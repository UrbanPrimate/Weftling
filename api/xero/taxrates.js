'use strict';

const { requireUser } = require('../_lib/supabaseUser');
const { requireXeroConnection, xeroGet, normalizeXeroError } = require('../_lib/xero');
const { withHandler, HttpError } = require('../_lib/http');

/** GET /api/xero/taxrates — for the tax-type picker (tax type must match exactly, same as account code). */
module.exports = withHandler('GET', async (req, res) => {
  const { supabase, user } = await requireUser(req);
  const conn = await requireXeroConnection(supabase, user);

  let body;
  try {
    const result = await xeroGet(conn, '/TaxRates');
    body = (result && result.data) || result;
  } catch (err) {
    const normalized = normalizeXeroError(err);
    throw new HttpError(normalized.status, normalized.code, normalized.message);
  }

  const taxRates = (body.TaxRates || body.taxRates || []).map((t) => ({
    taxType: t.TaxType || t.taxType,
    name: t.Name || t.name,
    effectiveRate: t.EffectiveRate != null ? t.EffectiveRate : t.effectiveRate,
    status: t.Status || t.status,
  }));

  res.status(200).json({ taxRates });
});
