import { GOVERNANCE_LEVELS } from "@gioia/dto";

/** The exact master-codebook filename mandated by WP5.2 (must not be renamed). */
export const CODEBOOK_FILENAME = "SkillResilience4EU_Gioia_Master_Codebook.xlsx";

/**
 * The existing codebook's distinct code vocabulary, split by abstraction level
 * so each pipeline stage can be handed only the level it reuses (Step 7). Each
 * entry is an `"ID: label"` string, e.g. `"FOC_1: reskilling tourism workforce"`.
 */
export interface ExistingContext {
  documentIds: string[];
  concepts: string[];
  themes: string[];
  dimensions: string[];
  isEmpty: boolean;
}

/**
 * Worksheet definitions: sheet name + ordered column headers, copied verbatim
 * from the WP5.2 prompt (including its exact spellings such as "Section/Page"
 * and "Aggregate_ID"). These headers must never be renamed or reordered.
 */
export const SHEETS = {
  PolicyMetadata: {
    name: "Policy_Metadata",
    columns: [
      "Document_ID",
      "Policy_Name",
      "Country_or_Region",
      "Governance_Level",
      "Policy_Year",
      "Issuing_Actor",
      "Policy_Type",
      "Source_File",
      "Date_Analysed",
      "Note",
    ],
  },
  RawDataExtraction: {
    name: "Raw_Data_Extraction",
    columns: [
      "Raw_ID",
      "Document_ID",
      "Policy_Name",
      "Country_or_Region",
      "Governance_Level",
      "Section/Page",
      "Excerpt_Text",
      "Initial_Notes",
      "Analytical_Flags",
    ],
  },
  FirstOrderConcepts: {
    name: "First_Order_Concepts",
    columns: [
      "Concept_Instance_ID",
      "Concept_ID",
      "Document_ID",
      "Raw_ID",
      "Excerpt_Text",
      "First_Order_Concept",
      "Coding_Notes",
    ],
  },
  SecondOrderThemes: {
    name: "Second_Order_Themes",
    columns: [
      "Theme_ID",
      "Document_ID",
      "First_Order_Concept_IDs",
      "First_Order_Concepts",
      "Second_Order_Theme",
      "Example_Quote",
    ],
  },
  AggregateDimensions: {
    name: "Aggregate_Dimensions",
    columns: [
      "Aggregate_ID",
      "Theme_ID",
      "Second_Order_Themes",
      "Aggregate_Dimension",
      "Description",
      "Example_Policies",
    ],
  },
  GioiaDataStructure: {
    name: "Gioia_Data_Structure",
    columns: [
      "Document_ID",
      "Concept_ID",
      "First_Order_Concept",
      "Theme_ID",
      "Second_Order_Theme",
      "Aggregate_ID",
      "Aggregate_Dimension",
    ],
  },
  PolicySummary: {
    name: "Policy_Summary",
    columns: ["Document_ID", "Policy_Summary"],
  },
  RefinementSummary: {
    name: "Refinement_Summary",
    columns: ["Document_ID", "Refinement_Summary"],
  },
  ResearchQuestionMemo: {
    name: "Research_Question_Memo",
    columns: ["Document_ID", "RQ_Focus", "Analytical_Memo"],
  },
} as const;

const str = { type: "string" } as const;

/**
 * JSON Schema passed to Claude via `output_config.format`. The model fills only
 * the analytical fields; the backend injects repeated metadata (Document_ID,
 * Policy_Name, Source_File, Date_Analysed) when writing rows.
 */
