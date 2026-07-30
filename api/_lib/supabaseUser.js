'use strict';

const { createClient } = require('@supabase/supabase-js');
const { HttpError } = require('./http');

/**
 * Verifies the caller's Supabase session and returns a Supabase client
 * scoped to THAT user's own access token (same Authorization header
 * SupabaseClient in the browser would send). Every query run through the
 * returned client is subject to Postgres RLS as auth.uid() = this user —
 * that's what actually stops user A from touching user B's `integrations`
 * row, not any check written here. No service-role key is used anywhere in
 * this app, so there's no privileged bypass sitting in server code to leak
 * or misuse.
 *
 * Throws HttpError(401) if the header is missing or the token doesn't
 * verify — every endpoint calls this first, before touching anything else.
 */
async function requireUser(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'unauthorized', 'Missing bearer token.');

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new HttpError(500, 'server_misconfigured', 'SUPABASE_URL / SUPABASE_ANON_KEY are not set.');
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Explicitly verifies the token against Supabase's own auth server (not a
  // local/cached decode) — the standard server-side pattern for trusting a
  // bearer token you didn't just mint yourself.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) {
    throw new HttpError(401, 'unauthorized', 'Invalid or expired session — sign in again.');
  }

  return { supabase, user: data.user };
}

module.exports = { requireUser };
