'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireQboConnection, qboQueryAll, normalizeQboError } = require('../_lib/qbo');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * GET /api/quickbooks/items — the company's active Products/Services
 * (QuickBooks twin of /api/xero/items). Category rows are filtered out:
 * they exist only to group other items in QBO's UI and can't be used as an
 * invoice line's ItemRef.
 */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireQboConnection(supabase, user);

  let items;
  try {
    const raw = await qboQueryAll(conn, 'Item', 'Active = true');
    items = raw
      .filter((it) => it.Type !== 'Category')
      .map((it) => ({
        itemId: it.Id != null ? String(it.Id) : null,
        name: it.Name,
        type: it.Type || null,
      }))
      .filter((it) => it.itemId && it.name);
  } catch (err) {
    const normalized = normalizeQboError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  res.status(200).json({ items });
});
