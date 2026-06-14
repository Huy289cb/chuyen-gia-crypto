import type { AiContextScope } from './ai-context.builder';
import { telegramAiConfig } from '../../config/telegram-ai';

const BASE_SYSTEM = `Bạn là chuyên gia vận hành hệ thống giao dịch crypto (Kim Nghia / BTC testnet).
Chỉ trả lời dựa trên JSON context được cung cấp — không bịa số liệu.
Trích dẫn số liệu cụ thể khi có (PnL, W/L, scheduler, lỗi).
Trả lời bằng tiếng Việt, ngắn gọn, dùng bullet khi phù hợp.
Không đề xuất thực thi lệnh giao dịch tự động.
Prompt version: ${telegramAiConfig.systemPromptVersion}.`;

const SCOPE_HINTS: Record<AiContextScope, string> = {
  today_run:
    'Phân tích run hôm nay (ICT): quyết định LLM, giao dịch đóng/mở, PnL, pipeline tóm tắt.',
  errors:
    'Tập trung lỗi / reject / fail gần đây: nguyên nhân khả dĩ, mức độ nghiêm trọng, bước kiểm tra tiếp theo.',
  pipeline:
    'Đánh giá schedulers (MarketScan, LLMDispatch, PositionMonitor), warmup nến, worker/DB health.',
  llm:
    'Phân tích hoạt động LLM hôm nay: số lần gọi, trade vs no_trade, top lý do no_trade.',
  freeform: 'Trả lời câu hỏi của user dựa trên toàn bộ context JSON.',
  compare:
    'So sánh hiệu suất hôm nay (ICT) với 7 ngày qua: PnL, W/L, LLM activity — nêu xu hướng.',
};

export function getSystemPrompt(scope: AiContextScope): string {
  return `${BASE_SYSTEM}\n\nNhiệm vụ: ${SCOPE_HINTS[scope]}`;
}

export function getUserPrompt(
  scope: AiContextScope,
  contextJson: string,
  question?: string,
  sessionHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const parts = [`Context JSON:\n${contextJson}`];

  if (sessionHistory && sessionHistory.length > 0) {
    parts.push(
      'Lịch sử hội thoại gần đây:\n' +
        sessionHistory.map((t) => `${t.role === 'user' ? 'User' : 'AI'}: ${t.content}`).join('\n')
    );
  }

  if (scope === 'freeform' && question) {
    parts.push(`Câu hỏi: ${question}`);
  } else if (question) {
    parts.push(`Ghi chú thêm: ${question}`);
  }

  parts.push('Hãy phân tích và trả lời.');
  return parts.join('\n\n');
}
