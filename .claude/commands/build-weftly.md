---
description: Build or extend Weftly — a local time & materials tracker that bills through Xero, installable as a phone app
argument-hint: [optional focus, e.g. "xero", "pwa", "ui", or blank for full build]
model: Fable 5
allowed-tools: Read, Write, Edit, Bash(npm:*), Bash(node:*), Bash(git:*), Bash(mkdir:*), Bash(ls:*), Bash(cat:*)
---

# Build Weftly

You are building (or extending) **Weftly**, a local-first time & materials tracker for an
independent consultant that lets them bill through **Xero**. Work in the current repository.

**Focus for this run:** $ARGUMENTS
(If blank, do a full build/completion pass. If a focus is given — e.g. `xero`, `pwa`, `ui` —
prioritise that area but keep everything else working.)

## Before you write anything
1. Read the existing files in this repo first. If Weftly already exists here, **extend and
   refactor it to match this spec — do not blow away working code**. If the repo is empty,
   scaffold from scratch.
2. Produce a short plan of what you'll add/change, then implement in logical, committed steps.
3. After building, run the acceptance checks at the bottom and report results.

## What Weftly is
A tiny full-stack app the user runs on their own machine (and can install on their iPhone as a
home-screen app). Xero is the source of truth for customers, items, and invoices; Weftly logs
time and materials and pushes a **draft** invoice to Xero when the user is ready to bill.

Branding note: "Weftly" is a placeholder name (parent brand "Fabbric"; final name TBD). Keep the
product name in as few places as possible — the header, the `<title>`, the manifest `name`/
`short_name`, and the apple web-app title — so it's a one-minute change later.

## Tech stack (keep it zero-build)
- **Backend:** Node.js (18+), Express, CommonJS. Uses the official **`xero-node`** SDK.
- **Frontend:** a single self-contained HTML file with vanilla JS + CSS served from `/public`.
  No framework, no bundler, no build step.
- Backend serves the frontend, so the UI and the `/api` routes are same-origin (no CORS between them).

## Core features (tabs)
- **Overview** — unbilled value (total + per client), hours logged this week, all-time billable
  hours after rounding, and billable utilization.
- **Time** — log entries: client, date, description, duration (hours+minutes) or a built-in
  stopwatch, per-hour rate, minimum billed increment, billable/non-billable. Show *actual* vs
  *billed* time side by side.
- **Materials** — pass-through costs: client, date, description, quantity, unit cost, optional
  markup %, billable flag.
- **Clients** — per-client rate and increment overrides; live unbilled total; link to a Xero contact.
- **Invoice** — pick a client + optional date range, preview the bundled unbilled lines, then
  either create a **draft in Xero** or download a **Xero-import CSV**; mark entries invoiced.
- **Settings** — defaults (rate, increment, rounding, terms, markup, currency symbol, date
  format), the Xero connection panel, and the Xero fields (account code, tax type).

## Billing logic (get this exactly right)
- `billedMinutes(min, inc, billable)`: if not billable or min<=0 → 0. Otherwise round to the
  increment: `roundingMode==="nearest" ? round(min/inc)*inc : ceil(min/inc)*inc`. If
  `minOneIncrement` is on and result < inc, use one increment.
- Time amount = `(billedMinutes/60) * rate`. Material amount = `qty * unitCost * (1 + markup/100)`.
- Sanity checks at 15-min increment, round-up: 7→15, 15→15, 16→30, 62→90, 0→0.

## Persistence (works outside this chat)
Storage picks the best available tier automatically, in this order:
1. `window.storage` (Claude artifact storage) if present,
2. `localStorage` when self-hosted in a real browser,
3. in-memory fallback (data lasts only for the tab).
Provide a JSON "Export all data" backup button in Settings.

## Xero integration (backend, via xero-node)
- OAuth 2.0 authorization-code flow (Web app, client secret held server-side).
- Scopes: `openid profile email offline_access accounting.transactions accounting.contacts.read accounting.settings.read`.
- Routes:
  - `GET /connect` → `xero.buildConsentUrl()` redirect
  - `GET /callback` → `apiCallback` + `updateTenants`, persist token set + tenantId
  - `POST /disconnect`
  - `GET /api/status` → { hasCredentials, connected, org }
  - `GET /api/contacts` → customers → clients (linked by Xero contact id)
  - `GET /api/items` → inventory items (services + materials) with description, sale price, account code, tax type
  - `GET /api/accounts` → REVENUE accounts (for the account-code picker)
  - `GET /api/taxrates` → tax rates (for the tax-type picker)
  - `POST /api/invoices` → create a **DRAFT** `ACCREC` invoice; return invoice id/number/total + a Xero deep link
- Persist tokens in a local `token.json` (single-user); auto-refresh when expired.
- Invoice lines: reference the Xero `itemCode` when the entry came from an item; otherwise use
  description + account code + tax type (from the item, else from Settings). Dates as `YYYY-MM-DD`.
- Never let the browser call Xero directly — it can't (Xero blocks CORS). All Xero traffic goes
  through these backend routes.
- **Gotchas to handle:** ContactName must match the Xero contact exactly; account code and tax
  type must match the org's chart of accounts or Xero rejects the whole invoice — surface those
  errors clearly in the UI. Default date format US (MM/DD/YYYY); make it configurable.

## CSV fallback export (offline path)
One row per line item; `ContactName` + `InvoiceNumber` repeat across an invoice's rows. Columns:
`ContactName, EmailAddress, InvoiceNumber, Reference, InvoiceDate, DueDate, Description, Quantity, UnitAmount, AccountCode, TaxType`.
Use `\r\n` line endings + a UTF-8 BOM; no currency symbols; warn the user not to open it in Excel
before importing (Excel mangles dates).

## PWA (installable on iPhone)
- `public/manifest.webmanifest` (display: standalone, theme_color `#17212E`, icons 192 / 512 /
  512-maskable), apple-touch-icon 180, a mobile `viewport` meta, and safe-area insets so the
  sticky header clears the notch.
- A service worker (`public/sw.js`): network-first for HTML, cache-first for static assets, and
  it must **never intercept** `/api`, `/connect`, or `/callback`. Register it only over http(s).
- Generate the app icons (an abstract woven-swatch mark on the ink background — no text).

## Config & housekeeping
- `.env` (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `REDIRECT_URI`, `PORT`) + a committed `.env.example`.
- `.gitignore`: `node_modules/`, `.env`, `token.json`, `server.log`.
- `package.json` scripts: `start` = `node server.js`, `dev` = `node --watch server.js`.
- A README covering: create a Xero app (redirect URI `http://localhost:3000/callback`), fill
  `.env`, `npm install`, `npm start`, connect (test with Xero's Demo Company), and the
  "Add to Home Screen" install steps.

## Design
Clean "ledger" aesthetic: ink `#17212E`, teal accent `#0E7C6B`, cool-neutral background
`#EEF2F5`, hairline borders, and **tabular monospaced figures for every time and money value** so
columns line up. Minimal, professional, no clutter. Responsive down to phone width.

## Definition of done (run these and report)
- `npm install` succeeds; `npm start` boots and prints the local URL.
- Server serves the app, `manifest.webmanifest`, `sw.js`, and the icons with correct content types.
- `GET /api/status` returns JSON; the Xero data routes return 409 when not connected.
- Billing math passes the sanity checks above.
- The CSV export validates and the PWA is installable.
- If Xero credentials are present, creating a draft invoice against the Demo Company succeeds and
  returns a working Xero deep link.
