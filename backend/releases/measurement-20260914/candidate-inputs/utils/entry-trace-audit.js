"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditEntryTraces = auditEntryTraces;
function auditEntryTraces(events) {
    const traces = new Map();
    let unlinkedRequests = 0, unlinkedFills = 0, unknownProviderCosts = 0;
    let knownProviderCostUsd = 0;
    const results = new Map(events.filter(e => e.event_type === 'llm_provider_result' && typeof e.event_data.request_id === 'string')
        .map(e => [e.event_data.request_id, e.event_data]));
    let paired = 0, improved = 0, missingPairs = 0;
    for (const event of events) {
        const d = event.event_data, id = typeof d.trace_id === 'string' ? d.trace_id : null;
        if (event.event_type === 'llm_provider_request') {
            if (!id)
                unlinkedRequests++;
            const cost = results.get(d.request_id)?.cost_usd;
            if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)
                unknownProviderCosts++;
            else
                knownProviderCostUsd += cost;
        }
        if (event.event_type === 'entry_order_filled' && !id)
            unlinkedFills++;
        if (event.event_type === 'retest_feasibility_pair') {
            const c = d.comparison;
            if (c?.paired === true) {
                paired++;
                if (c.becameGeometryFeasible === true)
                    improved++;
            }
            else
                missingPairs++;
        }
        if (!id)
            continue;
        let t = traces.get(id);
        if (!t) {
            t = { trace_id: id, observation_key: d.observation_key, requests: 0, decisions: new Set(), stages: [], orders: new Set(), fills: 0 };
            traces.set(id, t);
        }
        if (event.event_type === 'llm_provider_request')
            t.requests++;
        if (typeof d.decision_id === 'number')
            t.decisions.add(d.decision_id);
        if (typeof d.order_id === 'string')
            t.orders.add(d.order_id);
        if (event.event_type === 'entry_trace' && typeof d.stage === 'string')
            t.stages.push(d.stage);
        if (event.event_type === 'entry_order_filled')
            t.fills++;
    }
    return { traceCount: traces.size, unlinkedRequests, unlinkedFills, unknownProviderCosts, knownProviderCostUsd,
        retest: { paired, becameGeometryFeasible: improved, unavailable: missingPairs, pnlMeasured: false },
        traces: [...traces.values()].map(t => ({ ...t, decisions: [...t.decisions], orders: [...t.orders] })),
        limitations: ['Counts apply only to supplied events; historical missing links are not reconstructed by proximity.',
            'Repeated requests, bars and retest observations are not independent trades.',
            'Unknown provider costs cannot be treated as zero for ROI.'] };
}
//# sourceMappingURL=entry-trace-audit.js.map