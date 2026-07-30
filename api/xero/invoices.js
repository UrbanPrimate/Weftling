'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireXeroConnection, xeroPost, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/xero/invoices — creates a DRAFT ACCREC invoice in Xero.
 *
 * Known gotchas carried forward from the earlier integration:
 *  - dates go out as plain YYYY-MM-DD strings (Xero's raw JSON API accepts
 *    this on write, even though it returns a different shape on read —
 *    see invoice-status.js's toDateOnly()).
 *  - ContactName must match an existing Xero contact exactly, or Xero
 *    silently creates a new contact instead of matching one — prefer
 *    contactId (from /api/xero/contacts) whenever the caller has it.
 *  - AccountCode/TaxType must match the user's chart of accounts exactly,
 *    or Xero rejects the whole invoice — surfaced below as a 422 with
 *    Xero's own validation message, not a generic failure.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireXeroConnection(supabase, user);

  const { contactId, contactName, date, dueDate, reference, lineItems } = req.body || {};

  if (!contactId && !contactName) {
    throw new HttpError(400, 'bad_request', 'contactId or contactName is required.');
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new HttpError(400, 'bad_request', 'At least one line item is required.');
  }

  const invoice = {
    Type: 'ACCREC',
    Contact: contactId ? { ContactID: contactId } : { Name: contactName },
    Date: date || undefined,
    DueDate: dueDate || undefined,
    Reference: reference || undefined,
    Status: 'DRAFT',
    LineItems: lineItems.map((li) => ({
      Description: li.description,
      Quantity: li.quantity,
      UnitAmount: li.unitAmount,
      ItemCode: li.itemCode || undefined,
      AccountCode: li.itemCode ? undefined : li.accountCode,
      TaxType: li.itemCode ? undefined : li.taxType,
    })),
  };

  let body;
  try {
    const result = await xeroPost(conn, '/Invoices', { Invoices: [invoice] });
    body = (result && result.data) || result;
  } catch (err) {
    const normalized = normalizeXeroError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const created = (body.Invoices || body.invoices || [])[0];
  if (!created) throw new HttpError(502, 'xero_error', 'Xero did not return the created invoice.');

  const validationErrors = created.ValidationErrors || created.validationErrors;
  if (validationErrors && validationErrors.length) {
    throw new HttpError(422, 'validation_error', validationErrors.map((e) => e.Message || e.message).join('; '));
  }

  const invoiceId = created.InvoiceID || created.invoiceID;
  res.status(200).json({
    invoiceId,
    invoiceNumber: created.InvoiceNumber || created.invoiceNumber,
    total: created.Total != null ? created.Total : created.total,
    status: created.Status || created.status,
    deepLink: `https://go.xero.com/app/invoicing/edit/${invoiceId}`,
  });
});
