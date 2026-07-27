"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UsageReportDto } from "@gioia/dto";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useRequireAuth } from "@/lib/use-require-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const usd = (n: number) =>
  n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
const num = (n: number) => n.toLocaleString();

export default function UsagePage() {
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session, isPending } = authClient.useSession();
  const [data, setData] = useState<UsageReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api.getUsage());
  }, []);

  useEffect(() => {
    if (!isPending && session?.user.role !== "admin") router.replace("/dashboard");
  }, [isPending, router, session]);

  useEffect(() => {
    if (authed && session?.user.role === "admin") {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load usage."));
    }
  }, [authed, load, session?.user.role]);

  if (!authed || isPending || session?.user.role !== "admin") return null;

  return (
    <main className="container mx-auto max-w-5xl py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Usage &amp; cost</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Estimated spend on the analysis models. Anthropic prices are list prices; Chutes
            open-model prices are estimates (edit <code>apps/api/src/analysis/pricing.ts</code>).
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <div className="space-y-8">
          {/* Totals */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Actual spend</CardDescription>
                <CardTitle className="text-3xl">{usd(data.totalActualUsd)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Real money spent — every model call counted once.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Attributed total (as if independent)</CardDescription>
                <CardTitle className="text-3xl">{usd(data.attributedTotalUsd)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Sum of per-case-study costs. Higher than actual: a reused file&apos;s cost is
                counted for every case study that selected it.
              </CardContent>
            </Card>
          </div>

          {data.unpricedModels.length > 0 && (
            <p className="text-xs text-amber-600">
              ⚠ No price set for: {data.unpricedModels.join(", ")} — their calls are counted as $0.
            </p>
          )}

          {/* Per case study */}
          <Card>
            <CardHeader>
              <CardTitle>Cost per case study</CardTitle>
              <CardDescription>
                Each case study&apos;s files (reuse included) plus its aggregate-dimension calls.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case study</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                    <TableHead className="text-right">Files cost</TableHead>
                    <TableHead className="text-right">Aggregate cost</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.perCaseStudy.map((c) => (
                    <TableRow key={c.regionCaseStudyId}>
                      <TableCell className="font-medium">{c.label}</TableCell>
                      <TableCell className="text-right">{c.fileCount}</TableCell>
                      <TableCell className="text-right">{usd(c.fileCostUsd)}</TableCell>
                      <TableCell className="text-right">{usd(c.aggregateCostUsd)}</TableCell>
                      <TableCell className="text-right font-semibold">{usd(c.totalUsd)}</TableCell>
                    </TableRow>
                  ))}
                  {data.perCaseStudy.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">No case studies yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Per file */}
          <Card>
            <CardHeader>
              <CardTitle>Cost per file</CardTitle>
              <CardDescription>
                The full cost of analysing each file (all pipeline steps, including the whole prompt
                — not just the document). Click a row for the per-call breakdown.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Case study type</TableHead>
                    <TableHead className="text-right">Input tokens</TableHead>
                    <TableHead className="text-right">Output tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.perDocument.map((d) => {
                    const isOpen = openDoc === d.documentId;
                    return (
                      <Fragment key={d.documentId}>
                        <TableRow
                          className="cursor-pointer hover:bg-accent/50"
                          onClick={() => setOpenDoc(isOpen ? null : d.documentId)}
                        >
                          <TableCell className="font-medium">
                            {isOpen ? "▾" : "▸"} {d.documentId}
                            <div className="text-xs text-muted-foreground">{d.policyName}</div>
                          </TableCell>
                          <TableCell>{d.caseStudyType}</TableCell>
                          <TableCell className="text-right">{num(d.inputTokens)}</TableCell>
                          <TableCell className="text-right">{num(d.outputTokens)}</TableCell>
                          <TableCell className="text-right font-semibold">{usd(d.costUsd)}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-muted/30">
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-muted-foreground">
                                    <tr>
                                      <th className="py-1 text-left">Step</th>
                                      <th className="py-1 text-left">Model</th>
                                      <th className="py-1 text-right">Input</th>
                                      <th className="py-1 text-right">Output</th>
                                      <th className="py-1 text-right">Cost</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.stages.map((s, i) => (
                                      <tr key={`${s.stage}-${i}`}>
                                        <td className="py-1">{s.stage}</td>
                                        <td className="py-1">
                                          {s.provider}:{s.model}
                                        </td>
                                        <td className="py-1 text-right">{num(s.inputTokens)}</td>
                                        <td className="py-1 text-right">{num(s.outputTokens)}</td>
                                        <td className="py-1 text-right">{usd(s.costUsd)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  {data.perDocument.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">No analyses recorded yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
