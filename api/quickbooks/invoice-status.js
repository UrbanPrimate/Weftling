'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireQboConnection, qboQuery, qboQuoteEscape, qboInvoiceDeepLink, normalizeQboError } = require('../_lib/qbo');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * GET /api/quickbooks/invoice-status?ids=1,2,3
 *
 * Read-back status for previously created invoices — QuickBooks twin of
 * /api/xero/invoice-status, and the same philosophy: only ever asks about
 * ids the caller already knows, never trawls the whole invoice history.
 *
 * QBO has no status enum like Xero's — state is expressed numerically:
 *   Balance == 0            → paid
 *   Balance > 0, past due   → overdue
 *   Balance > 0, not due    → open
 * Voiding is special-cased: QBO's documented void behavior zeroes all
 * amounts AND prepends the literal string "Voided" to Invoice.PrivateNote —
 * that note marker is what separates a voided invoice from a legitimately
 * $0 (and therefore "paid") one. The mapping lives here so both the
 * invoice-preview result banner and any future status column render the
 * same word for the same numbers.
 */
function deriveStatus(inv, today) {
  const total = Number(inv.TotalAmt) || 0;
  const balance = Number(inv.Balance) || 0;
  if (total === 0 && balance <= 0 && /^Voided/.test(String(inv.PrivateNote || ''))) return 'Voided';
  if (balance <= 0) return 'Paid';
  const due = inv.DueDate ? String(inv.DueDate).slice(0, 10) : null;
  if (due && due < today) return 'Overdue';
  return 'Open';
}

module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireQboConnection(supabase, user);

  const idsParam = (req.query && req.query.ids) || '';
  // QBO ids are numeric strings — anything else can't match an invoice, so
  // rejecting non-numeric ids outright costs nothing and keeps arbitrary
  // client input out of the query string entirely (qboQuoteEscape below is
  // then a second layer, not the only one).
  const ids = String(idsParam)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'bad_request', 'ids is required (comma-separated invoice ids).');
  if (ids.length > 50) throw new HttpError(400, 'bad_request', 'At most 50 ids per request.');
  if (ids.some((id) => !/^\d+$/.test(id))) {
    throw new HttpError(400, 'bad_request', 'ids must be numeric QuickBooks invoice ids.');
  }

  // Optional `today` (YYYY-MM-DD): the CALLER's calendar date, so the
  // Open→Overdue flip happens at the user's local midnight rather than this
  // server's (UTC) midnight. Falls back to the UTC date when absent/garbled.
  const todayParam = String((req.query && req.query.today) || '');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);

  const idList = ids.map((id) => `'${qboQuoteEscape(id)}'`).join(',');
  let records;
  try {
    const qr = await qboQuery(conn, `select * from Invoice where Id in (${idList})`);
    records = qr.Invoice || [];
  } catch (err) {
    const normalized = normalizeQboError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const invoices = records.map((inv) => ({
    invoiceId: String(inv.Id),
    docNumber: inv.DocNumber || null,
    customerName: (inv.CustomerRef && inv.CustomerRef.name) || null,
    status: deriveStatus(inv, today),
    total: inv.TotalAmt != null ? inv.TotalAmt : null,
    balance: inv.Balance != null ? inv.Balance : null,
    date: inv.TxnDate ? String(inv.TxnDate).slice(0, 10) : null,
    dueDate: inv.DueDate ? String(inv.DueDate).slice(0, 10) : null,
    deepLink: qboInvoiceDeepLink(inv.Id),
  }));

  res.status(200).json({ invoices });
});
