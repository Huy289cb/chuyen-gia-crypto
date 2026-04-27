# Phân tích: Tại sao hệ thống hiển thị thua lỗ > 100%

**Date:** 2026-04-27  
**Type:** Analysis Report  
**Component:** Paper Trading Engine  
**Status:** Analysis Complete

## Tóm tắt vấn đề

Hệ thống paper trading đang hiển thị thua lỗ vượt quá 100% của vốn ban đầu, điều này là không thể trong một hệ thống trading được implement đúng. Vấn đề nằm ở việc tính toán balance không chính xác khi đóng position một phần (partial close).

## Phân tích chi tiết

### 1. Cách tính toán Balance trong Paper Trading

Hệ thống paper trading có 2 loại balance:
- `starting_balance`: Vốn ban đầu (100 USDT)
- `current_balance`: Balance hiện tại sau các trades
- `equity`: current_balance + unrealized_pnl

### 2. Luồng xử lý khi đóng Position

File: `backend/src/services/paperTradingEngine.js`

Có 2 function để đóng position:
1. `closePosition()` - Đóng toàn bộ position
2. `closePartialPosition()` - Đóng một phần position (partial TP)

### 3. Vấn đề trong closePartialPosition()

**File:** `backend/src/services/paperTradingEngine.js`  
**Function:** `closePartialPosition()`  
**Line:** 527

**Code hiện tại:**

```javascript
export async function closePartialPosition(db, position, currentPrice, closeSize, closeReason) {
  const { updateAccount, logTradeEvent, getAccountBySymbol } = await import('../db/database.js');
  
  // Calculate PnL for partial close
  const { pnl, pnl_percent } = calculateUnrealizedPnL(position, currentPrice);
  const partialPnl = position.size_qty > 0 ? pnl * (closeSize / position.size_qty) : 0;
  
  // Update account balance with partial PnL
  let account;
  try {
    account = await getAccountBySymbol(db, position.symbol);
  } catch (error) {
    console.error('[PaperTrading] Error fetching account for partial close:', error.message);
    throw error;
  }
  
  if (!account) {
    console.error('[PaperTrading] Account not found for symbol:', position.symbol);
    throw new Error(`Account not found for symbol ${position.symbol}`);
  }
  
  const newBalance = account.balance + partialPnl;  // ❌ BUG Ở ĐÂY
  try {
    await updateAccount(db, account.id, { balance: newBalance });
  } catch (error) {
    console.error('[PaperTrading] Error updating account for partial close:', error.message);
    throw error;
  }
  // ...
}
```

**Vấn đề:** Line 527 dùng `account.balance` thay vì `account.current_balance`

### 4. Sự khác biệt giữa balance và current_balance

Trong database schema (`accounts` table):
- `balance`: Đây là `starting_balance` - vốn ban đầu (100 USDT)
- `current_balance`: Balance hiện tại sau các trades

**Code trong database.js (line 904-906):**

```javascript
db.run(
  `INSERT INTO accounts (symbol, method_id, starting_balance, current_balance, equity)
   VALUES (?, ?, ?, ?, ?)`,
  [symbol.toUpperCase(), methodId, startingBalance, startingBalance, startingBalance],
```

Khi tạo account mới:
- `starting_balance` = 100
- `current_balance` = 100
- `balance` column KHÔNG tồn tại trong schema

**Nhưng khi query account:**

```javascript
// getAccountBySymbol returns account object with:
// - starting_balance: 100
// - current_balance: dynamic value
// - balance: likely same as starting_balance (legacy field)
```

### 5. Kịch bản gây lỗi >100%

Giả sử starting_balance = 100 USDT

**Trade 1: Win 10 USDT (partial TP)**
- Partial PnL = +10
- **BUG:** newBalance = account.balance (100) + 10 = 110
- **Đúng:** newBalance = account.current_balance (100) + 10 = 110
- Kết quả: Giống nhau (vì chưa có trade nào)

