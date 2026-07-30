'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { getNango, XERO_INTEGRATION_ID, normalizeNangoError } = require('../_lib/nango');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/xero/disconnect
 *
 * Only ever reads/writes the CALLING user's own row — `supabase` here is a
 * client scoped to their own verified JWT (see requireUser), and every
 * query below is additionally filtered `.eq('user_id', user.id)`, so even a
 * bug in this file couldn't touch another user's connection; RLS on
 * `integrations` would still refuse the row.
 *
 * Succeeds only if both halves actually succeed: the Nango-side connection
 * (and the OAuth tokens it holds) is deleted, AND the local reference row
 * is deleted. A real failure on either side is surfaced as an error rather
 * than silently reporting success — see the two failure branches below for
 * why each one stops instead of continuing.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);

  const { data, error } = await supabase
    .from('integrations')
    .select('nango_connection_id')
    .eq('user_id', user.id)
    .eq('provider', 'xero')
    .maybeSingle();

  if (error) throw new HttpError(500, 'server_error', error.message);

  if (!data) {
    // Nothing to disconnect — already in the desired end state.
    res.status(200).json({ connected: false });
    return;
  }

  try {
    const nango = getNango();
    await nango.deleteConnection(XERO_INTEGRATION_ID, data.nango_connection_id);
  } catch (err) {
    const normalized = normalizeNangoError(err);
    if (!normalized.notFound) {
      // A genuine failure (bad Nango secret key, Nango outage, network
      // error, etc). Deliberately do NOT delete the local row here: if we
      // don't know the token was actually removed from Nango's vault, the
      // app should keep showing this user as connected — reporting success
      // here would hide a live, still-usable Xero connection.
      throw new HttpError(502, 'nango_error', 'Could not remove the Xero connection from Nango: ' + normalized.message);
    }
    // 404 — Nango already has no record of this connection (e.g. it was
    // removed by hand in the Nango dashboard). That's the same end state
    // we're trying to reach, so treat it as success and continue below.
  }

  const { error: deleteError } = await supabase
    .from('integrations')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', 'xero');

  if (deleteError) {
    // The Nango side is confirmed gone at this point, but our own row
    // survived — surface this clearly rather than reporting success while
    // a stale row still shows this user as "connected" elsewhere in the app.
    throw new HttpError(500, 'server_error', 'Removed from Nango, but could not clear the local reference: ' + deleteError.message);
  }

  res.status(200).json({ connected: false });
});
