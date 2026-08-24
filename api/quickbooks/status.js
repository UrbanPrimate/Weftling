'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { withHandler, HttpError } = require('../_lib/http');

/** GET /api/quickbooks/status — is this user connected, and to which company? (QuickBooks twin of /api/xero/status.) */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);

  const { data, error } = await supabase
    .from('integrations')
    .select('qbo_company_name, qbo_realm_id, status, connected_at')
    .eq('user_id', user.id)
    .eq('provider', 'quickbooks')
    .maybeSingle();

  if (error) throw new HttpError(500, 'server_error', error.message);

  if (!data || data.status !== 'connected') {
    res.status(200).json({ connected: false });
    return;
  }

  res.status(200).json({
    connected: true,
    companyName: data.qbo_company_name,
    realmId: data.qbo_realm_id,
    connectedAt: data.connected_at,
  });
});
