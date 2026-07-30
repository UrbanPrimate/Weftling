'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireXeroConnection, xeroGetAllPages, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * GET /api/xero/items — Xero inventory/service items, for the line-item
 * picker (both the Invoice tab's per-line override and the Time/Materials
 * entry forms' "Item" picker). Paginated (see xeroGetAllPages).
 */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireXeroConnection(supabase, user);

  let rawItems;
  try {
    rawItems = await xeroGetAllPages(conn, '/Items', 'Items', 'ItemID');
  } catch (err) {
    const normalized = normalizeXeroError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const items = rawItems.map((i) => {
    const sales = i.SalesDetails || i.salesDetails || {};
    return {
      itemCode: i.Code || i.code,
      name: i.Name || i.name,
      description: sales.Description || sales.description || i.Description || i.description || '',
      unitPrice: sales.UnitPrice != null ? sales.UnitPrice : sales.unitPrice != null ? sales.unitPrice : null,
      accountCode: sales.AccountCode || sales.accountCode || null,
      taxType: sales.TaxType || sales.taxType || null,
    };
  });

  res.status(200).json({ items });
});
