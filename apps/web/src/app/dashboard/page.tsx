"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisSummaryDto, PolicyListItemDto } from "@gioia/dto";
import { api, workbookDownloadUrl } from "@/lib/api";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type JobStatus = "queued" | "processing" | "done" | "error";

interface Job {
  id: string;
  name: string;
  status: JobStatus;
  summary?: AnalysisSummaryDto;
  error?: string;
}

let jobSeq = 0;

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [policies, setPolicies] = useState<PolicyListItemDto[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session } = authClient.useSession();

  const refreshPolicies = useCallback(async () => {
    if (!authed) return;
    try {
      setPolicies(await api.listPolicies());
    } catch {
      /* backend not ready yet — ignore */
    }
  }, [authed]);

  useEffect(() => {
    void refreshPolicies();
  }, [refreshPolicies]);

  // Authoritative job list (incl. the File) for the async pump loop; `setJobs`
  // mirrors it for rendering. Updating both keeps the loop race-free.
  const jobsRef = useRef<(Job & { file: File })[]>([]);

  const update = useCallback((id: string, patch: Partial<Job>) => {
    jobsRef.current = jobsRef.current.map((j) => (j.id === id ? { ...j, ...patch } : j));
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const pump = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    try {
      // Process sequentially so the shared codebook is updated atomically.
      for (;;) {
        const next = jobsRef.current.find((j) => j.status === "queued");
        if (!next) break;
        update(next.id, { status: "processing" });
        try {
          const summary = await api.analysePdf(next.file);
          update(next.id, { status: "done", summary });
          await refreshPolicies();
        } catch (e) {
          update(next.id, {
            status: "error",
            error: e instanceof Error ? e.message : "Analysis failed",
          });
        }
      }
    } finally {
      processing.current = false;
    }
  }, [refreshPolicies, update]);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const pdfs = Array.from(fileList).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (pdfs.length === 0) return;
      const newJobs = pdfs.map((file): Job & { file: File } => ({
        id: `job_${++jobSeq}`,
        name: file.name,
        status: "queued",
        file,
      }));
      jobsRef.current = [...jobsRef.current, ...newJobs];
      setJobs((prev) => [...prev, ...newJobs.map(({ file: _file, ...j }) => j)]);
      // Analysis does not start automatically — the user presses "Analyse".
    },
    [],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const queuedCount = jobs.filter((j) => j.status === "queued").length;
  const isProcessing = jobs.some((j) => j.status === "processing");

  if (!authed) return null;

  return (
    <main className="container mx-auto max-w-4xl py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gioia Policy Analysis</h1>
          <p className="mt-1 text-muted-foreground">
            Upload policy PDFs — each is coded into the SkillResilience4EU master codebook.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href="/codebook">View full analysis</a>
          </Button>
          <Button asChild variant="outline">
            <a href={workbookDownloadUrl()}>Download codebook (.xlsx)</a>
          </Button>
          {session?.user.role === "admin" && (
            <Button asChild variant="outline">
              <a href="/admin/users">Manage users</a>
            </Button>
          )}
          <Button variant="ghost" onClick={() => void authClient.signOut()}>
            Log out
          </Button>
        </div>
      </div>

      <Card className="mb-8">
        <CardContent className="pt-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
              dragging ? "border-primary bg-accent" : "border-input hover:bg-accent/50"
            }`}
          >
            <p className="font-medium">Drop policy PDFs here, or click to browse</p>
            <p className="mt-1 text-sm text-muted-foreground">PDF files only · multiple allowed</p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {(queuedCount > 0 || isProcessing) && (
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {isProcessing
                  ? "Analysis runs the full 11-step Gioia pipeline via Claude and can take a few minutes per document."
                  : `${queuedCount} file${queuedCount === 1 ? "" : "s"} ready to analyse.`}
              </p>
              <Button onClick={() => void pump()} disabled={isProcessing || queuedCount === 0}>
                {isProcessing
                  ? "Analysing…"
                  : `Analyse ${queuedCount} file${queuedCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {jobs.length > 0 && (
        <div className="mb-8 space-y-3">
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{job.name}</CardTitle>
                  <StatusBadge status={job.status} />
                </div>
                {job.summary && (
                  <CardDescription>
                    {job.summary.documentId} · {String(job.summary.governanceLevel)}
                  </CardDescription>
                )}
              </CardHeader>
              {job.summary && (
                <CardContent className="pt-0">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Metric label="Excerpts" value={job.summary.counts.excerpts} />
                    <Metric label="First-order concepts" value={job.summary.counts.firstOrderConcepts} />
                    <Metric label="Second-order themes" value={job.summary.counts.secondOrderThemes} />
                    <Metric label="Aggregate dimensions" value={job.summary.counts.aggregateDimensions} />
                    <Metric label="New themes" value={job.summary.counts.newThemes} />
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {job.summary.policySummary}
                  </p>
                </CardContent>
              )}
              {job.error && (
                <CardContent className="pt-0">
                  <p className="text-sm text-destructive">{job.error}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Master codebook</CardTitle>
          <CardDescription>
            Policies coded into SkillResilience4EU_Gioia_Master_Codebook.xlsx — click a
            row to open it in the full analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents coded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document ID</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Analysed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow
                    key={p.documentId}
                    onClick={() => router.push(`/codebook?doc=${encodeURIComponent(p.documentId)}`)}
                    className="cursor-pointer hover:bg-accent/50"
                  >
                    <TableCell className="font-medium">{p.documentId}</TableCell>
                    <TableCell>{p.policyName}</TableCell>
                    <TableCell>{p.countryOrRegion}</TableCell>
                    <TableCell>{p.governanceLevel}</TableCell>
                    <TableCell>{p.dateAnalysed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    queued: { label: "Queued", variant: "outline" },
    processing: { label: "Analysing…", variant: "secondary" },
    done: { label: "Done", variant: "default" },
    error: { label: "Error", variant: "destructive" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-3 py-1.5 text-sm">
      <span className="font-semibold">{value}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
