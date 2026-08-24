'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireQboConnection, qboPost, qboInvoiceDeepLink, normalizeQboError, throwIfFault } = require('../_lib/qbo');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/quickbooks/invoices — creates an invoice in QuickBooks Online.
 * QuickBooks twin of /api/xero/invoices, with QBO's own rules:
 *
 *  - There is no "draft" state in QBO — a created invoice is a real
 *    (unsent) invoice. Creating never emails the customer.
 *  - Every line must reference a Product/Service (ItemRef); the frontend
 *    sends an itemId per line (currently the same one for all lines,
 *    picked in the invoice preview's Product/Service select).
 *  - DocNumber (the invoice number) is left for QBO to auto-assign, the
 *    same way Xero assigns its own invoice numbers to drafts. The Weftling
 *    "reference" travels as PrivateNote (internal memo) so it never
 *    hijacks the company's invoice numbering.
 *  - Amount must equal Qty × UnitPrice on each line; computed here (2dp)
 *    rather than trusted from the client.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireQboConnection(supabase, user);

  const { customerId, date, dueDate, privateNote, lineItems } = req.body || {};

  if (!customerId || typeof customerId !== 'string') {
    throw new HttpError(400, 'bad_request', 'customerId is required.');
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new HttpError(400, 'bad_request', 'At least one line item is required.');
  }
  for (const li of lineItems) {
    if (!li || !li.itemId) {
      throw new HttpError(400, 'bad_request', 'Every line needs an itemId — QuickBooks requires a Product/Service per line.');
    }
  }

  const invoice = {
    CustomerRef: { value: String(customerId) },
    TxnDate: date || undefined,
    DueDate: dueDate || undefined,
    PrivateNote: privateNote || undefined,
    Line: lineItems.map((li) => {
      const qty = Number(li.quantity) || 0;
      const unitPrice = Number(li.unitAmount) || 0;
      return {
        DetailType: 'SalesItemLineDetail',
        Amount: Math.round(qty * unitPrice * 100) / 100,
        Description: li.description || undefined,
        SalesItemLineDetail: {
          ItemRef: { value: String(li.itemId) },
          Qty: qty,
          UnitPrice: unitPrice,
        },
      };
    }),
  };

  let body;
  try {
    const result = await qboPost(conn, '/invoice', invoice);
    body = throwIfFault((result && result.data) || result); // QBO can 200 with a Fault body
  } catch (err) {
    const normalized = normalizeQboError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const created = body && body.Invoice;
  if (!created || created.Id == null) {
    throw new HttpError(502, 'qbo_error', 'QuickBooks did not return the created invoice.');
  }

  res.status(200).json({
    invoiceId: String(created.Id),
    docNumber: created.DocNumber || null,
    total: created.TotalAmt != null ? created.TotalAmt : null,
    balance: created.Balance != null ? created.Balance : null,
    status: 'Open',
    deepLink: qboInvoiceDeepLink(created.Id),
  });
});
