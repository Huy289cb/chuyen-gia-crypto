import cron, { type ScheduledTask } from 'node-cron';
import { isTelegramEnabled, telegramConfig } from '../config/telegram';
import { sendDailyReport } from '../services/telegram/daily-report';

let task: ScheduledTask | null = null;

export function startTelegramDailyReportScheduler(): void {
  if (!isTelegramEnabled()) return;
  if (task) return;

  task = cron.schedule(
    telegramConfig.dailyReportCron,
    async () => {
      try {
        console.log('[TelegramDailyReport] Sending daily report...');
        await sendDailyReport();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[TelegramDailyReport] Failed:', msg);
      }
    },
    { timezone: telegramConfig.timezone }
  );

  console.log(
    `[TelegramDailyReport] Scheduled cron="${telegramConfig.dailyReportCron}" tz=${telegramConfig.timezone}`
  );
}

export function stopTelegramDailyReportScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