export const GIOIA_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    policy_metadata: {
      type: "object",
      additionalProperties: false,
      properties: {
        Document_ID: str,
        Policy_Name: str,
        Country_or_Region: str,
        Governance_Level: { type: "string", enum: [...GOVERNANCE_LEVELS] },
        Policy_Year: str,
        Issuing_Actor: str,
        Policy_Type: str,
      },
      required: [
        "Document_ID",
        "Policy_Name",
        "Country_or_Region",
        "Governance_Level",
        "Policy_Year",
        "Issuing_Actor",
        "Policy_Type",
      ],
    },
    raw_data_extraction: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          Raw_ID: str,
          Section_Page: str,
          Excerpt_Text: str,
          Initial_Notes: str,
          Analytical_Flags: str,
        },
        required: ["Raw_ID", "Section_Page", "Excerpt_Text", "Initial_Notes", "Analytical_Flags"],
      },
    },
    first_order_concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          Concept_Instance_ID: str,
          Concept_ID: str,
          Raw_ID: str,
          Excerpt_Text: str,
          First_Order_Concept: str,
          Coding_Notes: str,
        },
        required: [
          "Concept_Instance_ID",
          "Concept_ID",
          "Raw_ID",
          "Excerpt_Text",
          "First_Order_Concept",
          "Coding_Notes",
        ],
      },
    },
    second_order_themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          Theme_ID: str,
          First_Order_Concept_IDs: str,
          First_Order_Concepts: str,
          Second_Order_Theme: str,
          Example_Quote: str,
        },
        required: [
          "Theme_ID",
          "First_Order_Concept_IDs",
          "First_Order_Concepts",
          "Second_Order_Theme",
          "Example_Quote",
        ],
      },
    },
    aggregate_dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          Aggregate_ID: str,
          Theme_IDs: str,
          Second_Order_Themes: str,
          Aggregate_Dimension: str,
          Description: str,
          Example_Policies: str,
        },
        required: [
          "Aggregate_ID",
          "Theme_IDs",
          "Second_Order_Themes",
          "Aggregate_Dimension",
          "Description",
          "Example_Policies",
        ],
      },
    },
    gioia_data_structure: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          Concept_ID: str,
          First_Order_Concept: str,
          Theme_ID: str,
          Second_Order_Theme: str,
          Aggregate_ID: str,
          Aggregate_Dimension: str,
        },
        required: [
          "Concept_ID",
          "First_Order_Concept",
          "Theme_ID",
          "Second_Order_Theme",
          "Aggregate_ID",
          "Aggregate_Dimension",
        ],
      },
    },
    policy_summary: str,
    refinement_summary: str,
    research_question_memo: {
      type: "object",
      additionalProperties: false,
      properties: { RQ_Focus: str, Analytical_Memo: str },
      required: ["RQ_Focus", "Analytical_Memo"],
    },
  },
  required: [
    "policy_metadata",
    "raw_data_extraction",
    "first_order_concepts",
    "second_order_themes",
    "aggregate_dimensions",
    "gioia_data_structure",
    "policy_summary",
    "refinement_summary",
    "research_question_memo",
  ],
} as const;

/** System prompt — a faithful condensation of the WP5.2 analysis instructions. */
export const GIOIA_SYSTEM_PROMPT = `You are assisting in a large-scale qualitative policy analysis using the Gioia methodology (Gioia, Corley & Hamilton, 2013). The project (SkillResilience4EU) maps twin-transition policies and labour-market adjustment strategies across Europe into an emergent master codebook.

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

Each ID prefix must use the Document_ID you assign in policy_metadata. In aggregate_dimensions, Theme_IDs holds the semicolon-separated second-order Theme_IDs.`;

/**
 * System prompt for cross-document aggregate-dimension synthesis (Step 5 applied
 * across a chosen set of documents rather than one). The model receives the
 * distinct second-order themes from the selected policies and groups them.
 */
