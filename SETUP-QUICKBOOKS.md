# QuickBooks Online sync — one-time setup

Weftling's QuickBooks integration works exactly like the Xero one: Nango holds
the OAuth tokens, the app stores only a reference (`integrations` row with the
company's realmId), and every call goes through the app's own
`/api/quickbooks/*` serverless functions. This file is the checklist to light
it up — sandbox first, production later with no code changes.

## 1. Supabase — run the migration

Paste `supabase/quickbooks_sync.sql` into Supabase Dashboard → SQL Editor →
Run. It adds `integrations.qbo_realm_id` / `qbo_company_name` and
`clients.qbo_customer_id` (all nullable, RLS unchanged).

**Do this before deploying the new frontend** — client saves now include the
`qbo_customer_id` column and will fail against a database that doesn't have it.

## 2. Intuit — create a developer app (free)

1. Sign in / sign up at https://developer.intuit.com
2. Dashboard → Create an app → QuickBooks Online and Payments.
3. Under the app's **Keys & credentials**, note the **Client ID** and
   **Client Secret** — Development keys work against sandbox companies,
   Production keys against real ones.
4. Add Nango's redirect URI to the app:
   `https://api.nango.dev/oauth/callback`
5. A sandbox test company comes with the developer account
   (Dashboard → Sandboxes) — that's what you'll connect to first.

## 3. Nango dashboard — add the integration

1. Integrations → Configure new integration → search **Quickbooks (Sandbox)**.
2. Set the integration's **unique key** to `quickbooks-sandbox` (that exact
   string — the app finds it by this name via `NANGO_QUICKBOOKS_INTEGRATION_ID`).
3. Paste the Intuit **Development** Client ID/Secret.
4. Scopes: `com.intuit.quickbooks.accounting` (Nango adds none by default —
   without this the OAuth consent will request nothing and API calls fail).

## 4. Environment variables

Local `.env` and Vercel (Project → Settings → Environment Variables — then
redeploy; env changes don't apply to existing deployments):

```
NANGO_QUICKBOOKS_INTEGRATION_ID=quickbooks-sandbox
```

While you're in Vercel: the functions also need `SUPABASE_URL` and
`SUPABASE_ANON_KEY` (same values as `public/config.js`). Their absence is what
was breaking the deployed Xero sync — every `/api/*` call was returning
`server_misconfigured`.

`NANGO_SECRET_KEY` is shared with Xero and should already be set in both places.

## 5. Connect and test

Settings → QuickBooks connection → **Connect to QuickBooks** → sign in with
your Intuit developer login and pick the sandbox company. (The Nango popup
shows an optional "Realm ID" field — leave it blank; it's captured
automatically.) Then:

- **Pull customers** — sandbox companies ship with ~29 sample customers.
- Billing → Invoice → build a preview → pick the QuickBooks customer and a
  Product/Service (sandbox has "Design", "Gardening", etc.) → **Create
  invoice in QuickBooks** → open the deep link, confirm it's there, unsent.
- **Sync status** on the result banner re-reads Balance/DueDate and shows
  Open / Overdue / Paid / Voided.

## Going to production later

1. In Nango: add a second integration, key `quickbooks`, provider
   **Quickbooks** (non-sandbox), with the Intuit **Production** keys and the
   same scope.
2. Change `NANGO_QUICKBOOKS_INTEGRATION_ID` to `quickbooks` (or remove it —
   `quickbooks` is the default). Redeploy.
3. Users reconnect once (Settings → Disconnect → Connect) since sandbox
   connections don't carry over. Deep links switch to the production
   QuickBooks host automatically.

## Notes / limitations

- QuickBooks has no "draft" invoice state — a created invoice is real but
  **unsent** (`EmailStatus: NotSet`); Weftling never triggers sending.
- Every QBO invoice line must reference a Product/Service; the invoice
  preview's picker applies one item to all lines (defaulting to the
  Settings → "Product/Service name" match). Descriptions/quantities/rates
  stay per-line.
- Invoice numbers (`DocNumber`) are left for QuickBooks to auto-assign; the
  Weftling "reference" goes into the invoice's PrivateNote instead.
- Deep links (`app.qbo.intuit.com/app/invoice?txnId=…`) carry no company id —
  you must be signed into the right QuickBooks company for them to land.
