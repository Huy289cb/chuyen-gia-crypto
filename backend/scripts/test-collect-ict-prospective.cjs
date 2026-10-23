'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  verifyFreeze,
  filterWindowCandidates,
  FREEZE,
  probeAdmission,
  summarizeReplay,
} = require('./collect-ict-prospective.cjs');

const manifest = JSON.parse(fs.readFileSync(path.join(FREEZE, 'manifest.json'), 'utf8'));
assert.equal(verifyFreeze(manifest), true);

const start = Date.parse(manifest.candidateWindowStart);
const end = Date.parse(manifest.candidateWindowEndExclusive);
assert.deepEqual(
  filterWindowCandidates(
    [
      { id: 'a', confirmedAt: start - 1 },
      { id: 'b', confirmedAt: start },
      { id: 'c', confirmedAt: end - 1 },
      { id: 'd', confirmedAt: end },
      { id: 'e', confirmedAt: Number.NaN },
    ],
    start,
    end
  ).map((c) => c.id),
  ['b', 'c']
);

const bad = structuredClone(manifest);
bad.hashes['research_ict_fvg.py'] = '0'.repeat(64);
assert.throws(() => verifyFreeze(bad), /freeze_hash_mismatch/);

const accept = probeAdmission({ entry: 100000, stopLoss: 99200 }, 10000);
assert.equal(accept.accepted, true);
const reject = probeAdmission({ entry: 100000, stopLoss: 90000 }, 33.6);
assert.equal(reject.accepted, false);
assert.equal(reject.reason, 'execution_risk');

const rates = summarizeReplay([
  { state: 'expired_without_fill' },
  { state: 'ambiguous_entry_exit_same_minute' },
  { state: 'invalid_levels' },
  { state: 'closed_assumed_fill' },
]);
assert.equal(rates.fillRate, 0.25);
assert.equal(rates.invalidRate, 0.25);

console.log(
  JSON.stringify({
    ok: true,
    checks: ['freeze_hash', 'window_filter', 'tamper_detect', 'admission_probe', 'replay_rates'],
    freezeVersion: 'prospective-v1',
  })
);
