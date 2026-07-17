"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CodebookDto, CodebookSheetDto } from "@gioia/dto";
import { api, caseStudyWorkbookDownloadUrl } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useRequireAuth } from "@/lib/use-require-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const METADATA_SHEET = "Policy_Metadata";
const RAW_SHEET = "Raw_Data_Extraction";
const FIRST_ORDER_SHEET = "First_Order_Concepts";
const SECOND_ORDER_SHEET = "Second_Order_Themes";
const DATA_STRUCTURE_SHEET = "Gioia_Data_Structure";

/**
 * A column whose every value is at most this many characters is treated as
 * "compact": pinned to its content width so the free-text columns can absorb the
 * remaining table width instead of wrapping into tall, narrow blocks.
 */
const COMPACT_MAX_LEN = 18;

/** Sheets whose on-page view should lead with the source Document_ID column. */
const DOC_FIRST_SHEETS = new Set([RAW_SHEET, FIRST_ORDER_SHEET, SECOND_ORDER_SHEET]);

/**
 * Columns hidden from a sheet's on-page view (the Excel keeps every column, and
 * the values stay in each row so they can still be shown on hover).
 * - Raw_Data_Extraction: the per-row document metadata is redundant (the
 *   Document_ID link shows policy name/region on hover).
 * - First_Order_Concepts: the row-level instance ID is shown on hover over
 *   Concept_ID instead of as its own column.
 */
const HIDDEN_COLUMNS: Record<string, string[]> = {
  [RAW_SHEET]: ["Policy_Name", "Country_or_Region", "Governance_Level"],
  [FIRST_ORDER_SHEET]: ["Concept_Instance_ID"],
};

/**
 * Display-only reorder: for the document-scoped sheets, move Document_ID to the
 * first column so you can see at a glance which policy each row came from. The
 * Excel itself keeps the spec's column order — this only affects rendering.
 */
function withDocFirst(sheet: CodebookSheetDto): CodebookSheetDto {
  if (!DOC_FIRST_SHEETS.has(sheet.name)) return sheet;
  const idx = sheet.columns.indexOf("Document_ID");
  if (idx <= 0) return sheet;
  const move = <T,>(arr: T[]) => [arr[idx], ...arr.filter((_, i) => i !== idx)];
  return { ...sheet, columns: move(sheet.columns), rows: sheet.rows.map(move) };
}

/** Metadata facets offered as multi-select filters on the master codebook. */
const MULTI_FACETS: { key: string; label: string }[] = [
  { key: "Country_or_Region", label: "Country / Region" },
  { key: "Governance_Level", label: "Governance level" },
  { key: "Policy_Type", label: "Policy type" },
  { key: "Issuing_Actor", label: "Issuing actor" },
];

