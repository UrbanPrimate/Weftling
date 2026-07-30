# Weftly

A tiny, local-first time & materials tracker for an independent consultant. Weftly logs your time
and materials, then exports a CSV you import into your own accounting software (Xero or
QuickBooks) when you're ready to bill. There's no live accounting integration — nothing leaves
your machine except the file you explicitly download.

> "Weftly" is a placeholder name (parent brand: Fabbric). The name only appears in a handful of
> places — the header, the page `<title>`, `public/manifest.webmanifest`, and the apple-mobile-web-app
> meta tag in `public/index.html` — so renaming later is quick.

## Stack

- **Backend (local dev):** Node.js 18+, Express, CommonJS (`server.js`) — serves `public/` as
  static files. This is what `npm start` runs; it does **not** serve `/api/*`.
- **Backend (deployed, optional Xero integration only):** Vercel Serverless Functions under
  `/api` — the only place any secret (Nango's secret key) lives. See "Xero integration" below.
- **Frontend:** one self-contained HTML file (`public/index.html`) — vanilla JS + CSS, no
  framework, no bundler, no build step.
- **Data:** your time, materials, clients, and settings live in Supabase, scoped to your account
  by Row-Level Security (see `supabase/*.sql`). Nothing leaves your machine except the CSV/JSON
  files you explicitly download, and (if you connect it) invoice data you explicitly send to your
  own Xero organisation.

## Setup

```bash
cp .env.example .env
npm install
npm start        # or: npm run dev   (auto-restarts on file changes)
```

Open the URL it prints (default `http://localhost:3000`). Change `PORT` in `.env` if you need a
different port.

## Day-to-day use

1. **Clients** — add your clients, and override the default rate/increment per client if needed.
2. **Time** — log entries (manually or with the built-in stopwatch). Actual vs. billed time is
   shown side by side so you can see the effect of rounding before you invoice.
3. **Materials** — log pass-through costs with optional markup.
4. **Invoice** — pick a client (and optionally a date range), preview the unbilled lines, then
   download either the **Xero-format CSV** or the **QuickBooks-format CSV**. Either path can mark
   the included entries as invoiced.
5. **Overview** — a running snapshot: unbilled value overall and per client, hours logged this
   period, billable hours after rounding.

### CSV import notes

**Xero-format** matches Xero's bulk invoice import columns (`ContactName, EmailAddress,
InvoiceNumber, Reference, InvoiceDate, DueDate, Description, Quantity, UnitAmount, AccountCode,
TaxType`). Set the revenue account code and sales tax rate in **Settings → Accounting software
(optional)** first (pick "Xero" from the dropdown to reveal those fields).

**QuickBooks-format** matches QuickBooks Online's invoice import columns (`InvoiceNo, Customer,
InvoiceDate, DueDate, ItemDescription, Product/Service, Quantity, Rate, Amount`). Optionally set a
Product/Service name in **Settings → Accounting software (optional)** (pick "QuickBooks Online")
to pre-fill that column; QuickBooks also lets you map columns during import if you leave it blank.

Both formats: one row per line item, UTF-8 with a BOM and `\r\n` line endings, no currency
symbols. **Don't open either file in Excel before importing** — Excel silently reformats date
columns on open (and re-save), which will corrupt the date columns before your accounting
software ever sees them. Import the file directly, or inspect it in a plain text editor if you
need to check it first.

## Xero integration (optional)

Instead of (or alongside) the CSV export, you can connect your own Xero organisation and create
draft invoices directly, with live contact/item/account/tax-rate pickers. It's entirely optional —
everything above works with no Xero connection at all.

**Architecture:** the browser never holds a Xero or Nango credential — only your Supabase
publishable key. Vercel Serverless Functions under `/api/xero/*` hold the one secret involved
(`NANGO_SECRET_KEY`) and are the only thing that ever talks to Nango or Xero. Every one of those
functions independently verifies the caller's Supabase session before doing anything, and acts
only on that signed-in user's own connection — there's no shared/global Xero connection.
[Nango](https://nango.dev) brokers the actual Xero OAuth flow and holds the encrypted token; this
app never sees a raw Xero access token, only a reference to the connection
(`supabase/integrations.sql` — table + RLS policies, no tokens stored).

**One-time setup (you do this by hand):**

1. **Xero Developer Portal** ([developer.xero.com/app/manage](https://developer.xero.com/app/manage)):
   new app, type **Web app** (not "Mobile or desktop app" — that's a public client with no secret,
   and Nango needs one). Redirect URI: `https://api.nango.dev/oauth/callback`. Copy the Client ID
   and generate/copy a Client Secret.
2. **Nango dashboard** ([app.nango.dev](https://app.nango.dev)): add a Xero integration, paste in
   the Client ID/Secret from step 1 (Nango holds these — not this app), scopes:
   `openid profile email offline_access accounting.invoices accounting.contacts.read accounting.settings.read accounting.invoices.read`
   (note: `accounting.invoices`, not the deprecated `accounting.transactions`). Copy your Nango
   **Secret Key**.
3. **Supabase SQL Editor**: run `supabase/integrations.sql` (safe to re-run).
4. **Vercel** → Project → Settings → Environment Variables, set `NANGO_SECRET_KEY`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` (same values already in `public/config.js`).

**Local testing of `/api/xero/*`:** `server.js`/`npm start` is a plain static file server and does
not serve `/api/*` — use `npx vercel dev` instead, which serves both the static frontend and the
serverless functions exactly as Vercel does in production. Put the same env vars from step 4 into
a local `.env` (already gitignored) for that.

**Known Xero gotchas this integration already accounts for:** account code and tax type must
match your Xero chart of accounts exactly, or Xero rejects the invoice; a Xero contact matched by
name must match exactly (prefer picking a contact from the live dropdown over typing a name); dates
are sent as plain `YYYY-MM-DD`; an expired/revoked connection or a missing scope surfaces as a
clear "reconnect Xero" prompt rather than a generic error.

## Install on iPhone (PWA)

1. Make sure your phone can reach the server (same Wi-Fi, and use your machine's LAN IP —
   `http://192.168.x.x:3000` — rather than `localhost`; on iOS, home-screen PWAs also work fine
   over plain `http://` on a local network).
2. Open that URL in **Safari**.
3. Tap the **Share** icon → **Add to Home Screen**.
4. Launch Weftly from the home screen icon — it opens full-screen, no browser chrome, with the
   header padded to clear the notch/Dynamic Island.

## Backing up your data

Since entries live in the browser, use **Settings → Backup → Export all data** periodically (and
before clearing site data or switching browsers). It downloads one JSON file with everything —
settings, clients, time, and materials. **Import backup** on the same screen restores it.

## Project layout

```
server.js               Express app entry point — serves public/ on PORT (local dev only, no /api)
lib/billing.js           Pure billing math (rounding, amounts) — see scripts/check-billing.js
public/index.html        The entire frontend (markup + CSS + JS)
public/manifest.webmanifest, public/sw.js, public/icons/  PWA assets
scripts/generate-icons.js  Regenerates the app icons (no image-library dependency)
scripts/check-billing.js   Billing math sanity checks (`npm run check`)
supabase/*.sql             Schema + RLS policies — run in order in Supabase's SQL Editor
api/_lib/                  Shared serverless helpers: JWT verification, Nango client, Xero proxy
api/xero/*.js               Serverless endpoints backing the optional Xero integration (see below)
```
