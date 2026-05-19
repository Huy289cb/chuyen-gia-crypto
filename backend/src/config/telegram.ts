import cron from 'node-cron';

export type TelegramNotifyLevel = 'off' | 'trades_only' | 'trades_risk' | 'verbose';

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatIds: string[];
  allowedUserIds: string[];
  notifyLevel: TelegramNotifyLevel;
  dailyReportCron: string;
  timezone: string;
}

function parseCsv(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseNotifyLevel(value: string | undefined): TelegramNotifyLevel {
  const v = (value || 'verbose').toLowerCase();
  if (v === 'off' || v === 'trades_only' || v === 'trades_risk' || v === 'verbose') {
    return v;
  }
  return 'verbose';
}

export const telegramConfig: TelegramConfig = {
  enabled: process.env.TELEGRAM_ENABLED === 'true',
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatIds: parseCsv(process.env.TELEGRAM_CHAT_IDS),
  allowedUserIds: parseCsv(process.env.TELEGRAM_ALLOWED_USER_IDS),
  notifyLevel: parseNotifyLevel(process.env.TELEGRAM_NOTIFY_LEVEL),
  dailyReportCron: process.env.TELEGRAM_DAILY_REPORT_CRON || '0 21 * * *',
  timezone: 'Asia/Ho_Chi_Minh',
};

export function isTelegramEnabled(): boolean {
  return telegramConfig.enabled && !!telegramConfig.botToken && telegramConfig.chatIds.length > 0;
}

export function shouldNotifyVerbose(): boolean {
  return telegramConfig.notifyLevel === 'verbose';
}

export function shouldNotifyTrades(): boolean {
  return (
    telegramConfig.notifyLevel === 'trades_only' ||
    telegramConfig.notifyLevel === 'trades_risk' ||
    telegramConfig.notifyLevel === 'verbose'
  );
}

export function shouldNotifyRisk(): boolean {
  return telegramConfig.notifyLevel === 'trades_risk' || telegramConfig.notifyLevel === 'verbose';
}

export function validateTelegramConfig(): void {
  if (!telegramConfig.enabled) return;

  const errors: string[] = [];
  if (!telegramConfig.botToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required when TELEGRAM_ENABLED=true');
  }
  if (telegramConfig.chatIds.length === 0) {
    errors.push('TELEGRAM_CHAT_IDS is required when TELEGRAM_ENABLED=true');
  }
  if (!cron.validate(telegramConfig.dailyReportCron)) {
    errors.push('TELEGRAM_DAILY_REPORT_CRON is invalid');
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Telegram configuration: ${errors.join(', ')}`);
  }
}

export function isChatAllowed(chatId: string | number): boolean {
  return telegramConfig.chatIds.includes(String(chatId));
}

export function isUserAllowed(userId: string | number | undefined): boolean {
  if (!userId) return true;
  if (telegramConfig.allowedUserIds.length === 0) return true;
  return telegramConfig.allowedUserIds.includes(String(userId));
}
