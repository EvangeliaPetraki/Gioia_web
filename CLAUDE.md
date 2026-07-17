# Gioia — Monorepo Guide

Full-stack TypeScript template. **Next.js** frontend, **NestJS** backend, a **shared DTO**
package, wired together with **pnpm workspaces**. One command boots everything.

## Stack

| Layer    | Tech                                                        |
| -------- | ---------------------------------------------------------- |
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS v3, shadcn/ui |
| Backend  | NestJS 11, Prisma 6                                        |
| Database | PostgreSQL (Neon)                                          |
| Shared   | `@gioia/dto` — DTO classes + types used by both sides      |
| Tooling  | pnpm workspaces, TypeScript 5                              |

## Layout

```
web_gioia/
├── package.json            # root scripts (dev / build / db:*)
├── pnpm-workspace.yaml     # workspaces: apps/*, packages/*
├── tsconfig.base.json      # shared compiler options
├── apps/
│   ├── api/                # @gioia/api — NestJS (port 3001, prefix /api)
│   │   ├── prisma/schema.prisma
│   │   ├── static/                 # WP5.2 prompt.pdf (the analysis spec)
│   │   ├── data/                   # generated master codebook (gitignored)
│   │   ├── .env            # DATABASE_URL, PORT, WEB_ORIGIN, CHUTES_API_KEY/BASE_URL/MODEL
│   │   └── src/
│   │       ├── main.ts             # bootstrap: CORS, ValidationPipe, /api prefix
│   │       ├── app.module.ts
│   │       ├── prisma/             # PrismaModule (global) + PrismaService
│   │       ├── users/              # example CRUD resource
│   │       └── analysis/           # Gioia policy-analysis pipeline (see below)
│   └── web/                # @gioia/web — Next.js (port 3000)
│       ├── components.json         # shadcn config
│       ├── tailwind.config.ts
│       └── src/
│           ├── app/                # App Router: / (demo), /dashboard (analysis)
│           ├── components/ui/      # shadcn (button, card, input, badge, table)
│           └── lib/                # cn() util + typed api client
└── packages/
    └── dto/                # @gioia/dto — shared contracts, built to dist/ with tsc
        └── src/user/       # CreateUserDto, UpdateUserDto, UserDto
```

## Commands (run from repo root)

| Command            | What it does                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `pnpm install`     | Install all workspace deps (`postinstall` runs `prisma generate`) |
| `pnpm dev`         | **The one command.** Builds DTOs, then runs DTO watch + API + Web in parallel |
| `pnpm build`       | Build dto → api → web                                              |
| `pnpm db:push`     | Push Prisma schema to the database (no migration history)         |
| `pnpm db:migrate`  | Create + apply a dev migration                                    |
| `pnpm db:generate` | Regenerate Prisma Client                                           |
| `pnpm db:studio`   | Open Prisma Studio                                                 |

