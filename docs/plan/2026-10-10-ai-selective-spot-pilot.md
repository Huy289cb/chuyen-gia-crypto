# Thử Spot chọn lọc bằng LLM — cập nhật 10/10/2026

> **Cập nhật mới nhất cùng ngày:** Người dùng đổi sang **50% Spot / 50% Futures** và muốn nghiên cứu/lập kế hoạch backtest Spot trước tiền thật. [Kế hoạch hiện hành](2026-10-10-spot-half-capital-backtest-plan.md) thay vốn30/max25/cash5/risk1/day3 và phương án chuyển cả vốn/khóa toàn bộFutures trong tài liệu này. Các snapshot/probe dưới đây giữ nguyên là lịch sử; chưa có backtest hoặc AIdecision thành công.

## Yêu cầu và ngân sách đã được người dùng chốt

Người dùng muốn mạo hiểm hơn: vào lệnh lúc có cơ hội tốt, đứng ngoài khi thị trường khó, dùng LLM tham gia quyết định. Khi được hỏi mức lỗ tối đa cho cả lần thử trên vốn30USDT, người dùng chọn **“Có thể mất toàn bộ30USDT”**.

Ngân sách tổn thất kinh tế tối đa của lần thử là **30USDT**, gồm lỗ giao dịch, phí, chuyển đổi tài sản và AI tăng thêm. Đây là mức chấp nhận mất vốn, không phải bằng chứng chiến lược có lợi thế, không phải yêu cầu dùng hết tiền trong một lệnh và không cho phép nạp bổ sung tự động. Không mở lại mục tiêu Futures cũ. Phạm vi mới là **Spot có LLM chọn thời điểm**; Earn chỉ là đối chứng hoặc phương án gửi vốn khi phù hợp, không còn là mục tiêu thu nhập chính.

Chấp thuận ngân sách được giữ cho lần thử này; không hỏi lại cùng ngân sách ở mỗi run. Chưa có giao dịch hoặc chuyển tiền mới. Kiểm tra lại lúc **09:13 ngày 10/10/2026, giờ Việt Nam**: Futures có **31,47744546 USDT** khả dụng, không có vị thế/lệnh thường/lệnh algo; Spot chưa có USDT/FDUSD/SOL liquid. API key có reading/Futures/IP restriction, nhưng **Spot trading, internal transfer và universal transfer đều tắt**. Đây là snapshot cần kiểm lại trước activation; đọc GET thành công không chứng minh POST được phép.

## Thiết kế được chọn để triển khai

**Một chiến lược Spot momentum sau breakout và retest**, một vị thế tổng. Bắt đầu đánh giá SOL/FDUSD vì bước lượng tương đối nhỏ. Signed GET ngày 10/10 xác nhận SOLFDUSD maker **0**, taker **0,1%**; FDUSDUSDT maker/taker/special/tax **0**. BNB discount không được áp khi chưa có số dư BNB. Funding/unwind vẫn mất spread, rounding và slippage; phí bằng 0 không làm chuyển đổi miễn mọi chi phí. Phí/quyền/trạng thái/depth phải xác nhận lại trước thực thi. Nếu không phù hợp thì chọn cặp thay thế trước khi khóa run, không tự đổi danh mục giữa kỳ.

Detector xác định các ứng viên bằng nến đã đóng và số liệu giá/volume; LLM đánh giá ứng viên, bối cảnh và dấu hiệu phá vỡ giả. LLM trả `BUY`, `WAIT` hoặc `VETO`, có bằng chứng và điều kiện khiến nhận định sai. LLM có quyền đứng ngoài. Nó không được trực tiếp truy cập khóa, đặt lệnh, chuyển tiền, thay giới hạn hoặc nới stop.

