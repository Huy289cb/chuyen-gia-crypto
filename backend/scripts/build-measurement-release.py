#!/usr/bin/env python3
"""Build a reviewable binary overlay against the exact live dist; never deploys.

Live TypeScript is not fully recoverable from source maps. The deployed JS is
therefore the baseline, and every selected delta is retained as a unified diff.
"""
import argparse, difflib, hashlib, json, pathlib, re, shutil

OVERLAY = [
    'repositories/testnet.repository.js', 'routes/metrics.js',
    'schedulers/llm-dispatch.scheduler.js', 'services/binance-order-fill.service.js',
    'services/entry-gate-funnel.service.js', 'services/groq-dispatch.service.js',
    'services/llm-telemetry.service.js', 'services/memory.service.js',
    'services/transition-breakout-retest.service.js', 'services/v3-trade-execution.service.js',
    'utils/order-quantity.js', 'utils/entry-feasibility-observation.js',
    'utils/entry-trace-audit.js', 'utils/entry-trace.js', 'utils/plan-feasibility.js',
    'utils/retest-feasibility.js',
]

def digest(data): return hashlib.sha256(data).hexdigest()
def inventory(root):
    return {str(p.relative_to(root)): digest(p.read_bytes()) for p in sorted(root.rglob('*')) if p.is_file()}

def replace_once(text, old, new):
    if text.count(old) != 1: raise ValueError('Patch anchor absent/ambiguous: ' + old[:100])
    return text.replace(old, new, 1)

def remove_between(text, start, end):
    if text.count(start) != 1 or text.count(end) != 1: raise ValueError('Ambiguous block anchors')
    a, b = text.index(start), text.index(end)
    if a >= b: raise ValueError('Invalid block order')
    return text[:a] + text[b:]

def isolate(name, candidate, baseline):
    s = candidate
    if name == 'services/groq-dispatch.service.js':
        s = replace_once(s, 'const closes = (0, closed_candles_1.closedCandlesOnly)(pbCandles, pbTf).map((c) => c.close);',
                         'const closes = pbCandles.map((c) => c.close);')
    elif name == 'utils/order-quantity.js':
        s = remove_between(s, '    if (![stepSize, minQty, minNotionalUsd].every(', '    const minFloor =')
    elif name == 'schedulers/llm-dispatch.scheduler.js':
        s = replace_once(s, 'const ai_opportunity_runtime_1 = require("../services/ai-opportunity-runtime");\n', '')
        s = remove_between(s, '            const aiOpportunity =', '            let retestOpportunity =')
    elif name == 'routes/metrics.js':
        s = replace_once(s, 'const ai_opportunity_policy_1 = require("../config/ai-opportunity-policy");\n', '')
        s = remove_between(s, '/** Read-only observability. Unknown provider cost', '/**\n * GET /api/metrics/risk')
    elif name == 'services/v3-trade-execution.service.js':
        s = replace_once(s, 'const ai_opportunity_policy_1 = require("../config/ai-opportunity-policy");\n', '')
        s = replace_once(s, "lane: input.opportunityContract ? 'ai_opportunity' : 'direct_execution', decision_id: input.decisionRecordId,\n        candidate_key: input.opportunityContract?.plan.id,",
                         "lane: 'direct_execution', decision_id: input.decisionRecordId,")
        s = remove_between(s, '    const contractBlock = () => {', '    const entry = Number(analysis.suggested_entry);')
        s = replace_once(s, '!input.opportunityContract && (0, v3_entry_policy_1.isV3OppositeFlipEnabled)()',
                         '(0, v3_entry_policy_1.isV3OppositeFlipEnabled)()')
        s = remove_between(s, '    if (input.opportunityContract && (openPositions.length', '    const scaleIn =')
        s = replace_once(s, '!input.opportunityContract && (0, v3_entry_policy_1.isV3ScaleInEnabled)()',
                         '(0, v3_entry_policy_1.isV3ScaleInEnabled)()')
        s = remove_between(s, '    const lateContractBlock = contractBlock();', '    const binanceSide =')
    elif name == 'services/entry-gate-funnel.service.js':
        # Returned gates/all_blocks are input to the legacy retest state machine.
        # Keep these EXACTLY legacy-compatible; corrected labels live separately.
        s = replace_once(s, ": unavailable('playbook direction unavailable');", ": gate(false, 'playbook direction unavailable');")
        for phrase in ('structure', 'side align', '5m guard'):
            s = replace_once(s, "notApplicable('" + phrase + " cannot evaluate without side')",
                             "gate(false, '" + phrase + " cannot evaluate without side')")
        s = replace_once(s, 'closedCandlesOnly)(fetched, tf, asOf).slice(-limit)', 'closedCandlesOnly)(fetched, tf).slice(-limit)')
        s = replace_once(s, 'closedCandlesOnly)(fetched, tf, asOf).map', 'closedCandlesOnly)(fetched, tf).map')
        s = replace_once(s, 'const entry = (0, closed_candles_1.closedCandlesOnly)(input.candles, input.timeframe, asOf).at(-1)?.close;',
                         'const entry = input.candles.at(-1)?.close;')
        s = replace_once(s, '    const barKey = (0, candle_hash_1.generateCandleBarKey)(input.candles);\n    return {', '''    const diagnosticGates = { ...gates };
    if (!side) {
        diagnosticGates.direction = unavailable('playbook direction unavailable');
        for (const key of ['structure', 'side_align', 'entry_5m_guard']) {
            if (diagnosticGates[key].status !== 'not_applicable')
                diagnosticGates[key] = notApplicable('requires a directional setup');
        }
    }
    const diagnosticBlocks = Object.entries(diagnosticGates)
        .filter(([, g]) => g.status === 'block' || g.status === 'unavailable').map(([key]) => key);
    const barKey = (0, candle_hash_1.generateCandleBarKey)(input.candles);
    return {''')
        s = replace_once(s, '        measurement_version: 2,', '        measurement_version: 2,\n        diagnostic_gates: diagnosticGates,\n        diagnostic_blocks: diagnosticBlocks,\n        legacy_control_fields_preserved: true,')
        s = replace_once(s, "Object.values(gates).some(g => g.status === 'unavailable') ? 'missing_data' : allBlocks.length ? 'blocked' : 'proxy_pass',",
                         "Object.values(diagnosticGates).some(g => g.status === 'unavailable') ? 'missing_data' : diagnosticBlocks.length ? 'blocked' : 'proxy_pass',")
    if 'ai_opportunity_' in s and name in ('routes/metrics.js','schedulers/llm-dispatch.scheduler.js','services/v3-trade-execution.service.js'):
        raise ValueError('AI opportunity lane leaked into runtime overlay')
    return re.sub(r'\n?//# sourceMappingURL=.*?(?:\n|$)', '\n', s)

