import type {
  AnalysisSettingsDto,
  AnalysisSettingsResponseDto,
  AnalysisSummaryDto,
  CodebookDto,
  CrossDocumentAggregateDto,
  PolicyDetailDto,
  PolicyListItemDto,
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

/** Download URL for the master codebook; navigation includes the session cookie. */
export function workbookDownloadUrl(docs?: string[]): string {
  const params = new URLSearchParams();
  if (docs && docs.length > 0) params.set("docs", docs.join(","));
  const qs = params.toString();
  return `${API_URL}/analysis/workbook${qs ? `?${qs}` : ""}`;
}

export const api = {
  /** Upload one PDF policy document and run the Gioia analysis. */
  async analysePdf(file: File): Promise<AnalysisSummaryDto> {
    const form = new FormData();
    form.append("file", file);
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

  getPolicyDetail: (documentId: string) =>
    request<PolicyDetailDto>(`/analysis/policies/${encodeURIComponent(documentId)}`),

  getCodebook: () => request<CodebookDto>("/analysis/codebook"),

  updateDocumentNote: (documentId: string, note: string) =>
    request<{ documentId: string; note: string }>(
      `/analysis/policies/${encodeURIComponent(documentId)}/note`,
      { method: "PATCH", body: JSON.stringify({ note }) },
    ),

  /** Current model selection + the options the admin UI renders. */
  getSettings: () => request<AnalysisSettingsResponseDto>("/analysis/settings"),

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
