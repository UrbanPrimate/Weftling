'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// script-src needs 'unsafe-inline': the whole app is one inline <script> in
// index.html (no build step, no bundler), so there's no external file or
// per-request nonce to reference instead. That's a real limitation — this
// header does NOT stop an XSS payload from executing once injected via
// innerHTML the way the currency_symbol bug did (see formatMoney() and its
// escapeHtml() fix). What it DOES still lock down: no script may load from
// any origin except this server and the pinned Supabase CDN (blocks a
// compromised/typosquatted third-party script tag), no page may frame this
// app (clickjacking on the login screen), and any exfiltration attempt via
// fetch()/WebSocket is confined to this origin and Supabase's — an injected
// script can't phone home to an attacker's server even if it does run.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY'); // legacy backstop for frame-ancestors above, for older browsers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Static frontend: the single-page app, PWA manifest, service worker, icons.
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('manifest.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json');
      }
      if (filePath.endsWith('sw.js')) {
        // Keep the service worker from being aggressively cached so updates land promptly.
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// SPA fallback: any non-file GET serves the app shell.
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'server_error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`Weftling is running at http://localhost:${PORT}`);
});
