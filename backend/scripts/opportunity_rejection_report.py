"""Explain observed first-rejection counters without treating scans as trades or causal ablations."""
import argparse, hashlib, json
from pathlib import Path

GROUPS = {
    'no_target_bound': 'target_room', 'structural_bounds': 'target_room',
    'quantity_or_exposure': 'quantity_or_exposure', 'risk_budget': 'risk_budget',
    'funding': 'funding', 'accepted': 'accepted',
}

def summarize(summary):
    diagnostics = summary.get('candidateDiagnostics')
    if diagnostics is None:
        return {'available': False, 'reason': 'Artifact has no candidate diagnostics; no causes inferred.'}
    for value in diagnostics.values():
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError('invalid diagnostic count')
    setups = {}
    for key, value in diagnostics.items():
        if ':' not in key: continue
        setup, reason = key.split(':', 1)
        row = setups.setdefault(setup, {'candidates': 0, 'groups': {}, 'rawReasons': {}})
        if reason == 'candidate': row['candidates'] += value; continue
        row['rawReasons'][reason] = value
        group = GROUPS.get(reason, 'other')
        row['groups'][group] = row['groups'].get(group, 0) + value
    for row in setups.values():
        if sum(row['groups'].values()) != row['candidates']:
            raise ValueError('candidate outcomes do not reconcile')
        row['percentOfCandidates'] = {k: 100*v/row['candidates'] if row['candidates'] else None for k,v in row['groups'].items()}
        rejected = {k:v for k,v in row['groups'].items() if k != 'accepted'}
        row['largestObservedRejection'] = max(rejected, key=rejected.get) if rejected and max(rejected.values()) else None
    snapshots = diagnostics.get('snapshots', 0)
    no_setup = diagnostics.get('no_confirmed_setup', 0)
    if no_setup > snapshots: raise ValueError('invalid snapshot denominator')
    return {'available': True, 'snapshotsEvaluated': snapshots, 'noSetupSnapshots': no_setup,
            'noSetupPercent': 100*no_setup/snapshots if snapshots else None,
            'setups': setups, 'runtimeCounters': summary.get('blocks', {}),
            'trades': summary.get('trades'), 'roiPercent': summary.get('roiEquityPercent')}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2]/'docs/audits/2026-09-11-opportunity-testbed')
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[2]/'docs/audits/2026-09-14-rejection-analysis')
    args=parser.parse_args(); reports=[]
    for folder in [args.root, args.root/'validation', args.root/'supplemental-2024', args.root/'independent-2023']:
        for path in sorted(folder.glob('*portfolio-*.json')):
            raw=path.read_bytes(); run=json.loads(raw)
            if 'summary' not in run or 'events' not in run: continue
            s=run['summary']
            reports.append({'artifact':str(path), 'sha256':hashlib.sha256(raw).hexdigest(),
                'split':s.get('split','train'), 'setup':s['setup'], 'cost':s['cost'],
                'initialWallet':s.get('initialWallet',33.59964603), 'diagnosis':summarize(s)})
    if not reports: raise ValueError('no replay artifacts found')
    args.out.mkdir(parents=True,exist_ok=True)
    limitations=['Counts describe the first observed rejection in guard order, not all simultaneous blockers.',
        'quantity_or_exposure cannot be split into lot, minimum notional and exposure causes from existing counters.',
        'Snapshots, candidate occurrences, accepted plans and closed trades have different denominators.',
        'Occupied/cooldown/quota scans skip candidate generation; this is not an unconditional market-signal census.',
        'Base/stress paths and alternative strategies overlap: do not pool them as independent observations.',
        'Historical files without diagnostics are reported unavailable, not zero.',
        'Removing a guard does not imply profitable or safe trades. No risk changes or new hypothesis selection made.']
    (args.out/'report.json').write_text(json.dumps({'runs':reports,'limitations':limitations},indent=2)+'\n')
    lines=['# Phân tích nguyên nhân ít lệnh','','Bảng dưới dùng từng kịch bản base riêng biệt. JSON giữ cả stress để đối chiếu; không cộng các kịch bản thành một mẫu độc lập.','','| Dữ liệu / tín hiệu | Ví ban đầu | Snapshot không setup | Ứng viên | Thiếu vùng TP | Lượng/exposure | Rủi ro | Hợp lệ | Lệnh đóng |','|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r in reports:
        d=r['diagnosis']
        if r['cost']!='base' or not d['available']: continue
        # A combined replay may generate multiple families; retain each family's denominator.
        for setup,s in d['setups'].items():
            g=s['groups']; n=d['noSetupPercent']
            lines.append(f"| {r['split']} / {r['setup']} / {setup} | {r['initialWallet']:.4f} | {n:.2f}% | {s['candidates']} | {g.get('target_room',0)} | {g.get('quantity_or_exposure',0)} | {g.get('risk_budget',0)} | {g.get('accepted',0)} | {d['trades']}* |")
    lines += ['','*Số lệnh đóng thuộc toàn kịch bản, không phân bổ lại cho từng nhóm tín hiệu. Tỷ lệ không setup chỉ tính trên snapshot đã được bộ tạo tín hiệu xử lý.','','## Giới hạn diễn giải','']+['- '+x for x in limitations]
    lines += ['','## Bước tiếp theo được bằng chứng hỗ trợ','','Đối chiếu nguyên nhân trong từng giai đoạn. Nếu lượng/exposure chiếm ưu thế, cần ghi thêm dữ liệu lượng tối thiểu, notional và trần exposure tại thời điểm loại trước khi kết luận do vốn. Nếu thiếu vùng TP chiếm ưu thế, nghiên cứu khả năng giá đi đủ xa sau tín hiệu trước khi tạo giả thuyết mới. Không nới SL/RR hoặc tăng vốn chỉ để tăng số lệnh. AI chọn lệnh chỉ có thể được đo khi có đủ kế hoạch hợp lệ.']
    (args.out/'report.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'runs':len(reports),'withDiagnostics':sum(r['diagnosis']['available'] for r in reports),'output':str(args.out)}))
if __name__=='__main__': main()
