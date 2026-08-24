-- Weftly — columns for the QuickBooks Online integration (via Nango).
--
-- Mirrors what xero_sync_columns.sql + integrations.sql already do for Xero:
--
--   integrations.qbo_realm_id      — the QuickBooks company id ("realmId")
--                                    every QBO API call must carry in its URL.
--                                    The QBO equivalent of xero_tenant_id.
--   integrations.qbo_company_name  — display name of the connected company,
--                                    shown in Settings the way xero_org_name is.
--   clients.qbo_customer_id        — links a Weftling client to the QuickBooks
--                                    customer it was pulled from (or matched
--                                    against), so repeat pulls update the right
--                                    row instead of creating duplicates.
--
-- No RLS changes needed: integrations/clients are already fully scoped by
-- user_id (see integrations.sql / policies.sql) — adding nullable columns to
-- a table doesn't change who can see its rows. The (user_id, provider)
-- primary key on integrations already allows a 'quickbooks' row alongside
-- the 'xero' one.
--
-- ⚠ Run this BEFORE deploying the updated frontend. Until it runs, any
-- client write that includes the qbo_customer_id column fails with an
-- unknown-column error (PGRST204). The frontend only sends the column for
-- clients that actually carry a QBO link, so the safe order is simply:
-- migration first, deploy second. supabase/verify_schema.sql will flag
-- these columns if this file gets skipped.
--
-- Paste into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run: every statement is `if not exists`.

alter table public.integrations add column if not exists qbo_realm_id text;
alter table public.integrations add column if not exists qbo_company_name text;

alter table public.clients add column if not exists qbo_customer_id text;

-- Speeds up the "does this user already have a client linked to this QBO
-- customer?" lookup pull-customers does on every repeat pull. Partial index
-- (only rows that actually have a linked customer) since most rows won't,
-- for users who never connect QuickBooks.
create index if not exists clients_user_qbo_customer_idx
  on public.clients (user_id, qbo_customer_id)
  where qbo_customer_id is not null;
