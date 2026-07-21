'use strict';

const express = require('express');
const xero = require('../lib/xero');

const router = express.Router();

// ---------------------------------------------------------------------
// OAuth2 flow
// ---------------------------------------------------------------------

router.get('/connect', async (req, res) => {
  if (!xero.hasCredentials()) {
    return res.status(409).send(
      'Xero credentials are not configured. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET and ' +
      'REDIRECT_URI in .env, then restart the server.'
    );
  }
  try {
    const url = await xero.buildConsentUrl();
    res.redirect(url);
  } catch (err) {
    console.error('Failed to build Xero consent URL:', err);
    res.status(500).send('Could not start the Xero connection: ' + err.message);
  }
});

router.get('/callback', async (req, res) => {
  try {
    await xero.handleCallback(req.protocol + '://' + req.get('host') + req.originalUrl);
    res.redirect('/?connected=1');
  } catch (err) {
    console.error('Xero callback failed:', err);
    res.redirect('/?connected=0&error=' + encodeURIComponent(err.message || 'connection failed'));
  }
});

router.post('/disconnect', (req, res) => {
  xero.disconnect();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Require an authenticated Xero connection, else respond 409. */
async function requireXero(req, res) {
  const conn = await xero.ensureAuthenticated();
  if (!conn) {
    res.status(409).json({ error: 'not_connected', message: 'Not connected to Xero yet. Go to Settings and connect.' });
    return null;
  }
  return conn;
}

/**
 * xero-node's generated client rejects HTTP-error responses with a *JSON string*
 * shaped like `{ response: { statusCode, body, headers }, body }` (see
 * node_modules/xero-node/dist/model/ApiError.js) rather than a normal Error
 * object. Genuine network failures (no HTTP response at all) surface as a
 * plain Error/TypeError instead. Normalize both into one shape.
 */
function parseXeroError(err) {
  let parsed = err;
  if (typeof err === 'string') {
    try { parsed = JSON.parse(err); } catch (e) { parsed = null; }
  }
  const statusCode = parsed && parsed.response && parsed.response.statusCode;
  const headers = (parsed && parsed.response && parsed.response.headers) || {};
  const body = (parsed && parsed.body) || (parsed && parsed.response && parsed.response.body) || null;
  return { statusCode, headers, body };
}

/** Surface Xero's own validation messages (bad account code / tax type / etc) instead of a bare 500. */
function xeroErrorMessage(err) {
  const { body } = parseXeroError(err);
  if (body) {
    if (body.Elements && body.Elements[0] && body.Elements[0].ValidationErrors) {
      return body.Elements[0].ValidationErrors.map((e) => e.Message).join('; ');
    }
    if (body.Message) return body.Message;
    if (typeof body === 'string') return body;
  }
  return (err && err.message) || 'Unknown Xero error';
}

/** True when a 401/403 looks like the token is missing a required OAuth2 scope. */
function isInsufficientScope(err) {
  const { statusCode, headers, body } = parseXeroError(err);
  if (statusCode !== 401 && statusCode !== 403) return false;
  const authHeader = headers['www-authenticate'] || headers['WWW-Authenticate'] || '';
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body || '');
  return /insufficient_scope/i.test(authHeader) || /insufficient_scope/i.test(bodyText);
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------

router.get('/api/status', async (req, res) => {
  const conn = await xero.ensureAuthenticated();
  res.json({
    hasCredentials: xero.hasCredentials(),
    connected: Boolean(conn),
    org: conn ? conn.tenantName : null,
  });
});

// ---------------------------------------------------------------------
// Read-only reference data from Xero
// ---------------------------------------------------------------------

router.get('/api/contacts', async (req, res) => {
  const conn = await requireXero(req, res);
  if (!conn) return;
  try {
    const { body } = await conn.xero.accountingApi.getContacts(conn.tenantId);
    const contacts = (body.contacts || []).map((c) => ({
      contactId: c.contactID,
      name: c.name,
      email: c.emailAddress || null,
    }));
    res.json({ contacts });
  } catch (err) {
    console.error('getContacts failed:', err);
    res.status(502).json({ error: 'xero_error', message: xeroErrorMessage(err) });
  }
});

router.get('/api/items', async (req, res) => {
  const conn = await requireXero(req, res);
  if (!conn) return;
  try {
    const { body } = await conn.xero.accountingApi.getItems(conn.tenantId);
    const items = (body.items || []).map((i) => ({
      itemCode: i.code,
      name: i.name,
      description: (i.salesDetails && i.salesDetails.description) || i.description || '',
      unitPrice: i.salesDetails ? i.salesDetails.unitPrice : null,
      accountCode: i.salesDetails ? i.salesDetails.accountCode : null,
      taxType: i.salesDetails ? i.salesDetails.taxType : null,
      isTrackedAsInventory: Boolean(i.isTrackedAsInventory),
    }));
    res.json({ items });
  } catch (err) {
    console.error('getItems failed:', err);
    res.status(502).json({ error: 'xero_error', message: xeroErrorMessage(err) });
  }
});

router.get('/api/accounts', async (req, res) => {
  const conn = await requireXero(req, res);
  if (!conn) return;
  try {
    const { body } = await conn.xero.accountingApi.getAccounts(conn.tenantId, undefined, 'Class=="REVENUE"');
    const accounts = (body.accounts || []).map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
    }));
    res.json({ accounts });
  } catch (err) {
    console.error('getAccounts failed:', err);
    res.status(502).json({ error: 'xero_error', message: xeroErrorMessage(err) });
  }
});

