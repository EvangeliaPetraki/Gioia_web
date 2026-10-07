"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisErrorDto } from "@gioia/dto";
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

const when = (iso: string) => new Date(iso).toLocaleString();

export default function ErrorsPage() {
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session, isPending } = authClient.useSession();
  const [data, setData] = useState<AnalysisErrorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api.getErrors());
  }, []);

  useEffect(() => {
    if (!isPending && session?.user.role !== "admin") router.replace("/dashboard");
  }, [isPending, router, session]);

  useEffect(() => {
    if (authed && session?.user.role === "admin") {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load the error log."));
    }
  }, [authed, load, session?.user.role]);

  if (!authed || isPending || session?.user.role !== "admin") return null;

  return (
    <main className="container mx-auto max-w-5xl py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analysis errors</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Failed uploads, most recent first. The pipeline already retries a bad response once
            internally — this is what was still wrong after that retry, including the model&apos;s
            raw output when the failure was unparseable JSON.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Failed analyses</CardTitle>
            <CardDescription>Click a row for the full error and raw model output.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Case study</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((e) => {
                  const isOpen = openId === e.id;
                  return (
                    <Fragment key={e.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => setOpenId(isOpen ? null : e.id)}
                      >
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {isOpen ? "▾" : "▸"} {when(e.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium">{e.fileName}</TableCell>
                        <TableCell>{e.caseStudyLabel ?? "—"}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-destructive">
                          {e.message}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={4} className="bg-muted/30">
                            <div className="space-y-3 py-1">
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground">Error</p>
                                <p className="text-sm text-destructive">{e.message}</p>
                              </div>
                              {e.rawOutput && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground">
                                    Model&apos;s raw output
                                  </p>
                                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs">
                                    {e.rawOutput}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No failed analyses recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
