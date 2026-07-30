'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { getNango, XERO_INTEGRATION_ID } = require('../_lib/nango');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/xero/connect-session
 *
 * Mints a short-lived Nango Connect session for the signed-in user. The
 * frontend hands the returned token straight to Nango's Connect UI, which
 * runs the actual Xero OAuth flow in a popup — this app's own code never
 * sees a Xero client id/secret or an OAuth token at any point.
 *
 * `tags.end_user_id` is what lets finalize.js later prove the resulting
 * connection really belongs to this Supabase user, not just whoever
 * happened to complete the popup.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { user } = await requireUser(req);
  const nango = getNango();

  let token;
  try {
    const { data } = await nango.createConnectSession({
      tags: { end_user_id: user.id, end_user_email: user.email || '' },
      allowed_integrations: [XERO_INTEGRATION_ID],
    });
    token = data && data.token;
  } catch (err) {
    console.error('createConnectSession failed:', err);
    throw new HttpError(502, 'nango_error', 'Could not start the Xero connection. Try again in a moment.');
  }

  if (!token) throw new HttpError(502, 'nango_error', 'Nango did not return a session token.');

  res.status(200).json({ token });
});
