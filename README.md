# Weftly

A tiny, local-first time & materials tracker for an independent consultant. Xero stays the
source of truth for customers, items, and invoices — Weftly just logs time and materials and
pushes a **draft** invoice to Xero when you're ready to bill.

> "Weftly" is a placeholder name (parent brand: Fabbric). The name only appears in a handful of
> places — the header, the page `<title>`, `public/manifest.webmanifest`, and the apple-mobile-web-app
> meta tag in `public/index.html` — so renaming later is quick.

## Stack

- **Backend:** Node.js 18+, Express, CommonJS, the official [`xero-node`](https://github.com/XeroAPI/xero-node) SDK.
- **Frontend:** one self-contained HTML file (`public/index.html`) — vanilla JS + CSS, no
  framework, no bundler, no build step. Served straight off disk by Express, same-origin as `/api`.
- **Data:** your time, materials, and client list live in the browser (localStorage, or
  `window.storage` if present, falling back to an in-memory tab if neither is available). Xero
  OAuth tokens live server-side in a local `token.json`. Nothing leaves your machine except what
  you explicitly send to Xero.

## Setup

### 1. Create a Xero app

1. Go to <https://developer.xero.com/app/manage> and create a new **Web app**.
2. Set the redirect URI to exactly:
   ```
   http://localhost:3000/callback
   ```
   (If you change `PORT` in `.env`, update this to match.)
3. Copy the **Client ID** and **Client secret**.

### 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

```
XERO_CLIENT_ID=...
XERO_CLIENT_SECRET=...
REDIRECT_URI=http://localhost:3000/callback
PORT=3000
```

### 3. Install & run

```bash
npm install
npm start        # or: npm run dev   (auto-restarts on file changes)
```

Open the URL it prints (default `http://localhost:3000`).

### 4. Connect to Xero

Go to **Settings → Xero connection → Connect to Xero**, and authorize. For testing without
touching a real ledger, connect to Xero's free **Demo Company** (available from the org picker
during the OAuth consent screen, or create one at <https://developer.xero.com>).

Once connected:
- **Clients** can be linked to a real Xero contact (Settings aren't required for this — the
  Clients tab has its own contact picker).
- **Settings → Xero invoice fields** lets you pick a default revenue account code and tax type,
  pulled live from your organisation's chart of accounts.

If you'd rather not connect at all, everything still works — use **Invoice → Download
Xero-import CSV** instead of **Create draft in Xero**.

## Day-to-day use

1. **Clients** — add your clients, optionally linking each to a Xero contact, and override the
   default rate/increment per client if needed.
2. **Time** — log entries (manually or with the built-in stopwatch). Actual vs. billed time is
   shown side by side so you can see the effect of rounding before you invoice.
3. **Materials** — log pass-through costs with optional markup.
4. **Invoice** — pick a client (and optionally a date range), preview the unbilled lines, then
   either **Create draft in Xero** or **Download Xero-import CSV**. Either path marks the
   included entries as invoiced.
5. **Overview** — a running snapshot: unbilled value overall and per client, hours logged this
   week, all-time billable hours after rounding, and billable utilization.

### CSV import notes

The CSV matches Xero's bulk invoice import columns (`ContactName, EmailAddress, InvoiceNumber,
Reference, InvoiceDate, DueDate, Description, Quantity, UnitAmount, AccountCode, TaxType`), one
row per line item, UTF-8 with a BOM and `\r\n` line endings, no currency symbols.

**Don't open it in Excel before importing** — Excel silently reformats date columns on open (and
re-save), which will corrupt `InvoiceDate`/`DueDate` before Xero ever sees them. Import the file
directly, or inspect it in a plain text editor if you need to check it first.

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
server.js              Express app entry point
lib/billing.js          Pure billing math (rounding, amounts) — see scripts/check-billing.js
lib/xero.js              xero-node client wrapper: auth, token refresh
lib/tokenStore.js        Local token.json persistence
routes/xero.js           /connect, /callback, /disconnect, /api/* routes
public/index.html        The entire frontend (markup + CSS + JS)
public/manifest.webmanifest, public/sw.js, public/icons/  PWA assets
scripts/generate-icons.js  Regenerates the app icons (no image-library dependency)
scripts/check-billing.js   Billing math sanity checks (`npm run check`)
```

## Troubleshooting

- **"Xero rejected the invoice"** on draft creation almost always means the account code or tax
  type doesn't match your org's chart of accounts, or the linked contact's name has drifted from
  Xero. The error message from Xero is surfaced directly in the banner — fix the field it names
  in Settings or Clients and retry.
- **`GET /api/*` returns 409** — you're not connected yet (or credentials aren't configured).
  Check Settings.
- Token refresh happens automatically; if it ever fails, disconnect and reconnect from Settings.
