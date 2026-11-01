import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isTelegramAdminUser } from '../../config/telegram-ai';
import { splitMessageForTelegram } from './ai-context.builder';
import { enqueueTelegramMessage } from './telegram-client';
import { escapeHtml } from './message-formatters';

export interface AgyChatConfig {
  enabled: boolean;
  binaryPath: string;
  cwd: string;
  dangerouslySkipPermissions: boolean;
  mode: string;
  settingsPath?: string;
}

const defaultAgySettingsPath = path.resolve(__dirname, '../../../agy-settings.json');

export const agyChatConfig: AgyChatConfig = {
  enabled: process.env.AGY_CHAT_ENABLED !== 'false',
  binaryPath: process.env.AGY_BINARY_PATH || '/home/ubuntu/.local/bin/agy',
  cwd: process.env.AGY_CWD || path.resolve(__dirname, '../../..'),
  dangerouslySkipPermissions: process.env.AGY_SKIP_PERMISSIONS !== 'false', // Mặc định bật tự động duyệt tool trong headless mode
  mode: process.env.AGY_MODE || 'accept-edits', // Mặc định accept-edits để cho phép chỉnh sửa code/file
  settingsPath: process.env.AGY_SETTINGS_PATH || (fs.existsSync(defaultAgySettingsPath) ? defaultAgySettingsPath : undefined),
};

export const AGY_HELP = `🪐 <b>LỆNH ANTIGRAVITY (AGY CLI)</b>

• <code>/agy &lt;câu hỏi&gt;</code> — Hỏi tiếp (trong hội thoại đang chọn)
• <code>/agy list</code> — Danh sách các hội thoại cũ để chọn
• <code>/agy resume &lt;số hoặc ID&gt; [câu hỏi]</code> — Chọn hội thoại để tiếp tục
• <code>/agy new &lt;câu hỏi&gt;</code> — Bắt đầu một hội thoại mới
• <code>/agy status</code> — Xem trạng thái &amp; hội thoại đang chọn
• <code>/agy cancel</code> — Hủy lệnh agy đang thực thi

<i>⚙️ Không giới hạn thời gian chạy (timeout tắt). Dùng /agy cancel để dừng thủ công khi cần.</i>`;

export const AGY_HELP_PLAIN = `🪐 LỆNH ANTIGRAVITY (AGY CLI):
• /agy <câu hỏi> — Hỏi tiếp (trong hội thoại đang chọn)
• /agy list — Danh sách các hội thoại cũ để chọn
• /agy resume <số hoặc ID> [câu hỏi] — Chọn hội thoại để tiếp tục
• /agy new <câu hỏi> — Bắt đầu một hội thoại mới
• /agy status — Xem trạng thái & hội thoại đang chọn
• /agy cancel — Hủy lệnh agy đang thực thi

Không giới hạn thời gian chạy (timeout tắt). Dùng /agy cancel để dừng thủ công khi cần.`;

export interface AgySessionSummary {
  index: number;
  id: string;
  source: 'CLI' | 'IDE';
  createdAt: Date;
  updatedAt: Date;
  preview: string;
}

// Map chat_id -> ChildProcess đang chạy
const activeProcesses = new Map<string, { cp: ChildProcess; startedAt: number }>();

// Cache danh sách sessions vừa list gần nhất theo chatId (để map số thứ tự [1], [2], ...)
const lastListedSessions = new Map<string, AgySessionSummary[]>();

// Đường dẫn file lưu trữ active conversation mapping cho từng chat
const SESSIONS_STORE_PATH = path.resolve(__dirname, '../../../data/agy-telegram-sessions.json');

// Map lưu trữ chatId -> active conversationId
const activeConversationMap = new Map<string, string>();

// Khởi tạo activeConversationMap từ file nếu có
try {
  if (fs.existsSync(SESSIONS_STORE_PATH)) {
    const raw = fs.readFileSync(SESSIONS_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [cId, convId] of Object.entries(parsed)) {
      if (typeof convId === 'string' && convId.trim()) {
        activeConversationMap.set(cId, convId.trim());
      }
    }
  }
} catch {
  /* ignore file read error */
}

