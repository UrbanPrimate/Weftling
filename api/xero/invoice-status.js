'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireXeroConnection, xeroGet, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * Xero's raw JSON API returns date fields in two parallel forms on every
 * invoice: a classic .NET-style wrapper (`Date: "/Date(1704067200000+0000)/"`)
 * and a plain ISO string on the paired `DateString` field. Prefer
 * DateString; fall back to parsing the wrapped form if it's ever missing.
 */
function toDateOnly(dateStringField, dateField) {
  if (dateStringField) return String(dateStringField).slice(0, 10);
  if (!dateField) return null;
  const match = /\/Date\((\d+)/.exec(dateField);
  if (match) return new Date(Number(match[1])).toISOString().slice(0, 10);
  return String(dateField).slice(0, 10);
}

/**
 * GET /api/xero/invoice-status?ids=a,b,c&modifiedSince=2026-01-01T00:00:00Z
 * Read-back status for previously created invoices — never pulls the whole
 * Xero invoice history, only what the caller already knows the ids of (or a
 * modified-since window).
 */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireXeroConnection(supabase, user);

  const params = { where: 'Type=="ACCREC"' };

  // Validate `ids` before forwarding to Xero, mirroring the QBO twin
  // (api/quickbooks/invoice-status.js). Xero InvoiceIDs are GUIDs; anything
  // else can't match an invoice, so rejecting non-GUIDs keeps arbitrary
  // client input out of the upstream request and caps the batch size. An
  // ids-less call is also rejected now — without it, this route would return
  // the org's first page of ACCREC invoices, which the file's own contract
  // ("only ids the caller already knows") says it must not.
  const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const ids = String((req.query && req.query.ids) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'bad_request', 'ids is required (comma-separated invoice ids).');
  if (ids.length > 50) throw new HttpError(400, 'bad_request', 'At most 50 ids per request.');
  if (ids.some((id) => !GUID.test(id))) {
    throw new HttpError(400, 'bad_request', 'ids must be Xero invoice GUIDs.');
  }
  params.IDs = ids.join(',');

  // Xero's API takes this as an HTTP header, not a query param.
  const extraHeaders = {};
  if (req.query && req.query.modifiedSince) {
    const since = new Date(req.query.modifiedSince);
    if (Number.isNaN(since.getTime())) {
      throw new HttpError(400, 'bad_request', 'modifiedSince is not a valid date.');
    }
    extraHeaders['If-Modified-Since'] = since.toUTCString();
  }

  let body;
  try {
    const result = await xeroGet(conn, '/Invoices', params, extraHeaders);
    body = (result && result.data) || result;
  } catch (err) {
    const normalized = normalizeXeroError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const invoices = (body.Invoices || body.invoices || []).map((inv) => {
    const invoiceId = inv.InvoiceID || inv.invoiceID;
    const contact = inv.Contact || inv.contact || {};
    return {
      invoiceId,
      invoiceNumber: inv.InvoiceNumber || inv.invoiceNumber,
      contactId: contact.ContactID || contact.contactID || null,
      contactName: contact.Name || contact.name || null,
      status: inv.Status || inv.status,
      total: inv.Total != null ? inv.Total : inv.total,
      amountDue: inv.AmountDue != null ? inv.AmountDue : inv.amountDue,
      amountPaid: inv.AmountPaid != null ? inv.AmountPaid : inv.amountPaid,
      date: toDateOnly(inv.DateString, inv.Date),
      dueDate: toDateOnly(inv.DueDateString, inv.DueDate),
      fullyPaidOnDate: toDateOnly(inv.FullyPaidOnDateString, inv.FullyPaidOnDate),
      deepLink: `https://go.xero.com/app/invoicing/edit/${invoiceId}`,
    };
  });

  res.status(200).json({ invoices });
});
