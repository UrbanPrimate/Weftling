-- Weftly — Row-Level Security (Step 4 of the localStorage -> Supabase migration).
--
-- Two layers, in order:
--   1. GRANTs — base table-level privileges. Without these, Postgres refuses
--      the query before RLS ever runs, raising exactly the error you saw:
--      "permission denied for table X". This is almost certainly what was
--      missing — tables created via the SQL Editor (as schema.sql did)
--      aren't always covered by the authenticated role's default privileges
--      the way tables made through the dashboard Table Editor are.
--   2. RLS policies — once GRANTs let `authenticated` reach the table at
--      all, these decide which ROWS they can see/touch. This is the actual
--      per-user isolation.
--
-- Paste this whole file into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run: grants are idempotent, and `drop policy if exists` clears
-- old policies before recreating them.

-- ---------------------------------------------------------------------------
-- 1. Base privileges for the `authenticated` role (i.e. any signed-in user).
--    Not granted to `anon` — this app has no legitimate unauthenticated
--    access, so there's no reason to widen the surface even though RLS
--    would block anon requests anyway (auth.uid() is null for them, which
--    never equals a real user_id).
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.time_entries to authenticated;
grant select, insert, update, delete on public.materials to authenticated;
grant select, insert, update, delete on public.settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS. Until this line, these tables have none — this is the
--    switch from "open to anyone `authenticated` covers" to "closed unless a
--    policy below says otherwise."
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.time_entries enable row level security;
alter table public.materials enable row level security;
alter table public.settings enable row level security;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
drop policy if exists "select own clients" on public.clients;
create policy "select own clients" on public.clients
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own clients" on public.clients;
create policy "insert own clients" on public.clients
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own clients" on public.clients;
create policy "update own clients" on public.clients
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own clients" on public.clients;
create policy "delete own clients" on public.clients
  for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- time_entries
-- ---------------------------------------------------------------------------
drop policy if exists "select own time_entries" on public.time_entries;
create policy "select own time_entries" on public.time_entries
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own time_entries" on public.time_entries;
create policy "insert own time_entries" on public.time_entries
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own time_entries" on public.time_entries;
create policy "update own time_entries" on public.time_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own time_entries" on public.time_entries;
create policy "delete own time_entries" on public.time_entries
  for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- materials
-- ---------------------------------------------------------------------------
drop policy if exists "select own materials" on public.materials;
create policy "select own materials" on public.materials
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own materials" on public.materials;
create policy "insert own materials" on public.materials
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own materials" on public.materials;
create policy "update own materials" on public.materials
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own materials" on public.materials;
create policy "delete own materials" on public.materials
  for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- settings — same column name (user_id), just also happens to be the PK here
-- ---------------------------------------------------------------------------
drop policy if exists "select own settings" on public.settings;
create policy "select own settings" on public.settings
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own settings" on public.settings;
create policy "insert own settings" on public.settings
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own settings" on public.settings;
create policy "update own settings" on public.settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own settings" on public.settings;
create policy "delete own settings" on public.settings
  for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Verification query 1 — GRANTs. Expect exactly 16 rows: 4 tables x 4
-- privileges (SELECT/INSERT/UPDATE/DELETE), grantee = authenticated on every
-- row. If any table has fewer than 4 rows here, that table will still throw
-- "permission denied."
-- ---------------------------------------------------------------------------
select table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('clients', 'time_entries', 'materials', 'settings')
  and grantee = 'authenticated'
order by table_name, privilege_type;

-- ---------------------------------------------------------------------------
-- Verification query 2 — RLS policies. Expect exactly 16 rows: 4 tables x 4
-- commands (select/insert/update/delete), using_expr and with_check both
-- reading "(auth.uid() = user_id)" wherever they apply, nothing reading
-- "true" anywhere.
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd, qual as using_expr, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
