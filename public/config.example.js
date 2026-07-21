// Copy this file to config.js (same folder) and fill in your own project's
// values. Find them in the Supabase dashboard: Project Settings -> API.
//
// The anon key is NOT a secret the way an API secret key is — Supabase
// designs it to be embedded in client-side code, because the real access
// control happens in the database via Row-Level Security policies (more on
// that when we add them). We still keep it out of a committed file, the same
// way this project already keeps .env out of git — mainly so you can swap
// keys per environment without editing tracked files, and so this exact
// pattern reads consistently with how the rest of the app handles config.
window.SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  anonKey: 'YOUR-ANON-PUBLIC-KEY',
};
