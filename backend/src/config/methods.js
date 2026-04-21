// Method configuration for multi-method paper trading system
// Optimized for PnL+ Objective and Risk Management

export const METHODS = {
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
- SL phải đặt sau râu nến quét thanh khoản hoặc ngoài Order Block (Min 0.75% từ entry).
- TP mục tiêu là vùng thanh khoản đối ứng hoặc FVG chưa lấp.
- Tỉ lệ RR tối thiểu 2.0.
- Trả về JSON tiếng Việt, ngắn gọn, quyết đoán.`,
    autoEntry: {
      minConfidence: 70,
      minRRRatio: 2.0,
      riskPerTrade: 0.10, // 10% để trading nhanh
      maxPositionsPerSymbol: 3,
      cooldownAfterLosses: 3,
      cooldownDuration: 240,
      maxConsecutiveLosses: 3,
      cooldownHours: 4,
      enabledSymbols: ['BTC'],
      allowedSessions: ['all_timeframes'],
      requiredTimeframes: ['4h', '1d'],
      minAlignment: 0.5
    }
  },

  kim_nghia: {
    methodId: 'kim_nghia',
    name: 'Kim Nghia (SMC + Volume)',
    description: 'SMC + Volume analysis for limit/market orders',
    scheduleOffset: 450,
    enabled: true,
    systemPrompt: `Bạn là Senior Trader chuyên trách phương pháp SMC + Volume + Fibonacci.
NHIỆM VỤ: Tìm kiếm các thiết lập giao dịch có xác suất thắng cao nhất để đạt PnL+.

CHIẾN LƯỢC PHÂN TÍCH (ƯU TIÊN):
1. CẤU TRÚC & VOLUME: Xác nhận xu hướng bằng Volume Profile. Breakout PHẢI đi kèm Volume lớn.
2. VÙNG VÀNG FIBONACCI: Sử dụng Fibo 0.5 - 0.618 kết hợp với OB/FVG làm vùng Entry tối ưu.
3. LIQUIDITY & SMC: Tìm kiếm EQL/EQH. Ưu tiên entry tại "Vùng chiết khấu" (Discount) cho lệnh Long và "Vùng cao cấp" (Premium) cho lệnh Short.

YÊU CẦU QUYẾT ĐOÁN:
- Nếu Confidence > 50% và cấu trúc H1/M15 đồng nhất -> Thực hiện BUY/SELL ngay. 
- Không lạm dụng HOLD nếu giá đang chạm vùng phản ứng quan trọng.

QUY TẮC CỨNG (HỆ THỐNG SẼ REJECT NẾU SAI):
- LONG: SL < Entry < TP. SHORT: SL > Entry > TP.
- SL >= 0.75% từ Entry để tránh nhiễu (noise). 
- Expected RR >= 2.5.
- Giá trị số (Entry, SL, TP) lấy 2 chữ số thập phân, KHÔNG làm tròn số chẵn.

OUTPUT FORMAT (JSON ONLY, VIETNAMESE):
{
  "btc": {
    "bias": "bullish|bearish|neutral",
    "action": "buy|sell|hold",
    "confidence": 0.00-1.00,
    "narrative": "Giải thích logic: Cấu trúc + Volume + SMC + Fibonacci (max 150 ký tự)",
    "structure": { "trend": "bullish|bearish|sideways", "hh_hl": "mô tả", "bos_choch": "vị trí" },
    "volume": { "profile": "expanding|contracting", "breakout_confirmed": bool, "analysis": "mô tả" },
    "smc": { "ob": "mức giá", "fvg": "vùng giá", "liquidity": "EQL/EQH" },
    "suggested_entry": number,
    "suggested_stop_loss": number,
    "suggested_take_profit": number,
    "expected_rr": number,
    "alternative_scenario": { "trigger": "khi nào quay xe", "logic": "tại sao" },
    "indicators": { "volume": "high|low|normal" }
  },
  "marketSentiment": "bullish|bearish|neutral",
  "comparison": "So sánh tương quan BTC/ETH"
}`,
    autoEntry: {
      minConfidence: 60,
      minRRRatio: 2.5,
      riskPerTrade: 0.10, // 10% để trading nhanh
      maxPositionsPerSymbol: 5,
      cooldownAfterLosses: 3,
      cooldownDuration: 240,
      maxConsecutiveLosses: 3,
      cooldownHours: 4,
      enabledSymbols: ['BTC', 'ETH'],
      allowedSessions: ['all_timeframes'],
      requiredTimeframes: ['4h', '1h'],
      minAlignment: 0.5
    }
  }
};

export const ENABLED_METHODS = Object.values(METHODS).filter(m => m.enabled);
export function getMethodById(methodId) { return METHODS[methodId] || null; }
export function getMethodConfig(methodId) {
  const method = getMethodById(methodId);
  if (!method) throw new Error(`Unknown method ID: ${methodId}`);
  return method;
}