After `pnpm dev`: web → http://localhost:3000, API → http://localhost:3001/api
(health check: http://localhost:3001/api/health).

## How the pieces connect

- **Shared DTOs**: `packages/dto` is compiled with `tsc` (CommonJS + declarations) to
  `dist/`. NestJS imports the DTO **classes** (decorated with `class-validator`) so the
  global `ValidationPipe` validates request bodies. Next.js imports the same package for
  **types** and lists it in `transpilePackages`. `pnpm dev` runs `tsc -w` on the package
  so changes propagate live.
- **Frontend → backend**: `apps/web/src/lib/api.ts` is a typed fetch client pointed at
  `NEXT_PUBLIC_API_URL` (default `http://localhost:3001/api`). CORS allows `WEB_ORIGIN`.
- **Backend → database**: `PrismaService` extends `PrismaClient` and connects on module
  init. `DATABASE_URL` lives in `apps/api/.env`.

## Gioia policy-analysis dashboard (WP5.2)

A dashboard at `/dashboard` (web) lets the user upload **policy PDFs** into a **region-case-study**;
the backend extracts the text and runs the Gioia qualitative-coding pipeline defined in
[apps/api/static/WP5.2 prompt.pdf](apps/api/static/). **Per-document coding stops at second-order
themes** — a single document does NOT get its own aggregate dimensions. Aggregate (theoretical)
dimensions are synthesised once **per region-case-study**, across its selected files (Gioia Step 5
at the case-study level), and persisted. The **codebook is per region-case-study** (its own 9-sheet
Excel), not one global master.

**Backend — `apps/api/src/analysis/`**
- `analysis.controller.ts` — `POST /api/analysis/upload` (multipart `file` + `regionCaseStudyId`,
  PDF-only, ≤25 MB); per region-case-study: `GET …/region-case-studies/:id/policies`,
  `…/codebook` (structured 9 sheets), `…/workbook` (xlsx download), `…/aggregate-status`
  (staleness), `POST …/aggregate` (extract + persist). The old global `/policies`, `/codebook`,
  `/workbook` are gone — the codebook is always scoped to a region-case-study.
- `pdf.service.ts` — extracts text with `pdf-parse` (imported from `pdf-parse/lib/pdf-parse.js`
  to dodge its debug-mode bug); rejects image-only PDFs.
- `gioia.service.ts` — runs the per-document analysis, **streaming**, over two methods (chosen at
  runtime, see `settings.service.ts`): **staged** (4 validated stages — metadata/excerpts →
  concepts → themes → synthesis/flags/memo) or **single** (one model, one call). Both **stop at
  second-order themes**; neither produces per-document aggregate dimensions. Providers: **Anthropic**
  (Claude, via `@anthropic-ai/sdk`, adaptive thinking + `MODEL_EFFORT` on the reasoning tier) and
  **Chutes** (open models, via the OpenAI SDK at `https://llm.chutes.ai/v1`,
  `response_format:{type:"json_object"}` with a no-JSON-mode fallback; output parsed tolerantly). In
  staged mode each stage runs on a *tier* (`extract`/`concepts`/`reason`) resolved from the active
  **profile** — `claude` (Sonnet/Haiku/Sonnet), `hybrid` (DeepSeek/Qwen/Opus), `chutes` (all open).
  Each stage receives only the codebook levels it reuses (concepts→stage 2, themes→stage 3/synthesis).
  `aggregateAcrossDocuments` (CROSS_DOC_AGGREGATE_SYSTEM) does the case-study-level Step 5.
- `settings.service.ts` — the model selection is **DB-backed and admin-controlled from the UI**
  (`/admin/settings`), no longer env-driven. A singleton `AnalysisSetting` row holds
  `{ mode, profile, singleModel, effort }`; env (`PIPELINE_MODE`/`MODEL_PROFILE`/`MODEL_EFFORT`)
  only **seeds the defaults** when no row exists. `GET /api/analysis/settings` returns the
  current settings + options (any user); `PATCH /api/analysis/settings` updates them
  (admin only, via `AdminGuard`). Selectable single-call models live in
  `SINGLE_MODEL_OPTIONS` (`packages/dto/src/analysis/analysis-settings.dto.ts`).
  For transparency, `GET /api/analysis/prompts` (admin only) returns a **read-only** grouped view of
  the system prompts (`buildPromptView` in `gioia.constants.ts`, so it can't drift from what the
  pipeline actually sends); the admin page is `/admin/prompts`. Prompts are **not editable** — they
  are coupled to the per-stage validators and the JSON output contract.
- `codebook.service.ts` — persists each analysis (metadata/excerpts/first-order concepts/
  second-order themes/summaries/memo — **no** per-doc aggregate or data-structure tables anymore)
  and builds a **per-region-case-study** codebook: `buildSheets(docIds, aggregate)` fills the 6
  document sheets from that case study's selected files, and the `Aggregate_Dimensions` +
  `Gioia_Data_Structure` sheets from its persisted `CaseStudyAggregate` (empty until extracted).
  `getConceptThemeStructure` rebuilds concept→theme rows from the DB; `save/getCaseStudyAggregate`
  + `getAggregateStatus` handle persistence and staleness. **Rows are written positionally (by
  column order), not by key.** Duplicate `Document_ID`s are re-prefixed (`_v2`). Also builds the
  "existing codebook" context (concepts + themes, scoped to the case-study type) for reuse (Step 7).
- `gioia.constants.ts` — the system prompt (faithful condensation of WP5.2), the output
  JSON schema, and the worksheet/column definitions (single source of truth for headers).

**Shared types** live in `packages/dto/src/analysis/` (`GioiaAnalysis`, `AnalysisSummaryDto`,
`PolicyListItemDto`, `GOVERNANCE_LEVELS`; case-study contracts in `case-study.dto.ts`).

**Case-study organisation (per-region analysis)** — analysis is scoped by **case study**, not run
globally. The model (`prisma/schema.prisma` + `case-study.service.ts`): `Region { country, name }`,
`CaseStudyType { name }` (a **shared taxonomy** — tourism, transportation…), `RegionCaseStudy`
(a region running a type — "Crete's transportation", the unit files are uploaded into), and
`FileSelection` (which analyses each region's case study includes). An analysis
(`AnalyzedDocument`) is keyed for reuse by **`(fileHash, caseStudyTypeId)`**: `fileHash` is the
sha256 of the uploaded bytes; `documentId` stays the primary key so the five child tables are
untouched. Reuse rule — the same file uploaded under the same case-study *type* (even for another
region) is **linked, not re-analysed**; a different type re-analyses. `getExistingContext` and the
new-theme count are scoped to `caseStudyTypeId` (Step-7 reuse is per case study, not global).
Pre-existing rows are attached on boot to an "Unassigned (legacy)" region/case-study by
`CodebookService.backfillLegacyCaseStudy` (their `fileHash` is synthesised as `legacy:{documentId}`).
Admin CRUD + `GET /analysis/catalog` (the country→region→case-study tree) live on the analysis
controller; the admin UI is `/admin/case-studies`. The dashboard picks a case study, uploads into
it, lists only its files, and aggregates only its files.

**Access control (per-region ownership, many-to-many)** — a `Region` has **many owners** via the
`RegionOwner` join table (`{ regionId, userId }`, composite PK). A non-admin sees and may use
**only the case studies of regions they own**; admins see/do everything. A region with **no** owners
is admin-only (the legacy region). Enforced on the backend, not just the UI: `getCatalog(viewer)`
filters with `owners: { some: { userId } }`, and `resolveCaseStudyType`/`documentIdsFor` call
`assertOwner(owners, viewer)` (403 otherwise), so upload / list / aggregate all reject a non-owner.
The viewer comes from `@CurrentUser()` + `toViewer()` (`apps/api/src/auth/current-user.decorator.ts`),
built from the `AuthGuard`-attached session user. Owners are editable after creation:
`POST /analysis/regions` takes `userIds[]` (≥1), `PUT /analysis/regions/:id/owners` replaces the
owner set (`SetRegionOwnersDto.userIds`, may be empty ⇒ admin-only), and `PATCH /analysis/regions/:id`
renames a region / changes its country (`UpdateRegionDto`). The admin UI at
`/admin/case-studies` picks owners (checkbox list from `authClient.admin.listUsers`) on create and, per
region, has "Rename" and "Edit owners" editors plus Delete.

**Case-study aggregate dimensions (persisted)** — an **owner or admin** extracts aggregate dimensions
for a whole case study via `POST /api/analysis/region-case-studies/:id/aggregate` (access enforced in
the service via `documentIdsFor` → `assertOwner`, not an `AdminGuard`), which resolves the
region-case-study's selected files and synthesises across their distinct second-order themes.
`CodebookService.getThemesForDocuments` gathers the themes, `GioiaService.aggregateAcrossDocuments`
runs one reasoning-model call (`CROSS_DOC_AGGREGATE_SYSTEM`, using the active profile's `reason`
model, or the single model) with the same validate/repair loop, returning `CrossDocumentAggregateDto`.
The result is **persisted** to `CaseStudyAggregate` (keyed by region-case-study) and fills that case
study's `Aggregate_Dimensions` + `Gioia_Data_Structure` codebook sheets. It is not auto-regenerated;
`GET …/aggregate-status` reports `staleCount` (files **added or removed** since the last extraction)
so the admin/owner re-runs it. (The older `POST /api/analysis/aggregate` with an explicit
`{ documentIds }` list still exists but is unused by the UI.)

**Excluding a file from a case study** — `DELETE /api/analysis/region-case-studies/:id/files/:documentId`
(owner or admin; `CaseStudyService.removeSelection`) **unlinks the `FileSelection` only** — the
`AnalyzedDocument` is never deleted, so a file shared with another region (same case-study type) stays
intact there. Excluding makes the case study's persisted aggregate stale (the staleness check counts
removals), so the dashboard nudges a re-extract. The dashboard file table has a per-row "Exclude".

**Frontend — `apps/web/src/app/dashboard/page.tsx`** — pick a region-case-study, drag-and-drop PDF
upload into it (sequential job queue), per-document counts + summary, and the "Extract aggregate
dimensions" action (owner or admin) with a staleness hint. Header is grouped: **How it works** +
account on the right, admin links collapsed into an **"Admin ▾"** dropdown (`Menu`, a dependency-free
click-outside dropdown → `/admin/case-studies`, `/admin/users`, `/admin/settings`, `/admin/prompts`);
the per-case-study **View full analysis** (`/codebook?cs=<id>`) + **Download codebook** buttons live on
the Case-study card, not the global header.

**Auth** — Better Auth (`apps/api/src/auth/auth.ts`) with the **admin** + **username** plugins,
email/password, public sign-up disabled. Users sign in with **either username or email**: the login
page (`apps/web/src/app/page.tsx`) sends the value to `signIn.email` if it contains "@", else
`signIn.username`. The admin sets a `username` when creating a user at `/admin/users` (passed via
`admin.createUser`'s `data:{username,displayUsername}`); the username plugin stores it lowercased +
unique in `User.username` and keeps the original casing in `User.displayUsername`, so username login
is case-insensitive. Pre-existing (email-only) users keep working via the email branch. From the same
page an admin can **manage** each user — rename / change username (`admin.updateUser` with
`data`), reset the password (`admin.setUserPassword`), and delete (`admin.removeUser`, blocked for
their own account). All password fields use the shared `PasswordInput`
(`apps/web/src/components/ui/password-input.tsx`) with a Show/Hide toggle.

**Setup:** set `CHUTES_API_KEY` (+ `CHUTES_BASE_URL`) and, for the `claude`/`hybrid` profiles or
a Claude single-model, `ANTHROPIC_API_KEY` in `apps/api/.env`. The active model selection is
then chosen at runtime by an admin at `/admin/settings` (env only seeds the initial defaults).

**Extending the analysis:** worksheet headers/structure come from `gioia.constants.ts`
(`SHEETS` + `GIOIA_OUTPUT_SCHEMA` + `GIOIA_SYSTEM_PROMPT`) — change them together. Keep the
model call streaming (large output) and keep using positional row writes in `codebook.service.ts`.

## Conventions & how to extend

- **Add a shared contract**: create it under `packages/dto/src/<feature>/`, re-export from
  `packages/dto/src/index.ts`. Use `class-validator` decorators when the backend must
  validate it; use a plain `interface` for response-only shapes.
- **Add a backend resource**: create `apps/api/src/<feature>/` with `*.module.ts`,
  `*.controller.ts`, `*.service.ts`; inject `PrismaService`; register the module in
  `app.module.ts`. Mirror the `users/` resource.
- **Add a shadcn component**: `cd apps/web && pnpm dlx shadcn@latest add <name>`
  (config in `components.json`; components land in `src/components/ui`). Always style with
  Tailwind utilities + the `cn()` helper — no ad-hoc CSS files.
- **Change the DB schema**: edit `apps/api/prisma/schema.prisma`, then `pnpm db:push`
  (or `pnpm db:migrate`) and `pnpm db:generate`.
- **Ports**: web 3000, API 3001. Change via `apps/web` `dev` script / `apps/api/.env`.

## Notes for future edits

- Keep request/response types in `@gioia/dto`; never redeclare them in an app.
- The DTO package must be built before type-checking the apps — `pnpm dev`/`pnpm build`
  already handle the ordering.
- `.env` files are gitignored; `.env.example` files document required vars.
