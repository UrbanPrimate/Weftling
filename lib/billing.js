'use strict';

/**
 * Pure billing math shared by the server (invoice creation, CSV export) and
 * referenced by the client for live previews. No I/O, no state.
 */

/**
 * Round actual minutes worked into billed minutes.
 *
 * @param {number} min - actual minutes worked
 * @param {number} inc - billing increment in minutes (e.g. 15)
 * @param {boolean} billable - whether the entry is billable at all
 * @param {"nearest"|"up"} [roundingMode="up"]
 * @param {boolean} [minOneIncrement=true] - if true, any nonzero billable
 *   duration rounds up to at least one increment
 * @returns {number} billed minutes, always a multiple of `inc` (or 0)
 */
function billedMinutes(min, inc, billable, roundingMode = 'up', minOneIncrement = true) {
  if (!billable || !min || min <= 0) return 0;
  inc = inc > 0 ? inc : 1;

  let result = roundingMode === 'nearest'
    ? Math.round(min / inc) * inc
    : Math.ceil(min / inc) * inc;

  if (minOneIncrement && result < inc) {
    result = inc;
  }
  return result;
}

/** Dollar amount for a time entry given its billed minutes and hourly rate. */
function timeAmount(billedMin, rate) {
  return (billedMin / 60) * rate;
}

/** Dollar amount for a material line: qty * unit cost, plus optional markup %. */
function materialAmount(qty, unitCost, markupPct = 0) {
  return qty * unitCost * (1 + (markupPct || 0) / 100);
}

/** Round a currency amount to 2dp using standard rounding (avoids float dust). */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { billedMinutes, timeAmount, materialAmount, round2 };
