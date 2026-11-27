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
  model: string;
  settingsPath?: string;
}

export type AgyEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const AGY_EFFORT_LEVELS: readonly AgyEffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_AGY_MODEL = 'gemini-4-hydrogen-high';

export interface AgyChatPreferences {
  model?: string;
  effort?: AgyEffortLevel;
}

export interface AgyModelInfo {
  index: number;
  slug: string;
  label: string;
}

export interface AgyEffortInfo {
  ok: boolean;
  adjustable: boolean;
  current?: AgyEffortLevel;
  available: AgyEffortLevel[];
  error?: string;
}

export interface ResolvedAgyModelConfig {
  model: string;
  effort?: AgyEffortLevel;
  cliArgs: string[];
  isDefault: boolean;
  displayModel: string;
}

const defaultAgySettingsPath = path.resolve(__dirname, '../../../agy-settings.json');

export const agyChatConfig: AgyChatConfig = {
  enabled: process.env.AGY_CHAT_ENABLED !== 'false',
  binaryPath: process.env.AGY_BINARY_PATH || '/home/ubuntu/.local/bin/agy',
  cwd: process.env.AGY_CWD || path.resolve(__dirname, '../../..'),
  dangerouslySkipPermissions: process.env.AGY_SKIP_PERMISSIONS !== 'false', // Mặc định bật tự động duyệt tool trong headless mode
  mode: process.env.AGY_MODE || 'accept-edits', // Mặc định accept-edits để cho phép chỉnh sửa code/file
  model: process.env.AGY_MODEL?.trim() || DEFAULT_AGY_MODEL,
  settingsPath: process.env.AGY_SETTINGS_PATH || (fs.existsSync(defaultAgySettingsPath) ? defaultAgySettingsPath : undefined),
};

export const AGY_HELP = `🪐 <b>LỆNH ANTIGRAVITY (AGY CLI)</b>

• <code>/agy &lt;câu hỏi&gt;</code> — Hỏi tiếp (trong hội thoại đang chọn)
• <code>/agy list</code> — Danh sách các hội thoại cũ để chọn
• <code>/agy resume &lt;số hoặc ID&gt; [câu hỏi]</code> — Chọn hội thoại để tiếp tục
• <code>/agy new &lt;câu hỏi&gt;</code> — Bắt đầu một hội thoại mới
• <code>/agy models</code> — Xem danh sách model khả dụng
• <code>/agy model &lt;số hoặc slug|default&gt;</code> — Đổi model cho chat hiện tại
• <code>/agy effort &lt;low|medium|high|xhigh|max|default&gt;</code> — Đổi mức suy luận
• <code>/agy status</code> — Xem trạng thái, model &amp; hội thoại đang chọn
• <code>/agy cancel</code> — Hủy lệnh agy đang thực thi

<i>⚙️ Không giới hạn thời gian chạy (timeout tắt). Dùng /agy cancel để dừng thủ công khi cần.</i>`;

