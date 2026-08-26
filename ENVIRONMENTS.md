# Weftling environments (dev / production)

Two front doors, backed by one Vercel project:

| Environment | Domain | Git branch | Purpose |
|---|---|---|---|
| **Production** | `weftling.fabbricerp.com` | `main` | The live app real users hit |
| **Development** | `weftling.vercel.app` | `develop` | A stable URL for testing dev work |
| **Preview** | auto `*.vercel.app` per PR | any branch/PR | Vercel builds every PR at its own URL |

The Android app (1.0.1+) points at **production** (`weftling.fabbricerp.com`).

## Everyday flow

1. Branch off `main`, build the change, open a PR — Vercel gives that PR its own preview URL to test.
2. To see it on the stable dev URL (`weftling.vercel.app`), merge/push the branch to `develop`.
3. When it's ready for real users, merge to `main` → auto-deploys to `weftling.fabbricerp.com`.
4. **Keep `develop` in sync:** after each merge to `main`, bring `main` back into `develop` (`git checkout develop && git merge main && git push`) so dev doesn't drift.

## Vercel one-time setup (dashboard)

- Project → **Settings → Domains** → edit **`weftling.vercel.app`** → **Connect to an environment** → pick the **`develop`** branch. (Leave `weftling.fabbricerp.com` on Production.)
- That's it for the code split — production stays untouched until you merge to `main`.

## Data isolation — the part that actually protects real customers

By default **both environments talk to the same Supabase project and the same
Nango account.** That's fine while you're solo and pre-launch, but before you
have paying customers you do NOT want dev testing hitting real books. Two
places set which backend an environment uses, because Supabase creds live in
two spots:

- **Backend** (serverless functions) → Vercel **env vars** (`SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `NANGO_SECRET_KEY`, `NANGO_INTEGRATION_ID`,
  `NANGO_QUICKBOOKS_INTEGRATION_ID`).
- **Frontend** (the browser app) → the **committed `public/config.js`**
  (Supabase URL + anon key). Because it's committed per-branch, `develop` can
  carry a different `config.js` than `main` — no dashboard needed for this half.

### To add a real dev backend (do before launch)

1. Create a second Supabase project (e.g. "weftling-dev"); run every
   `supabase/*.sql` migration in it.
2. On the **`develop`** branch, point `public/config.js` at the dev project's
   URL + anon key. Leave `main`'s `config.js` on production. (This is why the
   two branches can safely diverge on that one file.)
3. In Vercel, set the backend env vars above **scoped to the `develop` branch**
   (Settings → Environment Variables → add the dev values, environment =
   Preview + the `develop` branch) to point at the dev Supabase / a dev Nango
   integration.
4. Now dev work — code and data — can't touch production.

## Auth email note

Supabase Auth's **Site URL** should be the **production** domain
(`weftling.fabbricerp.com`) so confirmation / password-reset emails land on
production. Add both domains to **Redirect URLs** if you also want auth to
work when testing on `weftling.vercel.app`.
