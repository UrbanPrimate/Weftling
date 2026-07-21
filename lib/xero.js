'use strict';

const { XeroClient } = require('xero-node');
const tokenStore = require('./tokenStore');

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.invoices',
  'accounting.contacts.read',
  'accounting.settings.read',
].join(' ');

function hasCredentials() {
  return Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.REDIRECT_URI);
}

let client = null;

/** Lazily build the singleton XeroClient. Throws if credentials are missing. */
function getClient() {
  if (!hasCredentials()) {
    throw new Error('Missing Xero credentials. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, REDIRECT_URI in .env');
  }
  if (!client) {
    client = new XeroClient({
      clientId: process.env.XERO_CLIENT_ID,
      clientSecret: process.env.XERO_CLIENT_SECRET,
      redirectUris: [process.env.REDIRECT_URI],
      scopes: SCOPES.split(' '),
    });
  }
  return client;
}

/**
 * Returns { xero, tenantId, tenantName } for an authenticated, token-fresh
 * client, or null if there's no stored connection. Refreshes + persists the
 * token set transparently when it has expired.
 */
async function ensureAuthenticated() {
  const saved = tokenStore.load();
  if (!saved || !saved.tokenSet) return null;

  const xero = getClient();
  // xero-node's refreshToken() calls into xero.openIdClient without lazily
  // initializing it first (unlike buildConsentUrl/apiCallback). On a fresh
  // server process that never called those, openIdClient is still undefined,
  // so refreshing a token restored from disk throws "Cannot read properties
  // of undefined (reading 'refresh')". Initialize explicitly to avoid that.
  if (!xero.openIdClient) {
    await xero.initialize();
  }
  xero.setTokenSet(saved.tokenSet);

  let tokenSet = saved.tokenSet;
  if (xero.readTokenSet().expired()) {
    try {
      tokenSet = await xero.refreshToken();
    } catch (err) {
      console.error('Xero token refresh failed:', err.message);
      return null;
    }
    tokenStore.save({ ...saved, tokenSet });
  }

  if (!saved.tenantId) return null;
  return { xero, tenantId: saved.tenantId, tenantName: saved.tenantName || null };
}

async function buildConsentUrl() {
  const xero = getClient();
  return xero.buildConsentUrl();
}

/** Handle the OAuth callback: exchange code, discover tenants, persist. */
async function handleCallback(callbackUrl) {
  const xero = getClient();
  const tokenSet = await xero.apiCallback(callbackUrl);
  await xero.updateTenants(false);

  const tenants = xero.tenants || [];
  const tenant = tenants[0] || null;

  const saved = {
    tokenSet,
    tenantId: tenant ? tenant.tenantId : null,
    tenantName: tenant ? (tenant.tenantName || tenant.orgName || null) : null,
  };
  tokenStore.save(saved);
  return saved;
}

function disconnect() {
  tokenStore.clear();
  client = null;
}

module.exports = {
  hasCredentials,
  getClient,
  ensureAuthenticated,
  buildConsentUrl,
  handleCallback,
  disconnect,
};
