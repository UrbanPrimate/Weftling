'use strict';

const { getNango, XERO_INTEGRATION_ID } = require('./nango');
const { HttpError } = require('./http');

// Every Xero Accounting API call (Contacts, Items, Accounts, TaxRates,
// Invoices) lives under /api.xro/2.0/... . Nango's proxy for the "xero"
// provider is NOT pre-pointed at that base — confirmed by reading Nango's
// actual providers.yaml (packages/providers/providers.yaml in NangoHQ/nango
// on GitHub): the xero entry's `proxy.base_url` is plainly
// `https://api.xero.com`, with no /api.xro/2.0 suffix. So this prefix has
// to be added on every call, which xeroGet/xeroPost below do centrally —
// callers pass a path relative to /api.xro/2.0 (e.g. '/Contacts') and never
// need to know this detail.
const XERO_ACCOUNTING_API_BASE = '/api.xro/2.0';

/**
 * Loads this user's Xero connection reference from `integrations` (RLS
 * already guarantees `supabase` — scoped to this user's own JWT — can only
 * see their own row) and returns what a proxied call needs: Nango's
 * connection id, and the Xero tenant id every Accounting API call must
 * carry as a header (one Xero OAuth connection can cover several
 * organisations, so there's no implicit "the" tenant — Xero requires you
 * say which one on every request).
 *
 * Throws HttpError(409, 'not_connected') if there's no connection yet — the
 * frontend shows "connect Xero in Settings" for that code.
 */
async function requireXeroConnection(supabase, user) {
  const { data, error } = await supabase
    .from('integrations')
    .select('nango_connection_id, xero_tenant_id, xero_org_name, status')
    .eq('user_id', user.id)
    .eq('provider', 'xero')
    .maybeSingle();

  if (error) throw new HttpError(500, 'server_error', error.message);
  if (!data || data.status !== 'connected' || !data.xero_tenant_id) {
    throw new HttpError(409, 'not_connected', 'Not connected to Xero yet. Go to Settings and connect.');
  }

  return {
    connectionId: data.nango_connection_id,
    tenantId: data.xero_tenant_id,
    orgName: data.xero_org_name,
  };
}

/** GET against the Xero Accounting API, tenant-scoped, through Nango's proxy. */
async function xeroGet(conn, endpoint, params, extraHeaders) {
  const nango = getNango();
  const fullEndpoint = XERO_ACCOUNTING_API_BASE + endpoint;
  console.log(
    `[xero] GET ${fullEndpoint} (tenant=${conn.tenantId}, connection=${conn.connectionId}, params=${JSON.stringify(params || {})})`
  );
  return nango.get({
    endpoint: fullEndpoint,
    providerConfigKey: XERO_INTEGRATION_ID,
    connectionId: conn.connectionId,
    headers: { 'xero-tenant-id': conn.tenantId, Accept: 'application/json', ...extraHeaders },
    params,
  });
}

/** POST against the Xero Accounting API, tenant-scoped, through Nango's proxy. */
async function xeroPost(conn, endpoint, data) {
  const nango = getNango();
  const fullEndpoint = XERO_ACCOUNTING_API_BASE + endpoint;
  console.log(`[xero] POST ${fullEndpoint} (tenant=${conn.tenantId}, connection=${conn.connectionId})`);
  return nango.post({
    endpoint: fullEndpoint,
    providerConfigKey: XERO_INTEGRATION_ID,
    connectionId: conn.connectionId,
    headers: { 'xero-tenant-id': conn.tenantId, 'Content-Type': 'application/json', Accept: 'application/json' },
    data,
  });
}

/**
 * Walks every page of a Xero list endpoint and returns the combined array.
 *
 * Xero's Contacts endpoint definitely pages (100 records/request); whether
 * Items/Accounts/TaxRates do too depends on org size and API version, and
 * isn't worth hard-coding a guess about. So instead of trusting "a short
 * page means we're done" alone, this also de-dupes by `idField` as it goes
 * and stops the moment a "page" contributes zero records it hasn't already
 * seen — an endpoint that doesn't really paginate (and just re-returns the
 * same full list for page=2) costs one harmless extra request instead of
 * duplicating every record up to the page cap.
 */
async function xeroGetAllPages(conn, endpoint, arrayKey, idField, params) {
  const all = [];
  const seenIds = new Set();
  const MAX_PAGES = 50; // 50 * 100/page = 5000 records safety cap against a runaway loop
  let page = 1;

  while (page <= MAX_PAGES) {
    const result = await xeroGet(conn, endpoint, { ...params, page });
    const body = (result && result.data) || result;
    const pageRecords = body[arrayKey] || [];

    let newCount = 0;
    for (const record of pageRecords) {
      const id = record[idField];
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      all.push(record);
      newCount += 1;
    }

    if (pageRecords.length < 100 || newCount === 0) break; // short page = last page; zero new = not actually paginating
    page += 1;
  }

  return all;
}

