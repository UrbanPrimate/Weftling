'use strict';

// Quick sanity check for the billing math, per the Weftly spec:
// at 15-min increment, round-up: 7→15, 15→15, 16→30, 62→90, 0→0.
//
// Note: the spec's "62→90" does not match ceil-to-increment rounding
// (ceil(62/15)*15 = 75, consistent with the 16→30 case: ceil(16/15)*15 = 30).
// 90 would only be reached by inputs in (75, 90]. Treating it as a typo and
// checking against the mathematically consistent value (75) instead.

const { billedMinutes } = require('../lib/billing');

const cases = [
  { min: 7, inc: 15, expect: 15 },
  { min: 15, inc: 15, expect: 15 },
  { min: 16, inc: 15, expect: 30 },
  { min: 62, inc: 15, expect: 75 },
  { min: 0, inc: 15, expect: 0 },
];

let failed = 0;
for (const c of cases) {
  const got = billedMinutes(c.min, c.inc, true, 'up', true);
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  billedMinutes(${c.min}, ${c.inc}) = ${got}  (expected ${c.expect})`);
}

// non-billable and zero/negative guard
const guards = [
  { args: [30, 15, false], expect: 0, label: 'not billable -> 0' },
  { args: [-5, 15, true], expect: 0, label: 'negative min -> 0' },
];
for (const g of guards) {
  const got = billedMinutes(...g.args, 'up', true);
  const ok = got === g.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${g.label} = ${got}  (expected ${g.expect})`);
}

if (failed > 0) {
  console.error(`\n${failed} billing check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll billing checks passed.');
}
