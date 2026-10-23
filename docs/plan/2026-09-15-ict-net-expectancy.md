# Cơ hội ICT/Smart Money với mục tiêu ROI ròng dương

Ngày 15/09/2026. Đây là kết quả tìm nguồn và đề xuất nghiên cứu; chưa có chiến lược mới đạt ROI+, không thay runtime trong lượt này.

## Quyết định mới của người dùng

Không bắt buộc RR3. Chọn chiến lược theo expectancy và ROI ròng, khả năng khớp và rủi ro danh mục. RR là đặc trưng đo lường, không phải bằng chứng lợi thế. Không có ngưỡng RR mới nào được tuyên bố tối ưu. SL floor và giới hạn tài khoản giữ nguyên để tách tác động của RR; nghiên cứu SL khác, nếu có, là thay đổi riêng.

Với lệnh chỉ có hai kết quả, lãi gộp bR khi thắng, lỗ R khi thua và chi phí trung bình cR mỗi lệnh: E/R = p*b − (1−p) − c; p hòa vốn = (1+c)/(1+b). Đây là minh họa, không thay replay thực thi với partial exits, funding và slippage biến thiên.

| RR gộp b | Hòa vốn trước chi phí | Nếu tổng chi phí giả định = 0,10R/lệnh |
|---|---:|---:|
| 1,0 | 50,0% | 55,0% |
| 1,5 | 40,0% | 44,0% |
| 2,0 | 33,3% | 36,7% |
| 3,0 | 25,0% | 27,5% |

Không lấy win rate do AI tự ước lượng để vượt ngưỡng này. Nếu average win/loss đã là net thì không trừ chi phí lần hai. ROI tài khoản phải dùng ledger có equity, vốn nạp/rút, vị thế chưa đóng; không dùng trung bình RR thay ROI.

## Cơ hội ưu tiên

| Thứ tự | Mô hình cần nghiên cứu | Cơ hội bổ sung | Bằng chứng bắt buộc và giới hạn |
|---|---|---|---|
| 1 | Liquidity sweep → displacement/MSS → hồi FVG | Đợi entry tốt hơn sau quét đỉnh/đáy, có thể đạt lợi nhuận kỳ vọng dương ở RR<3 | Mức bị quét đã biết trước; close reclaim; phá swing nội bộ đã xác nhận; FVG sinh sau nến thứ ba đóng; chỉ xét lần hồi hợp lệ sau xác nhận |
| 2 | Tiếp diễn theo H4/H1 → hồi OB hoặc FVG | Bắt pullback của xu hướng thay vì đuổi breakout | Hướng HTF chưa mất hiệu lực; OB có quy tắc xác định nến gốc/impulse/BOS; không đồng nhất OB với lệnh tổ chức đã quan sát |
| 3 | Failed breakout → trở lại range | Mục tiêu gần ở giữa/biên đối diện range có thể phù hợp RR thấp hơn | Phải xét cản gần, range còn hiệu lực, fill và chi phí; so trùng với nhánh range hiện có để không đếm thành cơ hội mới |
| Sau | Silver Bullet; breaker/inversion FVG | Phân đoạn thời gian hoặc nhánh tiếp diễn/đảo vùng riêng | Chưa có bằng chứng BTC; không ghép vào vòng đầu. Session dùng America/New_York và DST, không hardcode EST/giờ Việt Nam quanh năm |

Fibonacci OTE 62–79% được xem là vùng hồi đề xuất để mô tả/đánh giá riêng, không thêm thành điều kiện bắt buộc cùng mọi nhãn khác. Anchor phải đóng băng khi impulse xác nhận. EQH/EQL là cụm swing với dung sai và khoảng cách thời gian định trước; lưu swept/unswept. OB, FVG, EQH/EQL cùng vùng không phải ba bằng chứng độc lập. Volume Profile chưa có dữ liệu volume-at-price trong pipeline đã kiểm tra; không thay bằng volume tổng rồi gọi là profile.

