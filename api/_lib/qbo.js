'use strict';

const { getNango, QUICKBOOKS_INTEGRATION_ID, isQuickBooksSandbox, connectionOwnerId } = require('./nango');
const { HttpError } = require('./http');
const { enforceRateLimit } = require('./rateLimit');

// Unlike Xero (where the org is an HTTP header on every call), QuickBooks
// scopes every Accounting API call by path — /v3/company/{realmId}/... —
// and Nango's proxy base_url for the quickbooks providers is a bare host
// (confirmed against Nango's providers.yaml: quickbooks →
// https://quickbooks.api.intuit.com, quickbooks-sandbox →
// https://sandbox-quickbooks.api.intuit.com, no path prefix, no automatic
// realmId injection). So the realmId has to be baked into the endpoint path
// by us, which qboGet/qboPost below do centrally — callers pass a path
// relative to /v3/company/{realmId} (e.g. '/invoice') and never build it.
//
// `minorversion` is Intuit's API sub-version pin, sent on every call so
// responses keep a stable shape regardless of what Intuit later makes the
// default. 75 is the current consolidated version Intuit moved everyone to
// when older minor versions were retired.
const QBO_MINOR_VERSION = 75;

/**
 * Loads this user's QuickBooks connection reference from `integrations`
 * (RLS scoped, same as requireXeroConnection) and returns what a proxied
 * call needs: Nango's connection id and the QBO company ("realm") id.
 *
 * Throws HttpError(409, 'not_connected') if there's no connection yet — the
 * frontend shows "connect QuickBooks in Settings" for that code.
 *
 * Like requireXeroConnection, this is the shared choke point for every
 * proxied QuickBooks call, so it also enforces the per-user rate limit and
 * re-verifies that the stored connection actually belongs to the caller
 * (the integrations row is client-writable — see that function's comment).
 */
async function requireQboConnection(supabase, user) {
  await enforceRateLimit(supabase, 'qbo_proxy', 60, 60);

  const { data, error } = await supabase
    .from('integrations')
    .select('nango_connection_id, qbo_realm_id, qbo_company_name, status')
    .eq('user_id', user.id)
    .eq('provider', 'quickbooks')
    .maybeSingle();

  if (error) throw new HttpError(500, 'server_error', error.message);
  if (!data || data.status !== 'connected' || !data.qbo_realm_id) {
    throw new HttpError(409, 'not_connected', 'Not connected to QuickBooks yet. Go to Settings and connect.');
  }

  let connection;
  try {
    connection = await getNango().getConnection(QUICKBOOKS_INTEGRATION_ID, data.nango_connection_id);
  } catch (err) {
    throw new HttpError(409, 'not_connected', 'Your QuickBooks connection could not be verified. Reconnect QuickBooks in Settings.');
  }
  if (connectionOwnerId(connection) !== user.id) {
    throw new HttpError(403, 'forbidden', 'This QuickBooks connection does not belong to your account.');
  }

  return {
    connectionId: data.nango_connection_id,
    realmId: data.qbo_realm_id,
    companyName: data.qbo_company_name,
  };
}

/** GET against the QBO Accounting API, realm-scoped, through Nango's proxy. */
async function qboGet(conn, endpoint, params) {
  const nango = getNango();
  const fullEndpoint = `/v3/company/${conn.realmId}${endpoint}`;
  console.log(`[qbo] GET ${fullEndpoint} (connection=${conn.connectionId}, params=${JSON.stringify(params || {})})`);
  return nango.get({
    endpoint: fullEndpoint,
    providerConfigKey: QUICKBOOKS_INTEGRATION_ID,
    connectionId: conn.connectionId,
    headers: { Accept: 'application/json' },
    params: { minorversion: QBO_MINOR_VERSION, ...params },
  });
}

/** POST against the QBO Accounting API, realm-scoped, through Nango's proxy. */
async function qboPost(conn, endpoint, data, params) {
  const nango = getNango();
  const fullEndpoint = `/v3/company/${conn.realmId}${endpoint}`;
  console.log(`[qbo] POST ${fullEndpoint} (connection=${conn.connectionId})`);
  return nango.post({
    endpoint: fullEndpoint,
    providerConfigKey: QUICKBOOKS_INTEGRATION_ID,
    connectionId: conn.connectionId,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    params: { minorversion: QBO_MINOR_VERSION, ...params },
    data,
  });
}

/**
 * QBO can return HTTP 200 with a Fault body instead of a non-2xx status —
 * documented behavior, most commonly on /query errors. Every read of a QBO
 * response body goes through this first so a "successful" Fault still lands
 * in normalizeQboError's axios-shaped error path like any other failure.
 */
