'use strict';

const { HttpError } = require('./http');

/**
 * Per-user rate limit, backed by the check_rate_limit() Postgres function
 * (see supabase/rate_limiting.sql). Call it after requireUser(), passing that
 * user's JWT-scoped `supabase` client — the function keys on auth.uid(), so
 * each user has their own budget.
 *
 * Fails OPEN: if the check itself errors (a DB hiccup), we log and allow the
 * request. Rate limiting here is abuse mitigation, not a security boundary —
 * a transient error on the limiter must not take down legitimate use.
 *
 * @param supabase   the JWT-scoped client from requireUser()
 * @param bucket     a stable name for the thing being limited (e.g. 'xero_proxy')
 * @param maxHits    max requests allowed per window
 * @param windowSeconds  window length in seconds
 */
async function enforceRateLimit(supabase, bucket, maxHits, windowSeconds) {
  let allowed = true;
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_max: maxHits,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error(`[rateLimit] check failed for bucket "${bucket}", allowing:`, error.message);
      return;
    }
    allowed = data !== false;
  } catch (err) {
    console.error(`[rateLimit] check threw for bucket "${bucket}", allowing:`, err && err.message);
    return;
  }
  if (!allowed) {
    throw new HttpError(429, 'rate_limited', 'Too many requests — slow down and try again in a moment.');
  }
}

module.exports = { enforceRateLimit };