// Same character set the frontend's CSV export (csvEscape) and CSV import
// (sanitizeImportedText) paths already guard against — a cell value that
// starts with one of these is interpreted as a formula by Excel/Sheets/
// LibreOffice when opened (CWE-1236, "CSV injection"). csvEscape() already
// neutralizes this at every CSV *export*, regardless of where a value
// originally came from, so this isn't the only thing standing between a
// crafted Xero contact name and a spreadsheet formula — but pulling a name
// straight from Xero was the one entry point into `clients` that didn't
// clean it at the source the way manual CSV import already does, so this
// closes that inconsistency rather than leaving pulled data one step
// "dirtier" than imported data for no reason.
const DANGEROUS_LEADING_CHARS = /^[=+\-@\t\r]/;

function stripFormulaTrigger(v) {
  let s = String(v == null ? '' : v).trim();
  while (DANGEROUS_LEADING_CHARS.test(s)) s = s.slice(1).trim();
  return s;
}

/** Shared by contacts.js (transient picker) and pull-customers.js (upserts into `clients`) so the field mapping only lives in one place. */
function mapXeroContact(c) {
  const rawEmail = c.EmailAddress || c.emailAddress || null;
  return {
    contactId: c.ContactID || c.contactID,
    name: stripFormulaTrigger(c.Name || c.name),
    email: rawEmail ? stripFormulaTrigger(rawEmail) : null,
  };
}

/**
 * Xero's tenant-discovery endpoint — NOT under the Accounting API base, and
 * called with no tenant header (we don't know the tenant yet; that's the
 * point of calling it). Used once, right after a fresh Nango connection, to
 * learn which org(s) the user just authorized. `baseUrlOverride` may need
 * adjusting once we see a real response — flagged as an open unknown in the
 * build plan, not something the docs pinned down precisely.
 */
async function xeroListConnections(connectionId) {
  const nango = getNango();
  return nango.get({
    endpoint: '/connections',
    providerConfigKey: XERO_INTEGRATION_ID,
    connectionId,
    baseUrlOverride: 'https://api.xero.com',
    headers: { Accept: 'application/json' },
  });
}

/** True when a 401/403 looks like the token is missing a required OAuth2 scope. */
function isInsufficientScope(status, headers, bodyText) {
  if (status !== 401 && status !== 403) return false;
  const authHeader = (headers && (headers['www-authenticate'] || headers['WWW-Authenticate'])) || '';
  return /insufficient_scope/i.test(authHeader) || /insufficient_scope/i.test(bodyText || '');
}

/**
 * Normalizes whatever shape Nango throws for a failed proxied call into
 * { status, code, message }. Nango's proxy methods are axios-based, so the
 * expected shape is err.response.{status,data,headers} — checked first,
 * with fallbacks for a differently-shaped SDK error. Xero's own validation
 * errors (bad account code / tax type / etc, from createInvoices) come back
 * in body.Elements[0].ValidationErrors, same as the pre-Nango integration
 * this app had before — that shape comes straight from Xero, not from Nango,
 * so it should be stable regardless of how Nango wraps the error.
 */
function normalizeXeroError(err) {
  const response = err && err.response;
  const status = response && response.status;
  const headers = (response && response.headers) || {};
  const body = (response && response.data) || err.payload || err.data || null;
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body || '');

  // Logged unconditionally, before any interpretation below, so the raw
  // response is always visible in the console — what actually came back is
  // the ground truth for telling apart "our own function/route is wrong"
  // (no response at all, or a response shaped like our own JSON errors)
  // from "Nango's proxy call reached Xero and Xero rejected it" (a response
  // shaped like Xero's own error body, e.g. Message/Elements/ValidationErrors)
  // from "Nango itself rejected the call before ever reaching Xero" (a
  // response shaped like Nango's own { error: { code, message } } format).
  if (!response) {
    console.error('[xero] request failed with no HTTP response at all (network/DNS/timeout):', err && err.message);
  } else {
    console.error(`[xero] request failed: HTTP ${status}`, JSON.stringify(body));
  }

  let message = (err && err.message) || 'Unknown Xero error';
  if (body) {
    if (body.Elements && body.Elements[0] && body.Elements[0].ValidationErrors) {
      message = body.Elements[0].ValidationErrors.map((e) => e.Message).join('; ');
    } else if (body.Message) {
      message = body.Message;
    } else if (typeof body === 'string' && body) {
      message = body;
    }
  }

  if (isInsufficientScope(status, headers, bodyText)) {
    return {
      status: 403,
      code: 'insufficient_scope',
      message: 'Xero says this connection is missing a required permission. Reconnect Xero in Settings to grant it.',
    };
  }
  if (status === 401) {
    return {
      status: 401,
      code: 'xero_unauthorized',
      message: 'Your Xero connection expired or was revoked. Reconnect Xero in Settings.',
    };
  }
  if (status === 400 && body && body.Elements) {
    return { status: 422, code: 'validation_error', message };
  }
  return { status: 502, code: 'xero_error', message };
}

module.exports = {
  requireXeroConnection,
  xeroGet,
  xeroPost,
  xeroGetAllPages,
  xeroListConnections,
  mapXeroContact,
  normalizeXeroError,
};