/** First 4-digit year found in a Policy_Year value (handles "2021", "2021–2027"). */
function parseYear(s: string | undefined): number | null {
  const m = (s ?? "").match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

/** Stable empty set so unselected facets don't create a new Set each render. */
const EMPTY_SET: Set<string> = new Set();

/** A dropdown of checkboxes for selecting several values of one facet. */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };

  return (
    <div ref={ref} className="relative flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 min-w-[11rem] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground"
      >
        <span className="truncate">{selected.size === 0 ? "All" : `${selected.size} selected`}</span>
        <span className="text-muted-foreground">▾</span>
      </button>
      {open && (
        <div className="absolute top-full z-20 mt-1 max-h-64 w-64 overflow-auto rounded-md border bg-background p-1 shadow-md">
          {options.map((o) => (
            <label
              key={o}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
            >
              <input type="checkbox" checked={selected.has(o)} onChange={() => toggle(o)} />
              <span className="truncate">{o}</span>
            </label>
          ))}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Distinct, sorted values of one column (for a filter dropdown). */
function distinctValues(sheet: CodebookSheetDto | undefined, column: string): string[] {
  if (!sheet) return [];
  const i = sheet.columns.indexOf(column);
  if (i < 0) return [];
  const set = new Set<string>();
  for (const r of sheet.rows) if (r[i]?.trim()) set.add(r[i].trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Keep only the rows of `sheet` belonging to one of `docIds` (null = no filter). */
function filterSheetByDocs(sheet: CodebookSheetDto, docIds: Set<string> | null): CodebookSheetDto {
  if (!docIds) return sheet;
  const di = sheet.columns.indexOf("Document_ID");
  if (di >= 0) return { ...sheet, rows: sheet.rows.filter((r) => docIds.has(r[di])) };
  // Sheets without a Document_ID column (Aggregate_Dimensions) match by the
  // documents named in Example_Policies.
  const ep = sheet.columns.indexOf("Example_Policies");
  if (ep >= 0) {
    return {
      ...sheet,
      rows: sheet.rows.filter((r) => [...docIds].some((d) => d && (r[ep] ?? "").includes(d))),
    };
  }
  return sheet;
}

export default function CodebookPage() {
  const [data, setData] = useState<CodebookDto | null>(null);
  const [active, setActive] = useState(METADATA_SHEET);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [caseStudyId, setCaseStudyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authed = useRequireAuth();

  useEffect(() => {
    if (!authed) return;
    const cs = new URLSearchParams(window.location.search).get("cs");
    setCaseStudyId(cs);
    if (!cs) {
      setError("Open a case study from the dashboard to view its codebook.");
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        setData(await api.getCaseStudyCodebook(cs));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load codebook");
      } finally {
        setLoading(false);
      }
    })();
  }, [authed]);

  // Deep link: /codebook?doc=<id> opens the metadata sheet with that document
  // selected (e.g. when arriving from the dashboard).
  useEffect(() => {
    const doc = new URLSearchParams(window.location.search).get("doc");
    if (doc) {
      setActive(METADATA_SHEET);
      setSelectedDoc(doc);
    }
  }, []);

  // ── Filters (by document metadata: countries, levels, year range, …) ─────
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [search, setSearch] = useState("");

  const fullMeta = data?.sheets.find((s) => s.name === METADATA_SHEET);
  const totalDocs = fullMeta?.rows.length ?? 0;
  const anyFilter =
    search.trim() !== "" ||
    yearFrom !== "" ||
    yearTo !== "" ||
    MULTI_FACETS.some((f) => (multi[f.key]?.size ?? 0) > 0);

  // Distinct numeric years present, for the year-range dropdowns.
  const yearOptions = useMemo(() => {
    const set = new Set<number>();
    const yi = fullMeta?.columns.indexOf("Policy_Year") ?? -1;
    if (fullMeta && yi >= 0) {
      for (const r of fullMeta.rows) {
        const y = parseYear(r[yi]);
        if (y) set.add(y);
      }
    }
    return [...set].sort((a, b) => a - b);
  }, [fullMeta]);

  // Document_IDs that pass the active filters (null = no filtering).
  const matchingDocs = useMemo<Set<string> | null>(() => {
    if (!fullMeta || !anyFilter) return null;
    const di = fullMeta.columns.indexOf("Document_ID");
    const ni = fullMeta.columns.indexOf("Policy_Name");
    const yi = fullMeta.columns.indexOf("Policy_Year");
    const from = yearFrom ? parseInt(yearFrom, 10) : null;
    const to = yearTo ? parseInt(yearTo, 10) : null;
    const q = search.trim().toLowerCase();
    const set = new Set<string>();
    for (const r of fullMeta.rows) {
      const multiOk = MULTI_FACETS.every((f) => {
        const sel = multi[f.key];
        if (!sel || sel.size === 0) return true;
        const ci = fullMeta.columns.indexOf(f.key);
        return ci >= 0 && sel.has(r[ci]);
      });
      let yearOk = true;
      if (from != null || to != null) {
        const y = yi >= 0 ? parseYear(r[yi]) : null;
        yearOk = y != null && (from == null || y >= from) && (to == null || y <= to);
      }
      const searchOk =
        !q ||
        (r[di] ?? "").toLowerCase().includes(q) ||
        (ni >= 0 && (r[ni] ?? "").toLowerCase().includes(q));
      if (multiOk && yearOk && searchOk && r[di]) set.add(r[di]);
    }
    return set;
  }, [fullMeta, multi, yearFrom, yearTo, search, anyFilter]);

  // Download the whole case-study codebook Excel (per-document filtering is a
  // view-only convenience here; the file is the full case-study codebook).
  const downloadHref = caseStudyId ? caseStudyWorkbookDownloadUrl(caseStudyId) : "#";

  // Every sheet, filtered to the matching documents.
  const displaySheets = useMemo(
    () => (data ? data.sheets.map((s) => filterSheetByDocs(s, matchingDocs)) : []),
    [data, matchingDocs],
  );

  const sheetByName = (name: string) => displaySheets.find((s) => s.name === name);
  const activeSheet = sheetByName(active);

  // Lookup of policy name + region per Document_ID (from the full, unfiltered
  // metadata) for the hover tooltip on Document_ID links.
  const docMeta = new Map<string, string>();
  if (fullMeta) {
    const di = fullMeta.columns.indexOf("Document_ID");
    const pi = fullMeta.columns.indexOf("Policy_Name");
    const ri = fullMeta.columns.indexOf("Country_or_Region");
    for (const r of fullMeta.rows) {
      if (di < 0 || !r[di]) continue;
      docMeta.set(r[di], [r[pi], r[ri]].filter(Boolean).join(" — "));
    }
  }

  const goToDocument = (documentId: string) => {
    setSelectedDoc(documentId);
    setActive(METADATA_SHEET);
  };

  // Per-cell rendering: Document_ID becomes a link to the document (policy name +
  // region on hover); Concept_ID shows its hidden instance ID on hover.
  const renderCell = (column: string, value: string, row: Record<string, string>): ReactNode => {
    if (column === "Document_ID" && value) {
      return (
        <button
          type="button"
          title={docMeta.get(value) || undefined}
          onClick={() => goToDocument(value)}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {value}
        </button>
      );
    }
    if (column === "Concept_ID" && value && row.Concept_Instance_ID) {
      return (
        <span
          title={`Instance ID: ${row.Concept_Instance_ID}`}
          className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
        >
          {value}
        </span>
      );
    }
    return value;
  };

  if (!authed) return null;

  return (
    <main className="mx-auto w-full max-w-[1800px] px-6 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Master codebook</h1>
          <p className="mt-1 text-muted-foreground">
            {data?.filename ?? "Overall Gioia analysis across all coded policies"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href="/dashboard">← Dashboard</a>
          </Button>
          {caseStudyId && (
            <Button asChild variant="outline">
              <a href={downloadHref}>Download .xlsx</a>
            </Button>
          )}
          <Button variant="ghost" onClick={() => void authClient.signOut()}>
            Log out
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Worksheets</CardTitle>
          <CardDescription>
            The full analysis, one tab per Excel sheet. Filter by document metadata
            below and every sheet narrows to the matching documents. On {METADATA_SHEET},
            click a document to see only its first- and second-order codes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading codebook…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {data && (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                {MULTI_FACETS.map((f) => {
                  const opts = distinctValues(fullMeta, f.key);
                  if (opts.length === 0) return null;
                  return (
                    <MultiSelect
                      key={f.key}
                      label={f.label}
                      options={opts}
                      selected={multi[f.key] ?? EMPTY_SET}
                      onChange={(next) => setMulti((prev) => ({ ...prev, [f.key]: next }))}
                    />
                  );
                })}

                {yearOptions.length > 0 && (
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Year range
                    <div className="flex items-center gap-1">
                      <select
                        value={yearFrom}
                        onChange={(e) => setYearFrom(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                      >
                        <option value="">From</option>
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">–</span>
                      <select
                        value={yearTo}
                        onChange={(e) => setYearTo(e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                      >
                        <option value="">To</option>
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Search
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Document ID or policy name"
                    className="h-9 w-64"
                  />
                </label>
                <div className="ml-auto flex items-center gap-3 self-end pb-0.5 text-sm text-muted-foreground">
                  <span>
                    Showing {matchingDocs ? matchingDocs.size : totalDocs} of {totalDocs} documents
                  </span>
                  {anyFilter && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMulti({});
                        setYearFrom("");
                        setYearTo("");
                        setSearch("");
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-1 border-b">
                {displaySheets.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => setActive(s.name)}
                    className={cn(
                      "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                      active === s.name
                        ? "border-primary font-medium"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.name}{" "}
                    <span className="text-xs text-muted-foreground">({s.rows.length})</span>
                  </button>
                ))}
              </div>

              {!activeSheet ? null : active === METADATA_SHEET ? (
                <MetadataSheet
                  sheet={activeSheet}
                  dataStructure={sheetByName(DATA_STRUCTURE_SHEET)}
                  renderCell={renderCell}
                  selectedDoc={selectedDoc}
                  onSelect={setSelectedDoc}
                />
              ) : active === DATA_STRUCTURE_SHEET ? (
                <DataStructureSheet sheet={activeSheet} renderCell={renderCell} />
              ) : (
                <SheetTable
                  sheet={withDocFirst(activeSheet)}
                  hiddenColumns={HIDDEN_COLUMNS[activeSheet.name]}
                  renderCell={renderCell}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function MetadataSheet({
  sheet,
  dataStructure,
  renderCell,
  selectedDoc,
  onSelect,
}: {
  sheet: CodebookSheetDto;
  dataStructure?: CodebookSheetDto;
  renderCell?: (column: string, value: string, row: Record<string, string>) => ReactNode;
  selectedDoc: string | null;
  onSelect: (doc: string | null) => void;
}) {
  const docIdx = sheet.columns.indexOf("Document_ID");

  // The Note column is editable; everything else renders as plain text.
  const renderMetaCell = (column: string, value: string, row: Record<string, string>): ReactNode => {
    if (column === "Note") {
      return <NoteCell key={row.Document_ID} documentId={row.Document_ID} initial={value} />;
    }
    return value;
  };

  return (
    <>
      <SheetTable
        sheet={sheet}
        onRowClick={(row) => onSelect(docIdx >= 0 ? row[docIdx] : null)}
        isRowSelected={(row) => docIdx >= 0 && row[docIdx] === selectedDoc}
        renderCell={renderMetaCell}
        wideColumns={["Note"]}
      />

      {selectedDoc ? (
        <div className="mt-6 space-y-4 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              Document {selectedDoc} — first-order concepts → second-order themes
            </h3>
            <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
              Clear selection
            </Button>
          </div>
          {dataStructure ? (
            <DataStructureSheet
              sheet={dataStructure}
              documentId={selectedDoc}
              upTo="theme"
              renderCell={renderCell}
              containerClassName="max-h-[34rem] overflow-auto rounded-md border bg-background"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No data structure available for this document.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Click a document row to see its first- and second-order codes.
        </p>
      )}
    </>
  );
}

/** Editable free-text note for one document, with a Save button (persists to the DB). */
function NoteCell({ documentId, initial }: { documentId: string; initial: string }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const dirty = draft !== saved;

  const save = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    setError(false);
    try {
      const res = await api.updateDocumentNote(documentId, draft);
      setSaved(res.note);
      setDraft(res.note);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a note…"
        className="h-8"
      />
      <Button
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty || saving}
        onClick={save}
        title={error ? "Save failed — try again" : undefined}
      >
        {saving ? "…" : error ? "Retry" : "Save"}
      </Button>
    </div>
  );
}

/**
 * Drag-to-resize column widths. Measures the natural (auto-layout) column widths
 * once after render, then renders a <colgroup> so the user can drag each header's
 * right edge to resize. `resetKey` should change when the column set changes, so
 * widths are re-measured for the new layout.
 */
function useResizableColumns(resetKey: string) {
  const [widths, setWidths] = useState<number[] | null>(null);
  const widthsRef = useRef<number[] | null>(null);
  const headRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  // New column set → drop measurements so they're recaptured for the new layout.
  useLayoutEffect(() => {
    widthsRef.current = null;
    setWidths(null);
  }, [resetKey]);

  // After an auto-layout render (no widths yet), capture the rendered widths.
  useLayoutEffect(() => {
    if (widthsRef.current === null && headRowRef.current) {
      const measured = Array.from(headRowRef.current.children).map((th) =>
        Math.round((th as HTMLElement).getBoundingClientRect().width),
      );
      if (measured.length > 0) {
        widthsRef.current = measured;
        setWidths(measured);
      }
    }
  });

  const startResize = useCallback((i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthsRef.current?.[i] ?? 0;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(64, startW + (ev.clientX - startX));
      setWidths((prev) => (prev ? prev.map((x, k) => (k === i ? w : x)) : prev));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  return { widths, headRowRef, startResize };
}

function SheetTable({
  sheet,
  onRowClick,
  isRowSelected,
  renderCell,
  hiddenColumns,
  wideColumns,
  emptyMessage = "No rows in this sheet yet.",
}: {
  sheet: CodebookSheetDto;
  onRowClick?: (row: string[]) => void;
  isRowSelected?: (row: string[]) => boolean;
  renderCell?: (column: string, value: string, row: Record<string, string>) => ReactNode;
  hiddenColumns?: string[];
  /** Columns forced to render wide (e.g. an editable cell) regardless of content length. */
  wideColumns?: string[];
  emptyMessage?: string;
}) {
  const hidden = new Set(hiddenColumns);
  const forcedWide = new Set(wideColumns);
  // Per-column layout: short columns get a fixed content-fitting width; the
  // free-text columns are left without a width so fixed layout splits the
  // remaining space equally between them (and wraps their content to fit).
  const cols = sheet.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !hidden.has(column))
    .map(({ column, index }) => {
      const maxLen = Math.max(
        column.length,
        ...sheet.rows.map((r) => (r[index] ?? "").length),
      );
      const compact = !forcedWide.has(column) && maxLen <= COMPACT_MAX_LEN;
      // +5ch covers the cell's px-3 padding (border-box) plus a little slack.
      return { column, index, compact, width: `${maxLen + 5}ch` };
    });

  const resetKey = `${sheet.name}|${cols.map((c) => c.column).join(",")}`;
  const { widths, headRowRef, startResize } = useResizableColumns(resetKey);
  const tableWidth = widths ? widths.reduce((a, b) => a + b, 0) : undefined;

  if (sheet.rows.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table className="table-fixed" style={tableWidth ? { width: tableWidth } : undefined}>
        {widths && (
          <colgroup>
            {widths.map((w, k) => (
              <col key={k} style={{ width: w }} />
            ))}
          </colgroup>
        )}
        <TableHeader>
          <TableRow ref={headRowRef}>
            {cols.map(({ column, compact, width }, k) => (
              <TableHead
                key={column}
                className={cn("relative overflow-hidden", compact && "whitespace-nowrap")}
                style={!widths && compact ? { width } : undefined}
              >
                {column}
                <span
                  onMouseDown={(e) => startResize(k, e)}
                  className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/30"
                />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sheet.rows.map((row, i) => {
            const record: Record<string, string> = Object.fromEntries(
              sheet.columns.map((c, j): [string, string] => [c, row[j]]),
            );
            return (
              <TableRow
                key={i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  onRowClick && "cursor-pointer hover:bg-accent/50",
                  isRowSelected?.(row) && "bg-accent",
                )}
              >
                {cols.map(({ column, index, compact }) => (
                  <TableCell
                    key={index}
                    className={cn(
                      "align-top text-sm",
                      compact
                        ? "overflow-hidden whitespace-nowrap"
                        : "whitespace-pre-wrap break-words",
                    )}
                  >
                    {renderCell ? renderCell(column, row[index], record) : row[index]}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The Gioia data structure rendered as a ladder: first-order concepts on the
 * left, with their second-order theme and aggregate dimension merged across the
 * concepts they group (HTML rowSpan). Rows are sorted into hierarchy order so
 * equal values are contiguous; a theme/dimension that recurs under a different
 * parent simply forms a separate merged block. Display-only — the Excel keeps
 * one flat row per concept.
 */
function DataStructureSheet({
  sheet,
  renderCell,
  documentId,
  upTo = "aggregate",
  containerClassName = "overflow-x-auto",
}: {
  sheet: CodebookSheetDto;
  renderCell?: (column: string, value: string, row: Record<string, string>) => ReactNode;
  /** When set, only this document's rows are shown and the Document_ID column is hidden. */
  documentId?: string;
  /** "theme" stops the ladder at the second-order theme (no aggregate columns). */
  upTo?: "aggregate" | "theme";
  containerClassName?: string;
}) {
  const idx = {
    docId: sheet.columns.indexOf("Document_ID"),
    conceptId: sheet.columns.indexOf("Concept_ID"),
    firstOrder: sheet.columns.indexOf("First_Order_Concept"),
    themeId: sheet.columns.indexOf("Theme_ID"),
    theme: sheet.columns.indexOf("Second_Order_Theme"),
    aggId: sheet.columns.indexOf("Aggregate_ID"),
    agg: sheet.columns.indexOf("Aggregate_Dimension"),
  };
  const withAgg = upTo === "aggregate";
  const hideDoc = documentId != null;

  const { widths, headRowRef, startResize } = useResizableColumns(
    `${sheet.name}|${documentId ?? "all"}|${upTo}|${sheet.rows.length}`,
  );
  const tableWidth = widths ? widths.reduce((a, b) => a + b, 0) : undefined;

  // If the required columns aren't present, fall back to a plain table.
  if (idx.theme < 0 || (withAgg && idx.agg < 0)) {
    return <SheetTable sheet={sheet} renderCell={renderCell} />;
  }

  const sourceRows =
    hideDoc && idx.docId >= 0
      ? sheet.rows.filter((r) => r[idx.docId] === documentId)
      : sheet.rows;

  if (sourceRows.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {hideDoc ? "No data structure for this document." : "No rows in this sheet yet."}
      </p>
    );
  }

  const aggKey = (r: string[]) => `${r[idx.aggId] ?? ""}|${r[idx.agg] ?? ""}`;
  const themeOnly = (r: string[]) => `${r[idx.themeId] ?? ""}|${r[idx.theme] ?? ""}`;
  // With aggregates shown, scope theme runs to their aggregate so a theme reused
  // under two dimensions forms separate blocks.
  const themeKey = withAgg ? (r: string[]) => `${aggKey(r)}||${themeOnly(r)}` : themeOnly;

  const rows = [...sourceRows].sort(
    (a, b) =>
      (withAgg ? aggKey(a).localeCompare(aggKey(b)) : 0) ||
      themeKey(a).localeCompare(themeKey(b)) ||
      (a[idx.firstOrder] ?? "").localeCompare(b[idx.firstOrder] ?? ""),
  );

  // For each merge column, the rowSpan to use on the row that *starts* a run of
  // equal keys; 0 on the rows it covers (which render no cell for that column).
  const spans = (keyOf: (r: string[]) => string) => {
    const out = new Array<number>(rows.length).fill(0);
    for (let i = 0; i < rows.length; ) {
      let j = i + 1;
      while (j < rows.length && keyOf(rows[j]) === keyOf(rows[i])) j++;
      out[i] = j - i;
      i = j;
    }
    return out;
  };
  const themeSpans = spans(themeKey);
  const aggSpans = withAgg ? spans(aggKey) : null;

  type Col = {
    label: string;
    col: number;
    compact: boolean;
    borderL: boolean;
    kind: "leaf" | "theme" | "agg";
    bold?: boolean;
    bg?: boolean;
  };
  const headers: Col[] = [];
  if (!hideDoc)
    headers.push({ label: "Document_ID", col: idx.docId, compact: true, borderL: false, kind: "leaf" });
  headers.push({ label: "Concept_ID", col: idx.conceptId, compact: true, borderL: false, kind: "leaf" });
  headers.push({ label: "First_Order_Concept", col: idx.firstOrder, compact: false, borderL: false, kind: "leaf" });
  headers.push({ label: "Theme_ID", col: idx.themeId, compact: true, borderL: true, kind: "theme", bold: true });
  headers.push({ label: "Second_Order_Theme", col: idx.theme, compact: false, borderL: false, kind: "theme" });
  if (withAgg) {
    headers.push({ label: "Aggregate_ID", col: idx.aggId, compact: true, borderL: true, kind: "agg", bold: true });
    headers.push({ label: "Aggregate_Dimension", col: idx.agg, compact: false, borderL: false, kind: "agg", bg: true });
  }

  const chWidth = (col: number, label: string) =>
    `${Math.max(label.length, ...sourceRows.map((r) => (r[col] ?? "").length)) + 5}ch`;

  return (
    <div className={containerClassName}>
      <Table className="table-fixed" style={tableWidth ? { width: tableWidth } : undefined}>
        {widths && (
          <colgroup>
            {widths.map((w, k) => (
              <col key={k} style={{ width: w }} />
            ))}
          </colgroup>
        )}
        <TableHeader>
          <TableRow ref={headRowRef}>
            {headers.map((h, k) => (
              <TableHead
                key={h.label}
                className={cn(
                  "relative overflow-hidden",
                  h.compact && "whitespace-nowrap",
                  h.borderL && "border-l",
                )}
                style={!widths && h.compact ? { width: chWidth(h.col, h.label) } : undefined}
              >
                {h.label}
                <span
                  onMouseDown={(e) => startResize(k, e)}
                  className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/30"
                />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => {
            const record: Record<string, string> = Object.fromEntries(
              sheet.columns.map((c, j): [string, string] => [c, row[j]]),
            );
            return (
              <TableRow key={i}>
                {headers.map((h) => {
                  const base = cn(
                    "text-sm",
                    h.borderL && "border-l",
                    h.bold && "font-medium",
                    h.bg && "bg-muted/20",
                    h.compact ? "overflow-hidden whitespace-nowrap" : "break-words",
                  );
                  if (h.kind === "leaf") {
                    return (
                      <TableCell key={h.label} className={cn(base, "align-top")}>
                        {renderCell ? renderCell(h.label, row[h.col], record) : row[h.col]}
                      </TableCell>
                    );
                  }
                  // Merged (theme/aggregate) cell: render only on the row that
                  // starts the run; covered rows render no cell here.
                  const span = h.kind === "theme" ? themeSpans[i] : aggSpans![i];
                  if (span <= 0) return null;
                  return (
                    <TableCell key={h.label} rowSpan={span} className={cn(base, "align-middle")}>
                      {row[h.col]}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
