"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AnalysisSummaryDto,
  CaseStudyAggregateStatusDto,
  CaseStudyCatalogDto,
  CrossDocumentAggregateDto,
  PolicyListItemDto,
} from "@gioia/dto";
import { api, caseStudyWorkbookDownloadUrl } from "@/lib/api";
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

/** One selectable "region · case study" upload target, flattened from the catalog. */
interface CaseStudyOption {
  id: string;
  label: string;
  documentCount: number;
}

let jobSeq = 0;

const EMPTY_CATALOG: CaseStudyCatalogDto = { regions: [], caseStudyTypes: [] };

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [catalog, setCatalog] = useState<CaseStudyCatalogDto>(EMPTY_CATALOG);
  const [caseStudyId, setCaseStudyId] = useState("");
  const [policies, setPolicies] = useState<PolicyListItemDto[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";

  // Aggregate-dimension extraction for the selected case study (admin).
  const [aggregating, setAggregating] = useState(false);
  const [aggResult, setAggResult] = useState<CrossDocumentAggregateDto | null>(null);
  const [aggError, setAggError] = useState<string | null>(null);
  const [aggOpen, setAggOpen] = useState(false);
  const [downloadingAgg, setDownloadingAgg] = useState(false);
  const [aggStatus, setAggStatus] = useState<CaseStudyAggregateStatusDto | null>(null);

  const caseStudyOptions = useMemo<CaseStudyOption[]>(
    () =>
      catalog.regions.flatMap((r) =>
        r.caseStudies.map((cs) => ({
          id: cs.id,
          label: `${r.country} · ${r.name} · ${cs.caseStudyName}`,
          documentCount: cs.documentCount,
        })),
      ),
    [catalog],
  );

  const selectedOption = caseStudyOptions.find((o) => o.id === caseStudyId) ?? null;

  const refreshCatalog = useCallback(async () => {
    if (!authed) return;
    try {
      setCatalog(await api.getCatalog());
    } catch {
      /* backend not ready yet — ignore */
    }
  }, [authed]);

  const refreshPolicies = useCallback(async () => {
    if (!authed || !caseStudyId) {
      setPolicies([]);
      setAggStatus(null);
      return;
    }
    try {
      const [pols, status] = await Promise.all([
        api.listCaseStudyPolicies(caseStudyId),
        api.getAggregateStatus(caseStudyId),
      ]);
      setPolicies(pols);
      setAggStatus(status);
    } catch {
      /* ignore */
    }
  }, [authed, caseStudyId]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    void refreshPolicies();
  }, [refreshPolicies]);

  // Authoritative job list (incl. the File + its target case study) for the
  // async pump loop; `setJobs` mirrors it for rendering.
  const jobsRef = useRef<(Job & { file: File; caseStudyId: string })[]>([]);

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
          const summary = await api.analysePdf(next.file, next.caseStudyId);
          update(next.id, { status: "done", summary });
          await refreshPolicies();
          await refreshCatalog();
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
  }, [refreshCatalog, refreshPolicies, update]);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || !caseStudyId) return;
      const pdfs = Array.from(fileList).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (pdfs.length === 0) return;
      const newJobs = pdfs.map((file): Job & { file: File; caseStudyId: string } => ({
        id: `job_${++jobSeq}`,
        name: file.name,
        status: "queued",
        file,
        caseStudyId,
      }));
      jobsRef.current = [...jobsRef.current, ...newJobs];
      setJobs((prev) => [...prev, ...newJobs.map(({ file: _f, caseStudyId: _c, ...j }) => j)]);
      // Analysis does not start automatically — the user presses "Analyse".
    },
    [caseStudyId],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (caseStudyId) addFiles(e.dataTransfer.files);
  };

  const queuedCount = jobs.filter((j) => j.status === "queued").length;
  const isProcessing = jobs.some((j) => j.status === "processing");
  const hasCaseStudy = Boolean(caseStudyId);

  async function extractAggregate() {
    if (!caseStudyId) return;
    setAggregating(true);
    setAggError(null);
    setAggResult(null);
    setAggOpen(true);
    try {
      setAggResult(await api.aggregateForCaseStudy(caseStudyId));
      await refreshPolicies(); // refresh the staleness status
    } catch (e) {
      setAggError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setAggregating(false);
    }
  }

  async function excludeFile(documentId: string) {
    if (!caseStudyId) return;
    if (
      !confirm(
        `Exclude "${documentId}" from this case study?\n\nThe file's analysis is kept in the database and stays available to other case studies — this only removes it from this one.`,
      )
    ) {
      return;
    }
    try {
      await api.excludeFile(caseStudyId, documentId);
      await refreshPolicies();
      await refreshCatalog();
    } catch (e) {
      setAggError(e instanceof Error ? e.message : "Could not exclude the file.");
    }
  }

  async function downloadAggregateWorkbook() {
    if (!aggResult) return;
    setDownloadingAgg(true);
    setAggError(null);
    try {
      await api.downloadAggregateWorkbook(aggResult);
    } catch (e) {
      setAggError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloadingAgg(false);
    }
  }

  if (!authed) return null;

  return (
    <main className="container mx-auto max-w-6xl py-12">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <h1 className="text-3xl font-bold tracking-tight">Gioia Policy Analysis</h1>
          <p className="mt-1 text-muted-foreground">
            Pick a region&apos;s case study, then upload its policy PDFs — each is coded into the
            SkillResilience4EU master codebook.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button asChild variant="ghost">
            <a href="/how-it-works">How it works</a>
          </Button>
          {isAdmin && (
            <Menu label="Admin ▾">
              <MenuLink href="/admin/case-studies">Regions &amp; case studies</MenuLink>
              <MenuLink href="/admin/users">Manage users</MenuLink>
              <MenuLink href="/admin/settings">Model settings</MenuLink>
              <MenuLink href="/admin/prompts">View prompts</MenuLink>
            </Menu>
          )}
          <Button variant="ghost" onClick={() => void authClient.signOut()}>
            Log out
          </Button>
        </div>
      </div>

      {/* Case-study picker — the upload target. */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Case study</CardTitle>
              <CardDescription>
                Files are analysed within a region&apos;s case study. The same file re-uploaded to the
                same case study is reused rather than re-analysed.
              </CardDescription>
            </div>
            {hasCaseStudy && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={`/codebook?cs=${encodeURIComponent(caseStudyId)}`}>View full analysis</a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={caseStudyWorkbookDownloadUrl(caseStudyId)}>Download codebook (.xlsx)</a>
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {caseStudyOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No case studies exist yet.{" "}
              {isAdmin ? (
                <a className="underline" href="/admin/case-studies">
                  Create a region and case study
                </a>
              ) : (
                "Ask an administrator to create one."
              )}
              .
            </p>
          ) : (
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={caseStudyId}
              onChange={(e) => setCaseStudyId(e.target.value)}
            >
              <option value="">Select a region &amp; case study…</option>
              {caseStudyOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} ({o.documentCount})
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardContent className="pt-6">
          <div
            onDragOver={(e) => {
              if (!hasCaseStudy) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => hasCaseStudy && inputRef.current?.click()}
            aria-disabled={!hasCaseStudy}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
              !hasCaseStudy
                ? "cursor-not-allowed border-input opacity-60"
                : dragging
                  ? "cursor-pointer border-primary bg-accent"
                  : "cursor-pointer border-input hover:bg-accent/50"
            }`}
          >
            <p className="font-medium">
              {hasCaseStudy ? "Drop policy PDFs here, or click to browse" : "Select a case study first"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasCaseStudy
                ? `Uploading into: ${selectedOption?.label ?? ""}`
                : "The dropzone unlocks once a case study is selected."}
            </p>
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
                  ? "Analysis runs the full 11-step Gioia pipeline and can take a few minutes per document."
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
                  <div className="flex items-center gap-2">
                    {job.summary?.reused && <Badge variant="secondary">Reused</Badge>}
                    <StatusBadge status={job.status} />
                  </div>
                </div>
                {job.summary && (
                  <CardDescription>
                    {job.summary.documentId} · {String(job.summary.governanceLevel)}
                    {job.summary.reused ? " · linked from an earlier analysis" : ""}
                  </CardDescription>
                )}
              </CardHeader>
              {job.summary && (
                <CardContent className="pt-0">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Metric label="Excerpts" value={job.summary.counts.excerpts} />
                    <Metric label="First-order concepts" value={job.summary.counts.firstOrderConcepts} />
                    <Metric label="Second-order themes" value={job.summary.counts.secondOrderThemes} />
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>
                {selectedOption ? selectedOption.label : "Case-study files"}
              </CardTitle>
              <CardDescription>
                {hasCaseStudy
                  ? "Files analysed for this case study — click a row to open it in the full analysis."
                  : "Select a case study to see its analysed files."}
              </CardDescription>
            </div>
            {hasCaseStudy && policies.length > 0 && (
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Button onClick={() => void extractAggregate()} disabled={aggregating}>
                  {aggregating ? "Extracting…" : "Extract aggregate dimensions"}
                </Button>
                {aggStatus && <AggregateStatusHint status={aggStatus} />}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!hasCaseStudy ? (
            <p className="text-sm text-muted-foreground">No case study selected.</p>
          ) : policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files analysed for this case study yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document ID</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Analysed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow
                    key={p.documentId}
                    onClick={() =>
                      router.push(
                        `/codebook?cs=${encodeURIComponent(caseStudyId)}&doc=${encodeURIComponent(p.documentId)}`,
                      )
                    }
                    className="cursor-pointer hover:bg-accent/50"
                  >
                    <TableCell className="font-medium">{p.documentId}</TableCell>
                    <TableCell>{p.policyName}</TableCell>
                    <TableCell>{p.countryOrRegion}</TableCell>
                    <TableCell>{p.governanceLevel}</TableCell>
                    <TableCell>{p.dateAnalysed}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void excludeFile(p.documentId)}
                      >
                        Exclude
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {aggOpen && (
        <AggregateResultModal
          result={aggResult}
          loading={aggregating}
          error={aggError}
          downloading={downloadingAgg}
          onClose={() => setAggOpen(false)}
          onDownload={() => void downloadAggregateWorkbook()}
        />
      )}
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

/** A lightweight dropdown menu (no external dependency). Closes on outside click. */
function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
      </Button>
      {open && (
        <>
          {/* Click-catcher closes the menu when clicking anywhere else. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-20 mt-1 w-52 rounded-md border bg-card p-1 shadow-md"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="block rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </a>
  );
}

function AggregateStatusHint({ status }: { status: CaseStudyAggregateStatusDto }) {
  if (status.generatedAt === null) {
    return <span className="text-xs text-muted-foreground">Not extracted yet.</span>;
  }
  const when = new Date(status.generatedAt).toLocaleDateString();
  if (status.staleCount > 0) {
    return (
      <span className="text-xs text-amber-600">
        ⚠ File set changed since {when} ({status.staleCount} added/removed) — re-extract.
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Up to date ({when}).</span>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-3 py-1.5 text-sm">
      <span className="font-semibold">{value}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function AggregateResultModal({
  result,
  loading,
  error,
  downloading,
  onClose,
  onDownload,
}: {
  result: CrossDocumentAggregateDto | null;
  loading: boolean;
  error: string | null;
  downloading: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg border bg-card shadow-lg">
        <div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Aggregate Gioia structure</h2>
            {result ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {result.documentIds.length} documents · {result.themeCount} second-order themes ·{" "}
                {result.dimensions.length} aggregate dimensions
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Synthesising with the configured reasoning model.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button onClick={onDownload} disabled={!result || loading || downloading}>
              {downloading ? "Preparing..." : "Download Excel"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {loading && (
            <p className="text-sm text-muted-foreground">
              Synthesising aggregate dimensions across the case study&apos;s files. This may take a minute.
            </p>
          )}
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
          {result && (
            <div className="space-y-6">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Gioia data structure</h3>
                  <span className="text-sm text-muted-foreground">
                    {result.structureRows.length} first-order concept rows
                  </span>
                </div>
                <div className="max-h-[42vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[7rem]">Document</TableHead>
                        <TableHead className="min-w-[14rem]">1st-order concept</TableHead>
                        <TableHead className="min-w-[14rem]">2nd-order theme</TableHead>
                        <TableHead className="min-w-[14rem]">Aggregate dimension</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.structureRows.map((row, index) => (
                        <TableRow key={`${row.documentId}-${row.conceptId}-${row.themeId}-${index}`}>
                          <TableCell className="font-medium">{row.documentId}</TableCell>
                          <TableCell>
                            <div className="text-xs text-muted-foreground">{row.conceptId}</div>
                            <div>{row.firstOrderConcept}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-muted-foreground">{row.themeId}</div>
                            <div>{row.secondOrderTheme}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-muted-foreground">{row.aggregateId}</div>
                            <div>{row.aggregateDimension}</div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Aggregate dimensions</h3>
                  <span className="text-sm text-muted-foreground">
                    {result.dimensions.length} dimensions
                  </span>
                </div>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[7rem]">ID</TableHead>
                        <TableHead className="min-w-[14rem]">Dimension</TableHead>
                        <TableHead className="min-w-[18rem]">Description</TableHead>
                        <TableHead className="min-w-[18rem]">2nd-order themes</TableHead>
                        <TableHead className="min-w-[10rem]">Documents</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.dimensions.map((dimension) => (
                        <TableRow key={dimension.aggregateId}>
                          <TableCell>
                            <Badge variant="secondary">{dimension.aggregateId}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">{dimension.aggregateDimension}</TableCell>
                          <TableCell>{dimension.description}</TableCell>
                          <TableCell>{dimension.secondOrderThemes}</TableCell>
                          <TableCell>{dimension.examplePolicies}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
