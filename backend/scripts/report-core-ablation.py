#!/usr/bin/env python3
"""Render every frozen result; do not select or tune a winner."""
import json, pathlib, csv, sys
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '../docs/audits/2026-09-21-core-ablation')
s=json.loads((root/'summary.json').read_text()); rows=s['summaries']; splits=[x['id'] for x in s['protocol']['datasets']]
fields=['split','variant','cost','candidates','submitted','fills','trades','wins','losses','netUsd','roiPercent','expectancy','profitFactor','fees','funding','slippage','maxDrawdownPercent']
with (root/'results.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows({k:r.get(k) for k in fields} for r in rows)
lines=['# Kiểm chứng core ablation — 21/09/2026','','Đã implement collector/replay offline và hoàn tất ma trận12 biến thể ×4 giai đoạn ×2 mức chi phí =96 lượt. Không thay runtime/PM2/.env; không đặt lệnh.','','## ROI mô phỏng base / stress (%)','','| Biến thể | 01–06/2023 | 07–12/2024 | 02–06/2025 | 07–09/2025 |','|---|---:|---:|---:|---:|']
for v in s['protocol']['variants']:
 cells=[]
 for split in splits:
  pair=[next(r for r in rows if r['variant']==v and r['split']==split and r['cost']==c) for c in ['base','stress']]
  cells.append(' / '.join(f"{r['roiPercent']:+.2f}" for r in pair))
 lines.append('| '+v+' | '+' | '.join(cells)+' |')
lines+=['','Ví32,2009046 USDT được reset độc lập ở mỗi cửa sổ; không cộng các ROI thành một tài khoản liên tục. Có thanh lý cuối kỳ và đầy đủ chi phí mô phỏng.','','## Số lệnh và nhóm lệnh bổ sung (stress, tổng4 cửa sổ độc lập)','','| Biến thể | Lệnh đóng | Net USDT | Thêm / mất so core | Net nhóm thêm | Delta net so core |','|---|---:|---:|---:|---:|---:|']
for v in s['protocol']['variants']:
 rs=[r for r in rows if r['variant']==v and r['cost']=='stress'];total=lambda key:sum(r[key] for r in rs);cohort=lambda key:sum(r['cohort'][key] for r in rs)
 lines.append(f"| {v} | {total('trades')} | {total('netUsd'):+.4f} | {cohort('added')} / {cohort('removed')} | {cohort('addedNet'):+.4f} | {cohort('delta'):+.4f} |")
lines+=['','## Phạm vi kết luận','','Đây là sàng lọc deterministic core, không phải phát lại đầy đủ bot live. `july_rule_proxy` là xấp xỉ chính sách, không phải bản tháng7 chính xác. TP theo RR là synthetic comparator; chỉ `structural_exit` dùng target cấu trúc. AI cost0 vì không có AI trong thí nghiệm, chưa đại diện phí AI runtime.','','Các cửa sổ đều từng được xem; không có fresh OOS. Không tự promote bất kỳ biến thể nào từ bảng này, kể cả một cửa sổ dương. Kết quả của nhánh range/AI hoặc các cơ hội không thuộc detector hiện hành không thể suy ra từ đây.','','Đọc methodology.md cho hợp đồng fill/SL/TP/funding/min-lot/cooldown và toàn bộ giới hạn. `protocol.json` lưu risk/env không chứa secrets, hash source và datasets trước outcome. `summary.json` và96 file chi tiết giữ đầy đủ block, trades, costs, events và cohort decomposition. `verification.json` lưu kiểm tra ma trận/ledger/latency/prefix.','','## Chạy lại','','```bash','cd /home/ubuntu/chuyen-gia-crypto/backend','npm run research:core-ablation -- --out=../docs/audits/core-ablation-rerun','npx tsx scripts/verify-core-ablation.ts --out=../docs/audits/core-ablation-rerun','python3 scripts/report-core-ablation.py ../docs/audits/core-ablation-rerun','```','','Dùng thư mục mới; runner từ chối ghi đè protocol. Môi trường phải đúng policy của chủ tài khoản. Source hash mới được lưu mỗi lần; không coi source đã sửa là cùng một trial.']
(root/'report.md').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines[:22]))