export const CROSS_DOC_AGGREGATE_SYSTEM = `You are assisting in a large-scale qualitative policy analysis using the Gioia methodology (SkillResilience4EU). You are given the distinct SECOND-ORDER THEMES coded across a chosen set of European twin-transition / labour-market policy documents.

TASK: distil these themes into AGGREGATE DIMENSIONS — the overarching theoretical structure that emerges ACROSS this set of policies. This is Step 5 of the Gioia method applied to the whole selection at once.

RULES
- Group semantically related second-order themes into 4-8 aggregate dimensions (fewer or more is allowed if the data warrants).
- Every theme provided must be grouped into exactly one aggregate dimension.
- Reuse each Theme_ID verbatim. Give each dimension an Aggregate_ID of the form AGG_1.
- Aggregate dimensions should be researcher-centric, theoretically meaningful, and relevant to the main research question: how labour-market and twin-transition policies construct and operationalise goals into implementation practices.
- Possible dimensions may relate to: labour-market problem framing; adjustment strategy design; governance and implementation architecture; territorial justice and uneven transition effects; coherence versus tension. Let them emerge from the data — do not impose these mechanically.
- In Example_Policies list the Document_IDs whose themes contributed to the dimension (semicolon-separated).
- Every field must contain substantive content; never use placeholder text.

OUTPUT FORMAT
Respond with a SINGLE JSON object and nothing else — no markdown, no commentary:
{
  "aggregate_dimensions": [
    { "Aggregate_ID": "", "Theme_IDs": "", "Second_Order_Themes": "", "Aggregate_Dimension": "", "Description": "", "Example_Policies": "" }
  ]
}
"Theme_IDs" and "Second_Order_Themes" are semicolon-separated and must correspond one-to-one.`;

/**
 * Explicit JSON output contract appended to the system prompt. OpenAI-compatible
 * providers (Chutes/GLM) honour `response_format: {type:"json_object"}` but need
 * the exact shape described in the prompt rather than via a server-side schema.
 */
export const GIOIA_OUTPUT_CONTRACT = `OUTPUT FORMAT
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
All values are strings (multi-value fields are semicolon-separated). Use "" only when something is genuinely undeterminable. Governance_Level must be exactly one of: ${GOVERNANCE_LEVELS.join(", ")}. In aggregate_dimensions, "Theme_IDs" holds the semicolon-separated second-order Theme_IDs.`;

// ─────────────────────────────────────────────────────────────────────────────
// STAGED PIPELINE PROMPTS (PIPELINE_MODE=staged)
// Each stage = CORE_FRAMING + that stage's instructions + that stage's JSON
// contract. Faithful to apps/api/static/WP5.2 prompt.pdf. See docs/PIPELINE_PLAN.md.
// ─────────────────────────────────────────────────────────────────────────────

/** Shared project framing + research questions + sensitizing concepts + rules. Prepended to every stage. */
export const CORE_FRAMING = `You are assisting a large-scale qualitative policy analysis using the Gioia methodology (Gioia, Corley & Hamilton, 2013) for the SkillResilience4EU project, mapping twin-transition policies and labour-market adjustment strategies across Europe into an emergent master codebook (comparable across EU-level, national, and regional policies). The codebook must stay conceptually consistent across documents while remaining open to inductive refinement.

MAIN RESEARCH QUESTION
How do labour-market and twin-transition policies across Europe construct and operationalise policy goals into implementation practices?

SUBSIDIARY RESEARCH QUESTIONS
1. How do policy actors frame labour-market challenges associated with the twin transition?
2. What policy instruments and implementation mechanisms are used to achieve labour-market adaptation in the twin transition?
3. How are responsibilities and coordination distributed across EU, national, and regional governance levels in implementing these policies?
4. How do policies conceptualise and address social inclusion and uneven impacts across regions, sectors, and vulnerable groups?
5. What implementation gaps, governance constraints, or design tensions can be identified in existing policy frameworks?

ANALYTICAL ORIENTATION
Treat the document as a source of policy framing, labour-market problem definitions, proposed adjustment mechanisms, governance arrangements, and territorial assumptions. Attend to how the policy: defines labour-market risks, disruptions, or opportunities linked to the twin transition; proposes adjustment measures (skills, training, education, mobility, job creation, social protection, industrial restructuring); distributes responsibility across governance levels; reflects coherence or inconsistency across objectives, instruments, and implementation logics; addresses or overlooks territorial unevenness, regional vulnerability, and left-behind groups or places.

SENSITIZING CONCEPTS (interpretive aids for SECOND-ORDER coding and cross-case comparison ONLY; never first-order unless the exact term appears verbatim in the policy text; must not constrain inductive coding)
- Multi-level governance: how authority, responsibility, and coordination are distributed across governance levels.
- Policy coherence: whether objectives, instruments, and strategies are mutually reinforcing.
- Place sensitivity: whether policy design recognises territorial differences in transition capacity, labour-market structure, and regional vulnerability.
- Institutional capacity: the ability of actors and institutions to implement and coordinate transition-related measures.
- Labour-market adjustment: how policies anticipate and manage workforce transitions associated with decarbonisation.
- Left-behind risk: whether workers, sectors, or territories are framed as vulnerable to exclusion, decline, or uneven transition effects.

METHODOLOGICAL RULES
Preserve informant/policy language; employ gradual abstraction; keep transparent links between quotes and theory; keep first-order concepts close to the policy's own vocabulary; do not collapse meaningful variation across governance levels; do not force excerpts into pre-existing categories when conceptual novelty is present. Use the research questions to guide relevance and attention, but let codes, themes, and dimensions emerge inductively.

LANGUAGE POLICY
Detect the document's original language. Keep IN THE ORIGINAL LANGUAGE (do not translate): every verbatim excerpt (Excerpt_Text), every first-order concept label (First_Order_Concept) and its repetitions, and Example_Quote. Produce everything researcher-generated IN ENGLISH: metadata, all notes, second-order themes, aggregate dimensions, descriptions, summaries, and the memo. If the document is already in English, every field is in English.

OUTPUT RULE
Every populated field must contain substantive analytical content — never placeholder text ("TBD", "N/A", "Concepts", etc.). If something is genuinely undeterminable, use an empty string. Respond with a SINGLE JSON object and nothing else — no markdown, no code fences, no commentary.`;