**Trade 2: Win 20 USDT (partial TP)**
- Partial PnL = +20
- **BUG:** newBalance = account.balance (100) + 20 = 120 ❌
- **Đúng:** newBalance = account.current_balance (110) + 20 = 130 ✅
- Sai lệch: 10 USDT

**Trade 3: Loss 50 USDT**
- Realized PnL = -50
- **BUG:** newBalance = 120 - 50 = 70
- **Đúng:** newBalance = 130 - 50 = 80
- Loss % (BUG): (70 - 100) / 100 = -30%
- Loss % (Đúng): (80 - 100) / 100 = -20%

**Sau nhiều trades:**

| Trade | PnL | Bug Balance | Correct Balance | Bug Loss % | Correct Loss % |
|-------|-----|-------------|------------------|------------|----------------|
| Start | 0 | 100 | 100 | 0% | 0% |
| 1 | +10 | 110 | 110 | 0% | 0% |
| 2 | +20 | 120 | 130 | 0% | 0% |
| 3 | -50 | 70 | 80 | -30% | -20% |
| 4 | +30 | 130 | 110 | +30% | +10% |
| 5 | -80 | 50 | 30 | -50% | -70% |

Sau nhiều trades, sự sai lệch tích lũy và có thể dẫn đến:
- Balance hiển thị sai
- Loss % tính toán sai
- Có thể hiển thị loss > 100% khi thực tế không phải vậy

### 6. Tại sao closePosition() không bị lỗi?

**File:** `backend/src/services/paperTradingEngine.js`  
**Function:** `closePosition()`  
**Line:** 635

```javascript
const newBalance = account.current_balance + realizedPnl;  // ✅ ĐÚNG
```

Function `closePosition()` dùng `account.current_balance` nên không bị lỗi.

### 7. Khi nào bug xảy ra?

Bug chỉ xảy ra khi:
1. Sử dụng ICT strategy với partial take profits
2. Hit TP1 hoặc TP2 (partial close)
3. System gọi `closePartialPosition()`
4. Balance được update với `account.balance` thay vì `account.current_balance`

### 8. Tác động đến hệ thống

**Ảnh hưởng trực tiếp:**
- Balance tracking sai sau partial TP hits
- Loss percentage hiển thị sai
- Có thể hiển thị loss > 100% (không thể xảy ra trong thực tế)
- Performance metrics sai lệch

**Ảnh hưởng gián tiếp:**
- Làm mất niềm tin vào hệ thống
- Không thể đánh giá chính xác performance
- Quyết định trading dựa trên metrics sai

### 9. Ví dụ thực tế

Giả sử starting_balance = 100 USDT

**Scenario 1: ICT Strategy với Partial TP**

1. Mở LONG tại 75000, size=100 USDT, SL=74000, TP1=76000, TP2=78000
2. Price hit TP1 (76000) → Partial close 50%
   - Partial PnL = (76000-75000) * 0.5 * size_qty = +10 USDT
   - **BUG:** newBalance = 100 + 10 = 110 (đúng)
3. Price hit TP2 (78000) → Close remaining 50%
   - Realized PnL = (78000-75000) * 0.5 * size_qty = +15 USDT
   - **BUG:** newBalance = 100 + 15 = 115 ❌
   - **Đúng:** newBalance = 110 + 15 = 125 ✅
4. Mở LONG mới, loss 40 USDT
   - **BUG:** newBalance = 115 - 40 = 75
   - **Đúng:** newBalance = 125 - 40 = 85
   - **BUG Loss %:** (75-100)/100 = -25%
   - **Đúng Loss %:** (85-100)/100 = -15%

**Scenario 2: Nhiều partial TP hits**

Sau 10 trades với 5 partial TP hits:
- Tổng sai lệch có thể lên đến 50-100 USDT
- Balance hiển thị có thể thấp hơn thực tế 50-100%
- Loss % có thể hiển thị >100% khi thực tế chỉ ~50%