export const AGY_HELP_PLAIN = `🪐 LỆNH ANTIGRAVITY (AGY CLI):
• /agy <câu hỏi> — Hỏi tiếp (trong hội thoại đang chọn)
• /agy list — Danh sách các hội thoại cũ để chọn
• /agy resume <số hoặc ID> [câu hỏi] — Chọn hội thoại để tiếp tục
• /agy new <câu hỏi> — Bắt đầu một hội thoại mới
• /agy models — Xem danh sách model khả dụng
• /agy model <số hoặc slug|default> — Đổi model cho chat hiện tại
• /agy effort <low|medium|high|xhigh|max|default> — Đổi mức suy luận
• /agy status — Xem trạng thái, model & hội thoại đang chọn
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

// Cache danh sách model vừa liệt kê gần nhất theo chatId (để map số thứ tự [1], [2], ...)
const lastListedModels = new Map<string, AgyModelInfo[]>();
let cachedAvailableModels: AgyModelInfo[] | null = null;

function getSettingsStorePath(): string {
  return process.env.AGY_SETTINGS_STORE_PATH?.trim() || path.resolve(__dirname, '../../../data/agy-telegram-settings.json');
}

const chatPreferencesMap = new Map<string, AgyChatPreferences>();

export function parseEffortLevel(raw: string | undefined): AgyEffortLevel | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return undefined;
  return AGY_EFFORT_LEVELS.includes(normalized as AgyEffortLevel) ? (normalized as AgyEffortLevel) : undefined;
}

export function splitModelSlugAndEffort(slug: string): { baseModel: string; suffixEffort?: AgyEffortLevel } {
  const match = slug.trim().match(/^(.+)-(low|medium|high|xhigh|max)$/i);
  if (!match) {
    return { baseModel: slug.trim() };
  }
  return {
    baseModel: match[1],
    suffixEffort: match[2].toLowerCase() as AgyEffortLevel,
  };
}

try {
  const storePath = getSettingsStorePath();
  if (fs.existsSync(storePath)) {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, AgyChatPreferences>;
    for (const [cId, prefs] of Object.entries(parsed)) {
      if (!prefs || typeof prefs !== 'object') continue;
      const model = typeof prefs.model === 'string' && prefs.model.trim() ? prefs.model.trim() : undefined;
      const effort = typeof prefs.effort === 'string' ? parseEffortLevel(prefs.effort) : undefined;
      if (model || effort) {
        chatPreferencesMap.set(cId, { ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
      }
    }
  }
} catch {
  /* ignore settings read error */
}

function persistChatPreferences(): void {
  try {
    const storePath = getSettingsStorePath();
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, AgyChatPreferences> = {};
    for (const [k, v] of chatPreferencesMap.entries()) {
      if (v.model || v.effort) {
        obj[k] = v;
      }
    }
    fs.writeFileSync(storePath, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[AgyChat] failed to persist settings store:', err);
  }
}

export function getChatAgyPreferences(chatId: string): AgyChatPreferences {
  const prefs = chatPreferencesMap.get(chatId);
  return prefs ? { ...prefs } : {};
}

export function setChatAgyPreferences(chatId: string, prefs: AgyChatPreferences | undefined): void {
  const model = prefs?.model?.trim() || undefined;
  const effort = prefs?.effort;
  if (!model && !effort) {
    chatPreferencesMap.delete(chatId);
  } else {
    chatPreferencesMap.set(chatId, { ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
  }
  persistChatPreferences();
}

export function getDefaultAgyModel(): string {
  return process.env.AGY_MODEL?.trim() || agyChatConfig.model || DEFAULT_AGY_MODEL;
}

export function resolveAgyCliModelArgs(chatId?: string): ResolvedAgyModelConfig {
  const defaultModel = getDefaultAgyModel();
  const prefs = chatId ? chatPreferencesMap.get(chatId) : undefined;
  const rawModel = prefs?.model?.trim() || defaultModel;
  const { baseModel, suffixEffort } = splitModelSlugAndEffort(rawModel);

  if (prefs?.effort) {
    return {
      model: baseModel,
      effort: prefs.effort,
      cliArgs: ['--model', baseModel, '--effort', prefs.effort],
      isDefault: false,
      displayModel: `${baseModel} (effort: ${prefs.effort})`,
    };
  }

  return {
    model: rawModel,
    effort: suffixEffort,
    cliArgs: ['--model', rawModel],
    isDefault: !prefs?.model && !prefs?.effort,
    displayModel: rawModel,
  };
}

export function getAgyModel(chatId?: string): string {
  return resolveAgyCliModelArgs(chatId).displayModel;
}

function buildAgySpawnEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `/home/ubuntu/.local/bin:${process.env.PATH || ''}`,
  };
}

function execAgyCommand(
  cmdArgs: string[],
  timeoutMs = 20_000
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let settled = false;

    const cp = spawn(agyChatConfig.binaryPath, cmdArgs, {
      cwd: agyChatConfig.cwd,
      env: buildAgySpawnEnv(),
    });

    const finish = (res: { ok: boolean; stdout: string; stderr: string; code: number | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const timer = setTimeout(() => {
      try {
        cp.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      finish({ ok: false, stdout: stdoutData, stderr: stderrData || 'Timeout', code: null });
    }, timeoutMs);

    cp.stdout?.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString();
    });
    cp.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });
    cp.on('close', (code) => {
      finish({ ok: code === 0, stdout: stdoutData, stderr: stderrData, code });
    });
    cp.on('error', (err) => {
      finish({ ok: false, stdout: stdoutData, stderr: err.message, code: null });
    });
  });
}

export function parseAgyModelsOutput(raw: string): AgyModelInfo[] {
  const clean = stripAnsi(raw);
  const models: AgyModelInfo[] = [];
  for (const line of clean.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^fetching available models/i.test(trimmed)) continue;
    const match = trimmed.match(/^([a-z0-9][a-z0-9._-]*)(?:\t+|\s{2,})(.+)$/i);
    if (!match) continue;
    models.push({
      index: models.length + 1,
      slug: match[1].trim(),
      label: match[2].trim(),
    });
  }
  return models;
}

export async function fetchAgyModels(): Promise<AgyModelInfo[]> {
  const res = await execAgyCommand(['models'], 25_000);
  const parsed = parseAgyModelsOutput(`${res.stdout}\n${res.stderr}`);
  if (parsed.length > 0) {
    cachedAvailableModels = parsed;
  }
  return parsed;
}

async function getOrFetchAgyModels(): Promise<AgyModelInfo[]> {
  if (cachedAvailableModels && cachedAvailableModels.length > 0) {
    return cachedAvailableModels;
  }
  return fetchAgyModels();
}

export async function inspectAgyEffort(
  modelSlug: string,
  effortOverride?: AgyEffortLevel
): Promise<AgyEffortInfo> {
  const args = ['-p', '/effort', '--output-format', 'json', '--model', modelSlug];
  if (effortOverride) {
    args.push('--effort', effortOverride);
  }
  const res = await execAgyCommand(args, 25_000);
  const cleanOut = stripAnsi(res.stdout).trim();
  const jsonLine = cleanOut
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith('{') && l.endsWith('}'));

  if (!jsonLine) {
    return {
      ok: false,
      adjustable: false,
      available: [],
      error: stripAnsi(res.stderr).trim() || cleanOut || 'Không nhận được phản hồi JSON từ agy.',
    };
  }

  try {
    const parsed = JSON.parse(jsonLine) as {
      status?: string;
      error?: string;
      command?: {
        data?: {
          adjustable?: boolean;
          current?: string;
          available?: string[];
        };
      };
    };
    if (parsed.status !== 'SUCCESS') {
      return {
        ok: false,
        adjustable: false,
        available: [],
        error: parsed.error || stripAnsi(res.stderr).trim() || 'agy trả về trạng thái lỗi.',
      };
    }
    const data = parsed.command?.data;
    const available = (data?.available || [])
      .map((item) => parseEffortLevel(item))
      .filter((item): item is AgyEffortLevel => Boolean(item));
    return {
      ok: true,
      adjustable: Boolean(data?.adjustable),
      current: parseEffortLevel(data?.current),
      available,
    };
  } catch {
    return {
      ok: false,
      adjustable: false,
      available: [],
      error: 'Không parse được JSON phản hồi từ agy /effort.',
    };
  }
}

function findModelInList(
  models: AgyModelInfo[],
  rawTarget: string,
  preferredEffort?: AgyEffortLevel
): AgyModelInfo | undefined {
  const target = rawTarget.trim();
  if (!target) return undefined;

  if (/^\d+$/.test(target)) {
    const idx = parseInt(target, 10);
    return models.find((m) => m.index === idx);
  }

  const lower = target.toLowerCase();
  const exactSlug = models.find((m) => m.slug.toLowerCase() === lower);
  if (exactSlug) return exactSlug;

  const exactLabel = models.find((m) => m.label.toLowerCase() === lower);
  if (exactLabel) return exactLabel;

  if (preferredEffort) {
    const withRequestedEffort = models.find((m) => m.slug.toLowerCase() === `${lower}-${preferredEffort}`);
    if (withRequestedEffort) return withRequestedEffort;
  }

  const withDefaultHigh = models.find((m) => m.slug.toLowerCase() === `${lower}-high`);
  if (withDefaultHigh) return withDefaultHigh;

  const prefixMatches = models.filter((m) => m.slug.toLowerCase().startsWith(`${lower}-`) || m.slug.toLowerCase().startsWith(lower));
  if (prefixMatches.length > 0) {
    return prefixMatches[0];
  }

  return models.find((m) => m.label.toLowerCase().includes(lower));
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
            const cleanReq = rawReq.replace(/\[Lưu ý định dạng:[\s\S]*?\]/gi, '').trim();
            preview = cleanReq.replace(/\s+/g, ' ').trim().slice(0, 90);
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
  options: { conversationId?: string; isNew?: boolean; imagePath?: string } = {}
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let promptWithImage = question;
    if (options.imagePath) {
      promptWithImage = `[Người dùng gửi kèm ảnh biểu đồ được lưu tại tệp: ${options.imagePath}. Hãy sử dụng công cụ read_file để đọc nội dung ảnh biểu đồ này và phân tích chi tiết: nhận diện mã coin, khung thời gian, các đường kẻ trendline, vùng hỗ trợ/kháng cự, chỉ báo và mũi tên/ghi chú kẻ vẽ trên ảnh].\n\nYêu cầu phân tích: ${question}`;
    }

    const promptWithFormatHint = `${promptWithImage}\n\n[Lưu ý định dạng: Trả lời qua tin nhắn Telegram mobile. Áp dụng skill telegram-chat-style: trực quan, chia đoạn ngắn, dùng bullet point và emoji sinh động, không dùng bảng markdown rộng hay trích xuất log terminal quá dài].`;
    const cmdArgs: string[] = ['-p', promptWithFormatHint, '--output-format', 'text'];

    if (options.conversationId) {
      cmdArgs.push('--conversation', options.conversationId);
    } else if (!options.isNew) {
      cmdArgs.push('--continue');
    }

    if (agyChatConfig.dangerouslySkipPermissions) {
      cmdArgs.push('--dangerously-skip-permissions');
    }

    const resolvedModel = resolveAgyCliModelArgs(chatId);
    cmdArgs.push(...resolvedModel.cliArgs);

    console.log(
      `[AgyChat] Running agy for chat=${chatId} convId=${options.conversationId || 'none'} isNew=${!!options.isNew} model=${resolvedModel.model} effort=${resolvedModel.effort || 'default'} prompt=${question.slice(0, 80)}`
    );

    let stdoutData = '';
    let stderrData = '';

    const cp = spawn(agyChatConfig.binaryPath, cmdArgs, {
      cwd: agyChatConfig.cwd,
      env: buildAgySpawnEnv(),
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
 * Quản lý lệnh /agy models, /agy model, /agy effort (dùng chung cho hybrid và legacy)
 */
async function processModelsCommand(
  chatId: string,
  sendFn: (chatId: string, text: string) => Promise<unknown>
): Promise<void> {
  const models = await fetchAgyModels();
  if (models.length === 0) {
    await sendFn(chatId, '❌ Không lấy được danh sách model từ agy CLI. Vui lòng thử lại sau.');
    return;
  }

  lastListedModels.set(chatId, models);
  const resolved = resolveAgyCliModelArgs(chatId);
  const activeSlug =
    resolved.cliArgs.includes('--effort') && resolved.effort
      ? `${resolved.model}-${resolved.effort}`.toLowerCase()
      : resolved.model.toLowerCase();

  const lines = ['🤖 DANH SÁCH MODEL ANTIGRAVITY (AGY):\n'];
  for (const m of models) {
    const isActive = m.slug.toLowerCase() === activeSlug;
    const badge = isActive ? ' ⭐ [Đang chọn]' : '';
    lines.push(`[${m.index}] ${m.slug}${badge}\n    ${m.label}`);
  }
  lines.push('');
  lines.push(`📌 Mặc định hệ thống: ${getDefaultAgyModel()}`);
  lines.push('👉 Đổi model: /agy model <số hoặc slug>');
  lines.push('👉 Đổi effort: /agy effort <low|medium|high|xhigh|max>');
  lines.push('👉 Về mặc định: /agy model default');
  await sendFn(chatId, lines.join('\n'));
}

async function processModelCommand(
  chatId: string,
  args: string,
  sendFn: (chatId: string, text: string) => Promise<unknown>
): Promise<void> {
  const trimmed = args.trim();
  const resolved = resolveAgyCliModelArgs(chatId);

  if (!trimmed) {
    const lines = [
      '🤖 CẤU HÌNH MODEL HIỆN TẠI:',
      `• Model: ${resolved.displayModel}${resolved.isDefault ? ' (mặc định)' : ' (tùy chỉnh)'}`,
      `• Effort: ${resolved.effort || 'theo model'}`,
      '',
      '👉 Gõ /agy models để xem danh sách.',
      '👉 Đổi model: /agy model <số hoặc slug>',
      '👉 Đổi effort: /agy effort <low|medium|high|xhigh|max>',
      '👉 Về mặc định: /agy model default',
    ];
    await sendFn(chatId, lines.join('\n'));
    return;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'default' || lower === 'reset') {
    setChatAgyPreferences(chatId, undefined);
    const nextResolved = resolveAgyCliModelArgs(chatId);
    await sendFn(
      chatId,
      `✅ Đã đặt lại model về mặc định:\n• Model: ${nextResolved.displayModel}\n• Effort: ${nextResolved.effort || 'theo model'}`
    );
    return;
  }

  const tokens = trimmed.split(/\s+/);
  const trailingEffort = tokens.length >= 2 ? parseEffortLevel(tokens[tokens.length - 1]) : undefined;
  const rawTarget = trailingEffort ? tokens.slice(0, -1).join(' ') : trimmed;
  const isNumeric = /^\d+$/.test(rawTarget);

  let models = isNumeric ? lastListedModels.get(chatId) || (await getOrFetchAgyModels()) : await getOrFetchAgyModels();
  let matched = findModelInList(models, rawTarget, trailingEffort);
  if (!matched && !isNumeric) {
    models = await fetchAgyModels();
    matched = findModelInList(models, rawTarget, trailingEffort);
  }

  if (!matched) {
    await sendFn(
      chatId,
      `❌ Không tìm thấy model khớp với "${rawTarget}".\nGõ /agy models để xem danh sách model khả dụng.`
    );
    return;
  }

  if (trailingEffort) {
    const { baseModel } = splitModelSlugAndEffort(matched.slug);
    const effortSlug = models.find((m) => m.slug.toLowerCase() === `${baseModel}-${trailingEffort}`.toLowerCase());
    if (effortSlug) {
      setChatAgyPreferences(chatId, { model: effortSlug.slug });
    } else {
      const check = await inspectAgyEffort(baseModel, trailingEffort);
      if (!check.ok) {
        await sendFn(
          chatId,
          `❌ Không thể dùng effort "${trailingEffort}" cho ${matched.slug}: ${check.error || 'Không được hỗ trợ'}`
        );
        return;
      }
      setChatAgyPreferences(chatId, { model: baseModel, effort: trailingEffort });
    }
  } else {
    setChatAgyPreferences(chatId, { model: matched.slug });
  }

  const updated = resolveAgyCliModelArgs(chatId);
  const busyNote = activeProcesses.has(chatId)
    ? '\n⏳ Lệnh đang chạy hiện tại vẫn hoàn tất bằng cấu hình cũ; cấu hình mới áp dụng từ tin nhắn tiếp theo.'
    : '';
  await sendFn(
    chatId,
    `✅ Đã cập nhật model cho chat này:\n• Model: ${updated.displayModel}\n• Effort: ${updated.effort || 'theo model'}${busyNote}`
  );
}

async function processEffortCommand(
  chatId: string,
  args: string,
  sendFn: (chatId: string, text: string) => Promise<unknown>
): Promise<void> {
  const trimmed = args.trim();
  const resolved = resolveAgyCliModelArgs(chatId);
  const currentPrefs = getChatAgyPreferences(chatId);

  if (!trimmed) {
    const info = await inspectAgyEffort(resolved.model, currentPrefs.effort);
    const lines = [
      '🧠 CẤU HÌNH EFFORT HIỆN TẠI:',
      `• Model: ${resolved.displayModel}`,
      `• Effort hiện tại: ${info.current || resolved.effort || 'cố định theo model'}`,
    ];
    if (info.ok && !info.adjustable) {
      lines.push('• Khả năng điều chỉnh: Không (model dùng mức suy luận cố định)');
    } else if (info.available.length > 0) {
      lines.push(`• Các mức hỗ trợ: ${info.available.join(', ')}`);
    } else if (!info.ok && info.error) {
      lines.push(`• Ghi chú kiểm tra: ${info.error}`);
    }
    lines.push('\n👉 Đổi effort: /agy effort <low|medium|high|xhigh|max|default>');
    await sendFn(chatId, lines.join('\n'));
    return;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'default' || lower === 'reset') {
    const defaultModel = getDefaultAgyModel();
    const { baseModel: defaultBase } = splitModelSlugAndEffort(defaultModel);
    const { baseModel: currentBase } = splitModelSlugAndEffort(resolved.model);
    if (!currentPrefs.model || currentBase.toLowerCase() === defaultBase.toLowerCase()) {
      setChatAgyPreferences(chatId, undefined);
    } else {
      const models = await getOrFetchAgyModels();
      const highVariant = models.find((m) => m.slug.toLowerCase() === `${currentBase.toLowerCase()}-high`);
      if (highVariant) {
        setChatAgyPreferences(chatId, { model: highVariant.slug });
      } else {
        setChatAgyPreferences(chatId, { model: currentPrefs.model });
      }
    }
    const nextResolved = resolveAgyCliModelArgs(chatId);
    await sendFn(
      chatId,
      `✅ Đã đặt lại effort về mặc định:\n• Model: ${nextResolved.displayModel}\n• Effort: ${nextResolved.effort || 'theo model'}`
    );
    return;
  }

  const level = parseEffortLevel(trimmed);
  if (!level) {
    await sendFn(
      chatId,
      `❌ Mức effort không hợp lệ: "${trimmed}".\nCác mức hỗ trợ: ${AGY_EFFORT_LEVELS.join(', ')} (hoặc default).`
    );
    return;
  }

  const info = await inspectAgyEffort(resolved.model, currentPrefs.effort);
  if (!info.ok) {
    await sendFn(
      chatId,
      `❌ Không thể kiểm tra effort cho ${resolved.displayModel}: ${info.error || 'Lỗi agy CLI'}`
    );
    return;
  }
  if (!info.adjustable) {
    await sendFn(
      chatId,
      `⚠️ Model hiện tại (${resolved.displayModel}) có effort cố định, không hỗ trợ chỉnh riêng /agy effort.`
    );
    return;
  }
  if (info.available.length > 0 && !info.available.includes(level)) {
    await sendFn(
      chatId,
      `❌ Model ${resolved.model} không hỗ trợ mức effort "${level}".\nCác mức khả dụng: ${info.available.join(', ')}`
    );
    return;
  }

  const { baseModel } = splitModelSlugAndEffort(resolved.model);
  const models = await getOrFetchAgyModels();
  const candidateSlug = `${baseModel}-${level}`;
  const slugMatch = models.find((m) => m.slug.toLowerCase() === candidateSlug.toLowerCase());

  if (slugMatch) {
    setChatAgyPreferences(chatId, { model: slugMatch.slug });
  } else {
    const verify = await inspectAgyEffort(baseModel, level);
    if (!verify.ok) {
      await sendFn(
        chatId,
        `❌ Không thể áp dụng effort "${level}" cho ${baseModel}: ${verify.error || 'Không hợp lệ'}`
      );
      return;
    }
    setChatAgyPreferences(chatId, { model: baseModel, effort: level });
  }

  const updated = resolveAgyCliModelArgs(chatId);
  const busyNote = activeProcesses.has(chatId)
    ? '\n⏳ Lệnh đang chạy hiện tại vẫn hoàn tất bằng cấu hình cũ; cấu hình mới áp dụng từ tin nhắn tiếp theo.'
    : '';
  await sendFn(
    chatId,
    `✅ Đã cập nhật effort cho chat này: ${level}\n• Model áp dụng: ${updated.displayModel}${busyNote}`
  );
}

async function handleModelEffortControlCommand(
  chatId: string,
  args: string,
  sendFn: (chatId: string, text: string) => Promise<unknown>
): Promise<boolean> {
  const lower = args.toLowerCase();
  if (lower === 'models') {
    await processModelsCommand(chatId, sendFn);
    return true;
  }
  if (lower === 'model' || lower.startsWith('model ')) {
    const modelArgs = args.replace(/^model\s*/i, '').trim();
    await processModelCommand(chatId, modelArgs, sendFn);
    return true;
  }
  if (lower === 'effort' || lower.startsWith('effort ')) {
    const effortArgs = args.replace(/^effort\s*/i, '').trim();
    await processEffortCommand(chatId, effortArgs, sendFn);
    return true;
  }
  return false;
}

/**
 * Handler cho hybrid-live worker (sử dụng sendFn trực tiếp)
 */
export async function handleHybridAgyCommand(
  chatId: string,
  rawText: string,
  sendFn: (chatId: string, text: string) => Promise<string>,
  imagePath?: string
): Promise<void> {
  if (!agyChatConfig.enabled) {
    await sendFn(chatId, '⚠️ Tính năng /agy đang tạm tắt (AGY_CHAT_ENABLED=false).');
    return;
  }

  let args = rawText.replace(/^\/agy\s*/i, '').trim();
  if (!args && imagePath) {
    args = 'Phân tích kỹ thuật chi tiết biểu đồ này: nhận diện mã coin, khung thời gian, các đường kẻ vẽ, vùng cản/hỗ trợ, xu hướng và đưa ra nhận định khách quan.';
  }
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

  if (lower === 'status' || lower === '/status') {
    const item = activeProcesses.get(chatId);
    const activeId = getActiveConversation(chatId);
    const resolvedModel = resolveAgyCliModelArgs(chatId);
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

    lines.push(`• Model: ${resolvedModel.displayModel}${resolvedModel.isDefault ? ' (mặc định)' : ''}`);
    lines.push(`• Effort: ${resolvedModel.effort || 'theo model'}`);
    lines.push('• Thời gian chờ: Không giới hạn (timeout tắt, dùng /agy cancel để ngắt)');
    lines.push('\n💡 Mẹo: Để xem trạng thái Bot Trade v2.0.0 (Vốn, Lệnh, PnL), hãy gõ thẳng /status hoặc /lenh (không kèm /agy).');
    await sendFn(chatId, lines.join('\n'));
    return;
  }

  if (await handleModelEffortControlCommand(chatId, args, sendFn)) {
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

  const waitMsg = imagePath
    ? `🪐 Antigravity đã nhận ảnh biểu đồ và đang phân tích (${promptNote}, vui lòng chờ trong giây lát)...`
    : `🪐 Antigravity đang xử lý (${promptNote}, không giới hạn thời gian)...`;

  await sendFn(chatId, waitMsg);

  const result = await runAgyCli(question, chatId, {
    conversationId: activeConvId,
    isNew,
    imagePath,
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
    const resolvedModel = resolveAgyCliModelArgs(chatId);
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

    lines.push(`• Model: <code>${escapeHtml(resolvedModel.displayModel)}</code>${resolvedModel.isDefault ? ' (mặc định)' : ''}`);
    lines.push(`• Effort: <code>${escapeHtml(resolvedModel.effort || 'theo model')}</code>`);
    lines.push('• Thời gian chờ: Không giới hạn (timeout tắt, dùng /agy cancel để ngắt)');
    enqueueTelegramMessage(lines.join('\n'), chatId);
    return;
  }

  if (
    await handleModelEffortControlCommand(chatId, trimmed, async (cId, text) => {
      enqueueTelegramMessage(text, cId, { plainText: true });
    })
  ) {
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
