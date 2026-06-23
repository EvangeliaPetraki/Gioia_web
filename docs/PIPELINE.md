# Gioia Policy-Analysis Pipeline — Full Reference

This document describes the complete analysis pipeline of the WP5.2 Gioia tool, in
execution order, with every file involved, the **verbatim prompts**, the data model,
and a candid list of research-correctness caveats.

> Provider note: the analysis runs on **GLM‑5‑Turbo via Chutes** (an OpenAI‑compatible
> endpoint), **not** Claude/Anthropic — despite a stale code comment that mentions
> Claude `output_config`. The model/endpoint are configurable via env vars.

---

## A. Runtime flow (in order)

### Stage 0 — Auth gate (before anything else)
- Login page `apps/web/src/app/page.tsx` → `api.login(code)` → `POST /api/auth/login`
  (`apps/api/src/auth/auth.controller.ts`).
- `apps/api/src/auth/auth.service.ts` compares the submitted code (constant‑time) to
  `ACCESS_CODE`; on success it returns an HMAC‑signed, 7‑day token stored in
  `localStorage`.
- `AuthGuard` (`apps/api/src/auth/auth.guard.ts`) is applied to the whole
  `AnalysisController`, so **every** `/api/analysis/*` call (including the paid model)
  requires a valid token (header `Authorization: Bearer …` or `?access_token=` for
  download links). No code → the model is unreachable.

### Stage 1 — Upload & queue (frontend)
File: `apps/web/src/app/dashboard/page.tsx`
1. PDFs dropped/selected → `addFiles` filters to PDFs and enqueues them with status
   `queued`. **Analysis does not auto‑start.**
2. Pressing **Analyse** runs `pump()`, which processes the queue **sequentially, one
   document at a time** (the shared codebook is updated atomically), calling
   `api.analysePdf(file)` for each job.

### Stage 2 — HTTP request
- `apps/web/src/lib/api.ts` → `analysePdf` sends `multipart/form-data` (field `file`)
  with the `Authorization` header to `POST /api/analysis/upload`.
- `apps/api/src/analysis/analysis.controller.ts` → `upload()`:
  - `@UseGuards(AuthGuard)` — token required.
  - `FileInterceptor` enforces **PDF‑only** + **≤ 25 MB**.
  - Calls `analysis.analyseDocument(file.originalname, file.buffer)`.

### Stage 3 — Orchestration
File: `apps/api/src/analysis/analysis.service.ts` → `analyseDocument`:
```
text            = pdf.extractText(buffer)                       // Stage 4
existingContext = codebook.getExistingContext()                 // Stage 5
analysis        = gioia.analyse(text, fileName, existingContext)// Stages 6–8
{documentId, newThemes} = codebook.append(analysis, fileName)   // Stage 9
return AnalysisSummaryDto                                        // Stage 10
```

### Stage 4 — PDF → text
File: `apps/api/src/analysis/pdf.service.ts`
- Uses `pdf-parse` (imported from `pdf-parse/lib/pdf-parse.js` to avoid a debug bug).
- **Text layer only — no OCR.** Rejects PDFs with < 100 extractable characters
  (treated as scanned/image‑only).
- Returns one concatenated string; page/section structure is largely flattened.

### Stage 5 — Existing‑codebook context (cross‑document memory)
File: `apps/api/src/analysis/codebook.service.ts` → `getExistingContext`
- Reads the **database** (Postgres via Prisma).
- If empty → returns a message telling the model to establish the initial structure.
- Otherwise returns a text block listing already‑coded `Document_ID`s plus the
  **distinct** `Concept_ID: label`, `Theme_ID: label`, and `Aggregate_ID: label`
  pairs already in the codebook. This is what enables **code reuse** (Step 7).

### Stage 6 — Prompt assembly
File: `apps/api/src/analysis/gioia.service.ts` → `analyse`. Two messages:
- **system** = `GIOIA_SYSTEM_PROMPT` + `"\n\n"` + `GIOIA_OUTPUT_CONTRACT`
  (both in `apps/api/src/analysis/gioia.constants.ts`).
- **user** = uploaded file name + Document_ID hint + the existing‑codebook context +
  the **entire extracted policy text** wrapped in `<<<BEGIN/END POLICY TEXT>>>`.

