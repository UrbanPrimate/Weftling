---
description: Build or extend Weftly — a local time & materials tracker with CSV invoice export, installable as a phone app
argument-hint: [optional focus, e.g. "pwa", "ui", "csv", or blank for full build]
model: Fable 5
allowed-tools: Read, Write, Edit, Bash(npm:*), Bash(node:*), Bash(git:*), Bash(mkdir:*), Bash(ls:*), Bash(cat:*)
---

# Build Weftly

You are building (or extending) **Weftly**, a local-first time & materials tracker for an
independent consultant. Work in the current repository.

**Focus for this run:** $ARGUMENTS
(If blank, do a full build/completion pass. If a focus is given — e.g. `pwa`, `ui`, `csv` —
prioritise that area but keep everything else working.)

## Before you write anything
1. Read the existing files in this repo first. If Weftly already exists here, **extend and
   refactor it to match this spec — do not blow away working code**. If the repo is empty,
   scaffold from scratch.
2. Produce a short plan of what you'll add/change, then implement in logical, committed steps.
3. After building, run the acceptance checks at the bottom and report results.

## What Weftly is
A tiny full-stack app the user runs on their own machine (and can install on their iPhone as a
home-screen app). There is no live accounting integration — Weftly logs time and materials, then
exports a CSV the user imports into their own accounting software (Xero or QuickBooks) when
they're ready to bill. Nothing leaves the machine except the file the user explicitly downloads.

Branding note: "Weftly" is a placeholder name (parent brand "Fabbric"; final name TBD). Keep the
product name in as few places as possible — the header, the `<title>`, the manifest `name`/
`short_name`, and the apple web-app title — so it's a one-minute change later.

## Tech stack (keep it zero-build)
- **Backend:** Node.js (18+), Express, CommonJS. No third-party API SDKs — it only serves static
  files. No secrets, no OAuth, no token handling.
- **Frontend:** a single self-contained HTML file with vanilla JS + CSS served from `/public`.
  No framework, no bundler, no build step.

## Core features (tabs)
- **Overview** — total unbilled value, unbilled value per client, hours logged this period
  (actual vs. billed after rounding).
- **Time** — log entries: client, date, description, duration (hours+minutes) or a built-in
  stopwatch, per-hour rate, minimum billed increment, billable/non-billable. Show *actual* vs
  *billed* time side by side.
- **Materials** — pass-through costs: client, date, description, quantity, unit cost, optional
  markup %, billable flag.
- **Clients** — per-client rate and increment overrides; live unbilled total.
- **Invoice** — pick a client + optional date range, preview the bundled unbilled lines, then
  download either a **Xero-format CSV** or a **QuickBooks-format CSV**; either path can mark the
  included entries as invoiced.
- **Timesheet** — a standalone document generator for 1099 contractors, entirely local.
- **Settings** — defaults (rate, increment, rounding, terms, markup, currency symbol, date
  format), accounting software (optional: pick Xero, QuickBooks Online, or Neither/not sure,
  which shows only the relevant export fields — revenue account code + sales tax rate for Xero,
  an optional Product/Service name for QuickBooks), backup/export, and reset data.

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

## CSV invoice export (the only "billing" path — no live API calls)
Two formats, generated client-side from the same bundled line items, one row per line item:
- **Xero-format**: `ContactName, EmailAddress, InvoiceNumber, Reference, InvoiceDate, DueDate,
  Description, Quantity, UnitAmount, AccountCode, TaxType`. `AccountCode`/`TaxType` come from
  Settings → Accounting software (optional), when Xero is selected.
- **QuickBooks-format**: `InvoiceNo, Customer, InvoiceDate, DueDate, ItemDescription,
  Product/Service, Quantity, Rate, Amount`, dates as MM/DD/YYYY. `Product/Service` comes from
  Settings → Accounting software (optional), when QuickBooks Online is selected (optional —
  QuickBooks also lets you map columns during import).

Both use `\r\n` line endings + a UTF-8 BOM; no currency symbols; warn the user not to open the
Xero-format file in Excel before importing (Excel mangles dates). After either download, ask the
user whether to mark the included entries as invoiced.

## PWA (installable on iPhone)
- `public/manifest.webmanifest` (display: standalone, theme_color `#17212E`, icons 192 / 512 /
  512-maskable), apple-touch-icon 180, a mobile `viewport` meta, and safe-area insets so the
  sticky header clears the notch.
- A service worker (`public/sw.js`): network-first for HTML, cache-first for static assets.
  Register it only over http(s).
- Generate the app icons (an abstract woven-swatch mark on the ink background — no text).

## Config & housekeeping
- `.env` (`PORT` only) + a committed `.env.example`.
- `.gitignore`: `node_modules/`, `.env`, `server.log`.
- `package.json` scripts: `start` = `node server.js`, `dev` = `node --watch server.js`.
- A README covering: `npm install`, `npm start`, and the "Add to Home Screen" install steps.

## Design
Clean "ledger" aesthetic: ink `#17212E`, teal accent `#0E7C6B`, cool-neutral background
`#EEF2F5`, hairline borders, and **tabular monospaced figures for every time and money value** so
columns line up. Minimal, professional, no clutter. Responsive down to phone width.

## Definition of done (run these and report)
- `npm install` succeeds; `npm start` boots and prints the local URL.
- Server serves the app, `manifest.webmanifest`, `sw.js`, and the icons with correct content types.
- No `/api` calls anywhere in the frontend; no console errors on load.
- Billing math passes the sanity checks above.
- Both CSV exports validate and the PWA is installable.
