'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { getNango, QUICKBOOKS_INTEGRATION_ID, connectionOwnerId } = require('../_lib/nango');
const { qboGet, normalizeQboError } = require('../_lib/qbo');
const { withHandler, HttpError } = require('../_lib/http');
const { enforceRateLimit } = require('../_lib/rateLimit');

/**
 * POST /api/quickbooks/finalize  { connectionId }
 *
 * QuickBooks twin of /api/xero/finalize, one step simpler: Intuit's OAuth
 * consent covers exactly one company per authorization, and Nango captures
 * that company's id ("realmId") from the OAuth callback automatically —
 * it lands on the connection as `connection_config.realmId` (that exact
 * casing; confirmed against Nango's providers.yaml `redirect_uri_metadata`
 * mechanism). So there's no multi-tenant selection round-trip like Xero's.
 *
 * Trust model is identical to Xero's finalize:
 *  1. The connectionId the client reports back is only believed after
 *     Nango's own record of it carries THIS user's id in its tags.
 *  2. The realmId comes from Nango's record (captured server-side from
 *     Intuit's redirect), never from the client.
 *  3. The company display name is read from QuickBooks itself
 *     (/companyinfo/{realmId}) — cosmetic, so a failure there degrades to
 *     a null name rather than failing the whole connection.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  await enforceRateLimit(supabase, 'qbo_finalize', 20, 60);

  const connectionId = req.body && req.body.connectionId;
  if (!connectionId || typeof connectionId !== 'string') {
    throw new HttpError(400, 'bad_request', 'connectionId is required.');
  }

  const nango = getNango();
  let connection;
  try {
    connection = await nango.getConnection(QUICKBOOKS_INTEGRATION_ID, connectionId);
  } catch (err) {
    console.error('getConnection (quickbooks) failed:', err);
    throw new HttpError(502, 'nango_error', 'Could not verify the QuickBooks connection with Nango.');
  }

  if (connectionOwnerId(connection) !== user.id) {
    throw new HttpError(403, 'forbidden', 'This connection does not belong to your account.');
  }

  const realmId =
    (connection && connection.connection_config && connection.connection_config.realmId) || null;
  if (!realmId) {
    throw new HttpError(
      502,
      'qbo_error',
      'Connected, but Nango did not capture a QuickBooks company id (realmId) for this connection. Disconnect and try again.'
    );
  }

  // Best-effort display name — the connection is fully usable without it.
  let companyName = null;
  try {
    const result = await qboGet({ connectionId, realmId }, `/companyinfo/${realmId}`);
    const body = (result && result.data) || result;
    companyName = (body && body.CompanyInfo && body.CompanyInfo.CompanyName) || null;
  } catch (err) {
    console.error('companyinfo lookup failed (non-fatal):', normalizeQboError(err));
  }

  const { error: upsertError } = await supabase.from('integrations').upsert(
    {
      user_id: user.id,
      provider: 'quickbooks',
      nango_connection_id: connectionId,
      qbo_realm_id: String(realmId),
      qbo_company_name: companyName,
      status: 'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );

  if (upsertError) throw new HttpError(500, 'server_error', upsertError.message);

  res.status(200).json({ connected: true, companyName, realmId: String(realmId) });
});
