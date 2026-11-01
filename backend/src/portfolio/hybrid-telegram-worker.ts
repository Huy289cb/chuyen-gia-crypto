import fs from 'node:fs';
import path from 'node:path';
import { isTelegramEnabled, telegramConfig } from '../config/telegram';
import { startHybridTelegramCommandListener } from './hybrid-live-notice';
import type { HybridLiveState } from './hybrid-worker';

const POLICY_ID = process.env.PORTFOLIO_LIVE_POLICY?.trim() || 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1';
const STATUS_PATH = path.resolve(__dirname, '../../data/portfolio-live', POLICY_ID, 'worker-status.json');

export function loadHybridLiveStateFromDisk(customPath?: string): HybridLiveState | null {
  try {
    const targetPath = customPath || STATUS_PATH;
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    const content = fs.readFileSync(targetPath, 'utf8');
    return JSON.parse(content) as HybridLiveState;
  } catch (err) {
    console.error('[HybridTelegramWorker] Error reading worker-status.json:', err);
    return null;
  }
}

export function startStandaloneTelegramBot(customStatusPath?: string): () => void {
  console.log('====================================================');
  console.log('[HybridTelegramWorker] Starting Standalone Telegram Bot Service...');
  console.log(`[HybridTelegramWorker] Policy ID: ${POLICY_ID}`);
  console.log(`[HybridTelegramWorker] Status path: ${customStatusPath || STATUS_PATH}`);

  if (!isTelegramEnabled() || !telegramConfig.botToken) {
    console.warn('[HybridTelegramWorker] Telegram is not enabled or botToken is missing. Bot will not start.');
    return () => {};
  }

  console.log(`[HybridTelegramWorker] Authorized chat IDs: ${telegramConfig.chatIds.join(', ') || 'ALL'}`);

  const stopListener = startHybridTelegramCommandListener(() => loadHybridLiveStateFromDisk(customStatusPath));
  return stopListener;
}

// Auto-run if executed directly
if (require.main === module) {
  const stopBot = startStandaloneTelegramBot();

  const shutdown = () => {
    console.log('[HybridTelegramWorker] Shutting down Standalone Telegram Bot...');
    stopBot();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log('[HybridTelegramWorker] Standalone Telegram Bot is running independently.');
}
