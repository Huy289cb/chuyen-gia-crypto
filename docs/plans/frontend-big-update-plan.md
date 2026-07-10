# Frontend Big Update Plan v3
## Cost-Aware Trading Dashboard + Testnet Control Center

---

## 1. Mục tiêu

Frontend v3 không chỉ là nơi xem chart, mà là một **control center** để theo dõi toàn bộ hệ thống trading sau Big Update v3.

Frontend phải trả lời rõ 3 câu hỏi chính:

1. Market đang làm gì?
2. Bot đang làm gì?
3. Tài khoản testnet đang ở trạng thái nào?

---

## 2. Nguyên tắc thiết kế

### 2.1 Không làm mất các chức năng cũ
Frontend vẫn phải hiển thị:

- chart giá
- indicator
- order / position
- balance / equity
- lịch sử giao dịch
- trạng thái bot

### 2.2 Thêm lớp monitoring cho Big Update v3
Ngoài phần trading truyền thống, frontend cần thêm:

- system health
- scheduler status
- signal gate status
- risk engine status
- no-trade reasons
- LLM dispatch status
- memory insights
- candle warmup progress

### 2.3 Ưu tiên rõ ràng
Ưu tiên hiển thị theo thứ tự:

1. Sức khỏe hệ thống
2. Trạng thái vào lệnh / không vào lệnh
3. Trạng thái tài khoản testnet
4. Chart và indicators
5. Thống kê / memory / performance

---

## 3. Cấu trúc giao diện tổng thể

Frontend nên chia thành 4 khu vực chính:

### A. System Overview
Hiển thị tổng quan hệ thống.

### B. Market View
Hiển thị chart, indicator, setup, trend, regime.

### C. Testnet Account Center
Hiển thị balance, order, position, PnL, risk.

### D. Intelligence / Monitoring
Hiển thị signal gate, no-trade reasons, memory, LLM, scheduler.

---

## 4. Khu vực A — System Overview

### Mục tiêu
Người dùng mở frontend là biết ngay hệ thống đang:

- sống hay chết
- đang warm-up hay đã trade
- bị block hay đang hoạt động
- BTC-only scope có được enforce không

### Thành phần cần có
- System Health Card
- Scheduler Status Card
- Scope Card
- Signal Status Card
- Risk Status Card
- Candle Warmup Card

### Nội dung hiển thị
- Worker status
- Database status
- Leader lock status
- Safety validation status
- BTC-only scope status
- MarketScan schedule
- LLMDispatch schedule
- PositionMonitor schedule
- Signal gate status
- Risk lock status
- Number of candles loaded
- Warmup progress per timeframe

### Trạng thái hiển thị
- `Healthy`
- `Warming up`
- `Blocked`
- `Trading enabled`
- `Trading paused`
- `BTC-only active`

---

## 5. Khu vực B — Market View

### Mục tiêu
Vẫn giữ phần xem giá và indicator như một trading dashboard thông thường.

### Thành phần cần có
- Price chart
- Candlestick chart
- Overlay indicator
- Volume
- Support / resistance
- Setup annotation
- Entry / SL / TP markers
- Multi-timeframe selector

### Indicator nên hiển thị
Tùy backend có gì, frontend nên hỗ trợ các nhóm sau:

- moving average
- volume
- RSI
- MACD
- ATR
- VWAP
- market structure
- liquidity zones
- fair value gap
- order blocks
- breakout / sweep markers

### Nhiệm vụ của Market View
- giúp xem market context
- giúp xác minh setup
- giúp hiểu vì sao signal bị block hoặc pass

### Gợi ý UX
- chọn symbol
- chọn timeframe
- bật/tắt từng indicator
- click nến để xem dữ liệu chi tiết
- hover để xem OHLCV

---

## 6. Khu vực C — Testnet Account Center

### Mục tiêu
Hiển thị toàn bộ thông tin tài khoản testnet để biết bot đang quản lý vốn thế nào.

### Thành phần cần có
- Balance summary
- Equity curve
- Open positions
- Active orders
- Order history
- Trade history
- Unrealized / realized PnL
- Fees
- Margin usage
- Risk usage
- Daily performance

### Balance summary
Hiển thị:
- available balance
- total balance
- equity
- used margin
- free margin
- daily PnL
- weekly PnL

### Open positions
Hiển thị:
- symbol
- side
- size
- entry price
- mark price
- unrealized PnL
- ROE / PnL %
- stop loss
- take profit
- time in position

### Active orders
Hiển thị:
- order id
- symbol
- side
- type
- status
- price
- quantity
- reduce-only flag
- created time

### Order history
Hiển thị:
- filled / canceled / rejected
- fill price
- fee
- slippage
- reason

### Mục tiêu UX
Người dùng phải thấy ngay:
- bot có đang giữ vị thế không
- vị thế nào đang lãi / lỗ
- order nào đang chờ
- phí đang ăn bao nhiêu vào lợi nhuận

---

## 7. Khu vực D — Intelligence / Monitoring

### Mục tiêu
Theo dõi Big Update v3 theo kiểu vận hành hệ thống.

### Thành phần cần có
- Signal Gate panel
- No-Trade Reasons panel
- LLM Dispatch panel
- Risk Engine panel
- Memory Insights panel
- Scheduler logs panel
- Candle Warmup panel

### Signal Gate panel
Hiển thị:
- signal grade
- confidence
- playbook detected
- regime
- pass / block
- reason codes

### No-Trade Reasons panel
Hiển thị top reason:
- insufficient candles
- grade below A
- no valid playbook
- duplicate signal
- spread too high
- slippage too high
- daily loss limit hit
- consecutive losses limit hit

