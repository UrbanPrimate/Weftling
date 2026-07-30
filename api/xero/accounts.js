'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireXeroConnection, xeroGet, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');

/** GET /api/xero/accounts — revenue accounts only, for the account-code picker (account code must match the user's chart of accounts exactly, or Xero rejects the invoice). */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireXeroConnection(supabase, user);

  let body;
  try {
    const result = await xeroGet(conn, '/Accounts', { where: 'Class=="REVENUE"' });
    body = (result && result.data) || result;
  } catch (err) {
    const normalized = normalizeXeroError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const accounts = (body.Accounts || body.accounts || []).map((a) => ({
    code: a.Code || a.code,
    name: a.Name || a.name,
    type: a.Type || a.type,
  }));

  res.status(200).json({ accounts });
});
