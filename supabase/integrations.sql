-- Weftly — third-party integrations (Xero via Nango).
--
-- This table does NOT store Xero credentials. Nango holds the actual OAuth
-- tokens (encrypted, refreshed automatically); this table only stores a
-- *reference* to that connection — enough to know whether a user is
-- connected, which Nango connection is theirs, and which Xero organisation
-- it points at. If this row were ever leaked, an attacker still couldn't
-- call Xero with it — they'd need the Nango secret key too, which lives only
-- in Vercel's environment variables, never in this database.
--
-- Same two-layer pattern as policies.sql: GRANT gets the `authenticated`
-- role past Postgres's table-level check, then RLS decides which ROWS they
-- can see once they're in. Bundled into one file (schema + grants + RLS)
-- since it's a small, single-table addition, unlike the original migration.
--
-- Paste this whole file into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run: `create table if not exists`, `drop policy if exists`.

create table if not exists public.integrations (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'xero',

  -- Nango's own id for this connection. Not a secret — think of it like a
  -- Stripe customer id: useless without the Nango secret key that our
  -- serverless functions hold, but it's how we tell Nango *which* of its
  -- (encrypted, Nango-held) tokens to use on this user's behalf.
  nango_connection_id text not null,

  xero_tenant_id text,
  xero_org_name text,

  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),

  connected_at timestamptz not null default now(),

  -- One row per (user, provider) rather than a surrogate id: a user can only
  -- ever have one Xero connection in this design, so the natural key doubles
  -- as the constraint that enforces that — a second `insert` for the same
  -- user/provider is a conflict, not a silent duplicate row.
  primary key (user_id, provider)
);

grant select, insert, update, delete on public.integrations to authenticated;

alter table public.integrations enable row level security;

drop policy if exists "select own integrations" on public.integrations;
create policy "select own integrations" on public.integrations
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own integrations" on public.integrations;
create policy "insert own integrations" on public.integrations
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own integrations" on public.integrations;
create policy "update own integrations" on public.integrations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own integrations" on public.integrations;
create policy "delete own integrations" on public.integrations
  for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Verification query 1 — GRANTs. Expect exactly 4 rows (one per privilege),
-- grantee = authenticated.
-- ---------------------------------------------------------------------------
select table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'integrations'
  and grantee = 'authenticated'
order by privilege_type;

-- ---------------------------------------------------------------------------
-- Verification query 2 — RLS policies. Expect exactly 4 rows, using_expr and
-- with_check both reading "(auth.uid() = user_id)" wherever they apply.
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd, qual as using_expr, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'integrations'
order by cmd;