const STAGE1_INSTRUCTIONS = `TASK — METADATA, RAW EXCERPTS, AND POLICY SUMMARY (Gioia Steps 1, 2, 8).

STEP 1 — Metadata. Extract Policy_Name, Country_or_Region, Governance_Level (exactly one of the allowed values), Policy_Year, Issuing_Actor, Policy_Type (strategy, law, action plan, recovery plan, etc.). Set Document_ID mirroring the uploaded file name where it encodes one (formats like EU_01, DE_NAT_01, IT_REG_01).

STEP 2 — Raw extraction. Extract roughly 25–40 relevant excerpts (more or fewer allowed depending on the document's scale, scope, and relevance) on: twin transition & labour-market change; labour-market adjustment strategies; skills/reskilling/upskilling & workforce transition; employment disruption, sectoral restructuring, or job creation; governance coordination and implementation responsibilities; territorial inequality, regional vulnerability, uneven impacts, and left-behind places or workers; policy ambition versus delivery or implementation constraints.
- Give each excerpt a Raw_ID of the form {Document_ID}_RAW_001 (sequential, zero-padded).
- Each excerpt: 1–3 sentences, EXACT verbatim wording in the document's ORIGINAL LANGUAGE.
- Section_Page: the section or page where the excerpt appears, when possible.
- Prioritise excerpts that illuminate problem framing, policy instruments, implementation logic, or territorial differentiation. Avoid generic climate, digitalisation, or twin-transition ambition statements unless they connect to labour markets, adjustment, governance, or territorial effects.
- Initial_Notes: indicate the analytical issue the excerpt is most relevant to — exactly one of: Labour-market challenge framing / Adjustment strategy / Governance coordination / Coherence signal / Territorial-place-sensitive response / Left-behind risk / Implementation constraint / Other relevant issue.
- Do NOT assign analytical flags here (those are added later).

STEP 8 — Policy summary. Produce a 150–250 word analytical summary IN ENGLISH covering: main policy focus; how labour-market challenges are framed; key labour-market adjustment mechanisms; skills/workforce strategy; governance approach; degree of place sensitivity; whether the policy acknowledges uneven territorial impacts or left-behind risks; and any notable coherence strengths, tensions, or implementation gaps.`;

const STAGE1_CONTRACT = `Return a JSON object with exactly these keys:
{
  "policy_metadata": { "Document_ID": "", "Policy_Name": "", "Country_or_Region": "", "Governance_Level": "", "Policy_Year": "", "Issuing_Actor": "", "Policy_Type": "" },
  "raw_data_extraction": [ { "Raw_ID": "", "Section_Page": "", "Excerpt_Text": "", "Initial_Notes": "" } ],
  "policy_summary": ""
}
Governance_Level must be exactly one of: ${GOVERNANCE_LEVELS.join(", ")}.`;