function persistActiveConversations(): void {
  try {
    const dir = path.dirname(SESSIONS_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of activeConversationMap.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(SESSIONS_STORE_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[AgyChat] failed to persist sessions store:', err);
  }
}

export function getActiveConversation(chatId: string): string | undefined {
  return activeConversationMap.get(chatId);
}

export function setActiveConversation(chatId: string, convId: string | undefined): void {
  if (convId) {
    activeConversationMap.set(chatId, convId);
  } else {
    activeConversationMap.delete(chatId);
  }
  persistActiveConversations();
}

/**
 * Định dạng thời gian theo múi giờ ICT (+07:00)
 */
function formatIct(date: Date): string {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(d.getUTCDate());
  const month = pad(d.getUTCMonth() + 1);
  const hours = pad(d.getUTCHours());
  const mins = pad(d.getUTCMinutes());
  return `${day}/${month} ${hours}:${mins}`;
}

/**
 * Loại bỏ ANSI escape sequences (màu sắc, formatting của terminal).
 */
export function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

export function chunkText(text: string, maxLen = 3800): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.5) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

export function isAgyChatActive(chatId: string): boolean {
  return activeProcesses.has(chatId);
}

export function cancelAgyChat(chatId: string): boolean {
  const item = activeProcesses.get(chatId);
  if (!item) return false;
  try {
    item.cp.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (!item.cp.killed) item.cp.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 2000);
  } catch {
    /* ignore */
  }
  activeProcesses.delete(chatId);
  return true;
}

/**
 * Quét toàn bộ các hội thoại Antigravity (CLI và IDE) trên server.
 */
export function listAgySessions(limit = 10): AgySessionSummary[] {
  const sessions: AgySessionSummary[] = [];
  const brainDirs: Array<{ path: string; source: 'CLI' | 'IDE' }> = [
    { path: '/home/ubuntu/.gemini/antigravity-cli/brain', source: 'CLI' },
    { path: '/home/ubuntu/.gemini/antigravity-ide/brain', source: 'IDE' },
  ];

  for (const { path: base, source } of brainDirs) {
    if (!fs.existsSync(base)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }

    for (const id of entries) {
      const fullDir = path.join(base, id);
      const transcriptPath = path.join(fullDir, '.system_generated/logs/transcript.jsonl');
      if (!fs.existsSync(transcriptPath)) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(transcriptPath);
      } catch {
        continue;
      }

      let preview = '(Hội thoại trống)';
      let createdAt = stat.birthtime || stat.mtime;

      try {
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const firstLine = content.split('\n')[0];
        if (firstLine) {
          const parsed = JSON.parse(firstLine);
          if (parsed.created_at) {
            createdAt = new Date(parsed.created_at);
          }
          if (parsed.content) {
            const match = parsed.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
            const rawReq = match ? match[1] : parsed.content;
            preview = rawReq.replace(/\s+/g, ' ').trim().slice(0, 90);
          }
        }
      } catch {
        /* ignore parse error */
      }

      sessions.push({
        index: 0,
        id,
        source,
        createdAt,
        updatedAt: stat.mtime,
        preview,
      });
    }
  }

  // Sắp xếp theo updatedAt giảm dần (hội thoại mới nhất lên đầu)
  sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return sessions.slice(0, limit).map((s, idx) => ({ ...s, index: idx + 1 }));
}

/**
 * Tìm session theo số thứ tự [1, 2, ...] hoặc theo ID / prefix ID.
 */
export function findSession(target: string, chatId?: string): AgySessionSummary | undefined {
  const t = target.trim();
  if (!t) return undefined;

  // Nếu là số thứ tự: ưu tiên tìm trong cache list của chat
  if (/^\d+$/.test(t)) {
    const num = parseInt(t, 10);
    const cached = chatId ? lastListedSessions.get(chatId) : undefined;
    if (cached && cached.length > 0) {
      const match = cached.find((s) => s.index === num);
      if (match) return match;
    }
    const fresh = listAgySessions(20);
    return fresh.find((s) => s.index === num);
  }

  // Nếu là ID hoặc prefix ID
  const all = listAgySessions(50);
  const lower = t.toLowerCase();
  return all.find((s) => s.id.toLowerCase().startsWith(lower) || s.id.toLowerCase() === lower);
}

