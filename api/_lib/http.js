'use strict';

/** Thrown by any /api handler to produce a specific HTTP status + JSON body instead of a bare 500. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Wraps a Vercel serverless function body: rejects the wrong HTTP method up
 * front, and turns any thrown error into { error, message } JSON with the
 * right status — HttpError's own status/code if it's one of ours, else a
 * logged 500. Every /api/xero/* handler is built with this so none of them
 * can forget the method check or leak a raw stack trace to the client.
 */
function withHandler(method, fn) {
  return async (req, res) => {
    if (req.method !== method) {
      res.status(405).json({ error: 'method_not_allowed', message: `Use ${method}.` });
      return;
    }
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const code = err instanceof HttpError ? err.code : 'server_error';
      if (status === 500) console.error(err);
      // Deliberate 4xx/422/502 messages (method_not_allowed, Xero/QBO
      // reconnect guidance, validation text) are safe and useful to the
      // client. A 500 is an unexpected internal failure whose message can
      // carry Supabase/internal detail — log it (above) but return a fixed
      // string so nothing internal leaks to the caller.
      const message = status === 500 ? 'Something went wrong.' : (err.message || 'Something went wrong.');
      res.status(status).json({ error: code, message });
    }
  };
}

module.exports = { HttpError, withHandler };