const STAGE2_INSTRUCTIONS = `TASK — FIRST-ORDER CONCEPTS (Gioia Step 3).

You are given this document's raw excerpts and the existing master codebook. For each excerpt, extract 1–3 informant-centric first-order concepts that stay close to the policy's wording.
- Copy the source excerpt verbatim (original language) into Excerpt_Text and set Raw_ID to that excerpt's id.
- Concept_Instance_ID of the form {Document_ID}_FOCINST_001 (one per concept occurrence, sequential).
- Concept_ID of the form FOC_1 identifying the concept itself; the same concept reused across excerpts shares one Concept_ID.
- First_Order_Concept: a short phrase (3–8 words preferred) IN THE DOCUMENT'S ORIGINAL LANGUAGE, close to the policy's vocabulary.
- First-order concepts should reflect: labour-market problems; transition risks; workforce responses; governance arrangements; implementation mechanisms; territorial targeting or omission; vulnerable sectors, groups, or regions.
- Do NOT use abstract analytical labels (policy coherence, place sensitivity, multi-level governance, institutional complementarity) unless those exact terms appear verbatim in the policy text.
- Cross-document reuse: reuse an existing Concept_ID ONLY where wording and meaning are highly similar to one already in the master codebook; otherwise create a new FOC_n. Expected ~40–80 concepts total (more or fewer allowed).`;

const STAGE2_CONTRACT = `Return a JSON object with exactly this key:
{
  "first_order_concepts": [ { "Concept_Instance_ID": "", "Concept_ID": "", "Raw_ID": "", "Excerpt_Text": "", "First_Order_Concept": "", "Coding_Notes": "" } ]
}
Every excerpt must be covered by at least one concept; every Raw_ID must be one of the provided excerpts.`;

const STAGE3_INSTRUCTIONS = `TASK — SECOND-ORDER THEMES (Gioia Step 4).

You are given this document's first-order concepts and the existing master codebook. Group semantically close first-order concepts into researcher-centric second-order themes. Expected ~10–20 themes (more or fewer allowed).
- Theme_ID of the form THM_1.
- First_Order_Concept_IDs: the grouped concepts' Concept_IDs, semicolon-separated (use the provided IDs verbatim).
- First_Order_Concepts: the grouped concept labels, semicolon-separated, in the original language (matching the labels).
- Second_Order_Theme: a researcher-centric theme label IN ENGLISH.
- Example_Quote: one representative verbatim quote IN THE ORIGINAL LANGUAGE.
- Each theme should be supported by multiple related first-order concepts where possible.
- Cross-document reuse: prefer reusing an existing Theme_ID where conceptual overlap with the master codebook is substantial; create a new THM_n only for a substantively distinct pattern. Do not create new themes solely because concepts use different wording.`;

const STAGE3_CONTRACT = `Return a JSON object with exactly this key:
{
  "second_order_themes": [ { "Theme_ID": "", "First_Order_Concept_IDs": "", "First_Order_Concepts": "", "Second_Order_Theme": "", "Example_Quote": "" } ]
}
Every provided Concept_ID must appear in exactly one theme's First_Order_Concept_IDs.`;

const STAGE4_INSTRUCTIONS = `TASK — AGGREGATE DIMENSIONS (Gioia Step 5).

You are given this document's second-order themes and the existing master codebook. Group semantically close second-order themes into aggregate (theoretical) dimensions relevant to the main research question. Expected ~4–8 dimensions (more or fewer allowed).
- Aggregate_ID of the form AGG_1.
- Theme_IDs: the grouped themes' Theme_IDs, semicolon-separated (use the provided IDs verbatim).
- Second_Order_Themes: the grouped theme labels, semicolon-separated, IN ENGLISH.
- Aggregate_Dimension: the dimension label IN ENGLISH.
- Description: a short description IN ENGLISH.
- Example_Policies: the Document_ID.
- Each dimension should be supported by multiple related themes where possible. Keep aggregate dimensions relatively stable across the dataset; prefer reusing an existing Aggregate_ID, and create a new AGG_n only when existing dimensions cannot capture an emerging theoretical pattern.`;