/**
 * Định dạng danh sách hội thoại gửi qua Telegram (plain text / markdown thân thiện)
 */
export function formatSessionsList(sessions: AgySessionSummary[], activeId?: string): string {
  if (sessions.length === 0) {
    return '📋 Chưa có hội thoại Antigravity nào được lưu trên máy chủ.\nDùng /agy <câu hỏi> để tạo phiên mới.';
  }

  const lines = ['📋 DANH SÁCH HỘI THOẠI AGY GẦN ĐÂY:\n'];
  for (const s of sessions) {
    const isActive = activeId && s.id === activeId;
    const activeBadge = isActive ? ' ⭐ [Đang chọn]' : '';
    lines.push(
      `[${s.index}] ${s.id.slice(0, 8)}... (${formatIct(s.updatedAt)})${activeBadge}\n💬 "${s.preview}"\n`
    );
  }

  lines.push('-----------------------------');
  lines.push('👉 Gõ: /agy resume <số hoặc ID> để chọn tiếp tục.');
  lines.push('Ví dụ: /agy resume 1');
  lines.push('Hoặc vừa resume vừa hỏi:');
  lines.push('/agy resume 1 Giải thích tiếp logic này');

  return lines.join('\n');
}

/**
 * Tìm ID của conversation mới nhất vừa được tạo trong brain/
 */
function findLatestCliConversationId(): string | undefined {
  const cliBrain = '/home/ubuntu/.gemini/antigravity-cli/brain';
  if (!fs.existsSync(cliBrain)) return undefined;
  try {
    const entries = fs.readdirSync(cliBrain);
    let newestId: string | undefined;
    let newestTime = 0;
    for (const e of entries) {
      const p = path.join(cliBrain, e);
      const stat = fs.statSync(p);
      if (stat.isDirectory() && stat.mtimeMs > newestTime) {
        newestTime = stat.mtimeMs;
        newestId = e;
      }
    }
    return newestId;
  } catch {
    return undefined;
  }
}

/**
 * Thực thi agy CLI và trả về output văn bản (KHÔNG GIỚI HẠN TIMEOUT).
 */
export async function runAgyCli(
  question: string,
  chatId: string,
  options: { conversationId?: string; isNew?: boolean } = {}
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const cmdArgs: string[] = ['-p', question, '--output-format', 'text'];

    if (options.conversationId) {
      cmdArgs.push('--conversation', options.conversationId);
    } else if (!options.isNew) {
      cmdArgs.push('--continue');
    }

    if (agyChatConfig.dangerouslySkipPermissions) {
      cmdArgs.push('--dangerously-skip-permissions');
    }

    if (process.env.AGY_MODEL) {
      cmdArgs.push('--model', process.env.AGY_MODEL);
    }

    console.log(
      `[AgyChat] Running agy for chat=${chatId} convId=${options.conversationId || 'none'} isNew=${!!options.isNew} prompt=${question.slice(0, 80)}`
    );

    const spawnEnv = {
      ...process.env,
      PATH: `/home/ubuntu/.local/bin:${process.env.PATH || ''}`,
    };

    let stdoutData = '';
    let stderrData = '';

    const cp = spawn(agyChatConfig.binaryPath, cmdArgs, {
      cwd: agyChatConfig.cwd,
      env: spawnEnv,
    });

    const startedAt = Date.now();
    activeProcesses.set(chatId, { cp, startedAt });

    // KHÔNG đặt timeout timer: Cho phép tác vụ chạy thoải mái không giới hạn thời gian.
    // Người dùng có thể chủ động ngắt bằng lệnh /agy cancel.

    cp.stdout?.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString();
    });

    cp.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    cp.on('close', (code, signal) => {
      activeProcesses.delete(chatId);

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        resolve({ ok: false, output: '🛑 Đã dừng tiến trình Antigravity.' });
        return;
      }

      // Nếu vừa tạo new session, cập nhật conversation ID mới nhất vào active map
      if (options.isNew) {
        const latestId = findLatestCliConversationId();
        if (latestId) {
          setActiveConversation(chatId, latestId);
          console.log(`[AgyChat] New session created and set as active: ${latestId}`);
        }
      }

      const cleanOutput = stripAnsi(stdoutData).trim();
      const cleanError = stripAnsi(stderrData).trim();

      if (code !== 0 && !cleanOutput) {
        console.error(`[AgyChat] process exited code=${code}: ${cleanError}`);
        const errNote = cleanError ? `\nChi tiết: ${cleanError.slice(0, 500)}` : '';
        resolve({
          ok: false,
          output: `❌ Lỗi khi chạy Antigravity CLI (code ${code}).${errNote}`,
        });
        return;
      }

      const replyText = cleanOutput || cleanError || 'Antigravity đã thực hiện xong (không có text output).';
      resolve({ ok: true, output: replyText });
    });

    cp.on('error', (err) => {
      activeProcesses.delete(chatId);
      console.error('[AgyChat] spawn error:', err);
      resolve({
        ok: false,
        output: `❌ Không thể khởi chạy binary agy: ${err.message}`,
      });
    });
  });
}

