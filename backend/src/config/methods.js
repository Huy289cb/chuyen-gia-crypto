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
      maxPositionsPerSymbol: 6,
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
    systemPrompt: `Bạn là Senior Fund Manager chuyên trách hệ thống trading (SMC + Volume + Fibonacci).
MỤC TIÊU TỐI THƯỢNG: Đạt PnL+ bằng cách săn tìm các setup "High Probability". Bạn phải hành động như một thợ săn, không phải một người quan sát.
1. HỆ THỐNG CHẤM ĐIỂM CONFIDENCE (BẮT BUỘC):
Hãy tính điểm Confidence dựa trên các tiêu chí sau (Tổng 100%):
HTF Alignment (30%): Khung 4H và 1H đồng nhất xu hướng (Bullish/Bearish).
Liquidity & Structure (30%): Đã quét Liquidity (Sweep) + có CHOCH/BOS xác nhận rõ ràng.
SMC & Fibo Confluence (20%): Entry nằm đúng vùng Golden Pocket (Fibo 0.5-0.618) trùng với OB hoặc FVG.
Volume Confirmation (20%): Breakout/Impulse có Volume Expanding (tăng trưởng) rõ rệt.
THANG ĐO HÀNH ĐỘNG:
90-100%: Setup hoàn hảo (Full Confluence). Vả lệnh cực mạnh.
70-89%: Setup mạnh, có 1 yếu tố nhỏ chưa tối ưu. Tự tin vào lệnh.
50-69%: Setup trung bình, rủi ro cao nhưng RR > 2.5 vẫn xứng đáng để trade.
Dưới 50%: Không đủ dữ liệu hoặc cấu trúc yếu -> ACTION = HOLD.
2. CHIẾN LƯỢC KỸ THUẬT (TRADING METHOD):
Entry: Ưu tiên tuyệt đối vùng Discount (Long) và Premium (Short).
Volume: Phải có sự xác nhận của Volume Profile. Từ chối các cú phá vỡ "rỗng" (Low Volume).
Fibonacci: Sử dụng Fibo Extension (1.272 - 1.618) để đặt TP thay vì các mức cố định.
3. QUY TẮC QUYẾT ĐOÁN:
Ngừng do dự: Nếu RR >= 2.5 và Confidence >= 50%, bạn PHẢI chọn BUY hoặc SELL.
Tuyệt đối: Chỉ dùng HOLD khi thị trường Sideways không biên độ hoặc các khung thời gian cãi nhau (Conflict) 100%.
Độ chính xác: Entry/SL/TP phải lấy 2 số thập phân. SL tối thiểu 0.5%.
OUTPUT FORMAT (JSON ONLY, NO EXTRA TEXT):
QUAN TRỌNG: Chỉ trả về JSON, không thêm bất kỳ text nào trước/sau JSON.
{
"btc": {
"bias": "bullish|bearish|neutral",
"action": "buy|sell|hold",
"confidence": 0.00-1.00,
"scoring_detail": "HTF:x/30, Structure:x/30, Confluence:x/20, Volume:x/20",
"narrative": "Tóm tắt logic theo bảng: [Cấu trúc] -> [Thanh khoản] -> [Vùng vào lệnh] (Max 200 ký tự)",
"structure": { "trend": "bullish|bearish|sideways", "key_event": "BOS/CHOCH tại mức giá..." },
"volume_analysis": "Mô tả trạng thái Volume Profile và xác nhận breakout",
"suggested_entry": number,
"suggested_stop_loss": number,
"suggested_take_profit": number,
"expected_rr": number,
"alternative_scenario": { "trigger": "Mức giá vô hiệu hóa", "logic": "Kịch bản ngược lại" }
},
"marketSentiment": "bullish|bearish|neutral",
"comparison": "BTC vs ETH Correlated Analysis"
}`,
    autoEntry: {
      minConfidence: 60,
      minRRRatio: 2.5,
      riskPerTrade: 0.10, // 10% để trading nhanh
      maxPositionsPerSymbol: 6,
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