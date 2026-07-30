-- Weftly — columns for pulling Xero data into the app's own tables.
--
-- Two purposes, three columns:
--   clients.xero_contact_id     — links a Weftling client to the Xero contact
--                                 it was pulled from (or matched against), so
--                                 repeat pulls update the right row instead of
--                                 creating duplicates.
--   time_entries.xero_item_code,
--   materials.xero_item_code    — the Xero item (if any) picked when logging
--                                 that entry, carried through to invoice
--                                 creation as the default line-item mapping.
--
-- No RLS changes needed: clients/time_entries/materials are already fully
-- scoped by user_id (see policies.sql) — adding nullable columns to a table
-- doesn't change who can see its rows.
--
-- Paste into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run: every statement is `if not exists`.

alter table public.clients add column if not exists xero_contact_id text;

-- Speeds up the "does this user already have a client linked to this Xero
-- contact?" lookup pull-customers.js does on every repeat pull. Partial
-- index (only rows that actually have a linked contact) since most rows
-- won't, for users who never connect Xero.
create index if not exists clients_user_xero_contact_idx
  on public.clients (user_id, xero_contact_id)
  where xero_contact_id is not null;

alter table public.time_entries add column if not exists xero_item_code text;
alter table public.materials add column if not exists xero_item_code text;
