'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireXeroConnection, xeroGetAllPages, mapXeroContact, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');

/**
 * GET /api/xero/contacts — Xero contacts, mapped down to what the invoice
 * UI needs (contact picker). Same shape the pre-Nango integration returned,
 * so the frontend logic that consumes it doesn't need to change. Paginated
 * (see xeroGetAllPages) — an org with more than 100 contacts used to come
 * back truncated at one page.
 */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireXeroConnection(supabase, user);

  let rawContacts;
  try {
    rawContacts = await xeroGetAllPages(conn, '/Contacts', 'Contacts', 'ContactID');
  } catch (err) {
    const normalized = normalizeXeroError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const contacts = rawContacts.map(mapXeroContact);

  res.status(200).json({ contacts });
});
