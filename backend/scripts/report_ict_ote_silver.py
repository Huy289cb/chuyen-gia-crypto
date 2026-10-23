from pathlib import Path
import json,csv
p=Path(__file__).resolve().parents[2]/'docs/audits/2026-09-20-ict-ote-silver'
s=json.loads((p/'summary.json').read_text()); rows=s['summaries'];v=json.loads((p/'verification.json').read_text())
with (p/'results.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=['split','variant','cost','candidates','trades','wins','roiEquityPercent','profitFactor','netCashUsd']);w.writeheader();w.writerows({k:r[k] for k in w.fieldnames} for r in rows)
eligible=[]
for variant in ['ote_cost_h1','silver_cost_h1']:
 rs=[r for r in rows if r['variant']==variant]
 if all(r['roiEquityPercent']>0 and not r['open'] for r in rs if r['split']!='validation') and all(sum(r['trades'] for r in rs if r['cost']==c)>=50 for c in ['base','stress']):eligible.append(variant)
report=['# ICT OTE / Silver Bullet: tìm lợi thế ROI+','', '**Kết luận: chưa tìm thấy phương pháp ROI+ đủ điều kiện kiểm chứng độc lập hoặc triển khai.**','',
'Thử nghiệm mới gồm OTE M15 và Silver Bullet M5, so sánh continuation cũ trên cùng dữ liệu và cùng sổ vốn. Quy tắc đã ghi trong protocol trước khi chạy; không tối ưu lại tham số sau kết quả. Đây là các mô hình được lượng hóa cho dự án, không phải bản sao đầy đủ phương pháp giao dịch tùy nghi của ICT.', '',
'Nguồn khái niệm: [ICT OTE Primer](https://www.youtube.com/watch?v=Cg0-CFJOJvg), [ICT Silver Bullet](https://www.youtube.com/watch?v=tRq1hyGGtl4). Công cụ đọc web xác nhận trang/tên video, không lấy được toàn bộ transcript. Vì vậy các thông số bên dưới là giả thuyết nghiên cứu của dự án, không khẳng định trích nguyên quy tắc video hay nguồn chứng minh BTC có lãi.', '',
'## Quy tắc cố định', '',
'- OTE: H1 cho phép hướng; M15 phá swing đã xác nhận, thân nến ≥ ATR14 trước đó. Đóng băng nhịp từ swing đối diện đến cực trị nến BOS; vào hồi 70,5%. SL ngoài gốc nhịp hoặc sàn 0,8%, lấy mức xa hơn. TP cực trị nhịp, bị chặn bởi swing chưa bị quét nằm gần hơn.',
'- Silver: BOS/displacement M5, FVG ba nến đã đóng, vào midpoint, H1 đồng hướng. Chỉ xác nhận và khớp lệnh 10:00–10:59 New York ngày thường, có DST. TP swing chưa bị quét gần nhất M5/H1/H4. Đây chỉ là biến thể NY AM.',
'- BTC, vốn đầu mỗi giai đoạn 32,2009046 USDT; rủi ro tối đa 3% gồm dự phòng, ngày 10%, cooldown 1h, target sizing 0,5%, exposure 100 USDT, SL tối thiểu 0,8%. Không tăng vốn hoặc nới guard để ép ROI dương.',
'- Phí 0,05% mỗi chiều; slippage khứ hồi 0,1% cơ sở / 0,2% stress; funding lịch sử có dấu. Cổng TP trừ chi phí stress nhưng không dự báo funding; quyết định không gọi AI nên AI cost bằng 0.',
'- Phát lệnh sau xác nhận, trễ tối thiểu 1 phút, xuyên giá 0,1 USD mới khớp, TTL 1h; stop-first khi mơ hồ trong phút. Không mô phỏng queue/partial fill hoặc đầy đủ bot live. Tag timeframe 15m trong plan là adapter sổ vốn; Silver thực sự phát hiện trên M5.', '',
'## Kết quả ROI equity (%)', '', '| Giai đoạn | Mô hình | Lệnh base / stress | ROI base | ROI stress |','|---|---|---:|---:|---:|']
for split in s['protocol']['splits']:
 for variant in s['protocol']['variants']:
  a,b=[next(r for r in rows if r['split']==split and r['variant']==variant and r['cost']==c) for c in ['base','stress']]
  report.append(f"| {split} | {variant} | {a['trades']} / {b['trades']} | {a['roiEquityPercent']:+.2f}% | {b['roiEquityPercent']:+.2f}% |")
report+=['','Không gộp ROI các ví khởi tạo lại thành lợi nhuận tài khoản liên tục. Số lệnh giữa base và stress có thể khác do vốn/circuit thay đổi. Không coi stress ít âm hơn là chi phí cao hơn có lợi.', '',
'## Đánh giá và kiểm chứng','',
'OTE cải thiện tỷ lệ giá vào về mặt hình học nhưng mất nhiều cơ hội khớp vì mục tiêu đã chạm trước khi giá hồi về entry; giá vào đẹp không đồng nghĩa expectancy dương. Silver giới hạn phiên giúp mô hình cụ thể hơn nhưng không tạo ra lợi thế ròng trong mẫu này. Không bỏ circuit expectancy hoặc bỏ chi phí để tạo một backtest có lãi.',
'','Cả bốn giai đoạn đều đã được xem trong nghiên cứu trước: chỉ là development/revalidation, không phải OOS chưa đụng tới. Q3/2025 không khớp được không chứng minh không có edge giá; min lot BTC/exposure/risk với ví nhỏ là hạn chế thực tế. Holdout Q4/2025 chưa mở vì không có ứng viên đạt điều kiện đã định.', '',
'Điều kiện sàng lọc đã ghi trước kết quả: dương base và stress trong cả ba cửa sổ còn khả năng giao dịch, ít nhất 50 lệnh đóng cộng lại mỗi cost, không vị thế mở cuối kỳ. Ngay cả đạt điều kiện này vẫn cần kiểm chứng độc lập và parity trước live. Ứng viên đạt: '+str(eligible)+'.', '',
'Xác minh: '+str(v['scenarios'])+' kịch bản; '+str(v['baselineChecks'])+' so sánh continuation khớp hoàn toàn kết quả cũ; '+str(v['fillChecks'])+' kiểm tra fill, '+str(v['riskChecks'])+' kiểm tra cap 3%, '+str(v['costChecks'])+' kiểm tra kinh tế TP. Prefix invariance: 12 kiểm tra mỗi tập dữ liệu, tổng 48, bao gồm H1, continuation, OTE và Silver. Unit tests và typecheck lưu riêng.', '',
'## Hướng nghiên cứu tiếp theo','',
'Ưu tiên giả thuyết Daily Liquidity Sweep → MSS → retest theo mục tiêu thanh khoản ngày trước, nhằm có biên độ mục tiêu đủ lớn so với SL và chi phí. Chưa implement/backtest trong vòng này và chưa có bằng chứng ROI+. Không tiếp tục quét hàng loạt mức Fibonacci/giờ phiên trên các cửa sổ này rồi gọi kết quả tốt nhất là kiểm chứng.', '',
'Runtime và cấu hình giao dịch không thay đổi. Dùng protocol.json, summary.json, verification.json, results.csv và các event ledger để tái lập. Chạy từ backend: `npx tsx scripts/backtest-ict-ote-silver.ts` rồi `npx tsx scripts/verify-ict-ote-silver.ts`.']
(p/'report.md').write_text('\n'.join(report)+'\n')
print(json.dumps({'eligible':eligible,'rows':[{k:r[k] for k in ['split','variant','cost','trades','roiEquityPercent']} for r in rows]},indent=2))