/**
 * Xử lý lệnh /agy resume <target> [câu hỏi]
 */
async function processResumeCommand(
  chatId: string,
  args: string,
  sendFn: (chatId: string, text: string) => Promise<unknown>
): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const target = parts[0];
  const restQuestion = parts.slice(1).join(' ').trim();

  if (!target) {
    const active = getActiveConversation(chatId);
    if (active) {
      await sendFn(
        chatId,
        `ℹ️ Hội thoại đang chọn hiện tại:\n🆔 ${active}\nGõ /agy list để xem các hội thoại khác hoặc /agy resume <số> để đổi.`
      );
    } else {
      await sendFn(chatId, '👉 Cú pháp: /agy resume <số hoặc ID> [câu hỏi]\nGõ /agy list để xem danh sách.');
    }
    return;
  }

  const session = findSession(target, chatId);
  if (!session) {
    await sendFn(
      chatId,
      `❌ Không tìm thấy hội thoại nào khớp với "${target}".\nGõ /agy list để xem danh sách hội thoại có sẵn.`
    );
    return;
  }

  // Đặt làm active conversation
  setActiveConversation(chatId, session.id);

  if (restQuestion) {
    await sendFn(
      chatId,
      `🔄 Đang tiếp tục hội thoại [${session.index}] (${session.id.slice(0, 8)}...)\n💬 "${session.preview}"\n(Không giới hạn thời gian, dùng /agy cancel nếu muốn dừng)...`
    );
    const result = await runAgyCli(restQuestion, chatId, { conversationId: session.id });
    const chunks = chunkText(result.output, 3800);
    for (const chunk of chunks) {
      await sendFn(chatId, chunk);
    }
  } else {
    await sendFn(
      chatId,
      `✅ Đã chọn tiếp tục hội thoại [${session.index}]:\n🆔 ${session.id}\n💬 "${session.preview}"\n\nTất cả câu hỏi /agy tiếp theo sẽ tiếp tục trong hội thoại này!`
    );
  }
}

/**
 * Handler cho hybrid-live worker (sử dụng sendFn trực tiếp)
 */
