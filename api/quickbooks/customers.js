'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireQboConnection, qboQueryAll, normalizeQboError } = require('../_lib/qbo');
const { withHandler, HttpError } = require('../_lib/http');

// Same CSV-injection guard the Xero contact path applies at its source —
// see api/_lib/xero.js's stripFormulaTrigger for the full reasoning.
const DANGEROUS_LEADING_CHARS = /^[=+\-@\t\r]/;

function stripFormulaTrigger(v) {
  let s = String(v == null ? '' : v).trim();
  while (DANGEROUS_LEADING_CHARS.test(s)) s = s.slice(1).trim();
  return s;
}

/** Shared by customers.js (transient picker) and pull-customers.js (upserts into `clients`) — one place for the field mapping, mirroring mapXeroContact. */
function mapQboCustomer(c) {
  const rawEmail = (c.PrimaryEmailAddr && c.PrimaryEmailAddr.Address) || null;
  return {
    customerId: c.Id != null ? String(c.Id) : null,
    name: stripFormulaTrigger(c.DisplayName),
    email: rawEmail ? stripFormulaTrigger(rawEmail) : null,
  };
}

/** Fetches every active customer from the connected QBO company, mapped to the app's shape. */
async function fetchQboCustomers(conn) {
  const raw = await qboQueryAll(conn, 'Customer', 'Active = true');
  return raw.map(mapQboCustomer).filter((c) => c.customerId && c.name);
}

/** GET /api/quickbooks/customers — transient list for the invoice-tab customer picker (QuickBooks twin of /api/xero/contacts). */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireQboConnection(supabase, user);

  let customers;
  try {
    customers = await fetchQboCustomers(conn);
  } catch (err) {
    const normalized = normalizeQboError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  res.status(200).json({ customers });
});

module.exports.mapQboCustomer = mapQboCustomer;
module.exports.fetchQboCustomers = fetchQboCustomers;
