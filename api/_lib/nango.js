'use strict';

const { Nango } = require('@nangohq/node');

// Nango's dashboard names the Xero integration "xero" by default — override
// via env var if yours ends up named differently (see the Nango dashboard
// setup step in the project's Xero integration notes).
const XERO_INTEGRATION_ID = process.env.NANGO_XERO_INTEGRATION_ID || 'xero';

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

module.exports = { getNango, XERO_INTEGRATION_ID, normalizeNangoError };