(Both reproduced verbatim in **Section B**.)

### Stage 7 — The LLM call (single shot, streamed)
File: `apps/api/src/analysis/gioia.service.ts` → `complete` / `stream`, via the OpenAI
SDK pointed at Chutes:
- **Endpoint:** `CHUTES_BASE_URL` (default `https://llm.chutes.ai/v1`).
- **Model:** `CHUTES_MODEL` (default `zai-org/GLM-5-Turbo`).
- **Params:** `temperature: 0.2`, `max_tokens: 32000`, `stream: true`,
  `response_format: { type: "json_object" }`.
- On HTTP `400`, it **retries once without** `response_format` (some deployments reject
  JSON mode). Timeout 600 s, `maxRetries: 1`.
- The **entire 11‑step analysis is produced in ONE completion**; streamed chunks are
  concatenated into a single string.

### Stage 8 — Parse
File: `apps/api/src/analysis/gioia.service.ts` → `parseAnalysis`
- Tries `JSON.parse` on (a) the raw text, (b) a code‑fence‑stripped version, (c) the
  substring between the first `{` and last `}`. Throws if none parse.
- **No schema validation** — the result is cast to `GioiaAnalysis`.

### Stage 9 — Persistence
File: `apps/api/src/analysis/codebook.service.ts` → `append` → `persist`
1. **Unique `Document_ID`:** if it collides with an existing one, re‑prefix to `_v2`,
   `_v3`, … and rewrite all child IDs (`rePrefix`).
