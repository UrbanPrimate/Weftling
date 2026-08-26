// COMMITTED and publicly deployed by design (served verbatim at /config.js).
// These are PUBLISHABLE values only — Supabase project URLs and their
// sb_publishable_ anon keys, safe to expose (Row Level Security is what
// actually protects the data). NEVER put a secret here (no sb_secret_,
// service_role JWT, or Nango key): this file is tracked in git and shipped to
// every browser.
//
// One file, both environments — the database is chosen by HOSTNAME, not by
// branch, so a develop -> main promotion can never swap the production app
// onto the dev database. Only the exact production domain uses the production
// project; the dev domain, Vercel preview URLs, and localhost all use the dev
// project (a safe default: unknown hosts fall to dev, never prod). The backend
// functions are matched separately via Vercel env vars scoped Production vs
// Preview (see ENVIRONMENTS.md).
(function () {
  var PROD_HOST = 'weftling.fabbricerp.com';
  var isProd = window.location.hostname === PROD_HOST;
  window.SUPABASE_CONFIG = isProd
    ? {
        url: 'https://bstuqohympbcarrbbvky.supabase.co',
        anonKey: 'sb_publishable_5fyX2eSKrNbEDDR4lPaRLQ_v0JitNpy',
      }
    : {
        url: 'https://kzdbokwlwyzrtstbvjxg.supabase.co',
        anonKey: 'sb_publishable_sQum7jCoaOh0VazIMFyVwQ_rlt9lGkG',
      };
})();