def build(baseline, candidate, out):
    if out.exists(): raise ValueError('Output already exists; releases are immutable')
    before, reference = inventory(baseline), inventory(candidate)
    out.mkdir(parents=True)
    shutil.copytree(baseline, out/'baseline')
    shutil.copytree(baseline, out/'release')
    (out/'candidate-inputs').mkdir()
    patches = []
    for name in OVERLAY:
        src = candidate/name
        data = src.read_bytes()
        if digest(data) != reference[name]: raise ValueError('Candidate mutated while packaging')
        archived = out/'candidate-inputs'/name
        archived.parent.mkdir(parents=True, exist_ok=True); archived.write_bytes(data)
        old = (baseline/name).read_text() if (baseline/name).exists() else ''
        selected = isolate(name, data.decode(), old)
        dest = out/'release'/name; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(selected)
        for suffix in ('.js.map', '.d.ts', '.d.ts.map'):
            artifact = dest.with_name(dest.name[:-3]+suffix)
            if artifact != dest: artifact.unlink(missing_ok=True)
        patches.extend(difflib.unified_diff(old.splitlines(True), selected.splitlines(True), fromfile='baseline/'+name, tofile='release/'+name))
    if inventory(baseline) != before or inventory(candidate) != reference: raise ValueError('Input changed while packaging')
    selected = inventory(out/'release')
    changed = sorted(k for k,v in selected.items() if before.get(k) != v)
    removed = sorted(set(before)-set(selected))
    candidate_delta = sorted(k for k,v in reference.items() if k.endswith('.js') and before.get(k) != v)
    manifest = {'version':1, 'baseline':before, 'release':selected, 'candidateInputHashes':{k:reference[k] for k in OVERLAY},
                'changedFiles':changed,'removedFiles':removed,'fullCandidateJsDelta':candidate_delta,
                'excludedCandidateJs':sorted(set(candidate_delta)-set(OVERLAY)),
                'excludedBehaviorChanges':['dispatch SMA closed-candle change','quantity invalid-input rejection',
                    'AI opportunity lane and execution contracts','legacy funnel control-field changes'],
                'runtimeDeployed':False,'databaseMigration':False,'environmentChanges':False}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (out/'measurement.patch').write_text(''.join(patches))
    (out/'builder.py').write_bytes(pathlib.Path(__file__).read_bytes())
    return manifest

if __name__ == '__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--baseline',type=pathlib.Path,required=True);ap.add_argument('--candidate',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True)
    a=ap.parse_args();m=build(a.baseline.resolve(),a.candidate.resolve(),a.out.resolve())
    print(json.dumps({'changedFiles':len(m['changedFiles']),'excludedJs':len(m['excludedCandidateJs']),'deployed':False}))
