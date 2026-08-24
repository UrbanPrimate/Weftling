'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { getNango, QUICKBOOKS_INTEGRATION_ID, normalizeNangoError } = require('../_lib/nango');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/quickbooks/disconnect — QuickBooks twin of /api/xero/disconnect,
 * with the same both-halves-or-error contract: the Nango-side connection
 * (and the OAuth tokens it holds) must be confirmed gone before the local
 * reference row is deleted, and a genuine Nango failure keeps the local row
 * so the app never hides a live, still-usable connection. A Nango 404 is
 * treated as success (already in the desired end state).
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);

  const { data, error } = await supabase
    .from('integrations')
    .select('nango_connection_id')
    .eq('user_id', user.id)
    .eq('provider', 'quickbooks')
    .maybeSingle();

  if (error) throw new HttpError(500, 'server_error', error.message);

  if (!data) {
    res.status(200).json({ connected: false });
    return;
  }

  try {
    const nango = getNango();
    await nango.deleteConnection(QUICKBOOKS_INTEGRATION_ID, data.nango_connection_id);
  } catch (err) {
    const normalized = normalizeNangoError(err);
    if (!normalized.notFound) {
      throw new HttpError(502, 'nango_error', 'Could not remove the QuickBooks connection from Nango: ' + normalized.message);
    }
  }

  const { error: deleteError } = await supabase
    .from('integrations')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', 'quickbooks');

  if (deleteError) {
    throw new HttpError(500, 'server_error', 'Removed from Nango, but could not clear the local reference: ' + deleteError.message);
  }

  res.status(200).json({ connected: false });
});
