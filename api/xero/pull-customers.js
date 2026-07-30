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

  let created = 0;
  let updated = 0;

  for (const contact of contacts) {
    const nameKey = contact.name.trim().toLowerCase();
    const linked = byContactId.get(contact.contactId);
    const nameMatch = !linked ? byNameLower.get(nameKey) : null;
    const target = linked || nameMatch;

    if (target) {
      const { error: updateError } = await supabase
        .from('clients')
        .update({ name: contact.name, email: contact.email, xero_contact_id: contact.contactId })
        .eq('id', target.id)
        .eq('user_id', user.id);
      if (updateError) throw new HttpError(500, 'server_error', updateError.message);
      if (nameMatch) byNameLower.delete(nameKey); // consumed — a later same-named contact must insert, not steal this row again
      updated += 1;
    } else {
      const { error: insertError } = await supabase.from('clients').insert({
        user_id: user.id,
        name: contact.name,
        email: contact.email,
        xero_contact_id: contact.contactId,
      });
      if (insertError) throw new HttpError(500, 'server_error', insertError.message);
      created += 1;
    }
  }

  res.status(200).json({ pulled: contacts.length, created, updated });
});
