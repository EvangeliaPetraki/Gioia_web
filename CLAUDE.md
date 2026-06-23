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

A dashboard at `/dashboard` (web) lets the user upload **policy PDFs**; the backend
extracts the text and runs the full 11-step Gioia qualitative-coding pipeline defined in
[apps/api/static/WP5.2 prompt.pdf](apps/api/static/), appending the result to a single
master Excel codebook (`SkillResilience4EU_Gioia_Master_Codebook.xlsx`, name is fixed by
the spec and must not change).

**Backend — `apps/api/src/analysis/`**
- `analysis.controller.ts` — `POST /api/analysis/upload` (multipart `file`, PDF-only,
  ≤25 MB), `GET /api/analysis/policies`, `GET /api/analysis/workbook` (downloads the xlsx).
- `pdf.service.ts` — extracts text with `pdf-parse` (imported from `pdf-parse/lib/pdf-parse.js`
  to dodge its debug-mode bug); rejects image-only PDFs.
- `gioia.service.ts` — calls the LLM via the **OpenAI SDK pointed at Chutes**
  (`https://llm.chutes.ai/v1`, model `zai-org/GLM-5-Turbo`), **streaming**, requesting
  `response_format: {type:"json_object"}` (falls back to no-JSON-mode on a 400) and parsing
  the result tolerantly (code fences / prose stripped). Reads `CHUTES_API_KEY` /
  `CHUTES_BASE_URL` / `CHUTES_MODEL` from env. To use a different OpenAI-compatible provider,
  change those three env vars — no code change needed.
- `codebook.service.ts` — `exceljs` read/create/append. Writes the 9 worksheets with the
  spec's exact headers. **Rows are written positionally (by column order), not by key** —
  exceljs does not restore column keys when a workbook is read back from disk, so key-based
  `addRow({...})` silently misplaces data on the 2nd+ append. Duplicate `Document_ID`s are
  re-prefixed (`_v2`). Also builds the "existing codebook" context fed back to the model for
  cross-document code reuse (Step 7).
- `gioia.constants.ts` — the system prompt (faithful condensation of WP5.2), the output
  JSON schema, and the worksheet/column definitions (single source of truth for headers).

**Shared types** live in `packages/dto/src/analysis/` (`GioiaAnalysis`, `AnalysisSummaryDto`,
`PolicyListItemDto`, `GOVERNANCE_LEVELS`).

**Frontend — `apps/web/src/app/dashboard/page.tsx`** — drag-and-drop PDF upload, a
sequential job queue (the shared codebook is updated one doc at a time), per-document counts
+ summary, a download button, and the analysed-policies table.

**Setup:** set `CHUTES_API_KEY` / `CHUTES_BASE_URL` / `CHUTES_MODEL` in `apps/api/.env`. The
master codebook is created on the first successful upload at `CODEBOOK_PATH` (default
`apps/api/data/...`).

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
