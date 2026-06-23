# Staged Gioia Pipeline — Design Plan

Target design for refactoring the analysis pipeline from **one LLM call** into a
**staged, validated, dependency-driven pipeline**, faithful to the WP5.2 prompt
(`apps/api/static/WP5.2 prompt.pdf`). This is the plan we review **before** touching
code. The as-built (current) pipeline is documented separately in `docs/PIPELINE.md`.

---

## 1. Goals

1. **Research correctness** — make link integrity, ID formats, the governance enum,
   and code reuse reliable instead of "requested in prose, never enforced."
2. **Faithfulness to the WP5.2 PDF** — the canonical spec is the attached prompt; the
   current `gioia.constants.ts` has drifted in places (see §11). The plan re-bases on
   the PDF.
3. **Model-independence** — keep the staged orchestration decoupled from which model
   runs it, so the model decision (Phase 2) is a localized change.

## 2. Guiding principles

- **Same output object.** Each run still ends with the same `GioiaAnalysis` shape, so
  the controller, `codebook.service` persistence, the DB schema, `/codebook`, filters,
  notes, and Excel export are **all unchanged**. Only `GioiaService.analyse()`
  internals change.
- **One model seam.** Every stage talks to the model through a single helper
  (see §6). Phase 2 (model swap) rewrites that helper only.
- **Code does the mechanical work.** The Gioia data structure (Step 6) and the
  quality-control checks (Step 11) are assembled/verified in code, not asked of the
  model — guaranteeing internal consistency.

## 3. Decisions locked (this session)

| Decision | Choice |
| --- | --- |
| Stage granularity | **5 stages** (§5) |
| `policy_summary` placement | **Stage 1** (produced from the full document, with metadata + excerpts) |
| `refinement_summary` placement | **Stage 5** (needs the produced concepts/themes/dimensions) |
| Validation strictness | **Validate → one repair-retry → fail loudly** (no silent storage of bad data) |
| Single-call path | **Kept as an env-toggle fallback** (`PIPELINE_MODE=staged \| single`) |

---

## 4. CORE_FRAMING (shared context, from the PDF)

A single constant prepended to **every** stage's system prompt — the "what we study
and how." Written once, reused everywhere (cheap vs. the policy text; cacheable on
Claude in Phase 2). Content, verbatim-faithful to the PDF:

**Project:** SkillResilience4EU. Map twin-transition policies and labour-market
adjustment strategies across Europe into an emergent Gioia master codebook;
build comparable datasets for EU-level, national, and regional policies; stay
conceptually consistent across documents while open to inductive refinement.

**Main research question:** How do labour-market and twin-transition policies across
Europe construct and operationalise policy goals into implementation practices?

**Subsidiary research questions (exact PDF wording):**
1. How do policy actors frame labour-market challenges associated with the twin transition?
2. What policy instruments and implementation mechanisms are used to achieve labour-market adaptation in the twin transition?
3. How are responsibilities and coordination distributed across EU, national, and regional governance levels in implementing these policies?
4. How do policies conceptualise and address social inclusion and uneven impacts across regions, sectors, and vulnerable groups?
5. What implementation gaps, governance constraints, or design tensions can be identified in existing policy frameworks?

**Analytical orientation:** Treat the document as a source of policy framing,
labour-market problem definitions, proposed adjustment mechanisms, governance
arrangements, and territorial assumptions. Attend to how the policy: defines
labour-market risks/disruptions/opportunities linked to the twin transition; proposes
adjustment measures (skills, training, education, mobility, job creation, social
protection, industrial restructuring); distributes responsibility across governance
levels; reflects coherence or inconsistency across objectives/instruments/
implementation logics; addresses or overlooks territorial unevenness, regional
vulnerability, and left-behind groups/places.

**Sensitizing concepts** — interpretive aids for **second-order coding and cross-case
comparison ONLY**. They must **not** appear as first-order concepts unless those exact
terms appear verbatim in the policy text, and must not constrain inductive coding:
- **Multi-level governance** — how authority, responsibility, and coordination are distributed across governance levels.
- **Policy coherence** — whether objectives, instruments, and strategies are mutually reinforcing.
- **Place sensitivity** — whether design recognises territorial differences in transition capacity, labour-market structure, and regional vulnerability.
- **Institutional capacity** — the ability of actors/institutions to implement and coordinate transition-related measures.
- **Labour-market adjustment** — how policies anticipate and manage workforce transitions associated with decarbonisation.
- **Left-behind risk** — whether workers/sectors/territories are framed as vulnerable to exclusion, decline, or uneven transition effects.

