'use strict';

const { Nango } = require('@nangohq/node');

// Nango's dashboard names the Xero integration "xero" by default — override
// via env var if yours ends up named differently (see the Nango dashboard
// setup step in the project's Xero integration notes). NANGO_INTEGRATION_ID
// is accepted as an alias because that's the name the project's .env files
// (local and Vercel) actually use.
const XERO_INTEGRATION_ID =
  process.env.NANGO_XERO_INTEGRATION_ID || process.env.NANGO_INTEGRATION_ID || 'xero';

// QuickBooks integration key in Nango. Nango's catalog has two QuickBooks
// providers sharing one OAuth config: `quickbooks` (production companies,
// api host quickbooks.api.intuit.com) and `quickbooks-sandbox` (Intuit
// sandbox companies, api host sandbox-quickbooks.api.intuit.com). Which one
// this app talks to is purely which integration key it names here — so
// "switch sandbox → production" is an env-var change, not a code change.
// Default is the production key; set NANGO_QUICKBOOKS_INTEGRATION_ID to
// `quickbooks-sandbox` while testing against a sandbox company.
const QUICKBOOKS_INTEGRATION_ID = process.env.NANGO_QUICKBOOKS_INTEGRATION_ID || 'quickbooks';

/** True when the configured QuickBooks integration points at Intuit's sandbox — deep links must then go to app.sandbox.qbo.intuit.com. */
function isQuickBooksSandbox() {
  return /sandbox/i.test(QUICKBOOKS_INTEGRATION_ID);
}

let client = null;

/** Lazy singleton — reused across requests handled by the same warm serverless instance, not recreated per call. */
function getNango() {
  if (!client) {
    const secretKey = process.env.NANGO_SECRET_KEY;
    if (!secretKey) throw new Error('NANGO_SECRET_KEY is not set.');
    client = new Nango({ secretKey });
  }
  return client;
}

/**
 * Normalizes a failed call to Nango's own API (session creation, connection
 * lookup/delete — as opposed to a call *proxied through* Nango to Xero; see
 * xero.js's normalizeXeroError for that). Nango's own SDK doesn't wrap HTTP
 * errors in a custom class (confirmed by reading node_modules/@nangohq/node:
 * it's a plain `axios.create()` instance with no response interceptor), so
 * a failed call throws a raw axios error — `err.response.status` is the
 * real HTTP status, `err.response.data` is Nango's JSON body, shaped
 * `{ error: { code, message } }` (same shape Nango's own frontend bundle
 * throws from, confirmed by inspecting its built output).
 */
function normalizeNangoError(err) {
  const status = err && err.response && err.response.status;
  const body = err && err.response && err.response.data;
  const message = (body && body.error && body.error.message) || (err && err.message) || 'Unknown Nango error';
  return { status, message, notFound: status === 404 };
}

/**
 * The Supabase user id a Nango connection was tagged with when its Connect
 * session was minted (connect-session.js sets tags.end_user_id). Checked both
 * shapes — `end_user` is Nango's older field, `tags` the current one. This is
 * the ground truth for "who owns this connection", used to re-verify that a
 * stored connection reference really belongs to the caller (finalize.js and
 * the requireXero/QboConnection helpers).
 */
function connectionOwnerId(connection) {
  return (
    (connection && connection.end_user && connection.end_user.id) ||
    (connection && connection.tags && connection.tags.end_user_id) ||
    null
  );
}

module.exports = {
  getNango,
  XERO_INTEGRATION_ID,
  QUICKBOOKS_INTEGRATION_ID,
  isQuickBooksSandbox,
  connectionOwnerId,
  normalizeNangoError,
};
