// Offline, explicit frozen input only. Never imports DB, exchange or live risk resolver.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('tsx/cjs');
const { createRoiUpgradePolicyVariants, ROI_UPGRADE_POLICY_SCHEMA } = require('../src/config/roi-upgrade-policy.ts');
const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw Error('Usage: node prepare-roi-upgrade-policy.cjs FROZEN_MANIFEST NEW_OUTPUT');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(bytes);
if (!manifest.resolvedRiskPolicy || !Array.isArray(manifest.apps) || !manifest.apps.length) throw Error('missing_frozen_policy_or_apps');
for (const app of manifest.apps) {
  const env = app.publicEnvironment;
  for (const key of ['POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES', 'POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES', 'PENDING_ORDER_REENTRY_COOLDOWN_MINUTES']) {
    if (env?.[key] !== '60') throw Error(`frozen_cooldown_mismatch:${app.name}:${key}`);
  }
}
const policy = { ...manifest.resolvedRiskPolicy };
if (policy.circuitExpectancySince != null) {
  policy.circuitExpectancySince = new Date(policy.circuitExpectancySince);
  if (!Number.isFinite(policy.circuitExpectancySince.getTime())) throw Error('invalid_expectancy_since');
}
const variants = createRoiUpgradePolicyVariants(policy);
const changed = Object.keys(policy).filter(key => JSON.stringify(variants.baseline.policy[key]) !== JSON.stringify(variants.candidate.policy[key])).sort();
if (JSON.stringify(changed) !== JSON.stringify(['circuitDrawdownEnabled', 'maxEffectiveRiskPerTradePercent'])) throw Error('unexpected_policy_changes');
const source = path.resolve(__dirname, '../src/config/roi-upgrade-policy.ts');
const report = {
  schema: ROI_UPGRADE_POLICY_SCHEMA,
  createdAt: new Date().toISOString(),
  frozenManifest: { path: path.resolve(manifestPath), sha256: sha(bytes) },
  source: { path: source, sha256: sha(fs.readFileSync(source)) },
  variants, changedFields: changed,
  deploymentAuthorizedByArtifact: false,
  limits: 'Research configuration only. No deployment, order, account reset or ROI/fill improvement demonstrated. Recorded cooldowns checked; full account/lifecycle parity remains pending.'
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ schema: report.schema, output: outputPath, changedFields: changed }));