## Quy tắc ứng viên vòng đầu — đề xuất trước đánh giá

Chỉ chọn nhánh sweep→MSS→FVG cho vòng đầu; các nhánh khác là backlog, chưa chạy hàng loạt để chọn đường đẹp.

- H4/H1 mô tả bối cảnh và mức mất hiệu lực; hướng xung đột là trạng thái riêng. Không dùng bias pivot cũ sau khi swing bảo vệ đã bị phá để ép hướng.
- M15, pivot strength2: chỉ có thể dùng swing sau hai nến bên phải đóng. Level sweep và swing MSS lưu ID, thời điểm được biết; không chọn lại sau kết quả.
- Một định nghĩa máy đề xuất: wick vượt pivot M15 rồi close trở lại phía trong; trong tối đa4 nến sau có close phá swing nội bộ ngược hướng đã biết tại sweep. Nến displacement có body≥1 ATR14 tính từ nến trước nó; đây là tham số nghiên cứu của dự án, không tuyên bố quy tắc ICT duy nhất.
- FVG ba nến cùng hướng displacement, biết sau nến thứ ba đóng. Ghi biên gap, phần đã chạm/lấp và invalidation. Chỉ xét entry midpoint của FVG đầu tiên đủ điều kiện, từ nến tiếp theo; TTL4 nến M15. Không giả định chạm midpoint là chắc chắn fill.
- SL tại điểm mất hiệu lực với buffer/tick và floor hiện hành; không thu hẹp SL để tạo RR đẹp. TP tại mục tiêu cấu trúc/liquidity gần nhất còn hiệu lực đã biết khi tạo plan; không kéo TP xuyên cản. RR phát sinh từ plan được ghi liên tục và phân nhóm để chẩn đoán, không ép TP=1R/1,5R/2R rồi chọn kết quả tốt nhất.
- Không dùng probability từ LLM. Thu đủ dữ liệu ngoài mẫu, tính uncertainty theo cụm ngày/sóng và kiểm soát số giả thuyết đã thử trước khi chọn ngưỡng admission mới.

Các con số trên mới là protocol đề xuất, chưa tuyên bố được code detector/replay kiểm chứng. Khóa detector, dữ liệu, fill model và chi phí trước khi đánh giá; thay quy tắc tạo một phiên bản/epoch mới.

## Chẩn đoán dữ liệu mới nhất đã lấy

Snapshot public Binance Futures `fapi.binance.com` lúc **11:09:22 ICT ngày 15/09/2026**; 299 nến đã đóng cho mỗi khung H4/H1/M15, kiểm tra OHLC hợp lệ, liên tục và độ mới. Close M15 cuối 77.658,6 USDT. Đây không phải executable quote.

- Classifier hiện tại báo H4 bear, H1 bull, M15 bear; phép đo H4 đồng thời báo `staleBias=true`. Vì vậy không kết luận ba khung đã xác nhận short.
- Proxy target-room hiện tại chỉ khoảng0,514% long và0,075% short tại close này, với stop floor khoảng0,8%. Những proxy này còn không đủ RR1. Tuy nhiên helper đang chọn pivot gần nhất mà chưa loại đầy đủ pivot đã bị xuyên: đây là chẩn đoán bảo thủ, **không chứng minh thị trường không còn mục tiêu hợp lệ**.
- Trước khi thêm nhãn ICT, cần kiểm tra lifecycle target đã bị quét và bias đã mất hiệu lực. Đây có thể là nguyên nhân bỏ sót cơ hội; chưa có thống kê chứng minh.
- Snapshot chưa chạy detector OB/FVG/EQH/EQL/MSS hoàn chỉnh, chưa tính profile và chưa chứng minh có setup vào lệnh. Không đưa entry/SL/TP hoặc xác suất thắng như tín hiệu đã xác nhận.

