"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PromptsDto } from "@gioia/dto";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useRequireAuth } from "@/lib/use-require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PromptsPage() {
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session, isPending } = authClient.useSession();
  const [data, setData] = useState<PromptsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setData(await api.getPrompts());
  }, []);

  useEffect(() => {
    if (!isPending && session?.user.role !== "admin") router.replace("/dashboard");
  }, [isPending, router, session]);

  useEffect(() => {
    if (authed && session?.user.role === "admin") {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load prompts."));
    }
  }, [authed, load, session?.user.role]);

  if (!authed || isPending || session?.user.role !== "admin") return null;

  return (
    <main className="container mx-auto max-w-4xl py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analysis prompts</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            The exact instructions given to the AI in each step, for transparency. These are
            <strong> read-only</strong> — they are wired to the pipeline&apos;s validation and output
            format, so they aren&apos;t editable here. Each call also includes the document text and
            the existing codebook as context, which aren&apos;t shown.
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
          {data.groups.map((group) => (
            <section key={group.title}>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">{group.title}</h2>
                {group.active && <Badge>Currently active</Badge>}
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{group.description}</p>

              <div className="space-y-3">
                {group.sections.map((section) => {
                  const isOpen = open[section.id] ?? false;
                  return (
                    <Card key={section.id}>
                      <CardHeader
                        className="cursor-pointer"
                        onClick={() => setOpen((p) => ({ ...p, [section.id]: !isOpen }))}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <CardTitle className="text-base">{section.title}</CardTitle>
                            <CardDescription>{section.description}</CardDescription>
                          </div>
                          <span className="shrink-0 text-sm text-muted-foreground">
                            {isOpen ? "Hide" : "Show"}
                          </span>
                        </div>
                      </CardHeader>
                      {isOpen && (
                        <CardContent>
                          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">
                            {section.content}
                          </pre>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
