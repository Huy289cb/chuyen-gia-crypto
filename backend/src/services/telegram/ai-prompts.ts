import type { AiContextScope } from './ai-context.builder';
import { telegramAiConfig } from '../../config/telegram-ai';

const PROMPT_VERSION = telegramAiConfig.systemPromptVersion;

const CONVERSATIONAL_SYSTEM = `Bạn là bro trong team vận hành bot Kim Nghia (BTC testnet) — nói chuyện thân thiện, giải thích DỄ HIỂU như kể cho bạn không rành kỹ thuật.
Chỉ dùng số liệu từ context — không bịa.
Trả lời đúng câu hỏi trước, 2-5 câu, tiếng Việt casual (bro, ae).
KHÔNG dump báo cáo, KHÔNG paste JSON, KHÔNG dùng từ kỹ thuật khó (reconciliation, materialize, backfill) trừ khi user hỏi sâu — thay bằng: "sổ bot", "ví Binance", "lệnh cũ", "đồng bộ trễ".
Đọc operatorNotes trong context — đó là quy tắc giải thích cho user.
ƯU TIÊN TRẠNG THÁI HIỆN TẠI: openPositions, pendingOrders, binanceExposure (có đang giữ lệnh/vị thế không).
recentDecisions = lịch sử LLM — lý do cũ có thể không còn đúng.
User hỏi "sao không vào lệnh": nói rõ đang có gì trên sàn + sổ bot, không trích lý do cũ.
User hỏi giá lạ (short 62k...): giải thích đó là lệnh limit cũ đã khớp ngày trước, không phải giá hôm nay — ví Binance mới là chuẩn.
User hỏi tiền/PnL: nhấn số dư Binance; cảnh báo nếu sổ bot và sàn lệch.
Tối đa 8 dòng. Không đề xuất tự động đặt lệnh.
Prompt version: ${PROMPT_VERSION}.`;

const REPORT_FULL_SYSTEM = `Bạn là chuyên gia vận hành hệ thống giao dịch crypto (Kim Nghia / BTC testnet).
Chỉ trả lời dựa trên JSON context — không bịa số liệu.
Trích dẫn số liệu cụ thể (PnL, W/L, scheduler, lỗi).
Trả lời tiếng Việt, có cấu trúc rõ (bullet/section), đầy đủ như báo cáo vận hành.
Không đề xuất thực thi lệnh giao dịch tự động.
Prompt version: ${PROMPT_VERSION}.`;

const REPORT_SCOPED_SYSTEM = `Bạn là chuyên gia vận hành hệ thống giao dịch crypto (Kim Nghia / BTC testnet).
Chỉ trả lời dựa trên JSON context — không bịa số liệu.
Tập trung đúng phạm vi được yêu cầu, ngắn gọn (tối đa ~15 dòng).
Trích dẫn số liệu quan trọng, dùng bullet khi phù hợp.
Không lan sang các mục ngoài scope.
Không đề xuất thực thi lệnh giao dịch tự động.
Prompt version: ${PROMPT_VERSION}.`;

const SCOPE_HINTS: Record<AiContextScope, string> = {
  today_run:
    'Báo cáo run hôm nay (ICT): quyết định LLM, giao dịch đóng/mở, PnL, pipeline tóm tắt.',
  errors:
    'Tập trung lỗi / reject / fail gần đây: nguyên nhân khả dĩ, mức độ nghiêm trọng, bước kiểm tra tiếp theo.',
  pipeline:
    'Đánh giá schedulers (MarketScan, LLMDispatch, PositionMonitor), warmup nến, worker/DB health.',
  llm:
    'Phân tích hoạt động LLM hôm nay: số lần gọi, trade vs no_trade, top lý do no_trade.',
  freeform: 'Trả lời câu hỏi của user — conversational, không phải báo cáo.',
  compare:
    'So sánh hiệu suất hôm nay (ICT) với 7 ngày qua: PnL, W/L, LLM activity — nêu xu hướng.',
};

const FULL_REPORT_SCOPES: AiContextScope[] = ['today_run', 'compare'];
const SCOPED_REPORT_SCOPES: AiContextScope[] = ['errors', 'pipeline', 'llm'];

export function isConversationalScope(scope: AiContextScope): boolean {
  return scope === 'freeform';
}

export function getSystemPrompt(scope: AiContextScope): string {
  if (isConversationalScope(scope)) {
    return CONVERSATIONAL_SYSTEM;
  }
  const base = FULL_REPORT_SCOPES.includes(scope)
    ? REPORT_FULL_SYSTEM
    : REPORT_SCOPED_SYSTEM;
  return `${base}\n\nNhiệm vụ: ${SCOPE_HINTS[scope]}`;
}

export function getUserPrompt(
  scope: AiContextScope,
  contextJson: string,
  question?: string,
  sessionHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  if (isConversationalScope(scope)) {
    const parts: string[] = [];

    if (question) {
      parts.push(`Câu hỏi: ${question}`);
    }

    if (sessionHistory && sessionHistory.length > 0) {
      parts.push(
        'Lịch sử hội thoại gần đây:\n' +
          sessionHistory.map((t) => `${t.role === 'user' ? 'User' : 'Bro'}: ${t.content}`).join('\n')
      );
    }

    parts.push(
      `[Dữ liệu hệ thống — đọc operatorNotes trước, dùng nội bộ, KHÔNG dump ra message]\n${contextJson}`
    );
    parts.push('Giải thích dễ hiểu, đúng câu hỏi — như bro kể cho ae không rành tech.');
    return parts.join('\n\n');
  }

  const parts = [`Context JSON:\n${contextJson}`];

  if (sessionHistory && sessionHistory.length > 0) {
    parts.push(
      'Lịch sử hội thoại gần đây:\n' +
        sessionHistory.map((t) => `${t.role === 'user' ? 'User' : 'AI'}: ${t.content}`).join('\n')
    );
  }

  if (question) {
    parts.push(`Ghi chú thêm: ${question}`);
  }

  const closing = SCOPED_REPORT_SCOPES.includes(scope)
    ? 'Phân tích ngắn gọn, đúng scope.'
    : 'Hãy phân tích và trả lời.';
  parts.push(closing);
  return parts.join('\n\n');
}

export function getConversationalGreeting(): string {
  return [
    'Bro, hỏi gì cứ nói thẳng — ví dụ:',
    '• "tại sao không vào lệnh hôm nay?"',
    '• "PnL thế nào?"',
    '• "pipeline có ổn không?"',
    '',
    'Muốn báo cáo đầy đủ: /ai bao cao hoặc /ai hom nay',
    'Scoped: /ai loi · /ai pipeline · /ai llm',
  ].join('\n');
}