export async function handleHybridAgyCommand(
  chatId: string,
  rawText: string,
  sendFn: (chatId: string, text: string) => Promise<string>
): Promise<void> {
  if (!agyChatConfig.enabled) {
    await sendFn(chatId, '⚠️ Tính năng /agy đang tạm tắt (AGY_CHAT_ENABLED=false).');
    return;
  }

  const args = rawText.replace(/^\/agy\s*/i, '').trim();
  const lower = args.toLowerCase();

  if (!args || lower === 'help') {
    await sendFn(chatId, AGY_HELP_PLAIN);
    return;
  }

  if (lower === 'list' || lower === 'sessions' || lower === 'ls') {
    const sessions = listAgySessions(10);
    lastListedSessions.set(chatId, sessions);
    const activeId = getActiveConversation(chatId);
    await sendFn(chatId, formatSessionsList(sessions, activeId));
    return;
  }

  if (lower === 'cancel') {
    const cancelled = cancelAgyChat(chatId);
    await sendFn(
      chatId,
      cancelled ? '🛑 Đã dừng tiến trình Antigravity đang chạy.' : 'Không có lệnh agy nào đang chạy.'
    );
    return;
  }

  if (lower === 'status') {
    const item = activeProcesses.get(chatId);
    const activeId = getActiveConversation(chatId);
    const lines = ['🪐 TRẠNG THÁI ANTIGRAVITY (AGY):'];

    if (item) {
      const runningSec = Math.round((Date.now() - item.startedAt) / 1000);
      lines.push(`• Tiến trình: ⏳ Đang xử lý (${runningSec}s trôi qua)`);
    } else {
      lines.push('• Tiến trình: ✅ Đang rảnh rỗi');
    }

    if (activeId) {
      const s = findSession(activeId, chatId);
      lines.push(`• Hội thoại đang chọn: 🆔 ${activeId.slice(0, 8)}...`);
      if (s) lines.push(`  💬 "${s.preview}"`);
    } else {
      lines.push('• Hội thoại: Tiếp tục phiên gần nhất (chưa cố định ID). Gõ /agy list để chọn.');
    }

    lines.push('• Thời gian chờ: Không giới hạn (timeout tắt, dùng /agy cancel để ngắt)');
    await sendFn(chatId, lines.join('\n'));
    return;
  }

  if (lower.startsWith('resume')) {
    const resumeArgs = args.replace(/^resume\s*/i, '').trim();
    await processResumeCommand(chatId, resumeArgs, sendFn);
    return;
  }

  const isNew = lower === 'new' || lower.startsWith('new ');
  const question = isNew ? args.replace(/^new\s*/i, '').trim() : args;

  if (isNew && !question) {
    setActiveConversation(chatId, undefined);
    await sendFn(
      chatId,
      '✅ Đã đánh dấu phiên mới cho AGY. Hãy gửi câu hỏi tiếp theo với /agy <câu hỏi>.'
    );
    return;
  }

  if (activeProcesses.has(chatId)) {
    await sendFn(
      chatId,
      '⏳ Antigravity đang thực hiện một lệnh khác cho chat này. Dùng /agy cancel nếu muốn hủy.'
    );
    return;
  }

  const activeConvId = isNew ? undefined : getActiveConversation(chatId);
  const promptNote = activeConvId
    ? `tiếp tục hội thoại ${activeConvId.slice(0, 8)}...`
    : isNew
    ? 'tạo hội thoại mới'
    : 'tiếp tục phiên gần nhất';

  await sendFn(chatId, `🪐 Antigravity đang xử lý (${promptNote}, không giới hạn thời gian)...`);

  const result = await runAgyCli(question, chatId, {
    conversationId: activeConvId,
    isNew,
  });

  const chunks = chunkText(result.output, 3800);
  for (const chunk of chunks) {
    try {
      await sendFn(chatId, chunk);
    } catch (err) {
      console.error('[AgyChat] failed to send chunk:', err);
    }
  }
}

/**
 * Handler cho telegram-bot.service (legacy worker)
 */