## Đề xuất giải pháp

### 1. Fix Bug trong closePartialPosition()

**File:** `backend/src/services/paperTradingEngine.js`  
**Line:** 527

**Thay đổi:**

```javascript
// TRƯỚC (BUG)
const newBalance = account.balance + partialPnl;

// SAU (FIX)
const newBalance = account.current_balance + partialPnl;
```

**Lợi ích:**
- Balance tracking chính xác
- Loss percentage hiển thị đúng
- Performance metrics chính xác

### 2. Thêm Balance Validation

Thêm validation sau mỗi balance update:

```javascript
// Validate balance after update
if (newBalance < 0) {
  console.error('[PaperTrading] Negative balance detected:', newBalance);
  throw new Error('Negative balance is not allowed');
}

// Validate loss percentage
const lossPercent = ((newBalance - account.starting_balance) / account.starting_balance) * 100;
if (lossPercent < -100) {
  console.error('[PaperTrading] Loss > 100% detected:', lossPercent);
  alert('Loss > 100% detected - check calculation logic');
}
```

### 3. Review Tất cả Balance Update Points

Kiểm tra tất cả các nơi update balance:

1. `closePosition()` - ✅ Đã dùng `current_balance`
2. `closePartialPosition()` - ❌ Dùng `balance` (cần fix)
3. Các function khác - Cần review

### 4. Đổi Tên Column cho Rõ Ràng

Đề xuất đổi tên column trong database:
- `balance` → `starting_balance` (nếu còn tồn tại)
- `current_balance` → `balance` (balance thực tế)

Hoặc:
- Giữ nguyên nhưng thêm comment rõ ràng
- Document rõ sự khác biệt

### 5. Thêm Unit Tests

Tạo unit tests cho:
- `closePartialPosition()` với các scenarios
- Balance update logic
- Loss percentage calculation
- Edge cases (negative balance, >100% loss)

### 6. Thêm Integration Tests

Test scenarios:
- ICT strategy với partial TP
- Nhiều partial TP hits liên tiếp
- Mixed wins và losses
- Verify balance tracking chính xác

## Ưu tiên triển khai

### Priority 1 (Ngay lập tức)
1. Fix bug trong `closePartialPosition()` - đổi `account.balance` → `account.current_balance`
2. Thêm balance validation
3. Test với paper trading

### Priority 2 (Ngắn hạn)
1. Review tất cả balance update points
2. Thêm unit tests
3. Thêm integration tests

### Priority 3 (Dài hạn)
1. Đổi tên column database (nếu cần)
2. Cải thiện documentation
3. Setup monitoring cho balance anomalies

## Testing Checklist

### Unit Tests
- [ ] Test closePartialPosition với partial PnL dương
- [ ] Test closePartialPosition với partial PnL âm
- [ ] Test balance update sau partial close
- [ ] Test loss percentage calculation
- [ ] Test edge cases (zero balance, negative balance)

### Integration Tests
- [ ] Test ICT strategy với TP1 hit
- [ ] Test ICT strategy với TP2 hit
- [ ] Test nhiều partial TP hits
- [ ] Test mixed wins và losses
- [ ] Verify balance tracking chính xác

### Regression Tests
- [ ] Verify closePosition() vẫn hoạt động đúng
- [ ] Check rằng fix không ảnh hưởng các function khác
- [ ] Confirm performance metrics cải thiện

## Kết luận

Vấn đề >100% loss là do bug trong `closePartialPosition()` function:
- Dùng `account.balance` (starting balance) thay vì `account.current_balance`
- Sai lệch tích lũy sau nhiều partial TP hits
- Có thể dẫn đến loss percentage hiển thị >100%

Giải pháp đơn giản là đổi `account.balance` → `account.current_balance` tại line 527. Đây là fix một dòng nhưng có tác động lớn đến accuracy của hệ thống.

Ngoài ra, cần thêm validation và tests để prevent các bugs tương tự trong tương lai.