### LLM Dispatch panel
Hiển thị:
- last Groq call
- model name
- prompt version
- response status
- invalid JSON count
- no-trade count
- skipped call count

### Risk Engine panel
Hiển thị:
- risk per trade
- daily loss cap
- max consecutive losses
- current streak
- current lock state
- allowed / blocked reason

### Memory Insights panel
Hiển thị:
- last 3 similar setups
- winrate by playbook
- recurring failure patterns
- trade reflection summary

### Scheduler logs panel
Hiển thị:
- MarketScan logs
- LLMDispatch logs
- PositionMonitor logs
- last run time
- next run time
- status per scheduler

---

## 8. Layout đề xuất

### Desktop layout
Chia thành 3 cột:

#### Cột 1
System Overview + Risk Engine + No-Trade Reasons

#### Cột 2
Market Chart + Indicators + Setup markers

#### Cột 3
Testnet Account Center + Open Positions + Active Orders + LLM / Memory

### Mobile layout
Xếp theo thứ tự:

1. System Overview
2. Market View
3. Testnet Account Center
4. Intelligence / Monitoring

---

## 9. Phân tách file frontend

Frontend nên được chia rõ để dễ maintain.

### Main page
- `frontend/app/page.tsx`

### Sections
- `frontend/app/sections/SystemOverview.tsx`
- `frontend/app/sections/MarketChartPanel.tsx`
- `frontend/app/sections/IndicatorPanel.tsx`
- `frontend/app/sections/TestnetBalancePanel.tsx`
- `frontend/app/sections/OpenPositionsPanel.tsx`
- `frontend/app/sections/ActiveOrdersPanel.tsx`
- `frontend/app/sections/TradeHistoryPanel.tsx`
- `frontend/app/sections/SignalGatePanel.tsx`
- `frontend/app/sections/NoTradeReasonsPanel.tsx`
- `frontend/app/sections/RiskEnginePanel.tsx`
- `frontend/app/sections/LlmDispatchPanel.tsx`
- `frontend/app/sections/MemoryInsightsPanel.tsx`
- `frontend/app/sections/SchedulerStatusPanel.tsx`
- `frontend/app/sections/CandleWarmupPanel.tsx`

### Components
- `frontend/app/components/StatusBadge.tsx`
- `frontend/app/components/MetricCard.tsx`
- `frontend/app/components/SectionHeader.tsx`
- `frontend/app/components/TimeframeSwitcher.tsx`
- `frontend/app/components/ChartToolbar.tsx`
- `frontend/app/components/ReasonChip.tsx`

---

## 10. API contracts cần có

Frontend cần backend trả về dữ liệu theo các nhóm sau:

### System endpoints
- `/api/dashboard/system`
- `/api/dashboard/schedulers`
- `/api/dashboard/scope`

### Market endpoints
- `/api/market/candles`
- `/api/market/indicators`
- `/api/market/signals`
- `/api/market/setups`

### Account endpoints
- `/api/account/balance`
- `/api/account/positions`
- `/api/account/orders`
- `/api/account/trades`

### Intelligence endpoints
- `/api/intelligence/signal-gate`
- `/api/intelligence/no-trade-reasons`
- `/api/intelligence/risk`
- `/api/intelligence/llm`
- `/api/intelligence/memory`

---

## 11. Các trạng thái UI bắt buộc

### System states
- healthy
- warming up
- trading enabled
- trading paused
- lock active
- error

### Signal states
- pass
- block
- skip
- duplicate
- low grade
- low confidence

### Account states
- flat
- in position
- partial position
- pending order
- margin warning
- drawdown warning

### LLM states
- pending
- called
- success
- invalid json
- skipped
- no-trade

---

## 12. Cách frontend phải diễn giải log v3

### Khi candle count còn ít
Frontend phải nói rõ:

> The system is warming up. Not enough history yet for A-grade setups.

### Khi signal bị block
Frontend phải nói rõ:

> Signal blocked intentionally by signal gate.

### Khi scheduler đang chạy
Frontend phải nói rõ:

> MarketScan / LLMDispatch / PositionMonitor are active.

### Khi BTC-only scope hoạt động
Frontend phải nói rõ:

> BTC-only execution scope enforced.

### Khi system an toàn
Frontend phải nói rõ:

> Safety validation passed. Capital protection is active.

---

## 13. Thứ tự triển khai frontend

### Phase 1 — Core monitoring
- System Overview
- Scheduler Status
- Signal Gate
- Risk Engine

### Phase 2 — Market view
- Chart
- Indicator overlay
- Setup annotations
- timeframe switcher

### Phase 3 — Testnet account center
- Balance
- Positions
- Orders
- Trade history

### Phase 4 — Intelligence layer
- No-trade reasons
- LLM dispatch
- Memory insights
- warmup progress

### Phase 5 — Polish
- responsive layout
- loading skeletons
- empty states
- error states
- color consistency
- live refresh controls

---

## 14. Definition of done

Frontend v3 is complete when:

- user still sees price charts and indicators
- user can inspect testnet balance, orders, positions, and PnL
- user can see why the bot did not trade
- user can see scheduler health and pipeline status
- user can see risk lockouts and warm-up progress
- user can see Groq usage and no-trade flow
- user can understand system state without reading backend logs

---

## 15. Final principle

Frontend must not be only a chart viewer.

It must become:
- a trading terminal
- a testnet account console
- a risk monitor
- a signal debugger
- a system health dashboard

All at the same time.

break down task follow:
./docs/plans/frontend-implementation-tasks.md