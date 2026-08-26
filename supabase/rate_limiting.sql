-- Weftly — per-user rate limiting, backed by Postgres (no external service).
--
-- The /api/* functions proxy to Nango/Xero/QuickBooks on the user's behalf.
-- Without a limit, one authenticated user could hammer those endpoints and
-- run up cost / degrade the shared Nango account for everyone (a cross-tenant
-- DoS). This adds a small server-managed counter the functions consult before
-- doing Nango work.
--
-- Design:
--  * rate_limit_hits is written ONLY by check_rate_limit() below — the
--    authenticated/anon roles have no direct grant, so a user can't reset or
--    forge their own counter.
--  * check_rate_limit() is SECURITY DEFINER, keyed on auth.uid(), and buckets
--    time into fixed windows. It prunes the caller's own stale windows on each
--    call, so the table stays tiny (≈ one row per active user per bucket).
--  * Fixed-window (not sliding) — simplest, and fine for abuse mitigation.
--
-- If this ever needs to scale beyond what Postgres comfortably handles, swap
-- the storage for Upstash Redis without changing the call sites (they only
-- call the check_rate_limit RPC).
--
-- Paste into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run.

create table if not exists public.rate_limit_hits (
  user_id uuid not null,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, bucket, window_start)
);

-- Only the SECURITY DEFINER function (owned by an admin role) touches this
-- table. No direct API access for anyone.
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon;
revoke all on public.rate_limit_hits from authenticated;

create or replace function public.check_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Floor now() to the start of the current fixed window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  -- Keep the table small: drop this caller's expired windows for this bucket.
  delete from public.rate_limit_hits
  where user_id = auth.uid() and bucket = p_bucket and window_start < v_window_start;

  insert into public.rate_limit_hits (user_id, bucket, window_start, hits)
  values (auth.uid(), p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;

  -- true = allowed (still within budget), false = over the limit.
  return v_hits <= p_max;
end;
$$;

revoke execute on function public.check_rate_limit(text, integer, integer) from public;
revoke execute on function public.check_rate_limit(text, integer, integer) from anon;
grant execute on function public.check_rate_limit(text, integer, integer) to authenticated;
