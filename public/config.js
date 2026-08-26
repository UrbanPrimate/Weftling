// COMMITTED and publicly deployed by design (served verbatim at /config.js).
// These are PUBLISHABLE values only — the Supabase project URL and the
// sb_publishable_ anon key, which are safe to expose (Row Level Security is
// what actually protects the data). NEVER put a secret here (no sb_secret_,
// service_role JWT, or Nango key): this file is tracked in git and shipped to
// every browser. Per-branch by design — the develop branch can point this at
// a dev Supabase project (see ENVIRONMENTS.md) without affecting production.
window.SUPABASE_CONFIG = {
  url: 'https://bstuqohympbcarrbbvky.supabase.co',
  anonKey: 'sb_publishable_5fyX2eSKrNbEDDR4lPaRLQ_v0JitNpy',
};
