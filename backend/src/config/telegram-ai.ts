import { telegramConfig } from './telegram';
import { getGroqTelegramAiModel } from './groq-models';

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

export interface TelegramAiConfig {
  enabled: boolean;
  model: string;
  maxTokens: number;
  rateLimitPerUserHour: number;
  rateLimitPerChatDay: number;
  /** Production: true when AI enabled — requires TELEGRAM_ALLOWED_USER_IDS */
  requireAllowedUserIds: boolean;
  systemPromptVersion: string;
}

export interface CursorAgentConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  repoUrl: string;
  baseBranch: string;
}

export interface CursorChatConfig {
  enabled: boolean;
  model: string;
  adminOnly: boolean;
  rateLimitPerUserHour: number;
  sessionTtlMs: number;
  jobTimeoutMs: number;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  const n = parseInt(value || String(fallback), 10);
  return Number.isFinite(n) ? n : fallback;
}

export const telegramAiConfig: TelegramAiConfig = {
  enabled: process.env.TELEGRAM_AI_ENABLED === 'true',
  model: getGroqTelegramAiModel(),
  maxTokens: parseIntEnv(process.env.TELEGRAM_AI_MAX_TOKENS, 2048),
  rateLimitPerUserHour: parseIntEnv(process.env.TELEGRAM_AI_RATE_LIMIT_PER_USER_HOUR, 5),
  rateLimitPerChatDay: parseIntEnv(process.env.TELEGRAM_AI_RATE_LIMIT_PER_CHAT_DAY, 30),
  requireAllowedUserIds: isProductionEnv(),
  systemPromptVersion: process.env.TELEGRAM_AI_SYSTEM_PROMPT_VERSION || '3',
};

export const cursorAgentConfig: CursorAgentConfig = {
  enabled: process.env.CURSOR_AGENT_ENABLED === 'true',
  apiKey: process.env.CURSOR_API_KEY || '',
  model: process.env.CURSOR_AGENT_MODEL || 'composer-2.5',
  repoUrl: process.env.CURSOR_AGENT_REPO_URL || '',
  baseBranch: process.env.CURSOR_AGENT_BASE_BRANCH || 'develop',
};

export const cursorChatConfig: CursorChatConfig = {
  enabled: process.env.CURSOR_CHAT_ENABLED !== 'false',
  model: process.env.CURSOR_CHAT_MODEL || process.env.CURSOR_AGENT_MODEL || 'composer-2.5',
  adminOnly: process.env.CURSOR_CHAT_ADMIN_ONLY !== 'false',
  rateLimitPerUserHour: parseIntEnv(process.env.CURSOR_CHAT_RATE_LIMIT_PER_USER_HOUR, 3),
  sessionTtlMs: parseIntEnv(process.env.CURSOR_CHAT_SESSION_TTL_MS, 24 * 60 * 60 * 1000),
  jobTimeoutMs: parseIntEnv(process.env.CURSOR_CHAT_JOB_TIMEOUT_MS, 300_000),
};

export function isTelegramAiEnabled(): boolean {
  return telegramAiConfig.enabled;
}

export function isCursorAgentEnabled(): boolean {
  return cursorAgentConfig.enabled && !!cursorAgentConfig.apiKey && !!cursorAgentConfig.repoUrl;
}

export function isCursorChatEnabled(): boolean {
  return cursorChatConfig.enabled && isCursorAgentEnabled();
}

export function canUseCursorChat(userId: string | number | undefined): boolean {
  if (!isCursorChatEnabled()) return false;
  if (!cursorChatConfig.adminOnly) return true;
  return isTelegramAdminUser(userId);
}

export function validateTelegramAiConfig(): void {
  if (!telegramAiConfig.enabled) return;

  const errors: string[] = [];

  if (telegramAiConfig.maxTokens < 256 || telegramAiConfig.maxTokens > 8192) {
    errors.push('TELEGRAM_AI_MAX_TOKENS must be between 256 and 8192');
  }

  if (
    !Number.isFinite(telegramAiConfig.rateLimitPerUserHour) ||
    telegramAiConfig.rateLimitPerUserHour < 1
  ) {
    errors.push('TELEGRAM_AI_RATE_LIMIT_PER_USER_HOUR must be >= 1');
  }

  if (
    !Number.isFinite(telegramAiConfig.rateLimitPerChatDay) ||
    telegramAiConfig.rateLimitPerChatDay < 1
  ) {
    errors.push('TELEGRAM_AI_RATE_LIMIT_PER_CHAT_DAY must be >= 1');
  }

  if (telegramAiConfig.requireAllowedUserIds && telegramConfig.allowedUserIds.length === 0) {
    errors.push(
      'TELEGRAM_ALLOWED_USER_IDS is required in production when TELEGRAM_AI_ENABLED=true'
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Telegram AI configuration: ${errors.join(', ')}`);
  }
}

export function validateCursorAgentConfig(): void {
  if (!cursorAgentConfig.enabled) return;

  const errors: string[] = [];
  if (!cursorAgentConfig.apiKey) {
    errors.push('CURSOR_API_KEY is required when CURSOR_AGENT_ENABLED=true');
  }
  if (!cursorAgentConfig.repoUrl) {
    errors.push('CURSOR_AGENT_REPO_URL is required when CURSOR_AGENT_ENABLED=true');
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Cursor Agent configuration: ${errors.join(', ')}`);
  }
}

/** Admin-only commands (/logs): user must be in TELEGRAM_ALLOWED_USER_IDS when list is set. */
export function isTelegramAdminUser(userId: string | number | undefined): boolean {
  if (!userId) return false;
  if (telegramConfig.allowedUserIds.length === 0) {
    return !isProductionEnv();
  }
  return telegramConfig.allowedUserIds.includes(String(userId));
}