function throwIfFault(body) {
  if (body && body.Fault) {
    const err = new Error('QuickBooks returned a Fault.');
    err.response = { status: 400, data: body };
    throw err;
  }
  return body;
}

/**
 * Runs one QBO SQL-ish query (their /query endpoint) and returns the
 * QueryResponse object ({ Customer: [...], startPosition, maxResults, ... }).
 */
async function qboQuery(conn, query) {
  const result = await qboGet(conn, '/query', { query });
  const body = throwIfFault((result && result.data) || result);
  return (body && body.QueryResponse) || {};
}

/**
 * Walks a paginated QBO query (STARTPOSITION/MAXRESULTS) and returns every
 * record of `entity`. QBO pages are capped at 1000 records; the safety cap
 * mirrors xeroGetAllPages' philosophy (bounded loop, never trusts the API
 * to terminate for us).
 */
async function qboQueryAll(conn, entity, whereClause) {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 10; // 10 * 1000 = 10k records — far beyond a one-person shop's customer list
  const all = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_SIZE + 1;
    const query = `select * from ${entity}${whereClause ? ' where ' + whereClause : ''} startposition ${start} maxresults ${PAGE_SIZE}`;
    const qr = await qboQuery(conn, query);
    const records = qr[entity] || [];
    all.push(...records);
    if (records.length < PAGE_SIZE) break;
  }

  return all;
}

/**
 * Escapes a value for use inside single quotes in a QBO query. QBO's query
 * language escapes a quote with a backslash (`'Adam\'s Candy Shop'` in
 * Intuit's own docs) — which makes the backslash itself a metachar too: a
 * value ending in `\` would otherwise eat the closing quote and break out
 * of the string (same class of bug as classic SQL injection).
 */
function qboQuoteEscape(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Web-UI deep link for an invoice — sandbox companies live on a different host than production ones. */
function qboInvoiceDeepLink(invoiceId) {
  const host = isQuickBooksSandbox() ? 'https://app.sandbox.qbo.intuit.com' : 'https://app.qbo.intuit.com';
  return `${host}/app/invoice?txnId=${invoiceId}`;
}

/**
 * Normalizes whatever shape Nango throws for a failed proxied QBO call into
 * { status, code, message } — the QuickBooks counterpart of
 * normalizeXeroError, and the same axios-style err.response contract.
 * QBO's own errors arrive as a Fault body:
 *   { Fault: { Error: [{ Message, Detail, code }], type: 'ValidationFault'|... } }
 * with HTTP 400 for validation problems and 401/403 for auth/scope problems.
 */
function normalizeQboError(err) {
  const response = err && err.response;
  const status = response && response.status;
  const body = (response && response.data) || err.payload || err.data || null;

  // Raw response logged before any interpretation — same ground-truth-first
  // policy as normalizeXeroError, and for the same reason: telling apart
  // "our code is wrong" / "QuickBooks rejected it" / "Nango rejected it
  // before Intuit ever saw it" starts from what actually came back.
  if (!response) {
    console.error('[qbo] request failed with no HTTP response at all (network/DNS/timeout):', err && err.message);
  } else {
    console.error(`[qbo] request failed: HTTP ${status}`, JSON.stringify(body));
  }

  let message = (err && err.message) || 'Unknown QuickBooks error';
  const faultErrors = body && body.Fault && Array.isArray(body.Fault.Error) ? body.Fault.Error : null;
  if (faultErrors && faultErrors.length) {
    message = faultErrors
      .map((e) => [e.Message, e.Detail].filter(Boolean).join(' — '))
      .join('; ');
  } else if (body && typeof body === 'string' && body) {
    message = body;
  }

  if (status === 403) {
    return {
      status: 403,
      code: 'insufficient_scope',
      message: 'QuickBooks says this connection is missing a required permission. Reconnect QuickBooks in Settings to grant it.',
    };
  }
  if (status === 401) {
    return {
      status: 401,
      code: 'qbo_unauthorized',
      message: 'Your QuickBooks connection expired or was revoked. Reconnect QuickBooks in Settings.',
    };
  }
  if (status === 400 && faultErrors) {
    return { status: 422, code: 'validation_error', message };
  }
  return { status: 502, code: 'qbo_error', message };
}

module.exports = {
  requireQboConnection,
  qboGet,
  qboPost,
  qboQuery,
  qboQueryAll,
  qboQuoteEscape,
  qboInvoiceDeepLink,
  normalizeQboError,
  throwIfFault,
  QBO_MINOR_VERSION,
};
