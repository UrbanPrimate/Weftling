'use strict';

require('dotenv').config();

// Guard against a known xero-node bug: its ApiError constructor does
// `axiosError.response.status` unconditionally (dist/model/ApiError.js), which
// throws when a Xero call fails at the network level (timeout, DNS, connection
// reset — no HTTP response at all, as opposed to an HTTP error response). That
// throw happens deep inside the SDK's generator-based async plumbing and can
// surface as an unhandled rejection rather than propagating to the calling
// route's own try/catch, which otherwise crashes this whole single-process
// server over one transient network hiccup during a background sync. Log and
// keep running instead — this is a local single-user tool; staying up after a
// bad Xero call is safer than going down entirely.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server stays up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server stays up):', err);
});

const path = require('path');
const express = require('express');
const xeroRoutes = require('./routes/xero');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Xero OAuth + /api routes (same-origin, so no CORS needed against the UI).
app.use(xeroRoutes);

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

// SPA fallback: any non-file, non-/api GET serves the app shell.
app.get(/^(?!\/api|\/connect|\/callback).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'server_error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`Weftly is running at http://localhost:${PORT}`);
});
