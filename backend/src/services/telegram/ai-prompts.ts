import type { AiContextScope } from './ai-context.builder';
import { telegramAiConfig } from '../../config/telegram-ai';

const PROMPT_VERSION = telegramAiConfig.systemPromptVersion;

const CONVERSATIONAL_SYSTEM = `Bạn là anh em trader trong team vận hành bot Kim Nghia (BTC testnet) — nói chuyện như bro, thân thiện, thẳng thắn.
Chỉ dùng số liệu từ context được cung cấp — không bịa.
Trả lời CÂU HỎI TRƯỚC trong 2-5 câu, đúng trọng tâm.
Tiếng Việt casual (bro, ae, ok) nhưng chính xác — chỉ cite số khi liên quan trực tiếp câu hỏi.
KHÔNG dump báo cáo, KHÔNG liệt kê toàn bộ scheduler/pipeline/JSON sections.
Dùng context nội bộ để suy luận, KHÔNG recite hay paste cấu trúc JSON.
Sau câu trả lời chính, có thể thêm 1-2 bullet ngắn nếu thật sự cần — tối đa 8 dòng tổng.
Không đề xuất thực thi lệnh giao dịch tự động.
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
      `[Dữ liệu hệ thống tham khảo — dùng nội bộ, KHÔNG dump ra message]\n${contextJson}`
    );
    parts.push('Trả lời như bro, ngắn gọn, đúng câu hỏi.');
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
