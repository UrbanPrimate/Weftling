# Security review — multi-tenant Xero integration

Scope: the whole app, with particular attention to everything added for the Xero integration
(Nango-brokered OAuth, `/api/xero/*` serverless functions, the `integrations` table, and the new
"pull" endpoints). Two tiers, per the request that triggered this review: Tier 1 items were
low-risk enough to fix directly; Tier 2 covers anything touching RLS, auth, secret/token handling,
CSP, or user-visible behavior — those are proposal-only even when found, and none were found this
pass (see "Tier 2" below for why).

---

## Findings

### 🟡 Medium — unescaped Xero-supplied URL in an `href` attribute (XSS)

- **What**: `renderXeroInvoiceResult()` built the "Open in Xero" link as
  `` `<a href="${inv.deepLink}" ...>` `` — `deepLink` is a template string built server-side
  (`api/xero/invoices.js`, `api/xero/invoice-status.js`) from `InvoiceID`, a value Xero's own API
  returns in the response to an invoice **we** just created. In the normal case this is a
  Xero-generated UUID with no attacker control, so real-world exploitability is low — but it's
  still external data (round-tripped through Nango's proxy, a second third party) landing in an
  HTML attribute with no escaping, which breaks the "escape every insertion" invariant this app
  otherwise holds everywhere else.
- **File/line**: `public/index.html`, `renderXeroInvoiceResult()` (~line 3340).
- **Status**: **Auto-fixed.** Wrapped in `escapeHtml()`, matching every other dynamic insertion in
  the file.
- **Why it matters**: if Xero (or anything between Xero and this app) ever returned a malformed
  `InvoiceID` containing `"`, an attacker-controlled value could break out of the attribute and
  inject arbitrary markup/attributes into the page. Low likelihood, cheap fix, no reason to leave
  it as the one unescaped insertion point in an otherwise fully-escaped codebase.

### 🟢 Low — Xero-pulled customer data skips the CSV-injection sanitization the manual-import path already has

- **What**: `sanitizeImportedText()` (frontend, CSV/xlsx file import) strips a leading
  `=`/`+`/`-`/`@`/tab/CR before storing an imported client's name/email — closing CSV-formula
  injection (CWE-1236) **at the source**. The new `pull-customers.js` (Xero → `clients`) had no
  equivalent: it stored `contact.Name`/`contact.EmailAddress` from Xero verbatim.
- **File/line**: `api/_lib/xero.js`, `mapXeroContact()`.
- **Status**: **Auto-fixed.** Added a server-side `stripFormulaTrigger()` (same character class as
  the frontend's `DANGEROUS_CSV_LEADING_CHARS`) and applied it in `mapXeroContact()`, so both
  `contacts.js` (transient picker) and `pull-customers.js` (persisted write) get clean values.
- **Why it matters, and why this was Low not Medium**: the actual attack — a malicious formula
  executing when someone opens an exported CSV in Excel — was **already fully blocked** regardless
  of data source, because `csvEscape()` re-checks and neutralizes the same leading characters at
  every CSV *export*, universally, not just for manually-imported data. This fix closes a
  data-at-rest inconsistency (Xero-pulled names were "dirtier" than imported ones for no reason),
  not a live hole — the export-time choke point was always the real backstop.

### 🔵 Info / hardening — two missing security headers

- **What**: `Strict-Transport-Security` and `Permissions-Policy` were absent. Neither is a gap an
  attacker could currently exploit (Vercel serves this app over HTTPS regardless; the app never
  touches geolocation/camera/mic/payment APIs — confirmed by grep, zero matches), but both are
  standard, zero-behavior-change hardening.
- **File/line**: `server.js`, `vercel.json`.
- **Status**: **Auto-fixed.** Added `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  and `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()` to both
  (server.js for local dev parity, vercel.json for production — matching how CSP is already
  duplicated in both places).
- **Why it matters**: HSTS prevents a downgrade-to-HTTP attack on future visits once a browser has
  seen it once; Permissions-Policy is defense-in-depth against a future dependency (e.g. a
  compromised CDN script) trying to invoke a browser API this app has no legitimate use for.

### Dependency vulnerabilities

`npm audit` → **0 vulnerabilities.** (The one real one — a vulnerable `axios` pulled in
transitively by an older `@nangohq/node`, CVE-class issues including SSRF/prototype-pollution —
was already found and fixed earlier in this build by bumping `@nangohq/node` to `^0.71.2`; nothing
new turned up this pass.)

### Secrets hygiene

Checked `.gitignore` coverage, every filename ever tracked across full git history (`git log --all
--name-only`), and a content sweep of every diff in history for secret-shaped strings
(`NANGO_SECRET_KEY=...`, `XERO_CLIENT_SECRET=...`, `service_role` JWTs, etc.).

**Clean — nothing found, nothing to flag or purge.** `.env`, `.env.local`, `.env*`, `config.js`,
`token.json`, and `.vercel` (the Vercel CLI's local link folder, which holds a project-scoped OIDC
token) are all gitignored and have never been committed at any point in history. `NANGO_SECRET_KEY`
appears in exactly one file in the whole codebase (`api/_lib/nango.js`, read from
`process.env` only) and is never logged, returned in any response, or referenced anywhere else —
including the frontend. `SUPABASE_SERVICE_ROLE_KEY` and `XERO_CLIENT_SECRET` don't appear
**anywhere** in this codebase at all — by design: this app never uses a service-role key (every
Supabase query goes through the caller's own JWT-scoped client), and the Xero client secret lives
only in the Nango dashboard, never in this app's code or environment.

### Input validation

Reviewed every `req.body`/`req.query`/`req.headers` read across `api/*.js` (grep, not spot-check).
The **only** header this app trusts anywhere is `Authorization` (`api/_lib/supabaseUser.js`), and
it's never trusted blindly — every request is independently re-verified against Supabase's own
Auth server. Body fields are always destructured by explicit name (`req.body.connectionId`, etc.)
and never spread wholesale (`{...req.body}`), so there's no prototype-pollution surface. No gap
found that crosses a security boundary — the few loosely-typed fields that exist (e.g. invoice
line-item `quantity`/`unitAmount`) can only ever affect the calling user's *own* Xero org, which
isn't a security boundary this app is responsible for policing.

---

## Tier 2 — proposed changes

**None.** Each Tier-2 category — RLS/access policies, session verification, Xero/Nango
token/secret/tenant handling, CSP — was reviewed specifically (not assumed clean from earlier
conversation turns) and no gap was found:

- RLS policies use `auth.uid() = user_id` on every command, every table — verified directly
  against the actual SQL files, not from memory (see invariant check below).
- `requireUser()` verifies every token via a live call to Supabase's own Auth server
  (`getUser(jwt)`) — never a local/cached decode — so a forged or expired token is rejected by
  Supabase itself, not by trust in anything this app computes.
- Every Xero-calling endpoint routes through `requireXeroConnection()` → `xeroGet`/`xeroPost`,
  which inject the calling user's own stored `xero_tenant_id` centrally — there's no per-file
  discipline to audit repeatedly, just one choke point, confirmed to be used by all 7
  Xero-data endpoints.
- CSP wasn't touched. Its one known weakening (`'unsafe-inline'` on `script-src`) is a pre-existing,
  already-documented tradeoff for this being a single-file, zero-build app — not a new finding, and
  tightening it would mean adding a build step, which is a real behavior change I'm not proposing
  unprompted.

If you want any of these categories hardened further regardless (e.g. moving off `'unsafe-inline'`),
say so and I'll propose a concrete diff for approval rather than guess at what tradeoff you'd
accept.

---

## Invariant checks

### 1. RLS enabled on every table, policies restricted to `auth.uid() = user_id`

**PASS.** Verified by reading `supabase/policies.sql` and `supabase/integrations.sql` directly:
all 5 tables (`clients`, `time_entries`, `materials`, `settings`, `integrations`) have
`enable row level security`, each with 4 policies (select/insert/update/delete), every one's
`using`/`with check` reading exactly `auth.uid() = user_id`.

Run this yourself in the Supabase SQL editor to confirm independently:

```sql
-- Expect 5 rows, rls_enabled = true for every one.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('clients','time_entries','materials','settings','integrations')
order by relname;

-- Expect 20 rows (5 tables x 4 commands). using_expr and with_check should read
-- "(auth.uid() = user_id)" everywhere they apply — nothing should read "true".
select tablename, policyname, cmd, qual as using_expr, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('clients','time_entries','materials','settings','integrations')
order by tablename, cmd;
```

### 2. Two different users cannot see or act on each other's data or Xero connection

**PASS**, by construction, on two independent layers:

- **Database layer**: RLS (invariant 1) is the actual backstop — even a bug in application code
  can't bypass it, since Postgres itself refuses the row.
- **Application layer**: every query in `api/*.js` against `integrations`/`clients` additionally
  filters `.eq('user_id', user.id)` explicitly (grepped and confirmed on every read/update/delete;
  inserts explicitly *set* `user_id: user.id` rather than filter by it, which is the correct
  equivalent for a write). This is redundant with RLS by design — defense in depth, not reliance
  on a single layer.
- `requireXeroConnection()` reads `xero_tenant_id`/`nango_connection_id` only from the row matching
  the *verified caller's* `user.id` — there's no code path that accepts a tenant id or connection
  id from the client and trusts it directly for a proxied Xero call.

*Not independently verifiable by me*: an actual two-account click-through (connect user A to org
X, user B to org Y, confirm neither's Settings/Invoice tab ever shows the other's org or contacts)
needs your real Xero-connected sessions — I don't have credentials for either. The code-level
guarantee above is what makes that test *expected* to pass; it's still worth you confirming
directly.

### 3. Every `/api` endpoint rejects an unauthenticated request; every Xero call is tenant-scoped

**PASS.** All 11 `/api/xero/*` endpoints tested with no/garbage `Authorization` header — every one
returns `401 {"error":"unauthorized"}` before touching Supabase, Nango, or Xero (re-run as part of
this review; full output above). Every endpoint that calls Xero does so through `requireXeroConnection()`
→ `xeroGet`/`xeroPost`, which centrally attach `xero-tenant-id: <that user's own stored tenant>` —
confirmed by reading all 7 call sites, not sampling.

### 4. No secret in frontend code or git

**PASS.** Covered in "Secrets hygiene" above — also separately grepped `public/` specifically for
`secretKey`/`client_secret`/`SUPABASE_SERVICE_ROLE`/`NANGO_SECRET` (zero matches). The only
credential the browser ever holds is the Supabase *publishable* anon key, which is designed to be
public (access control happens via RLS, not by keeping this key secret) and is already documented
as such in `public/config.example.js`.

---

## What's still open

1. **The one thing I can't verify myself**: the live two-account cross-tenant check (invariant 2's
   manual click-through). Code-level guarantees are in place; worth confirming directly with real
   Xero sessions when convenient.
2. That's it — no other open items from this pass. Tier 1 had 2 real (low/medium) findings, both
   fixed; Tier 2 had none to propose.