export async function handleAgyCommand(
  chatId: string,
  userId: string | undefined,
  args: string
): Promise<void> {
  if (!agyChatConfig.enabled) {
    enqueueTelegramMessage('⚠️ Tính năng /agy đang tạm tắt (AGY_CHAT_ENABLED=false).', chatId);
    return;
  }

  // Bảo mật: Chỉ cho phép admin trong whitelist
  if (!isTelegramAdminUser(userId)) {
    enqueueTelegramMessage('⛔ Lệnh /agy chỉ dành cho admin (TELEGRAM_ALLOWED_USER_IDS).', chatId);
    return;
  }

  const trimmed = args.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed || lower === 'help') {
    enqueueTelegramMessage(AGY_HELP, chatId);
    return;
  }

  if (lower === 'list' || lower === 'sessions' || lower === 'ls') {
    const sessions = listAgySessions(10);
    lastListedSessions.set(chatId, sessions);
    const activeId = getActiveConversation(chatId);
    enqueueTelegramMessage(formatSessionsList(sessions, activeId), chatId, { plainText: true });
    return;
  }

  if (lower === 'cancel') {
    const cancelled = cancelAgyChat(chatId);
    enqueueTelegramMessage(
      cancelled ? '🛑 Đã dừng tiến trình Antigravity đang chạy.' : 'Không có lệnh agy nào đang chạy.',
      chatId
    );
    return;
  }

  if (lower === 'status') {
    const item = activeProcesses.get(chatId);
    const activeId = getActiveConversation(chatId);
    const lines = ['<b>🪐 TRẠNG THÁI ANTIGRAVITY (AGY):</b>'];

    if (item) {
      const runningSec = Math.round((Date.now() - item.startedAt) / 1000);
      lines.push(`• Tiến trình: ⏳ Đang xử lý (${runningSec}s trôi qua)`);
    } else {
      lines.push('• Tiến trình: ✅ Đang rảnh rỗi');
    }

    if (activeId) {
      const s = findSession(activeId, chatId);
      lines.push(`• Hội thoại đang chọn: <code>${escapeHtml(activeId)}</code>`);
      if (s) lines.push(`  💬 <i>${escapeHtml(s.preview)}</i>`);
    } else {
      lines.push('• Hội thoại: Tiếp tục phiên gần nhất. Gõ /agy list để chọn.');
    }

    lines.push('• Thời gian chờ: Không giới hạn (timeout tắt, dùng /agy cancel để ngắt)');
    enqueueTelegramMessage(lines.join('\n'), chatId);
    return;
  }

  if (lower.startsWith('resume')) {
    const resumeArgs = trimmed.replace(/^resume\s*/i, '').trim();
    await processResumeCommand(chatId, resumeArgs, async (cId, text) => {
      enqueueTelegramMessage(text, cId, { plainText: true });
    });
    return;
  }

  const isNew = lower === 'new' || lower.startsWith('new ');
  const question = isNew ? trimmed.replace(/^new\s*/i, '').trim() : trimmed;

  if (isNew && !question) {
    setActiveConversation(chatId, undefined);
    enqueueTelegramMessage(
      '✅ Đã đánh dấu phiên mới cho AGY. Hãy gửi câu hỏi tiếp theo với <code>/agy &lt;câu hỏi&gt;</code>.',
      chatId
    );
    return;
  }

  if (!question) {
    enqueueTelegramMessage(AGY_HELP, chatId);
    return;
  }

  if (activeProcesses.has(chatId)) {
    enqueueTelegramMessage(
      '⏳ Antigravity đang thực hiện một lệnh khác cho chat này. Dùng <code>/agy cancel</code> nếu muốn hủy.',
      chatId
    );
    return;
  }

  const activeConvId = isNew ? undefined : getActiveConversation(chatId);
  const promptNote = activeConvId
    ? `tiếp tục hội thoại ${activeConvId.slice(0, 8)}...`
    : isNew
    ? 'tạo hội thoại mới'
    : 'tiếp tục phiên gần nhất';

  enqueueTelegramMessage(`🪐 Antigravity đang xử lý (${promptNote}, không giới hạn thời gian)...`, chatId);

  const result = await runAgyCli(question, chatId, {
    conversationId: activeConvId,
    isNew,
  });

  if (!result.ok && result.output.startsWith('❌ Lỗi khi')) {
    enqueueTelegramMessage(escapeHtml(result.output), chatId);
    return;
  }

  const chunks = splitMessageForTelegram(result.output, 3800);
  for (const chunk of chunks) {
    enqueueTelegramMessage(chunk, chatId, { plainText: true });
  }
}