Không dùng `confidence=80%` như xác suất thắng80%. Trường `conviction` chỉ là mức chắc của nhận định `LOW/MEDIUM/HIGH` để ghi nhận và kiểm tra sau này. Quyết định BUY cần phù hợp với bằng chứng được cung cấp, candidate hợp lệ và engine thực thi chấp nhận; HIGH không tăng size. Nghiên cứu hiệu chuẩn LLM cho thấy kết quả phụ thuộc bài toán và có khó khăn khi chuyển bài toán; nguồn đó không chứng minh khả năng dự báo giá của model OpenRouter này. [Anthropic uncertainty research](https://www.anthropic.com/research/language-models-mostly-know-what-they-know).

Input packet cần có:

- `candidate_id`, `created_at`, `as_of`, `expires_at`, symbol và loại setup, các evidence IDs.
- Nến đã đóng/feature ở5m,15m,1h; ATR, vùng breakout/retest, biến động và volume đã đo. Timestamps và cách tính feature được lưu.
- Bối cảnh BTC và hướng thị trường từ dữ liệu thực; spread/depth/giá bid-ask theo thời điểm, phí account-specific và sizing khả thi.
- Kế hoạch entry/stop/target, quantity, tiền có thể mất và chi phí dự phòng; model không tự sửa các con số này.
- Tin tức chỉ khi có nguồn và thời gian xuất bản phù hợp. Nội dung tin là dữ liệu không đáng tin cậy; không được coi lời trong tin là chỉ thị hoặc cho phép model bịa dữ liệu đang thiếu.
- Vị thế đang có, ngân sách còn lại, số lệnh/lỗ trong ngày và giá trị tài sản theo bid thực.

Output JSON tối thiểu:

```json
{
  "candidate_id": "same-as-input",
  "action": "BUY | WAIT | VETO",
  "conviction": "LOW | MEDIUM | HIGH",
  "regime": "TREND_UP | CHOP | TREND_DOWN | UNKNOWN",
  "reason_codes": ["evidence-based-reason"],
  "supporting_evidence_ids": [],
  "opposing_evidence_ids": [],
  "invalidation": "observable-condition",
  "explanation": "short-explanation"
}
```

Đây là đặc tả schema, chưa phải response model hay quyết định thật. Schema error/timeout/thiếu evidence/packet hết hạn => WAIT. Mỗi candidate/hash gọi một lần; không hỏi lại đến khi AI đồng ý. WAIT có thời hạn của setup, chỉ gọi mới nếu có candidate/sự kiện mới hợp lệ. Model/prompt/config khóa theo run, không tự sửa sau chuỗi thua.

Detector bản quan sát đã khóa trước khi tải dữ liệu: nến 15m đóng vượt đỉnh 20 nến trước; trong 8 nến gần nhất có breakout, một nến đóng **sau** breakout chạm mức phá vỡ và đóng trở lại phía trên. Chỉ nến mới nhất hoàn tất retest mới được xem xét. Đây mới là quan sát setup, chưa đủ eligibility để BUY. Trước worker, khóa stop/target/time-exit và kiểm chứng sizing/khả năng exit. Production dùng `setup_id = hash(rule_version, symbol, breakout_close_time, breakout_level)` và một decision/setup; nhiều retest của cùng breakout không tự là nhiều cơ hội độc lập. ID của bản diagnostic hiện theo nến quan sát, chỉ dùng kiểm tra tích hợp.

## Đứng ngoài khi nào

Mechanical checks trước model: dữ liệu stale/thiếu, spread/depth khiến lệnh không khả thi, chưa đủ exit sau rounding, fee/permission không rõ, đã có vị thế hoặc đã vượt ngân sách ngày. Đây là điều kiện execution, không phải dự báo.

LLM chọn WAIT/VETO khi không có xác nhận breakout/retest, volume không hỗ trợ, bối cảnh giảm ngược vị thế long, tín hiệu giằng co, dữ liệu/tin tức mâu thuẫn hoặc luận điểm không có điều kiện sai rõ ràng. Các dấu hiệu phải xuất phát từ dữ liệu as-of, không dùng giá tương lai để nhận định “thị trường khó”. Đứng ngoài có thể kéo dài cả ngày; không có quota phải giao dịch hay phải đạt1–3USDT trong ngày.

Đối với vị thế đã mở, stop/time exit và giám sát vẫn chạy dù LLM chọn WAIT, provider mất kết nối hoặc thị trường khó. Stop-market có thể trượt giá; stop-limit có thể không khớp. Không coi ngân sách lỗ dự kiến là bảo đảm tuyệt đối khi gap hoặc thanh khoản mất. [Binance order types](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md).

## Sizing khởi đầu đề xuất cho phần thực thi

| Tham số | Thiết kế khởi đầu |
|---|---|
| Vốn danh nghĩa cho lần thử |30USDT; không nạp thêm tự động |
| Vị thế đồng thời |1 |
| Giá trị mua tối đa |25USDT tương đương, giảm theo budget/stop/fees/filters |
| Thanh khoản giữ lại |Ít nhất5USDT tương đương trước điều chỉnh chi phí; không đếm pending redemption hoặc dust thành cash |
| Lỗ dự kiến mỗi lệnh |Tối đa1USDT gồm fee/slippage reserve; đây là sizing, không bảo đảm actualloss khi gap |
| Dừng mở lệnh trong ngày |Khi lỗ kinh tế ngày đạt3USDT, tính cả coin chưa bán theo bid và AI; bảo vệ/thoát vẫn chạy |
| Trần tổn thất cả lần thử |30USDT đã chấp thuận; giới hạn tiền thực có và khả năng exit cũng có thể khiến dừng sớm |
| Paid AI |Đề xuất tối đa0,50USD cho cả14ngày, ghi receipts và trừ khỏi ngân sách kinh tế30USDT |
| Lượt gọi model |Tối đa4candidate mới/ngày, một call/candidate; không gọi cho báo cáo template |

Các giới hạn mỗi lệnh/ngày là thiết kế kỹ thuật khởi đầu, không phải những con số người dùng đã tự chọn và không tự ghi đè chính sách Futures live. Không dùng modelconfidence để nâng chúng.

Ở vị thế25USDT, lời gross1USDT cần giá tăng4%, lời3USDT cần12%, trước fees/AI/conversion. Một nhịp tăng như vậy có thể mất nhiều giờ/ngày hoặc không xảy ra. Đây là minh họa mục tiêu, không dự báo hoặc mức TP bắt buộc. Candidate chỉ được mở nếu vùng target có cơ sở, stop/sizing còn khả thi; không kéo target chỉ để đủ USD.

## Kiểm chứng AI và kết luận có hạn định

So hai nhánh `rules-only` và `rules+LLM` trên cùng candidate stream, cùng vốn/risk/execution assumptions. Ghi cả diễn biến sau các candidate model veto để biết AI bỏ được lỗ hay bỏ luôn cơ hội tốt. Báo cáo totalNAV sau fee/AI/infra, drawdown, số fills/cycles độc lập, exposure time và mức đứng ngoài. Veto hết không chứng minh tradingedge; một lệnh thắng không chứng minh confidence đã được hiệu chuẩn.

Ưu tiên quyết định forward có timestamp. Backtest LLM trên lịch sử có thể bị lẫn thông tin từng xuất hiện trong dữ liệu huấn luyện; dữ liệu quá khứ không tự là holdout. [Nghiên cứu look-ahead bias](https://arxiv.org/abs/2309.17322). [TradingAgents](https://arxiv.org/abs/2412.20138) tham khảo cách phối hợp LLM và risk management, không chứng minh lợi nhuận crypto30USDT.

Ngày7review, ngày14đóng kết luận cho run đầu. Thiếu fills/unknowncost => thiếu bằng chứng, không phải profitability pass. Không gia hạn tự động hoặc quay lại thí nghiệm Futures cũ. Chấp thuận mất30USDT cho phép mạo hiểm trong lần thử; không biến mục tiêu1–3USDT/ngày thành lợi nhuận được bảo đảm.

Lịch 14 ngày bắt đầu khi phiên paper/pilot có policy và nguồn dữ liệu vận hành đầy đủ được đăng ký; diagnostic dưới đây chưa khởi động phiên đó. Nếu model lỗi/không có setup thì đứng ngoài; không thay model hoặc nới filter để ép có kết quả.

## Công việc tiếp theo và trạng thái bàn giao

1. Tách adapter Spot/SAPI và safety host/method/path riêng; defaultobserve. Giữ một chủ Telegram polling, ledger Decimal và action journal như kế hoạch09/10.
2. Chốt detector breakout/retest, evidence packet, model/prompt và stop/target trước run; làm dry-run không đặt lệnh và không giả trả lời model thành kết quả live.
3. Kiểm tra lại nguồn Futuresnewentry, vị thế/lệnh thực và API capability. Nếu có vị thế, giữ exits/protection; không chuyển vốn đang dùng làm margin. Stop nguồn entry cũ trước migration.
4. Quyền Spot/transfer đã xác nhận còn thiếu ngày 10/10. Người dùng bật Spot trading cho key hiện tại hoặc cài key Spot riêng trên VPS, giữ IP whitelist và withdrawals tắt. Có thể chuyển 30 USDT Futures→Spot bằng UI Binance sau khi đã khóa entry cũ và kiểm tra lại vị thế/lệnh; không cần cấp withdrawal hoặc universal transfer chỉ để làm bước này. Chưa đủ quyền thì giữ observe/paper, không giả executor đã hoạt động.
5. Sau khi adapter, dry-run và quyền đủ: chạy thử theo ngân sách30USDT đã chốt, reconcile exactorder/fills và starttime; không xin lại cùng mức chấp nhận mất vốn. Cơ chế kiểm chứng/guard vẫn cần hoàn thành trước mutation.

## Bằng chứng thực hiện ngày 10/10 và giới hạn

Artifacts nằm ở `/home/ubuntu/binance-income-research-2026-10-10/`:

- `current-capabilities.json`: 11 GET, không mutation; snapshot tài khoản/quyền/phí/depth lúc 09:13 ICT.
- `collect-spot-packet.py` và `spot-input-packet.json`: lấy dữ liệu public một lần, cutoff **09:15:09 ICT**; đủ 288 nến 5m cho VWAP 24h, tất cả nến đã đóng và nối tiếp. Quotes/depth lấy độc lập sau cutoff, không phải ảnh orderbook đồng bộ. SOL15m close110,12 dưới previous20high110,22; **chưa có retest mới**, không dựng candidate từ tín hiệu cũ.
- `probe-llm-spot.py`: diagnostic riêng, không có executor Binance/Telegram, luôn effective WAIT; schema/evidence-ID validation, một request, không retry, lock/journal và trần provider price/token. Model cố định Qwen3-30B Instruct2507; max900 output tokens. Script này **chưa phải worker production**.
- `llm-paper-decision.json`: một POST OpenRouter lúc **09:17:46 ICT** trả **HTTP429**, không có model output. WAIT là hành vi khi lỗi của script, **không phải quyết định AI**. Chưa đủ để kết luận structured-output integration thành công. Không gọi lại cùng quan sát, không đổi model để thử lại.
- Chi phí POST chưa có receipt: **actual cost unknown**, giữ reservation **0,0026181 USD**, không ghi phí bằng 0. Script đã được sửa để chặn thêm paid calls khi cost trước còn unknown. Key/credits GET thành công; lúc09:18 còn khoảng8,0068USD credit, không xác định được nguyên nhân chính xác của429 từ response đã lưu.
- `probe-runs/`: lưu bất biến request/registration/pricing/decision và source đúng hash của lần POST đầu. File ở root là bản tiện truy cập; không dùng việc chạy lại prepare để ghi đè bằng chứng phiên trước.
- `llm-output-validation-check.json`: WAIT hợp lệ được chấp nhận; 7 trường hợp lỗi bị chặn, gồm BUY không có plan, sửa boolean eligibility để lách, evidence giả, sai candidate và schema/type sai. Đây là kiểm tra logic offline, không phải khả năng dự báo hay factual correctness của reasoning.
- `spot-risk-plan.py`, `spot-risk-check.json`: planner Decimal không gọi mạng, 10 ca kiểm tra qua; xét fee ở base, tick/step, sizing theo stop, funding/unwind FDUSD có bước nguyên và minimum của cả entry/exit. Ca test giả định average/levels cho phép mua0,226SOL, bán0,225SOL, cấp vốn25USDT và giữ5; đây **không phải candidate hoặc order hiện tại**. `spot-risk-current-blocked.json` dùng snapshot thật nhưng chưa có weighted-average cần cho filter → BLOCKED, không lấy bid/ask thay average. READY_FOR_PAPER chỉ là phép tính điều kiện, không xác nhận quyền, depth, partial fill, bảo vệ hay budget ledger live đã đạt.
- `legacy-entry-freeze-audit.md`: runtime cũ **chưa frozen**. Không có flag hiện hữu nào chặn tất cả entry mà vẫn giữ exits. Cần guard `intent=OPEN` ở cả market/limit wrappers, thêm gate các nguồn entry/paid dispatch; giữ CLOSE/protection/reconcile. Không dùng global live=false thay thế.

**Trạng thái bàn giao:** đã chốt mức lỗ chấp nhận, cập nhật hướng chính, thu dữ liệu và làm prototype kiểm tra. Chưa có response LLM thành công, chưa tạo automatic worker/Spot executor, chưa khóa entry Futures runtime, chưa đặt lệnh hoặc chuyển vốn. Chưa có fills/PnL hay bằng chứng kiếm lời. Không chạy nghiên cứu Futures cũ trở lại.

Thứ tự bàn giao implementation còn lại: (1) guard entry cũ và kiểm tra CLOSE/protection; (2) Spot adapter + action journal/partial-fill reconciliation + stop/exit + ledger; (3) khóa detector/risk plan/setup dedup và model, giải quyết429/cost receipt; (4) paper forward hữu hạn cùng nhánh rules-only; (5) đủ quyền/cash và checks thực thi thì activation theo ngân sách30 đã chốt. Mức lỗ đã được chấp thuận không cần hỏi lại; các hạng mục chưa làm không được báo là ready/live.