Dữ liệu: [snapshot](../audits/2026-09-15-ict-opportunities/snapshot.json), [nến gốc](../audits/2026-09-15-ict-opportunities/candles.json). Script chỉ gọi public GET: `backend/scripts/snapshot-ict-opportunities.cjs`.

## Cổng chọn chiến lược

So baseline đang triển khai với ứng viên trên cùng cửa sổ độc lập, chống trùng candidate/sóng, có pending/filled/expired và wallet/cooldown thật. Yêu cầu ROI net dương cơ sở và stress, delta lợi nhuận so baseline dương và cohort lệnh bổ sung có expectancy net dương. Funding lấy theo timestamp và chiều trả/nhận; phí maker/taker theo tài khoản và fill; slippage/latency/AI đầy đủ, unknown không phải 0. Chưa đủ mẫu hoặc độ bất định lớn thì kết luận chưa có bằng chứng, không hứa ROI+.

Không thay đổi bot để hạ RR ngay khi chưa có kết quả. Quy tắc live hiện tại là baseline kỹ thuật; RR3 không còn là yêu cầu bắt buộc của người dùng cho chiến lược tiếp theo.

## Nguồn đã tìm

- [The Inner Circle Trader — 2022 Mentorship Episode 6](https://www.youtube.com/watch?v=Bkt8B3kLATQ): mô tả video gốc xác nhận chủ đề FVG và market structure shifts.
- [The Inner Circle Trader — Silver Bullet Time Based Trading Model](https://www.youtube.com/watch?v=tRq1hyGGtl4): nguồn gốc mô hình theo thời gian; không phải bằng chứng hiệu quả BTC.
- [The Inner Circle Trader — OTE Primer](https://www.youtube.com/watch?v=Cg0-CFJOJvg): tài liệu gốc để đối chiếu mô hình hồi giá. Công cụ duyệt chỉ lấy được metadata/trang hạn chế, không xác minh toàn bộ nội dung video; các quy tắc máy ở trên là đề xuất dự án.
- [Binance — Futures trading fees](https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554): commission khi khớp, funding tùy vị thế tại thời điểm thanh toán; funding có thể trả hoặc nhận. Slippage và AI được tính thêm bởi mô hình chi phí dự án.


## Kết quả detector vòng đầu

Đã hiện thực hóa detector offline sweep→MSS→FVG; xem [báo cáo](../audits/2026-09-15-ict-opportunities/detector-report.md). Trên299 nến M15 tìm được2 kế hoạch RR0,929 và3,111 nhưng cả hai không chạm entry trong TTL4 nến. Chưa có bằng chứng tạo thêm lệnh khớp hoặc ROI+. Năm kiểm tra qua, gồm prefix invariance tại249 mốc. Runtime không thay đổi.


Đã [kiểm chứng bằng1m](../audits/2026-09-15-ict-opportunities/replay-report.md): cả2 kế hoạch hết hạn không khớp. Đóng băng bản nghiên cứu cho cửa sổ16–30/09, chưa lên lịch collector và chưa đạt portfolio/admission parity.


Đã [nối funding và adapter tài khoản](../audits/2026-09-15-ict-opportunities/account-report.md):11 kiểm tra qua, hai kế hoạch qua sizing probe nhưng vẫn không fill. Có đối soát baseline DB; chưa có full guard/counterfactual parity nên chưa kết luận ROI+. Detector freeze không đổi.

Đã [bật catch-up collector](../audits/2026-09-15-ict-opportunities/collection-report.md) cho cửa sổ16–30/09: freeze hash OK, nguồn `fapi.binance.com`. Tới asOf17/09 có1 ứng viên trong cửa sổ; replay1m ghi `ambiguous_entry_exit_same_minute` (không gán fill); sizing probe từ chối `execution_risk`. Chưa cron liên tục; chưa admission/baseline parity đầy đủ; runtime không đổi.
