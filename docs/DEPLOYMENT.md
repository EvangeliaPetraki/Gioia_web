# Deployment

The root scripts build the shared DTO package first, so either platform can
deploy from a clean clone.

| Service | Platform | Build command | Start command |
| --- | --- | --- | --- |
| Frontend | Vercel | `pnpm build:web` | Managed by Vercel/Next.js |
| API | Railway | `pnpm build:api` | `pnpm start:api` |

`apps/web/vercel.json` and `railway.toml` contain these commands already.

## Railway API

Create a Railway service from this repository and set the variables from
`apps/api/.env.example`, plus production values for:

```env
NODE_ENV=production
PORT=3001
WEB_ORIGIN=https://your-project.vercel.app
BETTER_AUTH_URL=https://your-api.up.railway.app
BETTER_AUTH_SECRET=<long-random-secret>
DATABASE_URL=<postgres-connection-url>
ADMIN_EMAIL=<initial-admin-email>
ADMIN_PASSWORD=<initial-admin-password>
```

Run `pnpm db:push` once from a trusted environment that has the production
`DATABASE_URL` before the first deploy, to create/update the Prisma tables.

## Vercel frontend

Import the same repository as a separate Vercel project and set **Root
Directory** to `apps/web`. This is essential: it is where the `package.json`
that declares Next.js lives. Vercel automatically finds the app-specific
`vercel.json` there.

Add this environment variable for Production, Preview, and Development as
appropriate:

```env
NEXT_PUBLIC_API_URL=https://your-api.up.railway.app/api
```

Use the exact Vercel deployment URL for Railway's `WEB_ORIGIN`. If you use a
custom frontend domain, update `WEB_ORIGIN` to that domain and redeploy Railway.
The API sets secure cross-site cookies in production so the Vercel frontend can
send Better Auth sessions to Railway.
