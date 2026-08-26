'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { getNango, XERO_INTEGRATION_ID, connectionOwnerId } = require('../_lib/nango');
const { xeroListConnections, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');
const { enforceRateLimit } = require('../_lib/rateLimit');

/**
 * POST /api/xero/finalize  { connectionId, tenantId? }
 *
 * Called by the frontend right after Nango's Connect UI reports success.
 * Trusts nothing the client says without checking it against Nango's or
 * Xero's own records:
 *
 *  1. Confirms the connection Nango just created was actually tagged with
 *     THIS user's id when the session was minted (connect-session.js) —
 *     the connectionId itself is just an opaque string the client is
 *     reporting back; this is the check that makes it safe to trust.
 *  2. Asks Xero (not Nango) which organisation(s) were authorized, via
 *     Xero's own /connections endpoint. Xero's consent screen lets a user
 *     grant more than one organisation in a single authorization — if that
 *     happened, this does NOT guess which one to use. It hands the list
 *     back to the frontend (`needsTenantSelection: true`) and waits for a
 *     second call with an explicit `tenantId`, which is then checked
 *     against the list Xero actually returned for this connection (never
 *     trusted outright — same principle as the ownership check above).
 *  3. Records the reference in `integrations`. Still no token anywhere.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  await enforceRateLimit(supabase, 'xero_finalize', 20, 60);

  const connectionId = req.body && req.body.connectionId;
  const chosenTenantId = req.body && req.body.tenantId; // present only on the follow-up call after the user picks an org
  if (!connectionId || typeof connectionId !== 'string') {
    throw new HttpError(400, 'bad_request', 'connectionId is required.');
  }

  const nango = getNango();
  let connection;
  try {
    connection = await nango.getConnection(XERO_INTEGRATION_ID, connectionId);
  } catch (err) {
    console.error('getConnection failed:', err);
    throw new HttpError(502, 'nango_error', 'Could not verify the Xero connection with Nango.');
  }

  // Must match the verified caller, not a client-supplied value.
  if (connectionOwnerId(connection) !== user.id) {
    throw new HttpError(403, 'forbidden', 'This connection does not belong to your account.');
  }

  let tenants = [];
  try {
    const result = await xeroListConnections(connectionId);
    const list = (result && result.data) || result || [];
    tenants = (Array.isArray(list) ? list : [])
      .map((t) => ({
        tenantId: t.tenantId || t.tenant_id || null,
        orgName: t.tenantName || t.tenant_name || t.orgName || null,
      }))
      .filter((t) => t.tenantId);
  } catch (err) {
    const normalized = normalizeXeroError(err);
    console.error('xeroListConnections failed:', normalized);
    throw new HttpError(
      502,
      'xero_error',
      'Connected to Xero, but could not read your organisation list: ' + normalized.message
    );
  }

  if (!tenants.length) {
    throw new HttpError(502, 'xero_error', 'Xero did not report an authorized organisation for this connection.');
  }

  let selected;
  if (tenants.length === 1) {
    selected = tenants[0];
  } else if (chosenTenantId) {
    selected = tenants.find((t) => t.tenantId === chosenTenantId);
    if (!selected) {
      throw new HttpError(400, 'bad_request', 'That organisation isn’t part of this Xero authorization.');
    }
  } else {
    // More than one organisation was authorized and the caller hasn't told
    // us which to use yet — don't write anything to `integrations` until
    // they do. The row only ever ends up with one clearly-chosen tenant.
    res.status(200).json({
      connected: false,
      needsTenantSelection: true,
      tenants: tenants.map((t) => ({ tenantId: t.tenantId, orgName: t.orgName })),
    });
    return;
  }

  const { error: upsertError } = await supabase.from('integrations').upsert(
    {
      user_id: user.id,
      provider: 'xero',
      nango_connection_id: connectionId,
      xero_tenant_id: selected.tenantId,
      xero_org_name: selected.orgName,
      status: 'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );

  if (upsertError) throw new HttpError(500, 'server_error', upsertError.message);

  res.status(200).json({ connected: true, orgName: selected.orgName, tenantId: selected.tenantId });
});
