import type {
  AnalysisSettingsDto,
  AnalysisSettingsResponseDto,
  AnalysisSummaryDto,
  CaseStudyAggregateStatusDto,
  CaseStudyCatalogDto,
  CaseStudyTypeDto,
  CodebookDto,
  CrossDocumentAggregateDto,
  PolicyDetailDto,
  PolicyListItemDto,
  PromptsDto,
  RegionCaseStudyDto,
  RegionDto,
  UpdateAnalysisSettingsDto,
} from "@gioia/dto";
import { API_URL } from "./api-url";

/** A missing or expired Better Auth session returns the user to sign-in. */
function handleUnauthorized() {
  if (typeof window !== "undefined") window.location.href = "/";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    ...init,
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Not authorized");
  }
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${message}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Download URL for one region-case-study's codebook; navigation sends the cookie. */
export function caseStudyWorkbookDownloadUrl(regionCaseStudyId: string): string {
  return `${API_URL}/analysis/region-case-studies/${encodeURIComponent(regionCaseStudyId)}/workbook`;
}

export const api = {
  /** Upload one PDF into a region's case study and run (or reuse) the analysis. */
  async analysePdf(file: File, regionCaseStudyId: string): Promise<AnalysisSummaryDto> {
    const form = new FormData();
    form.append("file", file);
    form.append("regionCaseStudyId", regionCaseStudyId);
    const res = await fetch(`${API_URL}/analysis/upload`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error("Not authorized");
    }
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { message?: string | string[] };
        if (body.message) {
          message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
        }
      } catch {
        // Keep the status text when the server did not return JSON.
      }
      throw new Error(message);
    }
    return res.json() as Promise<AnalysisSummaryDto>;
  },

  listPolicies: () => request<PolicyListItemDto[]>("/analysis/policies"),

  // ── Case-study organisation ────────────────────────────────────────────────

  /** The country→region→case-study tree + case-study-type taxonomy. */
  getCatalog: () => request<CaseStudyCatalogDto>("/analysis/catalog"),

  createRegion: (country: string, name: string, userIds: string[]) =>
    request<RegionDto>("/analysis/regions", {
      method: "POST",
      body: JSON.stringify({ country, name, userIds }),
    }),

  deleteRegion: (id: string) =>
    request<void>(`/analysis/regions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Rename a region / change its country (admin). */
  updateRegion: (id: string, country: string, name: string) =>
    request<RegionDto>(`/analysis/regions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ country, name }),
    }),

  /** Replace a region's owner set (admin). */
  setRegionOwners: (id: string, userIds: string[]) =>
    request<RegionDto>(`/analysis/regions/${encodeURIComponent(id)}/owners`, {
      method: "PUT",
      body: JSON.stringify({ userIds }),
    }),

  createCaseStudyType: (name: string) =>
    request<CaseStudyTypeDto>("/analysis/case-study-types", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  createRegionCaseStudy: (regionId: string, caseStudyTypeId: string) =>
    request<RegionCaseStudyDto>("/analysis/region-case-studies", {
      method: "POST",
      body: JSON.stringify({ regionId, caseStudyTypeId }),
    }),

  deleteRegionCaseStudy: (id: string) =>
    request<void>(`/analysis/region-case-studies/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Files one region-case-study has selected. */
  listCaseStudyPolicies: (regionCaseStudyId: string) =>
    request<PolicyListItemDto[]>(
      `/analysis/region-case-studies/${encodeURIComponent(regionCaseStudyId)}/policies`,
    ),

  /** Exclude a file from a case study (unlinks only; the analysis is kept). */
  excludeFile: (regionCaseStudyId: string, documentId: string) =>
    request<void>(
      `/analysis/region-case-studies/${encodeURIComponent(regionCaseStudyId)}/files/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    ),

  /** Aggregate dimensions over one region-case-study's selected files (admin). */
  aggregateForCaseStudy: (regionCaseStudyId: string) =>
    request<CrossDocumentAggregateDto>(
      `/analysis/region-case-studies/${encodeURIComponent(regionCaseStudyId)}/aggregate`,
      { method: "POST" },
    ),

  getPolicyDetail: (documentId: string) =>
    request<PolicyDetailDto>(`/analysis/policies/${encodeURIComponent(documentId)}`),

  /** One region-case-study's codebook (structured, 9 sheets). */
  getCaseStudyCodebook: (regionCaseStudyId: string) =>
    request<CodebookDto>(
      `/analysis/region-case-studies/${encodeURIComponent(regionCaseStudyId)}/codebook`,
    ),

  /** Freshness of a case study's aggregate vs its current files. */
  getAggregateStatus: (regionCaseStudyId: string) =>
    request<CaseStudyAggregateStatusDto>(
      `/analysis/region-case-studies/${encodeURIComponent(regionCaseStudyId)}/aggregate-status`,
    ),

  updateDocumentNote: (documentId: string, note: string) =>
    request<{ documentId: string; note: string }>(
      `/analysis/policies/${encodeURIComponent(documentId)}/note`,
      { method: "PATCH", body: JSON.stringify({ note }) },
    ),

  /** Current model selection + the options the admin UI renders. */
  getSettings: () => request<AnalysisSettingsResponseDto>("/analysis/settings"),

  /** Read-only view of the system prompts used in the LLM calls (admin). */
  getPrompts: () => request<PromptsDto>("/analysis/prompts"),

  /** Update the model selection (admin only). */
  updateSettings: (patch: UpdateAnalysisSettingsDto) =>
    request<AnalysisSettingsDto>("/analysis/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /** Synthesise aggregate dimensions across the selected documents (admin only). */
  aggregateDimensions: (documentIds: string[]) =>
    request<CrossDocumentAggregateDto>("/analysis/aggregate", {
      method: "POST",
      body: JSON.stringify({ documentIds }),
    }),

  /** Download the already-generated cross-document aggregate result as Excel. */
  async downloadAggregateWorkbook(result: CrossDocumentAggregateDto): Promise<void> {
    const res = await fetch(`${API_URL}/analysis/aggregate/workbook`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error("Not authorized");
    }
    if (!res.ok) {
      const message = await res.text().catch(() => res.statusText);
      throw new Error(`API ${res.status}: ${message}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const suffix = result.documentIds.length ? result.documentIds.join("_") : "selected-documents";
    a.href = url;
    a.download = `Gioia_Aggregate_Dimensions_${suffix}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
