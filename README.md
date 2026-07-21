# Weftly

A tiny, local-first time & materials tracker for an independent consultant. Weftly logs your time
and materials, then exports a CSV you import into your own accounting software (Xero or
QuickBooks) when you're ready to bill. There's no live accounting integration — nothing leaves
your machine except the file you explicitly download.

> "Weftly" is a placeholder name (parent brand: Fabbric). The name only appears in a handful of
> places — the header, the page `<title>`, `public/manifest.webmanifest`, and the apple-mobile-web-app
> meta tag in `public/index.html` — so renaming later is quick.

## Stack

- **Backend:** Node.js 18+, Express, CommonJS. It only serves static files — no API keys, no
  OAuth, no token handling.
- **Frontend:** one self-contained HTML file (`public/index.html`) — vanilla JS + CSS, no
  framework, no bundler, no build step.
- **Data:** your time, materials, and client list live in the browser (localStorage, or
  `window.storage` if present, falling back to an in-memory tab if neither is available). Nothing
  leaves your machine except the CSV/JSON files you explicitly download.

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
server.js              Express app entry point — serves public/ on PORT
lib/billing.js          Pure billing math (rounding, amounts) — see scripts/check-billing.js
public/index.html        The entire frontend (markup + CSS + JS)
public/manifest.webmanifest, public/sw.js, public/icons/  PWA assets
scripts/generate-icons.js  Regenerates the app icons (no image-library dependency)
scripts/check-billing.js   Billing math sanity checks (`npm run check`)
```
