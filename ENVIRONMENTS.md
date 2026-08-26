# Weftling environments (dev / production)

Two front doors, **separate databases**, one Vercel project:

| Environment | Domain | Git branch | Supabase project |
|---|---|---|---|
| **Production** | `weftling.fabbricerp.com` | `main` | prod (`bstuqohympbcarrbbvky`) |
| **Development** | `weftling.vercel.app` | `develop` | dev (`kzdbokwlwyzrtstbvjxg`) |
| **Preview** | auto `*.vercel.app` per PR | any branch/PR | dev |

The Android app (1.0.1+) points at **production** (`weftling.fabbricerp.com`).
Accounts and data are per-database, so your production login does **not** exist
on the dev site (and vice versa) — that separation is the point.

## Everyday flow

1. Branch off `develop`, build the change, open a PR (base **develop**) — Vercel gives that PR its own preview URL (on the **dev** DB) to test.
2. Merge to `develop` to see it on `weftling.vercel.app` (dev DB).
3. When ready for real users, promote **`develop` → `main`** in one PR → auto-deploys to `weftling.fabbricerp.com` (prod DB).
4. After each promotion, re-sync: `git checkout develop && git merge main && git push`.

## How each half picks its database

- **Frontend** (`public/config.js`): chooses the Supabase project by **hostname** — `weftling.fabbricerp.com` → prod, everything else (dev domain, preview URLs, localhost) → dev. One committed file, so a `develop → main` promotion can never swap prod onto the dev DB. Both anon keys are publishable.
- **Backend** (serverless functions): Vercel **env vars scoped by environment** — Production → prod project, Preview → dev project (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). `NANGO_*` are set in **both** (shared Nango).
- **CSP** (`vercel.json` + `server.js`): `connect-src` lists **both** Supabase origins so either DB is reachable.
- **Local** (`node server.js`): `.env` (untracked) points at the **dev** DB, matching what `config.js` picks for `localhost`.

## Standing rules

- **Every schema migration must run in BOTH Supabase projects.** After applying any `supabase/*.sql`, run it in prod AND dev; then run `supabase/verify_schema.sql` + the objects check in each to confirm they match.
- **Nango is shared** between dev and prod for now. Dev OAuth connect/disconnect testing DOES touch the shared Nango account (but the connection *references* are stored per-DB). Split Nango later if that becomes a problem.
- **Supabase Auth Site URL** = the **production** domain (`weftling.fabbricerp.com`) so confirmation/reset emails land on prod; add `weftling.vercel.app` to Redirect URLs if you want auth flows to work while testing on dev.

## Gotchas

- **Stale CSP after a `vercel.json` change:** the dev site can keep serving the old CSP header from service-worker / HTTP cache, so a CSP-blocked request (`Failed to fetch` / "violates … connect-src") persists after a normal reload. Fix: DevTools open → right-click reload → **Empty Cache and Hard Reload** (or Application → Service Workers → Unregister).
- **Vercel Preview deployments are SSO-protected by default** — `weftling.vercel.app` may redirect to `vercel.com/sso-api` for anyone not logged into the Vercel team. Turn off Deployment Protection (Settings → Deployment Protection) if you want the dev site openly testable.
- **Env-var / domain changes need a redeploy** — they don't apply to the deployment already running.

## Vercel one-time setup (already done)

- Domains → `weftling.vercel.app` → Connect to environment **Preview**, branch **develop**.
- Environment Variables → `SUPABASE_URL` / `SUPABASE_ANON_KEY`: Production = prod project, Preview = dev project. `NANGO_*` present in both.
