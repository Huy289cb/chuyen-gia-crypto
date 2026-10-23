"""Present completed, registered v3 policy replays; never select or change a strategy.

Report generation refuses an incomplete execution before reading case PnL.
Ledger values remain Decimal; bootstrap floats are presentation diagnostics only.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import random
import shutil

D = Decimal
RESEARCH = Path('/home/ubuntu/binance-income-research-2026-10-10')
MODELS = ('trend4h', 'reversion4h')
MODEL_LABELS = {'trend4h': 'Xu hướng 4h', 'reversion4h': 'Hồi phục 4h'}
VERDICT_PASS = 'RETROSPECTIVE_SCREEN_PASS_FOR_PAPER'


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text())


def decimal(value) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise ValueError('missing or invalid numeric report input')
    result = D(str(value))
    if not result.is_finite():
        raise ValueError('nonfinite report input')
    return result


def jdefault(value):
    if isinstance(value, D):
        return str(value)
    raise TypeError(type(value).__name__)


def save_json(path: Path, value):
    path.write_text(json.dumps(value, indent=2, default=jdefault, ensure_ascii=False) + '\n')


def number(value, places=4):
    if value is None:
        return 'unknown'
    return format(decimal(value), f'.{places}f')


def pf_info(result):
    wins = sum((decimal(t['net_pnl']) for t in result['trades'] if decimal(t['net_pnl']) > 0), D(0))
    losses = -sum((decimal(t['net_pnl']) for t in result['trades'] if decimal(t['net_pnl']) < 0), D(0))
    if losses:
        return {'value': wins / losses, 'infinite_no_losses': False, 'gross_wins': wins, 'gross_losses': losses}
    return {'value': None, 'infinite_no_losses': wins > 0, 'gross_wins': wins, 'gross_losses': losses}


def pf_label(result):
    info = pf_info(result)
    return '∞ (0 lệnh lỗ)' if info['infinite_no_losses'] else number(info['value'], 3)


def evaluate_model(base, stress, protocol):
    """Only preregistered economic gates; a sample deficit alone is inconclusive."""
    gates = protocol['gates']
    pf = pf_info(base)
    checks = {
        'base_net_positive': decimal(base['net_pnl']) > 0,
        'base_profit_factor_at_least_1_2': pf['infinite_no_losses'] or
            (pf['value'] is not None and pf['value'] >= decimal(gates['base_profit_factor_min'])),
        'stress_net_nonnegative': decimal(stress['net_pnl']) >= 0,
        'confirmation_base_nonnegative': decimal(base['confirmation_net_pnl']) >= 0,
        'confirmation_stress_nonnegative': decimal(stress['confirmation_net_pnl']) >= 0,
        'base_drawdown_within_cap': decimal(base['max_drawdown']) <= decimal(gates['max_drawdown_USDT']),
        'stress_drawdown_within_cap': decimal(stress['max_drawdown']) <= decimal(gates['max_drawdown_USDT']),
    }
    sample_checks = {
        'base_closed_episodes_at_least_30': base['closed_trades'] >= gates['minimum_closed_episodes'],
        'stress_closed_episodes_at_least_30': stress['closed_trades'] >= gates['minimum_closed_episodes'],
    }
    failed = [key for key, passed in checks.items() if not passed]
    insufficient = [key for key, passed in sample_checks.items() if not passed]
    verdict = 'FAIL' if failed else 'INCONCLUSIVE' if insufficient else VERDICT_PASS
    operational = [name for name, result in (('base', base), ('stress', stress)) if result['open_position_at_end']]
    no_fills = base['entries'] == 0 and stress['entries'] == 0
    return {'verdict': verdict, 'economic_checks': checks, 'sample_checks': sample_checks,
            'failed_economic_gates': failed, 'insufficient_sample_gates': insufficient,
            'measurement_status': 'NO_FILLED_TRADES_FEASIBILITY_FAILURE' if no_fills else 'FILLED_REPLAY_MEASURED',
            'alpha_mechanism_measurement': 'UNMEASURED_NO_FILLS' if no_fills else 'RETROSPECTIVE_ONLY_NO_FORWARD_PROOF',
            'base_profit_factor_measurement': {'value': pf['value'], 'infinite_no_losses': pf['infinite_no_losses'],
                'measured': bool(base['closed_trades'])},
            'main_cases_with_stranded_inventory': operational,
            'automatic_live_activation': False, 'future_profit_proven': False,
            'all_cost_profit_verified': False, 'incremental_vps_cost': None}


def concentration(result):
    ordered = sorted((decimal(t['net_pnl']) for t in result['trades'] if decimal(t['net_pnl']) > 0), reverse=True)
    top = sum(ordered[:3], D(0))
    all_wins = sum(ordered, D(0))
    return {'top_3_winning_trade_cash_pnl': top,
            'top_3_fraction_of_gross_wins': top / all_wins if all_wins else None,
            'arithmetic_net_minus_top_3_winners': decimal(result['net_pnl']) - top,
            'is_counterfactual_replay': False}


def bootstrap(result, *, block_length=7, samples=2000, seed=1729):
    """Circular moving-block resampling of observed Vietnam-day NAV changes.

    Boundary days may be partial; seven-day blocks may understate dependence
    from positions lasting thirty days. No bootstrap number is a verdict gate.
    """
    if result.get('entries') == 0:
        return {'status': 'NOT_APPLICABLE_NO_FILLED_TRADES', 'is_forward_prediction': False, 'is_verdict_gate': False}
    values = [float(decimal(row['net_pnl'])) for row in result['daily']]
    n = len(values)
    if not n:
        return None
    length = min(block_length, n)
    sums = [sum(values[(start + j) % n] for j in range(length)) for start in range(n)]
    full, remaining = divmod(n, length)
    rng = random.Random(seed)
    totals = []
    for _ in range(samples):
        total = sum(sums[rng.randrange(n)] for _ in range(full))
        if remaining:
            start = rng.randrange(n)
            total += sum(values[(start + j) % n] for j in range(remaining))
        totals.append(total)
    totals.sort()
    def quantile(fraction):
        position = fraction * (len(totals) - 1)
        lo, hi = int(position), min(int(position) + 1, len(totals) - 1)
        return totals[lo] + (totals[hi] - totals[lo]) * (position - lo)
    return {'method': 'circular_moving_block_observed_daily_NAV_changes', 'block_days': length,
            'samples': samples, 'seed': seed, 'daily_buckets': n,
            'period_net_pnl_interval_2_5_to_97_5_percent': [quantile(.025), quantile(.975)],
            'resamples_positive_fraction_diagnostic': sum(value > 0 for value in totals) / samples,
            'is_forward_prediction': False, 'is_verdict_gate': False,
            'limitations': 'Partial boundary days; 7-day blocks may miss 30-day holding dependence; VPS unknown.'}


def fee_quote_equivalent(result):
    return sum((decimal(e['base_fee']) * decimal(e['price']) + decimal(e['quote_fee'])
                for e in result['events']), D(0))


def empirical_break_even_win_rate(result):
    """Descriptive rate from measured cash wins/losses; never a forecast."""
    if result['average_win'] is None or result['average_loss'] is None:
        return None
    win, loss = decimal(result['average_win']), abs(decimal(result['average_loss']))
    return loss / (win + loss) if win > 0 and loss > 0 else None


def confirmation_activity(result, protocol):
    cutoff = int(datetime.fromisoformat(protocol['split']['confirmation_start'].replace('Z', '+00:00')).timestamp()) * 1_000_000
    return {'entry_fills': sum(event['side'] == 'BUY' and event['timestamp_us'] >= cutoff
                               and decimal(event['filled_quantity']) > 0 for event in result['events']),
            'closed_episodes': sum(trade['exit_us'] >= cutoff for trade in result['trades'])}


def write_csv(path, rows):
    rows = list(rows)
    fields = list(dict.fromkeys(key for row in rows for key in row))
    if not fields:
        fields = ['case']
    with path.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: (json.dumps(value, ensure_ascii=False, default=jdefault)
                                  if isinstance(value, (list, dict)) else value) for key, value in row.items()})


def validate_inputs(run_dir, protocol_path):
    # This guard is deliberately before opening any case financial artifact.
    execution = read_json(run_dir / 'execution.json')
    if execution.get('status') != 'COMPLETE':
        raise ValueError('execution is not COMPLETE; no final verdict or case PnL is read')
    registration = read_json(run_dir / 'run-registration.json')
    protocol = read_json(protocol_path)
    design = {key: value for key, value in protocol.items() if key != 'design_sha256'}
    if hashlib.sha256(json.dumps(design, sort_keys=True, separators=(',', ':')).encode()).hexdigest() != protocol['design_sha256']:
        raise ValueError('protocol design integrity mismatch')
    for field in ('protocol_sha256', 'data_manifest_sha256', 'source_sha256'):
        if registration.get(field) != execution.get(field):
            raise ValueError('registration and execution identity mismatch: ' + field)
    if sha(protocol_path) != registration['protocol_sha256']:
        raise ValueError('protocol differs from completed registration')
    expected = [model + '_' + case['suffix'] for model in protocol['mechanisms'] for case in protocol['cases']]
    registered = [case['name'] for case in registration['cases']]
    completed = [summary['case']['name'] for summary in execution['summaries']]
    if len(expected) != protocol['run_limits']['main_replays'] or expected != registered or expected != completed:
        raise ValueError('registered protocol cases are not all complete and aligned')
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    split_start = datetime.fromisoformat(protocol['split']['main_start'].replace('Z', '+00:00'))
    split_end = datetime.fromisoformat(protocol['split']['main_end_exclusive'].replace('Z', '+00:00'))
    expected_start_us = int((split_start - epoch).total_seconds()) * 1_000_000
    expected_end_us = int((split_end - epoch).total_seconds()) * 1_000_000
    results = {}
    hashes = {}
    for case, summary in zip(registration['cases'], execution['summaries']):
        name = case['name']
        path = run_dir / (name + '.json')
        result = read_json(path)
        if result['case'] != case:
            raise ValueError('case parameters differ from registration: ' + name)
        if result['start_us'] != expected_start_us or result['end_us_exclusive'] != expected_end_us:
            raise ValueError('case financial period differs from protocol: ' + name)
        for field in ('net_pnl', 'final_executable_nav', 'closed_trades', 'max_drawdown', 'confirmation_net_pnl', 'open_position_at_end'):
            if result[field] != summary[field]:
                raise ValueError('case differs from execution summary: ' + name + ':' + field)
        if decimal(result['initial_cash']) != 15 or decimal(result['final_executable_nav']) - 15 != decimal(result['net_pnl']):
            raise ValueError('capital or net NAV mismatch: ' + name)
        if result['closed_trades'] != len(result['trades']):
            raise ValueError('closed trade count mismatch: ' + name)
        if sum((decimal(row['net_pnl']) for row in result['monthly']), D(0)) != decimal(result['net_pnl']):
            raise ValueError('monthly NAV does not reconcile: ' + name)
        results[name], hashes[name + '.json'] = result, sha(path)
    return protocol, registration, execution, results, hashes


def make_report(run_dir, protocol_path):
    with localcontext() as context:
        context.prec = 50
        protocol, registration, execution, results, input_hashes = validate_inputs(run_dir, protocol_path)
        model_ids = tuple(protocol['mechanisms'])
        model_verdicts = {model: evaluate_model(results[model + '_base'], results[model + '_stress'], protocol) for model in model_ids}
        diagnostics = {name: {'concentration': concentration(result), 'bootstrap': bootstrap(result),
                             'confirmation_activity': confirmation_activity(result, protocol),
                             'fee_quote_equivalent_at_fill_not_additional_deduction': fee_quote_equivalent(result)}
                       for name, result in results.items()}
        overall = (VERDICT_PASS if any(value['verdict'] == VERDICT_PASS for value in model_verdicts.values()) else
                   'INCONCLUSIVE' if any(value['verdict'] == 'INCONCLUSIVE' for value in model_verdicts.values()) else 'FAIL')
        utc_days = (datetime.fromisoformat(protocol['split']['main_end_exclusive'].replace('Z', '+00:00')) -
                    datetime.fromisoformat(protocol['split']['main_start'].replace('Z', '+00:00'))).days
        completed_vn = datetime.fromisoformat(execution['completed_at_utc'].replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=7)))
        admission = protocol['execution']['economic_gate']
        rr_minimum = admission.get('minimum_net_reward_to_stop_loss')
        rr_description = ('không áp netreward/stoploss hardminimum' if rr_minimum is None else
                          f'netreward/stoploss≥{rr_minimum}')
        lines = [f'# Spot v3: policy rủi ro và điều kiện entry mới, vốn 15 USDT — {overall}', '',
                 f'Hoàn thành lúc {completed_vn:%H:%M:%S ICT, %d/%m/%Y}. Kỳ chính **01/01/2024–30/09/2025 UTC**, '
                 f'**21 tháng / {utc_days} ngày**, warmup/development 04–12/2023. Mỗi case bắt đầu bằng 15 USDT và giữ ledger liên tục. '
                 f'{len(model_ids)} mô hình có ví giả lập riêng; không cộng vốn/lợi nhuận của {len(results)} cases. Futures giữ riêng.', '',
                 'Đây là **retrospective cross-period screen**, chọn sau v1 âm ở2026; chưa phải pristine prospectiveOOS hoặc chứng minh lợi nhuận tương lai. '
                 'Các số net dưới đây đã gồm phí/slippage/rounding trong mô phỏng, **chưa xác minh chi phí VPS**. Không có AIcall, liveorder, transfer hoặc sửaFutures.', '',
                 '## Kết quả chính', '',
                 '| Mô hình | Case | NetUSDT | NAV bán được | NAV book | Entry/đóng | PF | DD bán được/book | Confirmation2025 | Buyhold net |',
                 '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
        lines[4:4] = [f"**Policytrial riêng:** `{protocol['protocol_id']}` dùng risk/lệnh `{protocol['capital']['risk_per_trade']}` "
                       f"và dailyheadroom `{protocol['capital']['daily_loss_headroom']}`. "
                       'V2 cap0,50/NAV÷30 giữ nguyên kết quả0fills. V3 đổi riskpolicy và điều kiện admission sau feasibilityprobe, '
                       f'giữ nguyên indicator/episode/stop/trail/TP/hold; admission: {rr_description}, '
                       'neworder-alone profit tại TP/hurdle>0, benefit≥4×roundtripdrag, stop/TP-hurdle sellable. '
                       'setupIDs vẫn thuộc v2 để đối chiếu cùng episode, không tạo alphamechanism mới hoặc holdout mới. '
                       f"Phiên này chạy: {', '.join(MODEL_LABELS[model] for model in model_ids)}.", '']
        if all(result['entries'] == 0 for result in results.values()):
            lines[4:4] = ['**Không có lệnh nào được khớp ở các cases. Đây là thất bại về khả thi entry dưới policy đã khóa; '
                         'chưa đo lợi nhuận, expectancy hoặc PF của cơ chế khi thực sự giao dịch. Cash giữ nguyên không phải edge, '
                         'và FAIL không chứng minh cơ chế vốn có lợi nhuận âm.**', '']
        for model in model_ids:
            for suffix in ('base', 'stress'):
                result = results[model + '_' + suffix]
                lines.append(f"| {MODEL_LABELS[model]} | {suffix} | {number(result['net_pnl'])} | {number(result['final_executable_nav'])} | "
                             f"{number(result['final_book_nav'])} | {result['entries']}/{result['closed_trades']} | {pf_label(result)} | "
                             f"{number(result['max_drawdown'])}/{number(result['book_max_drawdown'])} | {number(result['confirmation_net_pnl'])} | {number(result['buy_hold_net_pnl'])} |")
        lines += ['', 'NAV bán được định giá inventory không bán hợpfilter là0; NAVbook vẫn ghi markvalue. '
                  'DD đo trên NAV trong kỳ; không chỉ cộng closedPnL. Confirmation01–09/2025 là NAVdelta của ledger kế thừa từ2024, không freshwallet15.', '',
                  'Hoạt động trong kỳ xác nhận 01–09/2025:', '']
        for model in model_ids:
            for suffix in ('base', 'stress'):
                name = model + '_' + suffix
                activity = diagnostics[name]['confirmation_activity']
                lines.append(f"- {MODEL_LABELS[model]}/{suffix}: {activity['entry_fills']} lượt mua khớp, "
                             f"{activity['closed_episodes']} episode đóng. " +
                             ('Không có giao dịch trong kỳ; confirmation net bằng 0 không xác nhận hiệu quả sinh lời.'
                              if activity['entry_fills'] == activity['closed_episodes'] == 0 else ''))
        lines += ['', '## Theo tháng — thay đổi NAV bán được / book, USDT', '']
        main_names = [model + '_' + suffix for model in model_ids for suffix in ('base', 'stress')]
        lines += ['| ThángUTC | ' + ' | '.join(name for name in main_names) + ' |',
                  '|---|' + '---:|' * len(main_names)]
        month_maps = {name: {row['month']: row for row in results[name]['monthly']} for name in main_names}
        month_names = sorted({month for mapping in month_maps.values() for month in mapping})
        for month in month_names:
            cells = []
            for name in main_names:
                row = month_maps[name].get(month)
                cells.append(number(row['net_pnl']) + '/' + number(row['book_net_pnl']) if row else 'unknown')
            lines.append('| ' + month + ' | ' + ' | '.join(cells) + ' |')
        lines += ['', 'Monthly vàdaily là NAVdelta có unrealisedmark, không phải tiền lợi nhuận đã rút. '
                  'CSV giữ cả start/end executable vàbookNAV; không resetwallet theo tháng.', '']
        for name in main_names:
            result = results[name]
            months = result['monthly']
            positive = sum(decimal(row['net_pnl']) > 0 for row in months)
            negative = sum(decimal(row['net_pnl']) < 0 for row in months)
            lines.append(f"- {name}: {positive}/{len(months)} tháng NAVtăng, {negative} tháng giảm; "
                         f"bình quân {number(decimal(result['net_pnl']) / D(len(months)))}USDT/tháng và "
                         f"{number(decimal(result['net_pnl']) / D(utc_days), 6)}USDT/ngày trong đúng kỳ này, **không dựbáo kỳ tới**.")
        lines += ['', '## Verdict theo gate đã khóa', '']
        for model, verdict in model_verdicts.items():
            lines.append(f"- **{MODEL_LABELS[model]}: {verdict['verdict']}**. " +
                         ('Không có filledtrade; alpha/expectancy/PF chưa đo. ' if verdict['measurement_status'] == 'NO_FILLED_TRADES_FEASIBILITY_FAILURE' else '') +
                         ('Economicgates không đạt: ' + ', '.join(verdict['failed_economic_gates']) + '. ' if verdict['failed_economic_gates'] else 'Economicgates đạt. ') +
                         ('Sample chưa đủ: ' + ', '.join(verdict['insufficient_sample_gates']) + '.' if verdict['insufficient_sample_gates'] else 'Samplefloor đạt.'))
        lines += ['', 'Gate: base net>0/PF≥1,2; stress net≥0; confirmationbase/stress≥0; DDbase/stress≤3USDT; '
                  'ít nhất30closedepisodes ở **cảbase vàstress**. Economicfail làFAIL; chỉ thiếu sample khi economicgatesđạt làINCONCLUSIVE. '
                  'Nếu pass, chỉ là screenpass để xem xétpaper, chưa tự triển khailive.', '',
                  'PF gate “không đạt” khi0trades nghĩa là chưa có PF để đáp ứng tiêu chí, không phải PF đo được bằng0. '
                  'Các skipreason là hợp của lý do ở nhiều quantity mà planner thử giảm dần; không thể coi từng reason là blocker độc lập '
                  'hoặc kết luận tăngrisk sẽ cứu được tất cảentry chỉ từ reasonlist.', '',
                  '## Chi phí, tần suất và khả thi', '',
                  '| Mô hình/case | Candidates/context | Ngày khôngentry | Phơi nhiễm | Winrate | Avgwin/avgloss | FeeSOL/USDT | Tổngfee quyUSDT tại fill |',
                  '|---|---:|---:|---:|---:|---:|---:|---:|']
        for model in model_ids:
            for suffix in ('base', 'stress'):
                result = results[model + '_' + suffix]
                exposure = decimal(result['minutes_exposed']) / D(utc_days * 1440) * 100
                win_rate = decimal(result['win_rate']) * 100 if result['win_rate'] is not None else None
                lines.append(f"| {MODEL_LABELS[model]}/{suffix} | {result['candidates']}/{result['context_eligible']} | {result['days_without_entry']} | "
                             f"{number(exposure, 2)}% | {number(win_rate, 2)}% | {number(result['average_win'])}/{number(result['average_loss'])} | "
                             f"{number(result['buy_fee_sol'], 8)}/{number(result['sell_fee_usdt'], 8)} | {number(fee_quote_equivalent(result))} |")
        lines += ['', 'Fee quyUSDT là feeSOL×giábuy cộng sellfeeUSDT để so độ lớn, **không trừ lần nữa** khỏi net. '
                  'Ngày theo ViệtNam, có hai boundaryday không đủ24h. Exposure tính minutes cóposition/639ngày. '
                  'AIactual=0 do offline/rules-only; các sensitivities−0,10/−0,25/−0,50USDT chỉ là giả định kinh tế, không receiptprovider.', '']
        for model in model_ids:
            for suffix in ('base', 'stress'):
                result = results[model + '_' + suffix]
                required = empirical_break_even_win_rate(result)
                lines.append(f"- {MODEL_LABELS[model]}/{suffix}: winrate hòa vốn suy từ avgwin/avgloss đã đo "
                             f"{number(required * 100 if required is not None else None, 2)}%; "
                             'chỉ là mô tả phân phối realisedcashPnL, không p(win) của tín hiệu sau này.')
        for model in model_ids:
            for suffix in ('base', 'stress'):
                result = results[model + '_' + suffix]
                top_skips = sorted(result['skips'].items(), key=lambda pair: (-pair[1], pair[0]))[:8]
                lines.append(f"- {MODEL_LABELS[model]}/{suffix}, skips nổi bật: " + '; '.join(f'{reason}={count}' for reason, count in top_skips) + '.')
        sensitivity_names = [name for name in results if name.endswith(('minimum10_stress', 'partial50_stress'))]
        if sensitivity_names:
            lines += ['', '## Stress về minimum và partialfill', '',
                      '| Mô hình | Case | NetUSDT | NAVexe/book | Entry/đóng | Cònposition | Coin cònSOL |',
                      '|---|---|---:|---:|---:|---|---:|']
            for name in sensitivity_names:
                result = results[name]
                model = result['case']['model_id']
                suffix = name[len(model) + 1:]
                lines.append(f"| {MODEL_LABELS[model]} | {suffix} | {number(result['net_pnl'])} | {number(result['final_executable_nav'])}/{number(result['final_book_nav'])} | "
                             f"{result['entries']}/{result['closed_trades']} | {'có' if result['open_position_at_end'] else 'không'} | {number(result['final_inventory_sol'], 8)} |")
        else:
            lines += ['', 'V3 chỉ chạy base/stress đã đăng ký; chưa chạy minNotional10 hoặc partial50% theo policy mới. '
                      'Không kế thừa các sensitivityv2 zero-fill như bằng chứng vận hành v3.']
        lines += ['', 'Partial hoặc exitblocked/stranded là giới hạn vận hành phải xử lý trước paper/live; NAVbook không thay tiền có thể bán.', '',
                  '## Concentration và bootstrap — diagnostics', '',
                  '| Mô hình/case | Top3winnercashPnL | Tỷ trọng grosswins | Net−3winner (số học) | Bootstrap intervalnet2,5–97,5% |',
                  '|---|---:|---:|---:|---:|']
        for model in model_ids:
            for suffix in ('base', 'stress'):
                name = model + '_' + suffix
                info = diagnostics[name]
                conc, boot = info['concentration'], info['bootstrap']
                fraction = conc['top_3_fraction_of_gross_wins']
                interval = boot.get('period_net_pnl_interval_2_5_to_97_5_percent')
                lines.append(f"| {MODEL_LABELS[model]}/{suffix} | {number(conc['top_3_winning_trade_cash_pnl'])} | "
                             f"{number(fraction * 100 if fraction is not None else None, 2)}% | {number(conc['arithmetic_net_minus_top_3_winners'])} | "
                             + (f"[{interval[0]:.4f}, {interval[1]:.4f}] |" if interval is not None else 'không đo:0filledtrades |'))
        lines += ['', 'Net−3winner chỉ là phép trừcashPnL, **không replay bỏlệnh**: cash/sizing/dust các lần sau sẽ khác. '
                  'Bootstrap circularblock7ngày/2.000resamples/seed1729 trên dailyNAVchanges, chỉ mô tả uncertaintyhồi cứu; '
                  'không là p(win), dự báokỳ tới hoặc verdictgate. Block7ngày có thể chưa bao hết phụ thuộc từ hold30ngày, có boundaryday partial.', '',
                  '## Quy tắc được kiểm', '',
                  'Xu hướng4h mua ở jointSOL/BTC SMA20>SMA60, một attempt/episode; stop2ATR14, trailing chỉ tăng, regimeoff/30ngàyexit. '
                  '**Không fixedTP**. Giáhurdlesignal+4ATR chỉ kiểm khoảng payoff/chi phí, không biết xác suất sẽ chạm. '
                  'Hồi phục4h mua excursionclose dưới mean20priorcloses−2populationSD với BTCclose≥SMA60; '
                  'targetmean cố định, stop2ATR14,48hexit; rejectedcontext vẫnconsumeexcursion.', '',
                  'Entry/regimeexitdelaybase30s,stress120s; stopgap bất lợi, same1mstop&TP chọnstopfirst. '
                  'Trailing áp ở minuteopen đầu tiên sau closed4h, trước currentminutehigh/low, không scenarioentrydelay. '
                  'Đó là giả định amendmentlatency0 ở minute resolution, chưa đo live. '
                  f'Costgate neworder-alone {rr_description}, soloTP/hurdleprofit>0 và hurdlebenefit≥4×flatroundtripdrag; '
                  'chỉ là algebraicpayoffscreen, **không modelconfidence/pwin/EV evidence**. '
                  'Bỏ hardRRgate không bảo đảm cóedge: reversion có thể thắng nhiều nhưng avgprofit quá nhỏ so avgstoploss; '
                  'trend4ATR là diagnosticprice, không phải giới hạn phầnlời thực tế hoặc dựbáo sẽchạm.', '',
                  '## Benchmark và giới hạn bằng chứng', '']
        for name, result in results.items():
            receipts_valid = all(receipt.get('eligible') is True for receipt in result['buy_hold_receipts'])
            lines.append(f"- {name}: buyhold receipts {'đủ BUY/SELL hợp lệ' if receipts_valid else 'có receipt không hợp lệ; không coi là realisedbuyhold đầy đủ'}; "
                         f"main cuối cash={number(result['final_cash'])}, inventory={number(result['final_inventory_sol'], 8)}SOL.")
        lines += ['', 'Buyhold dùng tối đa12USDT mua và giữ3cash, cùng fees/slip/conditionalminimum, không so với full15exposure. '
                  'Buyhold không có stop/dailybudget như activepolicy; đây là baseline thụ động cùngcapital/cost, không matchedriskcounterfactual. '
                  'Historicalfee/filterprovenance chưa đầy đủ; scenario fee0,1%/phía, slipbase0,1%/stress0,3% mỗi phía. '
                  'Referenceproxy là5completedminuteWAP, không reconstructionexact exchangehistory. '
                  'Chi phí VPSincremental/fullallocated đềuunknown; không gọi net bảng trên là profit sau mọi chi phí. '
                  'Không có evidence đảm bảo1–3USDT/ngày; không dùng LLM biết dữ liệulịch sử để cứu các lệnh thua.', '',
                  '## Nguồn và tái lập', '',
                  '[Liu–Tsyvinski/NBER](https://www.nber.org/papers/w24877) hỗ trợ nghiên cứu momentum ở samplecrypto cũ; '
                  '[Corbet–Katsiampa](https://shura.shu.ac.uk/23470/1/Asymmetric_Mean_Reversion_of_Bitcoin_Price_Returns.pdf) nghiên cứu asymmetricmeanreversionBTC. '
                  'Hai paper không xác nhận bộruleSOL15USDT này. '
                  '[Grobys và cộng sự2025](https://link.springer.com/article/10.1007/s11408-025-00474-9) cho thấy momentumrisk/payoff phụ thuộc cách xây dựng danh mục.', '',
                  '[BinancePublicData](https://github.com/binance/binance-public-data), '
                  '[Filters](https://developers.binance.com/en/docs/products/spot/filters), '
                  '[CommissionFAQ](https://developers.binance.com/en/docs/products/spot/faqs/commission_faq). '
                  'Protocol đã sửa coverage development trướcPnL vì2023Feb/Mar cógaps; strategy/main2024→09/2025 không đổi.', '',
                  f"Core/protocol/data identities: [registration]({run_dir / 'run-registration.json'}), [execution]({run_dir / 'execution.json'}), [verdict]({run_dir / 'verdict.json'}). "
                  f"Replaywall={number(execution['wall_seconds'], 2)}s; peakmemory={number(D(execution['peak_memory_kib']) / D(1024), 2)}MiB.", '',
                  f'ReporterSHA256: `{sha(Path(__file__))}`. Copy nguồn trình bày: [reporter-source.py]({run_dir / "reporter-source.py"}). '
                  f'CSV: [summary]({run_dir / "summary.csv"}), [monthly]({run_dir / "monthly.csv"}), [daily]({run_dir / "daily.csv"}), '
                  f'[trades]({run_dir / "trades.csv"}), [decisions]({run_dir / "decisions.csv"}), [receipts]({run_dir / "receipts.csv"}).', '']
        (run_dir / 'report.md').write_text('\n'.join(lines))
        summary_rows = []
        for name, result in results.items():
            summary_rows.append({key: result.get(key) for key in ('net_pnl', 'final_executable_nav', 'final_book_nav', 'final_cash',
                'final_inventory_sol', 'entries', 'closed_trades', 'win_rate', 'profit_factor', 'max_drawdown', 'book_max_drawdown',
                'confirmation_net_pnl', 'candidates', 'context_eligible', 'minutes_exposed', 'days_without_entry', 'buy_fee_sol',
                'sell_fee_usdt', 'buy_hold_net_pnl', 'open_position_at_end')} | {'case': name, 'model_id': result['case']['model_id'],
                'average_daily_NAV_change_over_UTC_period': decimal(result['net_pnl']) / D(utc_days),
                'confirmation_entry_fills': diagnostics[name]['confirmation_activity']['entry_fills'],
                'confirmation_closed_episodes': diagnostics[name]['confirmation_activity']['closed_episodes'],
                'empirical_break_even_win_rate_not_prediction': empirical_break_even_win_rate(result)})
        write_csv(run_dir / 'summary.csv', summary_rows)
        for file_name, key in (('monthly', 'monthly'), ('daily', 'daily'), ('trades', 'trades'), ('decisions', 'decisions'), ('receipts', 'events')):
            write_csv(run_dir / (file_name + '.csv'), ({'case': name, 'model_id': result['case']['model_id'], **row}
                       for name, result in results.items() for row in result[key]))
        shutil.copyfile(Path(__file__), run_dir / 'reporter-source.py')
        generated_hashes = {name: sha(run_dir / name) for name in ('report.md', 'summary.csv', 'monthly.csv', 'daily.csv',
                             'trades.csv', 'decisions.csv', 'receipts.csv', 'reporter-source.py')}
        verdict = {'status': overall, 'report_created_at_utc': datetime.now(timezone.utc).isoformat(),
                   'period_days_UTC': utc_days, 'initial_cash_each_case': '15', 'models': model_verdicts,
                   'policy_id': protocol['protocol_id'], 'risk_per_trade': protocol['capital']['risk_per_trade'],
                   'entry_admission_policy': admission,
                   'setup_id_rule_namespace': 'spot-two-new-mechanisms-v2',
                   'new_alpha_mechanisms': False, 'new_holdout_data': False,
                   'diagnostics': diagnostics, 'reporter_sha256': sha(Path(__file__)),
                   'registered_protocol_sha256': registration['protocol_sha256'],
                   'input_case_sha256': input_hashes, 'generated_artifact_sha256': generated_hashes,
                   'execution_sha256': sha(run_dir / 'execution.json'),
                   'registration_sha256': sha(run_dir / 'run-registration.json'),
                   'interpretation': protocol['split']['interpretation'], 'automatic_live_activation': False,
                   'paid_model_calls': 0, 'live_orders': 0, 'incremental_vps_cost': None,
                   'all_cost_profit_verified': False}
        save_json(run_dir / 'verdict.json', verdict)
        return verdict


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, default=RESEARCH / 'backtest-run-v3')
    parser.add_argument('--protocol', type=Path, default=RESEARCH / 'spot-aggressive-mechanisms-protocol.json')
    args = parser.parse_args()
    try:
        result = make_report(args.run_dir, args.protocol)
    except (ValueError, KeyError, FileNotFoundError) as exc:
        raise SystemExit('Report refused; no valid final assessment: ' + str(exc)) from exc
    print(json.dumps({'status': result['status'], 'models': {model: value['verdict'] for model, value in result['models'].items()},
                      'report': str(args.run_dir / 'report.md')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