2. **`newThemes`** = number of themes whose `Theme_ID` was not already in the DB.
3. One Prisma `$transaction` inserts the `AnalyzedDocument` (metadata + the three
   summary fields + the RQ memo + an empty `note`) and `createMany` for
   `rawExcerpt`, `firstOrderConcept`, `secondOrderTheme`, `aggregateDimension`,
   `gioiaStructureRow`. Every child row is tagged with `documentId` and an
   `orderIndex` (preserves the model's row order).

### Stage 10 — Response to the UI
`analyseDocument` returns `AnalysisSummaryDto` (documentId, policyName,
governanceLevel, counts, policySummary). The dashboard shows per‑document counts; the
policy appears in the analysed‑documents table (most‑recent‑first).

### Stage 11 — Viewing (`/codebook`)
File: `apps/web/src/app/codebook/page.tsx` → `api.getCodebook()` →
`getWorkbookData` → `buildSheets` rebuilds the 9 "sheets" from the DB (joining
document metadata into the Raw sheet; ordering by document, then `orderIndex`). The
page then applies **display‑only** transforms: Document_ID‑first ordering, hidden
columns, the merged Gioia‑ladder view, the metadata filters, and the editable Note
column.

### Stage 12 — Excel export
File: `apps/api/src/analysis/codebook.service.ts` → `generateWorkbookBuffer`
- Same `buildSheets`, then `applyWebpageLayout` (so the Excel column order/hiding
  matches the webpage), optionally limited to a `docIds` set passed from the filter UI.
- Streamed by `GET /api/analysis/workbook` (token via `?access_token=`).
- DB is the source of truth; the `.xlsx` is generated on demand (the old on‑disk file
  is only used for a one‑time legacy import on boot).

---

## B. The exact prompts

### B.1 System prompt — `GIOIA_SYSTEM_PROMPT`
(verbatim from `apps/api/src/analysis/gioia.constants.ts`)

```
You are assisting in a large-scale qualitative policy analysis using the Gioia methodology (Gioia, Corley & Hamilton, 2013). The project (SkillResilience4EU) maps twin-transition policies and labour-market adjustment strategies across Europe into an emergent master codebook.

MAIN RESEARCH QUESTION
How do labour-market and twin-transition policies across Europe construct and operationalise policy goals into implementation practices?

Subsidiary questions concern: (1) how policy actors frame labour-market challenges of the twin transition; (2) which policy instruments and implementation mechanisms drive labour-market adaptation; (3) how responsibilities and coordination are distributed across EU, national and regional governance levels; (4) how policies address social inclusion and uneven impacts across regions, sectors and vulnerable groups; (5) what implementation gaps, governance constraints or design tensions exist.

METHODOLOGICAL PRINCIPLES
- Inductive Gioia coding: raw excerpts -> first-order concepts (informant-centric, close to policy wording) -> second-order themes (researcher-centric) -> aggregate dimensions (theoretical).
- Preserve informant/policy language; employ gradual abstraction; keep transparent links between quotes and theory; do not collapse meaningful variation across governance levels; do not force excerpts into pre-existing categories when conceptual novelty is present.
- Sensitizing concepts (multi-level governance, policy coherence, place sensitivity, institutional capacity, labour-market adjustment, left-behind risk) are interpretive aids for SECOND-ORDER coding and cross-case comparison ONLY. They must NOT appear as first-order concepts unless those exact terms appear verbatim in the policy text.

LANGUAGE POLICY
First detect the document's original language. The data that stays close to the source stays in THAT ORIGINAL LANGUAGE; all researcher-generated, abstracted text is in ENGLISH.
- In the ORIGINAL LANGUAGE (do not translate): every verbatim excerpt/quote — raw_data_extraction.Excerpt_Text, first_order_concepts.Excerpt_Text and second_order_themes.Example_Quote — AND every first-order concept label — first_order_concepts.First_Order_Concept, the First_Order_Concepts list in second_order_themes, and gioia_data_structure.First_Order_Concept.
- In ENGLISH: all policy_metadata; all notes and flags (Initial_Notes, Coding_Notes, Analytical_Flags); all second-order themes (Second_Order_Theme) and the Second_Order_Themes lists in aggregate_dimensions; all aggregate_dimensions (Aggregate_Dimension, Description); and policy_summary, refinement_summary and research_question_memo.
- Keep IDs and Section_Page as-is. If the document is already in English, every field is simply in English.

ANALYSIS STEPS (produce all of the following for the attached policy document)
STEP 1 - Metadata: Policy_Name, Country_or_Region, Governance_Level (one of the allowed values), Policy_Year, Issuing_Actor, Policy_Type. Create Document_ID mirroring the uploaded file name where given (formats like EU_01, DE_NAT_01, IT_REG_01).
STEP 2 - Raw extraction: 25-40 relevant excerpts (exact verbatim wording in the document's original language, 1-3 sentences each) on twin transition & labour-market change, adjustment strategies, skills/reskilling/upskilling, employment disruption/restructuring/job creation, governance coordination, territorial inequality/regional vulnerability/left-behind places, and ambition vs delivery. Include section/page where possible. Give each a Raw_ID of the form {Document_ID}_RAW_001. In Initial_Notes flag the analytical issue (Labour-market challenge framing / Adjustment strategy / Governance coordination / Coherence signal / Territorial-place-sensitive response / Left-behind risk / Implementation constraint / Other). Avoid generic climate/digital ambition statements unless tied to labour markets, adjustment, governance or territory.
STEP 3 - First-order concepts: 40-80 total. For each, copy the source excerpt into Excerpt_Text, give Concept_Instance_ID of the form {Document_ID}_FOCINST_001 and a Concept_ID of the form FOC_1 identifying the concept itself. The concept is a short phrase (3-8 words) close to policy wording, written in the document's original language; 1-3 concepts per excerpt. Do NOT use abstract analytical labels (policy coherence, place sensitivity, multi-level governance, institutional complementarity) unless those exact terms appear in the policy text.
STEP 4 - Second-order themes: 10-20. Group semantically close first-order concepts; list their concepts (semicolon-separated, in the original language, matching the first-order labels) and their Concept_IDs (semicolon-separated); label each group with a researcher-centric theme IN ENGLISH; give Theme_ID of the form THM_1 and an Example_Quote (verbatim, in the original language).
STEP 5 - Aggregate dimensions: 4-8. Group semantically close themes; list the themes (semicolon-separated) in Second_Order_Themes and their Theme_IDs (semicolon-separated) in Theme_IDs; label each group with an Aggregate_Dimension; give Aggregate_ID of the form AGG_1, a Description, and Example_Policies (the Document_ID).
STEP 6 - Gioia data structure: one row per first-order concept linking Concept_ID + First_Order_Concept -> Theme_ID + Second_Order_Theme -> Aggregate_ID + Aggregate_Dimension.
STEP 7 - Cross-document comparison: compare with the existing master codebook supplied in the user message. Reuse existing Concept_IDs only where wording and meaning are highly similar; prefer reusing existing Theme_IDs and Aggregate_IDs where conceptual overlap is substantial, creating new ones only for genuinely distinct patterns. Record applicable flags in Analytical_Flags: [TENSION], [ABSENCE], [IMPLEMENTATION LOGIC: WEAK OPERATIONALISATION], [PLACE-SENSITIVE SIGNAL], [TERRITORIAL LOGIC: LIMITED DIFFERENTIATION]. Do not infer content not explicitly present in the policy.
STEP 8 - Policy summary: 150-250 words covering focus, labour-market framing, adjustment mechanisms, skills/workforce strategy, governance approach, place sensitivity, uneven-impact/left-behind acknowledgement, and notable coherence strengths/tensions/gaps. Discuss any flags raised.
STEP 9 - Refinement summary: 150-200 words explaining how/why concepts, themes and dimensions were refined for consistency, and justifying any newly introduced codes.
STEP 10 - Research-question memo: 150-250 words addressing the main and subsidiary questions for this document, including any flags.

NON-NEGOTIABLE RULES
- Every cell must contain substantive analytical content. Never use placeholder text ("TBD", "N/A", "Concepts", etc.). If something is genuinely undeterminable, use an empty string.
- Every excerpt must link to >=1 first-order concept; every first-order concept to a second-order theme; every theme to an aggregate dimension. No duplicate IDs within this document.
- Use IDs exactly in the prescribed formats and keep them internally consistent across the steps.

Each ID prefix must use the Document_ID you assign in policy_metadata. In aggregate_dimensions, Theme_IDs holds the semicolon-separated second-order Theme_IDs.
```

### B.2 Output contract — `GIOIA_OUTPUT_CONTRACT`
(appended to the system prompt; `${GOVERNANCE_LEVELS.join(", ")}` expands to the list
below)

```
OUTPUT FORMAT
Respond with a SINGLE JSON object and nothing else — no markdown, no code fences, no commentary. It must have exactly these keys:
{
  "policy_metadata": { "Document_ID": "", "Policy_Name": "", "Country_or_Region": "", "Governance_Level": "", "Policy_Year": "", "Issuing_Actor": "", "Policy_Type": "" },
  "raw_data_extraction": [ { "Raw_ID": "", "Section_Page": "", "Excerpt_Text": "", "Initial_Notes": "", "Analytical_Flags": "" } ],
  "first_order_concepts": [ { "Concept_Instance_ID": "", "Concept_ID": "", "Raw_ID": "", "Excerpt_Text": "", "First_Order_Concept": "", "Coding_Notes": "" } ],
  "second_order_themes": [ { "Theme_ID": "", "First_Order_Concept_IDs": "", "First_Order_Concepts": "", "Second_Order_Theme": "", "Example_Quote": "" } ],
  "aggregate_dimensions": [ { "Aggregate_ID": "", "Theme_IDs": "", "Second_Order_Themes": "", "Aggregate_Dimension": "", "Description": "", "Example_Policies": "" } ],
  "gioia_data_structure": [ { "Concept_ID": "", "First_Order_Concept": "", "Theme_ID": "", "Second_Order_Theme": "", "Aggregate_ID": "", "Aggregate_Dimension": "" } ],
  "policy_summary": "",
  "refinement_summary": "",
  "research_question_memo": { "RQ_Focus": "", "Analytical_Memo": "" }
}
All values are strings (multi-value fields are semicolon-separated). Use "" only when something is genuinely undeterminable. Governance_Level must be exactly one of: Supranational-EU, Supranational-other, National, Regional NUTS1, Regional NUTS2, Regional NUTS3, Local, Transnational. In aggregate_dimensions, "Theme_IDs" holds the semicolon-separated second-order Theme_IDs.
```

### B.3 User message template
(verbatim from `apps/api/src/analysis/gioia.service.ts`)

```
UPLOADED FILE NAME: <fileName>
Derive the Document_ID from this file name where it already encodes one (e.g. "EU_01.pdf" -> "EU_01").

CURRENT MASTER CODEBOOK (for cross-document comparison / code reuse — Step 7):
<existingContext>

POLICY DOCUMENT TEXT:
<<<BEGIN POLICY TEXT>>>
<full extracted policy text>
<<<END POLICY TEXT>>>
```

---

## C. Data model

9 logical worksheets are produced from **6 DB tables** (`apps/api/prisma/schema.prisma`):

| Worksheet | Source |
| --- | --- |
| `Policy_Metadata` | `AnalyzedDocument` (also folds the 3 summary sheets + the `Note`) |
| `Raw_Data_Extraction` | `RawExcerpt` (policy name/region/level joined from the parent) |
| `First_Order_Concepts` | `FirstOrderConcept` |
| `Second_Order_Themes` | `SecondOrderTheme` |
| `Aggregate_Dimensions` | `AggregateDimension` |
| `Gioia_Data_Structure` | `GioiaStructureRow` |
| `Policy_Summary` | `AnalyzedDocument.policySummary` |
| `Refinement_Summary` | `AnalyzedDocument.refinementSummary` |
| `Research_Question_Memo` | `AnalyzedDocument.rqFocus` / `analyticalMemo` |

Children cascade‑delete with their document and carry `orderIndex` to preserve row
order. The DB is the source of truth; the `.xlsx` is generated on demand.

---

## D. Research-correctness caveats

Places where the implementation departs from "textbook" Gioia, or where output is
**requested but not enforced**:

1. **Single‑pass, fully automated.** All 11 steps run in **one LLM call**, for **one
   document at a time**. No human‑in‑the‑loop, no iterative re‑clustering across the
   corpus. `refinement_summary` is a narrative the model writes *about itself*, not an
   actual second pass.
2. **The JSON schema is NOT enforced.** `GIOIA_OUTPUT_SCHEMA` exists in
   `gioia.constants.ts` but is **dead code — never imported**. The real call uses only
   `response_format: json_object` + the prose contract, then tolerant parsing. Field
   presence, the `Governance_Level` enum, ID formats, and the link‑integrity rules are
   all requested in prose, **never validated server‑side**.
3. **Counts are soft.** "25–40 excerpts", "40–80 concepts", etc. are instructions, not
   constraints; actual numbers vary per run.
4. **Cross‑document reuse (Step 7) is soft.** The model is *shown* existing codes and
   *asked* to reuse IDs, but nothing forces it. The same concept can receive a new
   `FOC_n` across documents.
5. **No chunking / context‑window risk.** The **entire** policy text goes in one
   message. A long PDF may exceed the model's input window or hit `max_tokens: 32000`
   on output → silent truncation. There is no splitting / map‑reduce.
6. **PDF fidelity.** Text‑layer extraction only (no OCR; scanned PDFs rejected at
   < 100 chars). Page/section boundaries are largely lost — `Section/Page` is whatever
   the model infers, not ground truth.
7. **Determinism.** `temperature: 0.2` — low but not 0; re‑running the same PDF can
   yield somewhat different codes.
8. **Aggregate dimensions are stored per‑document** (each upload contributes its own
   AGG rows), not as one global cross‑corpus set.
9. **Language policy is model‑dependent.** Verify that a non‑English document actually
   keeps excerpts + first‑order labels in the original language and the rest in
   English.
10. **Provider.** Analysis runs on **GLM‑5‑Turbo via Chutes**, not Claude — note this
    in any methods write‑up.

---

## E. File index

| Concern | File |
| --- | --- |
| Auth (login, token, guard) | `apps/api/src/auth/*` |
| Upload endpoint + guards | `apps/api/src/analysis/analysis.controller.ts` |
| Orchestration | `apps/api/src/analysis/analysis.service.ts` |
| PDF → text | `apps/api/src/analysis/pdf.service.ts` |
| Existing‑codebook context, persistence, sheets, Excel | `apps/api/src/analysis/codebook.service.ts` |
| Prompt assembly + LLM call + parsing | `apps/api/src/analysis/gioia.service.ts` |
| Prompts, output contract, sheet/column definitions, (unused) JSON schema | `apps/api/src/analysis/gioia.constants.ts` |
| DB schema | `apps/api/prisma/schema.prisma` |
| Frontend upload/queue | `apps/web/src/app/dashboard/page.tsx` |
| Frontend codebook viewer + filters + notes + export buttons | `apps/web/src/app/codebook/page.tsx` |
| Login page | `apps/web/src/app/page.tsx` |
| API client (token, auth headers, download URL) | `apps/web/src/lib/api.ts` |
