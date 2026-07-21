'use strict';

const fs = require('fs');
const path = require('path');

// Single-user local token cache. Persists the OAuth2 token set + the chosen
// Xero tenant so the connection survives server restarts.
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');

function load() {
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to read token.json:', err.message);
    }
    return null;
  }
}

function save(data) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function clear() {
  try {
    fs.unlinkSync(TOKEN_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { load, save, clear, TOKEN_PATH };