**Methodological rules (Gioia, Corley & Hamilton 2013):** preserve informant language;
gradual abstraction; transparent links between quotes and theory; keep first-order
concepts close to the policy's own vocabulary; use second-order themes and aggregate
dimensions to interpret patterns; do not collapse meaningful variation across
governance levels; do not force excerpts into pre-existing categories when conceptual
novelty is present.

**Non-negotiable output rule:** every populated cell must contain substantive
analytical content — never placeholders ("TBD", "N/A", "Concepts", …). If something is
genuinely undeterminable, use an empty string.

**Language policy (project addition — beyond the PDF):** detect the document's original
language. Verbatim excerpts/quotes and first-order concept labels stay in the
**original language**; all researcher-generated/abstracted text (metadata, notes,
second-order themes, aggregate dimensions, summaries, memo) is in **English**. (Kept
from the current implementation; the PDF is silent on language.)

---

## 5. The five stages

Each stage = `CORE_FRAMING` + stage instructions + that stage's output contract,
sent through the LLM-call helper, then validated (§7). Inputs flow forward as concrete
prior artifacts, so links are grounded rather than re-derived.

### Stage 1 — Metadata + Raw excerpts + Policy summary  *(PDF Steps 1, 2, 8)*
- **Input:** full policy text (the only stage that needs it).
- **Produces:**
  - `policy_metadata`: `Document_ID` (mirror the uploaded file name), `Policy_Name`,
    `Country_or_Region`, `Governance_Level` (∈ the 8 allowed values), `Policy_Year`,
    `Issuing_Actor`, `Policy_Type`.
  - `raw_data_extraction[]`: 25–40 excerpts (soft target) — `Raw_ID`
    (`{Document_ID}_RAW_001`), `Section_Page`, `Excerpt_Text` (exact wording, 1–3
    sentences), `Initial_Notes` (one of: *Labour-market challenge framing / Adjustment
    strategy / Governance coordination / Coherence signal / Territorial-place-sensitive
    response / Left-behind risk / Implementation constraint / Other relevant issue*).
    **`Analytical_Flags` left blank here** — assigned in Stage 5 (PDF: "Leave blank in
    Step 2, complete in Step 7").
  - `policy_summary`: 150–250 words (focus, labour-market framing, adjustment
    mechanisms, skills/workforce strategy, governance approach, place sensitivity,
    uneven-impact/left-behind acknowledgement, coherence strengths/tensions/gaps).
    **Without** the flag discussion (flags don't exist yet — see §10).
- **Extraction rules (from the PDF):** exact wording; page/section where possible;
  prioritise problem framing, instruments, implementation logic, territorial
  differentiation; avoid generic climate/digital/twin-transition ambition statements
  unless tied to labour markets, adjustment, governance, or territory.

### Stage 2 — First-order concepts  *(PDF Step 3)*
- **Input:** the **excerpts from Stage 1** (not the full text) + existing-codebook
  concepts (for reuse, Step 7).
- **Produces:** `first_order_concepts[]` (40–80 soft target) — `Concept_Instance_ID`
  (`{Document_ID}_FOCINST_001`), `Concept_ID` (`FOC_1`), `Raw_ID` (must reference a
  Stage-1 excerpt), `Excerpt_Text` (copied verbatim from the source excerpt),
  `First_Order_Concept` (short phrase, 3–8 words, informant-centric, original
  language), `Coding_Notes`. 1–3 concepts per excerpt.
- **Rules:** preserve policy wording; concepts should reflect labour-market problems,
  transition risks, workforce responses, governance arrangements, implementation
  mechanisms, territorial targeting/omission, vulnerable sectors/groups/regions. Do
  **not** use abstract analytical labels (policy coherence, place sensitivity,
  multi-level governance, institutional complementarity) unless verbatim in the text.

### Stage 3 — Second-order themes  *(PDF Step 4)*
- **Input:** the **first-order concept list** (IDs + labels) + existing-codebook themes.
- **Produces:** `second_order_themes[]` (10–20 soft target) — `Theme_ID` (`THM_1`),
  `First_Order_Concept_IDs` (semicolon-separated, referencing real `Concept_ID`s),
  `First_Order_Concepts` (semicolon-separated labels, original language, matching the
  concept labels), `Second_Order_Theme` (researcher-centric label, **English**),
  `Example_Quote` (verbatim, original language).
- **Rules:** group semantically close concepts; reuse an existing `Theme_ID` on strong
  conceptual fit, create a new one only for a substantively distinct pattern. Example
  theme directions from the PDF are illustrative only, never imposed.

### Stage 4 — Aggregate dimensions  *(PDF Step 5)*
- **Input:** the **theme list** (IDs + labels) + existing-codebook dimensions.
- **Produces:** `aggregate_dimensions[]` (4–8 soft target) — `Aggregate_ID` (`AGG_1`),
  `Theme_IDs` (semicolon-separated, referencing real `Theme_ID`s — written to the
  `Theme_ID` column per the PDF), `Second_Order_Themes` (semicolon-separated labels),
  `Aggregate_Dimension` (English), `Description`, `Example_Policies` (the `Document_ID`).
- **Rules:** dimensions should be relatively stable across the dataset; create a new
  one only when existing dimensions can't capture an emerging pattern. Illustrative
  dimension directions from the PDF are not imposed.

### Stage 5 — Cross-document flags + Refinement summary + RQ memo  *(PDF Steps 7, 9, 10)*
- **Input:** the **assembled structure** (concepts → themes → dimensions) + the
  existing master codebook (what was reused vs. newly introduced).
- **Produces:**
  - `analytical_flags[]`: `{ Raw_ID, flags[] }` where flags ∈ `[TENSION]`, `[ABSENCE]`,
    `[IMPLEMENTATION LOGIC: WEAK OPERATIONALISATION]`, `[PLACE-SENSITIVE SIGNAL]`,
    `[TERRITORIAL LOGIC: LIMITED DIFFERENTIATION]`. Written back to the
    `Analytical_Flags` column of the referenced raw excerpts (PDF Step 7).
  - `refinement_summary`: 150–200 words — how/why concepts/themes/dimensions were
    refined for consistency; explicitly justify any **newly introduced** codes; note
    whether the document reinforced existing framings, introduced new concerns, etc.
  - `research_question_memo`: `{ RQ_Focus, Analytical_Memo }`, 150–250 words addressing
    the main + subsidiary RQs for this document, discussing any flags raised.

### Code-assembled — Gioia data structure  *(PDF Step 6)*
Built in code by joining concept → theme → dimension links (no model call). Columns:
`Document_ID | Concept_ID | First_Order_Concept | Theme_ID | Second_Order_Theme |
Aggregate_ID | Aggregate_Dimension` (the PDF's `Aggreagere_ID` typo is **corrected to
`Aggregate_ID`** per the team's decision). This **guarantees** the ladder is internally
consistent.

---

## 6. The LLM-call helper

A single function every stage uses, so provider/SDK details live in one place:

```
callModel(systemPrompt, userMessage, { schema, label }) → validated, parsed JSON
```

Responsibilities: client construction, model id, streaming, JSON-mode request (+ the
no-JSON-mode fallback), tolerant parse (code-fence / prose stripping), the repair-retry
loop (§7), and per-call logging. Today this is ~80% present as `complete()` /
`stream()` / `parseAnalysis()` in `gioia.service.ts`; we extract and generalize it.

**This is the only seam Phase 2 touches.** Swapping GLM/Chutes → Claude means rewriting
this helper (Anthropic SDK, `output_config.format` for native schema enforcement, drop
`temperature`, optional native-PDF input) — no stage changes.

---

## 7. Validation strategy (the research-correctness payoff)

Per stage, after parsing, run checks; on failure send the errors back to the model
**once** ("your output failed these checks: … return corrected JSON"); if it still
fails, **throw** — the upload errors and nothing is stored (fail loudly).

Per-stage checks:
- **Stage 1:** `Governance_Level` ∈ enum; `Document_ID` present; `Raw_ID`s unique and
  matching `{Document_ID}_RAW_\d+`; `Initial_Notes` ∈ allowed set; summary length sane.
- **Stage 2:** `Concept_ID` matches `FOC_\d+`, `Concept_Instance_ID` matches
  `{Document_ID}_FOCINST_\d+`; every `Raw_ID` exists in Stage 1; **every excerpt is
  covered by ≥1 concept** (PDF Step 11).
- **Stage 3:** `Theme_ID` matches `THM_\d+`; every referenced `Concept_ID` exists;
  **every concept appears in some theme** (Step 11).
- **Stage 4:** `Aggregate_ID` matches `AGG_\d+`; every referenced `Theme_ID` exists;
  **every theme appears in some dimension** (Step 11).
- **Stage 5:** flags ∈ allowed set; referenced `Raw_ID`s valid.
- **No duplicate IDs** within the document (Step 11).

Counts (25–40 / 40–80 / 10–20 / 4–8) are **soft targets**, not hard failures — the PDF
explicitly allows higher/lower depending on the document.

---

## 8. Cross-document reuse (PDF Step 7)

Not a separate model call — the existing-codebook context (distinct `Concept_ID`/
`Theme_ID`/`Aggregate_ID` → label pairs, already built by
`CodebookService.getExistingContext()`) is **injected into Stages 2–4** so the model
reuses IDs where wording/meaning match. The **outputs** of Step 7 (the analytical
flags, and the discussion of reuse) are produced in **Stage 5**.

## 9. What stays unchanged

Controller, `analysis.service` orchestration contract, `codebook.service` persistence,
Prisma schema, `/codebook` viewer, filters, the editable Note, the auth gate, and Excel
export. The staged pipeline assembles the **same `GioiaAnalysis`** and hands it to the
existing `codebook.append()`.

## 10. Deliberate deviations from the PDF (with rationale)

1. **`policy_summary` moves to Stage 1** (PDF Step 8 is near the end). Rationale: it's a
   document-level reading, and Stage 1 is the only stage with the full text — producing
   it there keeps it grounded in the source rather than the abstracted codes. **Cost:**
   the PDF's Step 8 says the summary should discuss the analytical flags, which don't
   exist until Stage 5. We therefore **drop the flag discussion from the summary** and
   let the **RQ memo + refinement summary (Stage 5)** carry the flag synthesis. (Your
   explicit decision; flagged here so the deviation is on record.)
2. **`Gioia_Data_Structure` is code-assembled** rather than model-produced (PDF Step 6
   asks the model to fill it). Rationale: it's a pure join; assembling it in code makes
   the ladder provably consistent.
3. **Language policy** is retained as a project addition (the PDF is English-only).

## 11. Corrections vs. the current implementation (to apply during build)

Drift between `gioia.constants.ts` and the PDF, to fix when we implement:
- **Subsidiary RQ wording** — align to the exact PDF phrasing (esp. RQ2:
  "*What policy instruments and implementation mechanisms are used to achieve
  labour-market adaptation in the twin transition?*").
- **Sensitizing concepts** — include all six **with their PDF definitions** (currently
  listed without definitions).
- **First-order "should reflect" list** — ensure the seven PDF categories are present
  (labour-market problems, transition risks, workforce responses, governance
  arrangements, implementation mechanisms, territorial targeting/omission, vulnerable
  sectors/groups/regions).
- **`Initial_Notes` allowed set** — eight values including "Other relevant issue".
- **`Analytical_Flags` timing** — must be **blank at extraction** and assigned in the
  cross-document step (Stage 5), per the PDF. (The current single-call assigns them
  inline.)
- **Aggregate dimensions** — `Theme_ID` column holds the semicolon-separated theme IDs;
  `Example_Policies` = the `Document_ID`. (Matches PDF; keep.)
- **Counts are soft** — phrase as targets, not requirements (PDF allows deviation).
- **`Aggreagere_ID` → `Aggregate_ID`** in `Gioia_Data_Structure` — the PDF's typo is
  corrected (team decision). Backend already used `Aggregate_ID`; the frontend
  reference was fixed to match.

## 12. Implementation sequence (Phase 1)

1. Extract the **LLM-call helper** + per-stage JSON validation (no behavior change).
2. Add **deterministic `Gioia_Data_Structure` assembly** + the Step 11 QC checks.
3. Re-base the prompts on the PDF and **split into the five stages**, behind
   `PIPELINE_MODE` (default `single` until staged is proven).
4. Wire **Stage 5 flag write-back** into the `Analytical_Flags` of the raw excerpts.
5. Verify each stage against a real PDF; once solid, flip the default to `staged` and
   keep `single` as fallback.

Nothing in this phase changes the model/provider.

## 13. Phase 2 (models) — pointer

After the staged pipeline is in place, swap the model behind the §6 helper and upgrade
code-side validation to **provider-native structured outputs** (Claude
`output_config.format`), optionally moving to **native-PDF input + page-accurate
citations** for real `Section/Page` values. Model selection is tracked separately
(Opus 4.8 vs. Sonnet 4.6 vs. a staged mix).
