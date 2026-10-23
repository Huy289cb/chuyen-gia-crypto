#!/usr/bin/env python3
"""Summarize a completed, audited64-day replay; no strategy rerun or tuning."""
import argparse
import json
from decimal import Decimal as D, getcontext
from pathlib import Path

getcontext().prec = 50
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--package-dir', required=True, type=Path)
args = parser.parse_args()
package = args.package_dir.resolve()
report = json.loads((package / 'outputs/report.json').read_text())
audit = json.loads((package / 'receipts/independent-ledger-64d-audit.json').read_text())
assert report['calendarDays'] == 64 and audit['status'] == 'PASS'
assert {case['case'] for case in audit['cases']} == {'base', 'stress'}
results = {}
for name, case in report['cases'].items():
    summary = case['summary']
    days = json.loads((package / 'outputs' / name / 'days.json').read_text())
    assert len(days) == 64 and summary['calendarDays'] == 64
    net = D(summary['netPnl'])
    assert abs(D(summary['meanNetPerCalendarDay']) - net / D(64)) < D('1e-12')
    peak = D(100)
    maximum_drawdown_usd, maximum_drawdown_fraction = D(0), D(0)
    for line in (package / 'outputs' / name / 'frames.ndjson').open():
        equity = D(json.loads(line)['equity'])
        peak = max(peak, equity)
        maximum_drawdown_usd = max(maximum_drawdown_usd, peak - equity)
        maximum_drawdown_fraction = max(maximum_drawdown_fraction, (peak - equity) / peak)
    day_nets = [D(day['netPnl']) for day in days]
    assert abs(sum(day_nets, D(0)) - net) < D('1e-12')
    results[name] = {
        'netPnl': str(net), 'meanNetPerCalendarDay': str(net / D(64)),
        'terminalCash': summary['equity'], 'totalFees': summary['totalFees'],
        'slippageEmbeddedInRealizedPnl': summary['totalSlippage'],
        'fundingPnl': summary['fundingPnl'], 'realizedPnl': summary['realizedPnl'],
        'positiveMean': net > 0, 'meets0_2UsdtPerDay': net >= D('12.8'),
        'meets1UsdtPerDay': net >= D(64),
        'daysPositive': sum(value > 0 for value in day_nets),
        'daysNegative': sum(value < 0 for value in day_nets),
        'daysZero': sum(value == 0 for value in day_nets),
        'first50DayNetContinuousWallet': str(sum(day_nets[:50], D(0))),
        'last14DayNetContinuousWallet': str(sum(day_nets[50:], D(0))),
        'worstModeledDayNetPnl': summary['worstDayNetPnl'],
        'dailyBudgetBreachMaxUsd': summary['maxDailyBreachUsd'],
        'daysRiskLatched': sum(day['riskLatched'] for day in days),
        'max5mCloseEquityDrawdownUsd': str(maximum_drawdown_usd),
        'max5mCloseEquityDrawdownFraction': str(maximum_drawdown_fraction),
        'fillCount': summary['fillCount'], 'rejectedCount': summary['rejectedCount'],
        'meanTrackingErrorFractionOfSourceGross': case['metrics']['meanTrackingErrorWeight'] / 2,
        'fundingMarkFallbacks': case['metrics']['fundingMarkFallbacks'],
    }
positive_both = all(case['positiveMean'] for case in results.values())
no_modeled_breach = all(D(case['dailyBudgetBreachMaxUsd']) == 0 for case in results.values())
verdict = {
    'status': 'COMPLETE_AUDITED_64_DAY_TEST', 'calendarDays': 64,
    'period': {'startTimeMs': report['startTimeMs'], 'endTimeMs': report['endTimeMs'], 'timezone': 'Asia/Ho_Chi_Minh'},
    'sourceProtocolSha256': report['protocolSha256'], 'cases': results,
    'positiveMeanBothCostCases': positive_both,
    'noModeledFixed10DailyBreach': no_modeled_breach,
    'eligibleForApplicationProposal': positive_both and no_modeled_breach,
    'meets0_2BothCases': all(case['meets0_2UsdtPerDay'] for case in results.values()),
    'meetsOriginal1BothCases': all(case['meets1UsdtPerDay'] for case in results.values()),
    'financialMeaning': 'Full64-day retrospective exchange-model net divided by all64calendar days; no claim of future/live expected income.',
    'operationalLimitations': report['limitations'], 'realOrdersPlacedByThisExperiment': 0,
    'externalCost': {'paidAi': '0', 'incrementalInfrastructureUsdt': 'not_measured'},
}
with (package / 'verdict.json').open('x') as output:
    output.write(json.dumps(verdict, indent=2) + '\n')
print(json.dumps(verdict, indent=2))