router.get('/api/taxrates', async (req, res) => {
  const conn = await requireXero(req, res);
  if (!conn) return;
  try {
    const { body } = await conn.xero.accountingApi.getTaxRates(conn.tenantId);
    const taxRates = (body.taxRates || []).map((t) => ({
      taxType: t.taxType,
      name: t.name,
      effectiveRate: t.effectiveRate,
      status: t.status,
    }));
    res.json({ taxRates });
  } catch (err) {
    console.error('getTaxRates failed:', err);
    res.status(502).json({ error: 'xero_error', message: xeroErrorMessage(err) });
  }
});

// ---------------------------------------------------------------------
// Invoice status sync (read-back)
// ---------------------------------------------------------------------

/**
 * xero-node deserializes Invoice date fields into real Date objects despite
 * the SDK's own .d.ts typing them as `string` (YYYY-MM-DD) — confirmed by
 * hitting a live connection, where these came back as full ISO datetimes.
 * Normalize to the plain YYYY-MM-DD strings the rest of Weftly uses.
 */
function toDateOnly(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

router.get('/api/xero-invoices', async (req, res) => {
  const conn = await requireXero(req, res);
  if (!conn) return;

  const idList = req.query.ids
    ? String(req.query.ids).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const ifModifiedSince = req.query.modifiedSince ? new Date(req.query.modifiedSince) : undefined;

  try {
    const { body } = await conn.xero.accountingApi.getInvoices(
      conn.tenantId,
      ifModifiedSince,
      'Type=="ACCREC"',
      undefined, // order
      idList
    );
    const invoices = (body.invoices || []).map((inv) => ({
      invoiceID: inv.invoiceID,
      invoiceNumber: inv.invoiceNumber,
      contactID: inv.contact ? inv.contact.contactID : null,
      contactName: inv.contact ? inv.contact.name : null,
      status: inv.status,
      total: inv.total,
      amountDue: inv.amountDue,
      amountPaid: inv.amountPaid,
      date: toDateOnly(inv.date),
      dueDate: toDateOnly(inv.dueDate),
      fullyPaidOnDate: toDateOnly(inv.fullyPaidOnDate),
      deepLink: `https://go.xero.com/app/invoicing/edit/${inv.invoiceID}`,
    }));
    res.json({ invoices });
  } catch (err) {
    console.error('getInvoices failed:', err);
    if (isInsufficientScope(err)) {
      return res.status(403).json({
        error: 'insufficient_scope',
        message: 'Xero says this connection can\'t read invoices. Add "accounting.invoices.read" to the '
          + 'scopes in lib/xero.js, then disconnect and reconnect to Xero once.',
      });
    }
    res.status(502).json({ error: 'xero_error', message: xeroErrorMessage(err) });
  }
});

// ---------------------------------------------------------------------
// Draft invoice creation
// ---------------------------------------------------------------------

router.post('/api/invoices', async (req, res) => {
  const conn = await requireXero(req, res);
  if (!conn) return;

  const { contactId, contactName, date, dueDate, reference, lineItems } = req.body || {};

  if (!contactId && !contactName) {
    return res.status(400).json({ error: 'bad_request', message: 'contactId or contactName is required.' });
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: 'bad_request', message: 'At least one line item is required.' });
  }

  const invoice = {
    type: 'ACCREC',
    contact: contactId ? { contactID: contactId } : { name: contactName },
    date: date || undefined,
    dueDate: dueDate || undefined,
    reference: reference || undefined,
    status: 'DRAFT',
    lineItems: lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitAmount: li.unitAmount,
      itemCode: li.itemCode || undefined,
      accountCode: li.itemCode ? undefined : li.accountCode,
      taxType: li.itemCode ? undefined : li.taxType,
    })),
  };

  try {
    const { body } = await conn.xero.accountingApi.createInvoices(conn.tenantId, { invoices: [invoice] });
    const created = body.invoices && body.invoices[0];
    if (!created) {
      return res.status(502).json({ error: 'xero_error', message: 'Xero did not return the created invoice.' });
    }
    if (created.validationErrors && created.validationErrors.length) {
      return res.status(422).json({
        error: 'validation_error',
        message: created.validationErrors.map((e) => e.message).join('; '),
      });
    }
    res.json({
      invoiceId: created.invoiceID,
      invoiceNumber: created.invoiceNumber,
      total: created.total,
      status: created.status,
      deepLink: `https://go.xero.com/app/invoicing/edit/${created.invoiceID}`,
    });
  } catch (err) {
    console.error('createInvoices failed:', err);
    res.status(422).json({ error: 'xero_error', message: xeroErrorMessage(err) });
  }
});

module.exports = router;
