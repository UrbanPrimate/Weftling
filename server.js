'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

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
  console.log(`Weftly is running at http://localhost:${PORT}`);
});
