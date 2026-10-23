#!/usr/bin/env python3
"""Engineering-only golden vectors from registered frozen pure functions.

No engine/account import, wallet replay, return/PnL run, network or source edit.
The research files are hash checked against the continuous128 registration.
"""
import csv
import datetime as dt
import hashlib
import json
import pathlib
import sys
import types
from decimal import Decimal

sys.dont_write_bytecode = True
RESEARCH = pathlib.Path('/home/ubuntu/futures-improvement-20261015')
DEST = pathlib.Path(__file__).resolve().parents[1] / 'tests/fixtures/cct-source-projection'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_frozen(path, name):
    module = types.ModuleType(name)
    module.__file__ = str(path)
    sys.modules[name] = module
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


def main():
    protocol_path = RESEARCH / 'cct-buffer11-continuous128/protocol.json'
    protocol = json.loads(protocol_path.read_text())
    registered = {item['path']: item['sha256'] for item in protocol['inputs']}
    source = RESEARCH / 'cct-candidate/generate_targets.py'
    projector = RESEARCH / 'candidate_projection.py'
    price_input = pathlib.Path(next(p for p in registered if p.endswith('/daily-source.csv')))
    prior = RESEARCH / 'cct-confirmation-targets/targets-64d.ndjson'
    main_targets = RESEARCH / 'cct-candidate/long_cash/targets-64d.ndjson'
    inputs = [source, projector, price_input, prior, main_targets]
    before = {str(p): digest(p) for p in inputs}
    assert all(registered[str(p)] == before[str(p)] for p in inputs)
    generator = load_frozen(source, 'frozen_cct_source_golden_only')
    projection = load_frozen(projector, 'frozen_cct_projection_golden_only')
    start, end = protocol['period']['start'], protocol['period']['endExclusive']
    rows, receipt = generator.generate(price_input,
        start=dt.datetime.fromtimestamp(start / 1000, dt.timezone.utc),
        end=dt.datetime.fromtimestamp(end / 1000, dt.timezone.utc), mode='long_cash')
    expected = [json.loads(line) for p in (prior, main_targets) for line in p.read_text().splitlines()]
    assert rows == expected and len(rows) == 128
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / 'daily-source.csv').write_bytes(price_input.read_bytes())
    (DEST / 'source128.json').write_text(json.dumps({'startTimeMs': start,
        'endTimeMs': end, 'rows': rows}, separators=(',', ':'), allow_nan=False) + '\n')

    def flt(step='1', minimum='1', notional='5', maximum='1000'):
        return dict(stepSize=step, minQty=minimum, maxQty=maximum, minNotional=notional)

    def case(name, weights, positions=None, marks=None, filters=None, **kwargs):
        symbols = set(weights) | set(positions or {})
        params = dict(weights=weights, positions=positions or {}, equity='100',
            marks=marks or {s: '10' for s in symbols},
            filters=filters or {s: flt() for s in symbols}, gross_cap='8',
            fee_rate='.0005', slippage_bps='2', leverage='10', day_anchor='100',
            daily_loss_budget='10', close_buffer='1.1')
        params.update(kwargs)
        answer = projection.project_portfolio(**params).as_dict()
        key_map = dict(gross_cap='grossCap', fee_rate='feeRate', slippage_bps='slippageBps',
            day_anchor='dayAnchor', day_net_cashflow='dayNetCashflow', daily_loss_budget='dailyLossBudget',
            close_buffer='closeBuffer')
        return dict(name=name, input={key_map.get(k, k): v for k, v in params.items()}, expected=answer)

    cases = [
        case('flat_below_opening_minimum', {'A': '.02'}),
        case('retained_inventory_below_opening_minimum', {'A': '.1'}, {'A': '1'}, filters={'A': flt(notional='20')}),
        case('reduction_below_opening_minimum', {'A': '.1'}, {'A': '2'}, filters={'A': flt(notional='50')}),
        case('flip_close_then_open', {'A': '-.3', 'B': '.2'}, {'A': '2', 'B': '-2'}),
        case('off_step_inventory_retained', {'A': '.105'}, {'A': '1.05'}, filters={'A': flt(step='.1', minimum='.1')}),
        case('off_step_inventory_delta_lattice', {'A': '.005'}, {'A': '1.05'}, filters={'A': flt(step='.1', minimum='.1')}),
        case('market_lot_overrides_lot_size', {'A': '.3'}, filters={'A': {**flt(step='.01', minimum='.01'),
            'marketStepSize': '1', 'marketMinQty': '1', 'marketMaxQty': '50'}}),
        case('post_cost_gross_cap_repair', {'A': '4', 'B': '4'}, fee_rate='.0007', slippage_bps='5'),
        case('source_gross12_is_projected_not_clipped', {'A': '2.4', 'B': '2.4', 'C': '2.4', 'D': '2.4', 'E': '2.4'}),
        case('balanced_source_net_zero', {'A': '.6', 'B': '-.6'}),
        case('long_cash_source_net_is_not_zero', {'A': '.6', 'B': '.6'}),
        case('strict_daily_boundary_equal_no_safe_portfolio', {'A': '.1'}, equity='91.1'),
        case('strict_daily_boundary_above_only_flat_safe', {'A': '.1'}, equity='91.10000000000000000000000000000000001'),
        case('daily_reservation_after_close_cost', {'A': '.5'}, equity='91.2'),
        case('reduction_cost_can_make_all_plans_infeasible', {'A': '0'}, {'A': '2'}, equity='91.1001'),
        case('reference_mark_difference_and_cost_credit', {'A': '.5', 'B': '-.3'}, {'A': '2', 'B': '-1'},
             references={'A': '9.9', 'B': '10.1'}),
        case('net_cashflow_adjusted_day_anchor', {'A': '.5'}, equity='101.2', day_net_cashflow='10'),
        case('gross_cap_exact_equality_retained', {'A': '8'}, {'A': '80'}, fee_rate='0', slippage_bps='0'),
        case('margin_reservation_binding', {'A': '8'}, leverage='2'),
        case('deterministic_symbol_quantity_ties', {'B': '.15', 'A': '.15'}, fee_rate='0', slippage_bps='0'),
        case('opening_ticket_maximum', {'A': '5'}, filters={'A': flt(maximum='3')}),
        case('empty_portfolio', {}, marks={}, filters={}),
    ]
    (DEST / 'projection.json').write_text(json.dumps(cases, indent=2) + '\n')
    assert before == {str(p): digest(p) for p in inputs}
    evidence = dict(status='PURE_SOURCE_AND_STATIC_PROJECTOR_GOLDENS_NO_ACCOUNT_RUN',
        registeredProtocol=str(protocol_path), registeredProtocolSha256=digest(protocol_path),
        inputs=before, sourceRows=128, sourceWeights=5120, selectedStateRows=640,
        sourceFunctionEqualsRegisteredTargetRows=True, projectionFixtures=len(cases),
        sourceFrozenBytesUnchanged=True, accountFinancialRuns=0, networkCalls=0, ordersSent=0,
        generatedFiles={p.name: digest(p) for p in DEST.iterdir() if p.is_file() and p.name != 'receipt.json'})
    (DEST / 'receipt.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))


if __name__ == '__main__':
    main()
