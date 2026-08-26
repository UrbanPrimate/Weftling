-- Weftly — self-service account deletion.
--
-- Google Play requires any app with account creation to let users delete
-- their account (and associated data) from inside the app AND from a web
-- URL. This adds the one server-side primitive that makes that possible:
-- a function the signed-in user can call to delete THEIR OWN auth account.
--
-- Deleting the row from auth.users cascades to every app table — clients,
-- time_entries, materials, settings, integrations all declare
-- `references auth.users (id) on delete cascade` (see schema.sql /
-- integrations.sql) — so this single delete removes all of the user's data.
-- The Nango-side OAuth tokens are NOT touched by this (they live in Nango,
-- keyed by a connection id); users should Disconnect Xero/QuickBooks first,
-- and the app's delete flow reminds them to. A leftover Nango connection
-- without its local reference row is harmless (nothing can look it up).
--
-- SECURITY DEFINER so it runs with the function owner's rights (the delete
-- on auth.users needs more than the `authenticated` role has). The function
-- can ONLY ever delete the caller's own account — it derives the target
-- from auth.uid() and ignores all input, so there is no id parameter to
-- abuse. `set search_path = ''` pins schema resolution (no search_path
-- hijacking of a definer function). Must be created by an admin role (the
-- Supabase SQL Editor runs as one) so the owner has delete rights on
-- auth.users.
--
-- Paste into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run: `create or replace`.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Belt-and-braces: RLS/grants already keep this to authenticated callers,
  -- but a definer function should never assume a caller — refuse if somehow
  -- invoked without a signed-in user rather than deleting nothing silently.
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- One delete; the on-delete-cascade foreign keys do the rest.
  delete from auth.users where id = auth.uid();
end;
$$;

-- Only signed-in users may call it; never anon or the public pseudo-role.
revoke execute on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
