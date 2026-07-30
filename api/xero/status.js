'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { withHandler, HttpError } = require('../_lib/http');

/** GET /api/xero/status — is this user connected, and to which org? */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);

  const { data, error } = await supabase
    .from('integrations')
    .select('xero_org_name, xero_tenant_id, status, connected_at')
    .eq('user_id', user.id)
    .eq('provider', 'xero')
    .maybeSingle();

  if (error) throw new HttpError(500, 'server_error', error.message);

  if (!data || data.status !== 'connected') {
    res.status(200).json({ connected: false });
    return;
  }

  res.status(200).json({
    connected: true,
    orgName: data.xero_org_name,
    tenantId: data.xero_tenant_id,
    connectedAt: data.connected_at,
  });
});
