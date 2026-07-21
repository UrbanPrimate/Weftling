-- Weftly — Supabase schema (Step 3 of the localStorage -> Supabase migration).
--
-- This script only creates tables. Row-Level Security is NOT enabled here —
-- that's Step 4, on purpose, so it gets its own careful walkthrough. Until
-- that script runs, do not point any real user data at this project: once a
-- table is reachable through Supabase's API, it's readable/writable by
-- anyone who can call that API unless RLS says otherwise. With RLS off,
-- there's no "otherwise" yet.
--
-- Paste this whole file into Supabase Dashboard -> SQL Editor -> New query -> Run.

-- Postgres needs this extension for gen_random_uuid() below. Supabase
-- projects normally have it already; `if not exists` makes re-running safe.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  email text,
  rate numeric,
  increment integer,
  created_at timestamptz not null default now()
);

create index clients_user_id_idx on public.clients (user_id);

-- ---------------------------------------------------------------------------
-- time_entries
-- ---------------------------------------------------------------------------
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  entry_date date not null,
  description text not null,
  minutes integer not null default 0,
  rate numeric not null default 0,
  increment integer not null default 15,
  billable boolean not null default true,
  entry_mode text not null default 'duration',
  clock_start text,
  clock_end text,
  clock_break_minutes integer,
  invoiced boolean not null default false,
  created_at timestamptz not null default now()
);

create index time_entries_user_id_idx on public.time_entries (user_id);
create index time_entries_client_id_idx on public.time_entries (client_id);

-- ---------------------------------------------------------------------------
-- materials
-- ---------------------------------------------------------------------------
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  entry_date date not null,
  description text not null,
  qty numeric not null default 1,
  unit_cost numeric not null default 0,
  markup_pct numeric not null default 0,
  billable boolean not null default true,
  invoiced boolean not null default false,
  created_at timestamptz not null default now()
);

create index materials_user_id_idx on public.materials (user_id);
create index materials_client_id_idx on public.materials (client_id);

-- ---------------------------------------------------------------------------
-- settings — one row per user (a "profile" row), not one row per setting.
-- ---------------------------------------------------------------------------
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  default_rate numeric not null default 150,
  default_increment integer not null default 15,
  rounding_mode text not null default 'up',
  min_one_increment boolean not null default true,
  terms_days integer not null default 14,
  default_markup numeric not null default 0,
  currency_symbol text not null default '$',
  date_format text not null default 'MM/DD/YYYY',
  xero_account_code text not null default '',
  xero_tax_type text not null default '',
  accounting_software text not null default '',
  qb_product_service text not null default '',
  time_entry_mode text not null default 'duration',
  overview_period jsonb not null default '{"mode":"month","from":null,"to":null}',
  timesheet_period jsonb not null default '{"mode":"month","from":null,"to":null}',
  contractor jsonb not null default '{}',
  timesheet_counter integer not null default 0
);

-- If you already ran this script against a live project before the
-- accounting-software rework, re-run just these two lines instead of the
-- whole file — `add column if not exists` makes them safe either way.
alter table public.settings add column if not exists accounting_software text not null default '';
alter table public.settings add column if not exists qb_product_service text not null default '';
