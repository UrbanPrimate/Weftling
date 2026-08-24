'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { getNango, QUICKBOOKS_INTEGRATION_ID } = require('../_lib/nango');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/quickbooks/connect-session
 *
 * QuickBooks twin of /api/xero/connect-session: mints a short-lived Nango
 * Connect session for the signed-in user, scoped to the QuickBooks
 * integration only. Same trust model — this app never sees an Intuit client
 * id/secret or OAuth token; Nango's popup runs the whole flow, and
 * `tags.end_user_id` is what lets finalize.js later prove the resulting
 * connection belongs to this Supabase user.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { user } = await requireUser(req);
  const nango = getNango();

  let token;
  try {
    const { data } = await nango.createConnectSession({
      tags: { end_user_id: user.id, end_user_email: user.email || '' },
      allowed_integrations: [QUICKBOOKS_INTEGRATION_ID],
    });
    token = data && data.token;
  } catch (err) {
    console.error('createConnectSession (quickbooks) failed:', err);
    throw new HttpError(502, 'nango_error', 'Could not start the QuickBooks connection. Try again in a moment.');
  }

  if (!token) throw new HttpError(502, 'nango_error', 'Nango did not return a session token.');

  res.status(200).json({ token });
});
