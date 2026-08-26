-- Weftly — post-review hardening fixes (from the adversarial security review).
-- Each fix gets its own dated section below as they land, so this file reads
-- as a changelog of what was tightened and why. Safe to re-run in full.

-- ---------------------------------------------------------------------------
-- Fix #1 (HIGH): stored XSS via settings.currency_symbol.
--
-- The Settings UI limits this field to 3 characters via the input's
-- `maxlength="3"` — client-side only, trivially bypassed by any direct call
-- to the Supabase REST API. Nothing on the database side enforced it, so a
-- user could set their own currency_symbol to an arbitrary-length string
-- (e.g. an <img onerror=...> payload), which formatMoney() then wrote into
-- innerHTML unescaped across nearly every tab. escapeHtml() in
-- formatMoney() (public/index.html) closes the actual injection; this
-- constraint closes the gap between the UI's stated intent and what the
-- database actually allows, so the bad value can't be stored in the first
-- place even if some future code path forgets to escape it.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'currency_symbol_len') then
    alter table public.settings
      add constraint currency_symbol_len check (char_length(currency_symbol) <= 3);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fix #4 (MEDIUM): time_entries.client_id / materials.client_id aren't
-- checked against row ownership.
--
-- The foreign key alone only guarantees "this client_id exists somewhere in
-- clients" — Postgres FK validation runs with elevated privileges and does
-- not go through the referenced table's RLS policies, so it can't tell
-- whether the client belongs to the same user as the time_entry/material
-- row. A direct API call (not through the app's own UI, which only ever
-- offers the signed-in user's own clients in the picker) could otherwise
-- set client_id to any client UUID system-wide, including one owned by a
-- different user.
--
-- This doesn't actually leak the other user's data on its own — RLS's
-- "select own clients" policy still blocks reading that client row through
-- any query path, direct or joined/embedded — but it's a real gap in what
-- the schema itself guarantees, and it's cheap to close outright rather
-- than depend on every future feature remembering not to trust client_id as
-- an ownership signal.
--
-- The trigger runs as the invoking role (no elevated privilege needed):
-- its own WHERE clause already requires user_id = new.user_id, which is
-- sufficient on its own regardless of RLS on clients.
-- ---------------------------------------------------------------------------
create or replace function public.check_client_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null then
    if not exists (
      select 1 from public.clients
      where id = new.client_id and user_id = new.user_id
    ) then
      raise exception 'client_id % does not belong to user_id %', new.client_id, new.user_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_client_ownership_time_entries on public.time_entries;
create trigger check_client_ownership_time_entries
  before insert or update on public.time_entries
  for each row execute function public.check_client_ownership();

drop trigger if exists check_client_ownership_materials on public.materials;
create trigger check_client_ownership_materials
  before insert or update on public.materials
  for each row execute function public.check_client_ownership();

-- ---------------------------------------------------------------------------
-- Fix #5 (LOW): no DB-level validation on numeric/text fields.
--
-- Only client-side HTML attributes (required, min="0") enforced these
-- before — a direct API call bypasses them entirely. Self-scoped (RLS still
-- confines this to the writer's own rows, so it's not a cross-user
-- vulnerability), but negative quantities/rates flowing into invoice totals
-- or CSV exports could produce wrong or confusing invoices, and an empty
-- description/name is a data-quality gap worth closing at the source.
--
-- If any of these fail with "check constraint is violated by some existing
-- row," a row already violates it (e.g. an empty description from early
-- testing) — find and fix that row first (or delete it), then re-run just
-- the failed line.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'time_entries_rate_nonneg') then
    alter table public.time_entries
      add constraint time_entries_rate_nonneg check (rate >= 0),
      add constraint time_entries_minutes_nonneg check (minutes >= 0),
      add constraint time_entries_increment_pos check (increment > 0),
      add constraint time_entries_description_not_blank check (char_length(trim(description)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'materials_qty_nonneg') then
    alter table public.materials
      add constraint materials_qty_nonneg check (qty >= 0),
      add constraint materials_unit_cost_nonneg check (unit_cost >= 0),
      add constraint materials_markup_nonneg check (markup_pct >= 0),
      add constraint materials_description_not_blank check (char_length(trim(description)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_rate_nonneg') then
    alter table public.clients
      add constraint clients_rate_nonneg check (rate is null or rate >= 0),
      add constraint clients_increment_pos check (increment is null or increment > 0),
      add constraint clients_name_not_blank check (char_length(trim(name)) > 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fix #6 (from the pre-launch review): the `anon` role's access to the app
-- tables is never explicitly revoked — RLS is the sole confirmed backstop
-- against unauthenticated PostgREST access.
--
-- The app never touches these tables as `anon`: every data read/write happens
-- only after sign-in (the auth gate), as the `authenticated` role; sign-up
-- and sign-in go through Supabase Auth (GoTrue), not these tables. So
-- removing `anon`'s table privileges outright is pure defense-in-depth — if
-- an RLS policy is ever misconfigured on a future table/change, `anon` still
-- has nothing to fall back on. Idempotent: re-running a REVOKE is harmless.
-- ---------------------------------------------------------------------------
revoke all on public.clients from anon;
revoke all on public.time_entries from anon;
revoke all on public.materials from anon;
revoke all on public.settings from anon;
revoke all on public.integrations from anon;

-- Forward-looking: stop future tables created by `postgres` in `public` from
-- auto-granting to `anon` (mirrors Supabase's own hardening guidance), so a
-- table added later via the dashboard doesn't silently reopen this.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon;

-- ---------------------------------------------------------------------------
-- Fix #7 (from the pre-launch review): the `integrations` row is
-- client-writable (RLS lets a user insert/update their own row directly),
-- and its columns had no shape validation. finalize.js is meant to be the
-- only writer, but a direct API call can forge the row — so constrain what
-- values are even storable to shrink that surface. (The deeper fix — making
-- the row writable only through a verified server path — is tracked
-- separately; these constraints are the cheap, immediate half.)
--
-- Wrapped in existence checks so this section is genuinely re-runnable
-- (Postgres has no ADD CONSTRAINT IF NOT EXISTS for table constraints). If a
-- check fails on ADD because an existing row violates it, that rogue row is
-- itself the finding — inspect it before forcing the constraint.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'integrations_provider_known') then
    alter table public.integrations
      add constraint integrations_provider_known check (provider in ('xero', 'quickbooks'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'integrations_nango_conn_len') then
    alter table public.integrations
      add constraint integrations_nango_conn_len
      check (char_length(nango_connection_id) between 1 and 255);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'integrations_xero_tenant_fmt') then
    alter table public.integrations
      add constraint integrations_xero_tenant_fmt
      check (xero_tenant_id is null or
             xero_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'integrations_qbo_realm_fmt') then
    alter table public.integrations
      add constraint integrations_qbo_realm_fmt
      check (qbo_realm_id is null or qbo_realm_id ~ '^[0-9]{1,20}$');
  end if;
end $$;