const STAGE4_CONTRACT = `Return a JSON object with exactly this key:
{
  "aggregate_dimensions": [ { "Aggregate_ID": "", "Theme_IDs": "", "Second_Order_Themes": "", "Aggregate_Dimension": "", "Description": "", "Example_Policies": "" } ]
}
Every provided Theme_ID must appear in exactly one dimension's Theme_IDs.`;

const STAGE5_INSTRUCTIONS = `TASK — CROSS-DOCUMENT FLAGS, REFINEMENT SUMMARY, AND RESEARCH-QUESTION MEMO (Gioia Steps 7, 9, 10).

You are given this document's full coding (metadata, excerpts, themes, dimensions) and the existing master codebook.

ANALYTICAL FLAGS (Step 7). For each excerpt that warrants it, assign one or more flags (do not infer content not explicitly present in the policy):
- [TENSION] — the document directly contradicts or diverges from an existing master-codebook entry.
- [ABSENCE] — a clear omission of labour-market adjustment, territorial targeting, or implementation detail.
- [IMPLEMENTATION LOGIC: WEAK OPERATIONALISATION] — broad ambitions with weak operational detail.
- [PLACE-SENSITIVE SIGNAL] — recognises uneven regional effects or left-behind groups.
- [TERRITORIAL LOGIC: LIMITED DIFFERENTIATION] — assumes uniform capacity or generic adaptation across territories.
Return only excerpts that carry at least one flag, referencing them by Raw_ID.

REFINEMENT SUMMARY (Step 9). 150–200 words IN ENGLISH explaining how and why first-order concepts, second-order themes, and aggregate dimensions were refined for consistency across policies. Explicitly justify any newly introduced codes, and note whether the document reinforced existing framings, introduced new labour-market or territorial concerns, clarified governance distribution, revealed tensions across governance levels, or sharpened coherent/place-sensitive/spatially-blind distinctions. Discuss the major flags here.

RESEARCH-QUESTION MEMO (Step 10). 150–250 words IN ENGLISH addressing the main and subsidiary research questions for this document: framing of labour-market challenges; translation of goals into implementation mechanisms; prioritised instruments; governance coordination across levels; acknowledgement of territorial unevenness and left-behind risks; place-sensitive vs spatially blind design; tensions/constraints/mismatches; and any flags raised. RQ_Focus is a one-line statement of the document's main analytical focus.`;

const STAGE5_CONTRACT = `Return a JSON object with exactly these keys:
{
  "analytical_flags": [ { "Raw_ID": "", "Flags": "" } ],
  "refinement_summary": "",
  "research_question_memo": { "RQ_Focus": "", "Analytical_Memo": "" }
}
In analytical_flags, "Flags" is a semicolon-separated list drawn ONLY from: [TENSION], [ABSENCE], [IMPLEMENTATION LOGIC: WEAK OPERATIONALISATION], [PLACE-SENSITIVE SIGNAL], [TERRITORIAL LOGIC: LIMITED DIFFERENTIATION]. Omit excerpts that carry no flags (an empty array is valid).`;

/** The five composed stage system prompts (CORE_FRAMING + stage instructions + stage contract). */
export const STAGE_SYSTEM = {
  metadata: `${CORE_FRAMING}\n\n${STAGE1_INSTRUCTIONS}\n\n${STAGE1_CONTRACT}`,
  concepts: `${CORE_FRAMING}\n\n${STAGE2_INSTRUCTIONS}\n\n${STAGE2_CONTRACT}`,
  themes: `${CORE_FRAMING}\n\n${STAGE3_INSTRUCTIONS}\n\n${STAGE3_CONTRACT}`,
  dimensions: `${CORE_FRAMING}\n\n${STAGE4_INSTRUCTIONS}\n\n${STAGE4_CONTRACT}`,
  synthesis: `${CORE_FRAMING}\n\n${STAGE5_INSTRUCTIONS}\n\n${STAGE5_CONTRACT}`,
} as const;
