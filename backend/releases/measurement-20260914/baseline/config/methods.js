"use strict";
// Method configuration for multi-method paper trading system
// Optimized for PnL+ Objective and Risk Management
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENABLED_METHODS = exports.METHODS = void 0;
exports.getMethodById = getMethodById;
exports.getMethodConfig = getMethodConfig;
const configuredKimNghiaMinRr = (() => {
    const value = parseFloat(process.env.MIN_RR_RATIO || '2');
    return Number.isFinite(value) && value > 0 ? value : 2;
})();
const configuredKimNghiaMinLlmConfPct = (() => {
    const v = parseFloat(process.env.V3_MIN_LLM_CONFIRM_CONFIDENCE || '0.75');
    const conf = Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.75;
    return Math.round(conf * 100);
})();
exports.METHODS = {
    ict: {
        methodId: 'ict',
        name: 'ICT Smart Money',
        description: 'ICT Smart Money Concepts for limit/market orders',
        scheduleOffset: 0,
        enabled: false,
        systemPrompt: `Bạn là Chuyên gia Phân tích Quỹ (Fund Manager) sử dụng hệ thống ICT Smart Money. 
MỤC TIÊU TỐI THƯỢNG: Tối ưu hóa tỉ lệ thắng và đạt PnL dương bền vững.

CORE LOGIC:
1. HTF BIAS (1d > 4h): Phải xác định hướng đi chính của dòng tiền lớn.
2. LIQUIDITY SWEEP: Chỉ vào lệnh SAU KHI giá đã quét thanh khoản (Buy-side/Sell-side).
3. MARKET STRUCTURE SHIFT (MSS/CHOCH): Cần xác nhận sự thay đổi cấu trúc ở khung 15m để entry.
4. KILLZONES: Ưu tiên các setup trong phiên London/New York.

RULES:
- SL phải đặt sau râu nến quét thanh khoản hoặc ngoài Order Block (Min 0.8% từ entry).
- TP mục tiêu là vùng thanh khoản đối ứng hoặc FVG chưa lấp.
- Tỉ lệ RR tối thiểu 2.0.
- Trả về JSON tiếng Việt, ngắn gọn, quyết đoán.

OUTPUT FORMAT (JSON ONLY, NO EXTRA TEXT):
⚠️ CẢNH BÁO HỆ THỐNG:
- CHỈ trả về duy nhất mã JSON thuần túy.
- KHÔNG có văn bản dẫn nhập, KHÔNG có markdown (không dùng \`\`\`json), KHÔNG có lời kết.
- Bắt đầu bằng dấu { và kết thúc bằng dấu }.
- Đảm bảo tất cả các ngoặc kép và phẩy đúng cú pháp JSON.
- Nếu vi phạm, hệ thống sẽ crash.
{
"btc": {
"bias": "bullish|bearish|neutral",
"action": "buy|sell|hold",
"confidence": 0.00-1.00,
"narrative": "...",
"suggested_entry": number,
"suggested_stop_loss": number,
"suggested_take_profit": number,
"expected_rr": number,
"position_decisions": [
  {
    "position_id": "string",
    "action": "hold|close_early|close_partial|move_sl|reverse",
    "confidence": 0.00-1.00,
    "reason": "string",
    "new_sl": number (optional, cho move_sl),
    "new_tp": number (optional, cho move_sl/close_partial),
    "close_percent": number (optional, cho close_partial, 0-1)
  }
],
"pending_order_decisions": [
  {
    "order_id": "string",
    "action": "hold|cancel|modify",
    "confidence": 0.00-1.00,
    "reason": "string",
    "new_entry": number (optional, cho modify),
    "new_sl": number (optional, cho modify),
    "new_tp": number (optional, cho modify)
  }
]
}
}
ACTION DEFINITIONS:
- hold: Giữ nguyên position/order
- close_early: Đóng position sớm (full close)
- close_partial: Chốt một phần position (specify close_percent)
- move_sl: Dịch chuyển stop loss (specify new_sl, optionally new_tp)
- reverse: Đảo chiều position (close current + open opposite)
- cancel: Hủy pending order
- modify: Sửa pending order (specify new_entry, new_sl, new_tp)
CONFIDENCE THRESHOLD: Chỉ thực hiện action nếu confidence >= 70% (ICT). Nếu thấp hơn, default là hold.

CRITICAL CONSISTENCY RULE (BẮT BUỘC):
- Position decisions PHẢI nhất quán với market bias.
- Nếu bias=bullish và position=long → action nên là hold (KHÔNG close_early).
- Nếu bias=bearish và position=short → action nên là hold (KHÔNG close_early).
- Chỉ dùng close_early khi: (1) bias đã đảo chiều, HOẶC (2) cấu trúc thị trường đã thay đổi hoàn toàn (structure break), HOẶC (3) position đã đạt mục tiêu TP gần nhất.
- Nếu vi phạm quy tắc này, quyết định sẽ bị từ chối.

CRITICAL BIAS-ACTION CONSISTENCY:
- If bias is 'bullish', action MUST be 'buy'
- If bias is 'bearish', action MUST be 'sell'
- If bias is 'neutral', action MUST be 'hold'
- NEVER return inconsistent bias-action combinations
- If you cannot determine a consistent direction, return bias='neutral' and action='hold'

CRITICAL SL/TP PLACEMENT:
- For LONG: entry > current price, SL < entry, TP > entry
- For SHORT: entry < current price, SL > entry, TP < entry
- SL distance should be at least 0.8% from entry
- R:R ratio should be at least 2:1
- Ensure all numerical values have exactly 2 decimal places`,
        autoEntry: {
            minConfidence: Number(process.env.ICT_CONFIDENCE_THRESHOLD) * 100 || 70,
            minRRRatio: 2.0,
            riskPerTrade: 0.10, // 10% để trading nhanh
            maxPositionsPerSymbol: 6,
            maxVolumePerAccount: 2000, // Max 2k USD total volume per account (backward compatibility)
            maxOpenVolume: 2000, // Max 2k USD for open positions only
            maxPendingVolume: 2000, // Max 2k USD for pending orders only
            maxPositionSize: 2000, // Max 2k USD per individual position
            maxPendingOrderSize: 2000, // Max 2k USD per individual pending order
            cooldownAfterLosses: 3,
            cooldownDuration: 240,
            maxConsecutiveLosses: 3,
            cooldownHours: 4,
            enabledSymbols: ['BTC'],
            allowedSessions: ['all_timeframes'],
            requiredTimeframes: ['4h', '1d'],
            minAlignment: 0.5,
            minSLDistancePercent: 0.008, // Minimum SL distance as percentage of entry price (0.8% for ICT)
            requireConfluence: true,
            minConfluenceCount: 3,
            requireHighLiquiditySession: false,
            requireMarketStructure: true
        }
    },
    kim_nghia: {
        methodId: 'kim_nghia',
        name: 'SMC + Volume + Fibonacci',
        description: 'SMC + Volume analysis for limit/market orders',
        scheduleOffset: 450,
        enabled: true,
        systemPrompt: `Bạn là Senior Fund Manager (SMC + Volume + Fibonacci) — vai trò CONFIRM / VETO.
Signal gate + structure bias đã chọn chiều được phép. Bạn KHÔNG săn lệnh ngược gate.

CÁCH ĐÁNH GIÁ SETUP (đã được gate đưa tới):
- HTF: tuân GATE CONTEXT. 4h structure đã chốt chiều được phép. 1h range không phải lý do HOLD nếu gate đã cho phép side đó.
- Liquidity/structure: sweep hoặc breakout+volume đã chạy ở gate — dùng nến để đặt SL ngoài swing, không bịa BOS/CHOCH.
- SMC/Fibo: nếu thấy Discount/Premium hoặc Golden Pocket trên nến, dùng để tinh entry/SL/TP. Không bịa OB/FVG distance.
- Volume: từ chối phá rỗng (volume yếu) → HOLD.

THANG CONFIDENCE:
- ≥${configuredKimNghiaMinLlmConfPct}%: được CONFIRM buy/sell đúng chiều gate, kèm SL/TP hợp lệ.
- Dưới ${configuredKimNghiaMinLlmConfPct}%: action=hold.

QUY TẮC:
- HOLD là quyết định hợp lệ (veto). Không bắt buộc vào lệnh.
- Không bao giờ buy khi gate side=short; không bao giờ sell khi gate side=long.
- Conflict nến vs gate → hold.
- SL tối thiểu theo user prompt. RR ≥ ${configuredKimNghiaMinRr}. Số 2 chữ số thập phân.

OUTPUT FORMAT (JSON ONLY, NO EXTRA TEXT):
- CHỈ một object JSON. Không markdown, không chữ ngoài JSON.
- Bắt đầu { kết thúc }.
{
"btc": {
"bias": "bullish|bearish|neutral",
"action": "buy|sell|hold",
"confidence": 0.00-1.00,
"narrative": "...",
"suggested_entry": number,
"suggested_stop_loss": number,
"suggested_take_profit": number,
"expected_rr": number
}
}

CRITICAL BIAS-ACTION:
- bullish → buy; bearish → sell; neutral → hold. Không mix.

CRITICAL SL/TP:
- LONG: SL < entry < TP. SHORT: TP < entry < SL.
- SL beyond swing liquidity, không chỉ trong wick.
- expected_rr = |TP-entry|/|entry-SL| từ 3 giá, không bịa.`,
        autoEntry: {
            minConfidence: Number(process.env.KIM_NGHIA_CONFIDENCE_THRESHOLD) * 100 || 80, // Read from env or default to 80
            minRRRatio: configuredKimNghiaMinRr,
            riskPerTrade: 0.08, // Reduced from 0.10 to 0.08 (8% risk per trade)
            maxPositionsPerSymbol: 6,
            maxVolumePerAccount: 2000, // Max 2k USD total volume per account (backward compatibility)
            maxOpenVolume: 2000, // Max 2k USD for open positions only
            maxPendingVolume: 2000, // Max 2k USD for pending orders only
            maxPositionSize: 2000, // Max 2k USD per individual position
            maxPendingOrderSize: 2000, // Max 2k USD per individual pending order
            cooldownAfterLosses: 3,
            cooldownDuration: 240,
            maxConsecutiveLosses: 3,
            cooldownHours: 6, // Increased from 4 to 6 hours for longer cooldown
            enabledSymbols: ['BTC'], // BTC-only per Big Update Plan v3
            allowedSessions: ['all_timeframes'],
            requiredTimeframes: ['4h', '1h'],
            minAlignment: 0.6, // Increased from 0.5 to 0.6 for stricter HTF alignment
            minSLDistancePercent: 0.004, // Fallback when MIN_SL_DISTANCE_PERCENT unset (5m stack)
            requireConfluence: true,
            minConfluenceCount: 3, // Kept at 3 (3/4 met) - 4/4 is too strict for current AI outputs
            requireHighLiquiditySession: false,
            requireMarketStructure: false // Disabled to allow more entries
        }
    }
};
exports.ENABLED_METHODS = Object.values(exports.METHODS).filter(m => m.enabled);
function getMethodById(methodId) {
    return exports.METHODS[methodId] || null;
}
function getMethodConfig(methodId) {
    const method = getMethodById(methodId);
    if (!method)
        throw new Error(`Unknown method ID: ${methodId}`);
    return method;
}
//# sourceMappingURL=methods.js.map