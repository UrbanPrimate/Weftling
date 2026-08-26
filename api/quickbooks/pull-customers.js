'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireQboConnection, normalizeQboError } = require('../_lib/qbo');
const { fetchQboCustomers } = require('./customers');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/quickbooks/pull-customers
 *
 * QuickBooks twin of /api/xero/pull-customers — pulls every active customer
 * from the connected QBO company and syncs it into the caller's own
 * `clients` table, with the exact same matching algorithm (and the same
 * RLS backstop — every read/write goes through the caller's JWT-scoped
 * client):
 *   1. an existing client already linked to this exact QBO customer id -> update
 *   2. else an existing UNLINKED client with the same name (trimmed,
 *      case-insensitive) -> adopt it (link + refresh email)
 *   3. else -> insert a new client
 * A name-match is consumed once used, so two QBO customers sharing a name
 * produce two clients instead of silently fighting over one row.
 *
 * "Unlinked" here means no qbo_customer_id — a client already linked to a
 * XERO contact can still adopt a QBO link (and vice versa); the two link
 * columns are independent, letting one Weftling client map to the same
 * real-world customer in both systems.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireQboConnection(supabase, user);

  let customers;
  try {
    customers = await fetchQboCustomers(conn);
  } catch (err) {
    const normalized = normalizeQboError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const { data: existingClients, error: loadError } = await supabase
    .from('clients')
    .select('id, name, qbo_customer_id')
    .eq('user_id', user.id);

  if (loadError) throw new HttpError(500, 'server_error', loadError.message);

  const byCustomerId = new Map();
  const byNameLower = new Map(); // only QBO-unlinked clients are candidates for name-matching
  for (const c of existingClients || []) {
    if (c.qbo_customer_id) {
      byCustomerId.set(c.qbo_customer_id, c);
    } else {
      byNameLower.set(c.name.trim().toLowerCase(), c);
    }
  }

  // Resolve every customer to an insert or update in memory, then write in
  // batches — same change (and reasoning) as the Xero twin: one round-trip
  // per customer was an N+1 that risked a serverless timeout and partial
  // sync on a large list. Matching logic is unchanged; update targets are
  // provably unique, so upsert-by-id can't collide.
  const toInsert = [];
  const toUpdate = [];

  for (const customer of customers) {
    const nameKey = customer.name.trim().toLowerCase();
    const linked = byCustomerId.get(customer.customerId);
    const nameMatch = !linked ? byNameLower.get(nameKey) : null;
    const target = linked || nameMatch;

    if (target) {
      toUpdate.push({ id: target.id, user_id: user.id, name: customer.name, email: customer.email, qbo_customer_id: customer.customerId });
      if (nameMatch) byNameLower.delete(nameKey); // consumed — a later same-named customer must insert, not steal this row again
    } else {
      toInsert.push({ user_id: user.id, name: customer.name, email: customer.email, qbo_customer_id: customer.customerId });
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await supabase.from('clients').insert(toInsert.slice(i, i + CHUNK));
    if (error) throw new HttpError(500, 'server_error', error.message);
  }
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const { error } = await supabase.from('clients').upsert(toUpdate.slice(i, i + CHUNK), { onConflict: 'id' });
    if (error) throw new HttpError(500, 'server_error', error.message);
  }

  res.status(200).json({ pulled: customers.length, created: toInsert.length, updated: toUpdate.length });
});
