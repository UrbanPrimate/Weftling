'use strict';

require('dotenv').config();

const fs = require('fs');
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
// connect-src/frame-src additions are for @nangohq/frontend (loaded only
// when a user clicks "Connect Xero"): it talks to api.nango.dev from this
// page's own context, and its Connect UI runs at connect.nango.dev — either
// as a same-page frame or a separate popup window depending on Nango's
// implementation, so both are allow-listed defensively. Xero's own OAuth
// pages are never loaded in this app at all — they only ever appear inside
// Nango's popup, a separate top-level browsing context this CSP has no
// jurisdiction over.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://bstuqohympbcarrbbvky.supabase.co https://api.nango.dev https://connect.nango.dev",
  "frame-src https://connect.nango.dev",
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
  // HSTS is a no-op over plain http (this local dev server) — browsers only
  // honor it when received over an actual https connection, which is all
  // this app is ever served over in production (Vercel). Harmless here,
  // load-bearing there.
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  // The app never uses any of these browser features (confirmed: no
  // geolocation/camera/mic/payment API calls anywhere in the codebase) —
  // denying them outright is pure hardening, not a behavior change.
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
  next();
});

// Local mirror of Vercel's api/ filesystem routing. In production the files
// under api/ deploy as Vercel serverless functions; this local server used to
// serve ONLY the static frontend, so every /api/* request fell through to the
// SPA fallback below and came back as index.html — which is exactly the
// "did not return valid JSON" failure apiFetch() warns about. Mounting the
// same handler files here makes `node server.js` a fully working app. The
// handlers are plain (req, res) functions built on the express-compatible
// subset of Vercel's API (req.method/headers/query/body, res.status().json()),
// so they mount directly — express.json() supplies the parsed req.body that
// Vercel provides automatically.
app.use(express.json());
(function mountApiDir(dir, urlBase) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue; // _lib is shared code, not routes
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      mountApiDir(full, `${urlBase}/${entry.name}`);
    } else if (entry.name.endsWith('.js')) {
      app.all(`${urlBase}/${entry.name.replace(/\.js$/, '')}`, require(full));
    }
  }
})(path.join(__dirname, 'api'), '/api');

// Any /api path that didn't match a mounted handler is a genuine 404 — JSON,
// never the SPA fallback's HTML (matching how Vercel 404s unknown functions).
app.all(['/api', '/api/*'], (req, res) => {
  res.status(404).json({ error: 'not_found', message: `No such API route: ${req.path}` });
});

// Static frontend: the single-page app, PWA manifest, service worker, icons.
app.use(
  express.static(path.join(__dirname, 'public'), {
    // Serve dot-paths too: /.well-known/assetlinks.json (the Android TWA's
    // digital asset link) lives in a dot-directory, which express.static
    // refuses by default — Vercel serves it either way, so this keeps local
    // behavior identical.
    dotfiles: 'allow',
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
