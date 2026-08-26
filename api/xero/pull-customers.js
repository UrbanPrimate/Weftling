'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireXeroConnection, xeroGetAllPages, mapXeroContact, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * POST /api/xero/pull-customers
 *
 * Pulls every contact from the caller's connected Xero org and syncs it
 * into their own `clients` table. Every read/write below goes through
 * `supabase` — the caller's own JWT-scoped client from requireUser() — the
 * same pattern every other endpoint in this app uses, so this can never
 * touch another user's clients even if the matching logic here had a bug:
 * RLS on `clients` would still refuse the row.
 *
 * Matching priority per Xero contact, applied in order (avoids duplicate
 * clients on repeat pulls, and avoids one Xero contact stealing a client
 * that's already linked to a *different* Xero contact):
 *   1. an existing client already linked to this exact Xero contact id -> update
 *   2. else an existing UNLINKED client with the same name (trimmed,
 *      case-insensitive) -> adopt it (link + refresh email)
 *   3. else -> insert a new client
 *
 * A name-match is removed from consideration once used, so if Xero has two
 * contacts sharing a name, the second becomes a new client instead of
 * silently overwriting the first one's link.
 */
module.exports = withHandler('POST', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireXeroConnection(supabase, user);

  let contacts;
  try {
    const rawContacts = await xeroGetAllPages(conn, '/Contacts', 'Contacts', 'ContactID');
    contacts = rawContacts.map(mapXeroContact).filter((c) => c.contactId && c.name);
  } catch (err) {
    const normalized = normalizeXeroError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const { data: existingClients, error: loadError } = await supabase
    .from('clients')
    .select('id, name, xero_contact_id')
    .eq('user_id', user.id);

  if (loadError) throw new HttpError(500, 'server_error', loadError.message);

  const byContactId = new Map();
  const byNameLower = new Map(); // only unlinked clients are candidates for name-matching
  for (const c of existingClients || []) {
    if (c.xero_contact_id) {
      byContactId.set(c.xero_contact_id, c);
    } else {
      byNameLower.set(c.name.trim().toLowerCase(), c);
    }
  }

  // Resolve every contact to an insert or an update in memory first, then
  // write in batches. The old code did one round-trip per contact (an N+1
  // that risked a serverless timeout and a half-finished sync on a large
  // customer list); the matching logic is unchanged, only the writes are
  // now chunked. Update targets are provably unique (a linked client is
  // never also name-matched, and a name match is consumed on first use), so
  // upsert-by-id can't collide.
  const toInsert = [];
  const toUpdate = [];

  for (const contact of contacts) {
    const nameKey = contact.name.trim().toLowerCase();
    const linked = byContactId.get(contact.contactId);
    const nameMatch = !linked ? byNameLower.get(nameKey) : null;
    const target = linked || nameMatch;

    if (target) {
      toUpdate.push({ id: target.id, user_id: user.id, name: contact.name, email: contact.email, xero_contact_id: contact.contactId });
      if (nameMatch) byNameLower.delete(nameKey); // consumed — a later same-named contact must insert, not steal this row again
    } else {
      toInsert.push({ user_id: user.id, name: contact.name, email: contact.email, xero_contact_id: contact.contactId });
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await supabase.from('clients').insert(toInsert.slice(i, i + CHUNK));
    if (error) throw new HttpError(500, 'server_error', error.message);
  }
  // Upsert on the primary key updates the existing rows (they all exist —
  // targets came from this user's own clients). Only the columns supplied
  // are written, so rate/increment and other fields are left untouched.
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const { error } = await supabase.from('clients').upsert(toUpdate.slice(i, i + CHUNK), { onConflict: 'id' });
    if (error) throw new HttpError(500, 'server_error', error.message);
  }

  res.status(200).json({ pulled: contacts.length, created: toInsert.length, updated: toUpdate.length });
});
