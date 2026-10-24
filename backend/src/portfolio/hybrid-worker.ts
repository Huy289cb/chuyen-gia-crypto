import dotenv from 'dotenv';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDefaultLiveBroker, type LiveBroker } from './live-broker';
import {
  formatHybridBookNotice,
  formatHybridBreakerNotice,
  formatHybridStopNotice,
  sendHybridTelegram,
  startHybridTelegramCommandListener,
} from './hybrid-live-notice';
import { HYBRID_POLICY_ID } from './source-hybrid';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ICT_OFFSET = 7 * 3_600_000;
const CHECK_INTERVAL_MS = 3_000;
const DAILY_LOSS_LIMIT_USD = 12.0;
const MOMENTUM_SL_PCT = 0.12;

export interface HybridLiveState {
  policyId: string;
  status: 'active' | 'risk_latched' | 'rebalance_pending';
  lastObservedAt: string;
  accountEquity: number;
  availableBalance: number;
  dayStartEquity: number;
  currentDayPnl: number;
  worstDayPnl: number;
  breakerLatched: boolean;
  positions: Record<string, { symbol: string; qty: number; entryPrice: number; markPrice: number; unrlPnl: number; slPrice: number }>;
  btcGridLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }>;
}

export class HybridLiveWorker {
  private broker: LiveBroker;
  private running = false;
  private stateDir: string;
  private dayStartEquity = 100.0;
  private currentDay = '';
  private breakerLatched = false;
  private sentNotices = new Set<string>();
  private noticesLoaded = false;
  private lastState: HybridLiveState | null = null;
  private stopTelegramListener: (() => void) | null = null;

  constructor() {
    this.broker = createDefaultLiveBroker({ requestTimeoutMs: 5_000, retryReads: true });
    this.stateDir = path.resolve(__dirname, '../../data/portfolio-live', HYBRID_POLICY_ID);
  }

  public async start(): Promise<void> {
    console.log(`[HybridLiveWorker] Starting Phase 2 Multi-Sleeve Live Worker (${HYBRID_POLICY_ID})...`);
    await fs.mkdir(this.stateDir, { recursive: true });

    this.running = true;
    this.setupSignalHandlers();

    // Start interactive Telegram listener (/status, /report, /lenh, /pnl)
    this.stopTelegramListener = startHybridTelegramCommandListener(() => this.lastState);

    // Initial sync
    await this.tick();

    // Run continuous loop
    const loop = async () => {
      while (this.running) {
        try {
          await this.tick();
        } catch (error) {
          console.error('[HybridLiveWorker] Tick error:', error instanceof Error ? error.message : error);
        }
        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
      }
    };

    void loop();
  }

  public stop(): void {
    console.log('[HybridLiveWorker] Gracefully stopping worker...');
    this.running = false;
    this.stopTelegramListener?.();
    process.exit(0);
  }

  private setupSignalHandlers(): void {
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
    process.on('uncaughtException', (err) => {
      console.error('[HybridLiveWorker] Uncaught exception:', err);
      process.exit(1);
    });
  }

  private getUtcDay(): string {
    return new Date(Date.now() + ICT_OFFSET).toISOString().slice(0, 10);
  }

  private async tick(): Promise<void> {
    const today = this.getUtcDay();
    if (this.currentDay !== today) {
      console.log(`[HybridLiveWorker] Day roll: ${this.currentDay || 'init'} -> ${today}`);
      this.currentDay = today;
      this.breakerLatched = false;
      // Re-anchor start equity
      try {
        const acc = await this.broker.getAccount();
        this.dayStartEquity = parseFloat(acc.totalMarginBalance || acc.totalWalletBalance || '100');
      } catch {
        this.dayStartEquity = 100.0;
      }
    }

    const [account, positions] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getPositions(),
    ]);

    const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
    const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
    const availableBalance = parseFloat(account.availableBalance || '0');

    let totalUnrealizedPnl = 0.0;
    const posMap: HybridLiveState['positions'] = {};
    const alerts: Array<{ key: string; text: string }> = [];

    for (const p of activePositions) {
      const qty = parseFloat(p.positionAmt);
      const entry = parseFloat(p.entryPrice);
      const mark = parseFloat(p.markPrice || p.entryPrice);
      const unrl = (mark - entry) * qty;
      totalUnrealizedPnl += unrl;

      // Stop loss price: for Long position, entry * (1 - 0.12)
      const slPrice = qty > 0 ? entry * (1.0 - MOMENTUM_SL_PCT) : entry * (1.0 + MOMENTUM_SL_PCT);

      posMap[p.symbol] = {
        symbol: p.symbol,
        qty,
        entryPrice: entry,
        markPrice: mark,
        unrlPnl: unrl,
        slPrice,
      };

      // -----------------------------------------------------------------------
      // Check Sleeve 1 Per-Position Stop Loss (12%)
      // -----------------------------------------------------------------------
      if (!this.breakerLatched && qty > 0 && mark <= slPrice) {
        console.warn(`[HybridLiveWorker] STOP LOSS TRIGGERED for ${p.symbol}: Mark=${mark} <= SL=${slPrice} (-${(MOMENTUM_SL_PCT * 100).toFixed(1)}%)! Closing position...`);
        try {
          await this.broker.submitMarketOrder({
            symbol: p.symbol,
            side: 'SELL',
            quantity: Math.abs(qty).toString(),
            clientOrderId: `sl_${p.symbol.toLowerCase()}_${Date.now()}`,
            positionSide: 'BOTH',
            reduceOnly: true,
          });
          console.log(`[HybridLiveWorker] STOP LOSS order submitted successfully for ${p.symbol}`);
          alerts.push({ key: `sl:${today}:${p.symbol}`, text: formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: true }) });
        } catch (err) {
          console.error(`[HybridLiveWorker] Failed to execute stop loss for ${p.symbol}:`, err);
          alerts.push({ key: `sl-fail:${today}:${p.symbol}`, text: formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: false }) });
        }
      }
    }

    const currentDayPnl = accountEquity - this.dayStartEquity;

    // -------------------------------------------------------------------------
    // Check 12 USDT Daily Circuit Breaker
    // -------------------------------------------------------------------------
    if (!this.breakerLatched && currentDayPnl <= -DAILY_LOSS_LIMIT_USD) {
      console.error(`[HybridLiveWorker] CIRCUIT BREAKER TRIGGERED! Day PnL=${currentDayPnl.toFixed(2)} <= -${DAILY_LOSS_LIMIT_USD} USDT. Flattening ALL positions!`);
      this.breakerLatched = true;
      let breakerOk = true;

      for (const p of activePositions) {
        const qty = parseFloat(p.positionAmt);
        if (Math.abs(qty) > 0) {
          try {
            await this.broker.submitMarketOrder({
              symbol: p.symbol,
              side: qty > 0 ? 'SELL' : 'BUY',
              quantity: Math.abs(qty).toString(),
              clientOrderId: `breaker_${p.symbol.toLowerCase()}_${Date.now()}`,
              positionSide: 'BOTH',
              reduceOnly: true,
            });
            console.log(`[HybridLiveWorker] Breaker flatten submitted for ${p.symbol}`);
          } catch (err) {
            breakerOk = false;
            console.error(`[HybridLiveWorker] Breaker flatten error for ${p.symbol}:`, err);
          }
        }
      }
      alerts.push({ key: `breaker:${today}`, text: formatHybridBreakerNotice(currentDayPnl, breakerOk) });
    }

    // Write state
    const state: HybridLiveState = {
      policyId: HYBRID_POLICY_ID,
      status: this.breakerLatched ? 'risk_latched' : 'active',
      lastObservedAt: new Date().toISOString(),
      accountEquity,
      availableBalance,
      dayStartEquity: this.dayStartEquity,
      currentDayPnl,
      worstDayPnl: Math.min(currentDayPnl, 0),
      breakerLatched: this.breakerLatched,
      positions: posMap,
      btcGridLevels: [],
    };

    this.lastState = state;
    await fs.writeFile(path.join(this.stateDir, 'worker-status.json'), JSON.stringify(state, null, 2));
    await this.publish(state, alerts);
  }

  private noticeFile(): string {
    return path.join(this.stateDir, 'telegram-sent.json');
  }

  private async loadNotices(): Promise<void> {
    if (this.noticesLoaded) return;
    this.noticesLoaded = true;
    try {
      const raw = JSON.parse(await fs.readFile(this.noticeFile(), 'utf8')) as { keys?: string[] };
      for (const key of raw.keys ?? []) this.sentNotices.add(key);
    } catch {
      // First notice for this policy.
    }
  }

  private async publish(state: HybridLiveState, alerts: Array<{ key: string; text: string }>): Promise<void> {
    await this.loadNotices();
    const bookKey = `book:${this.currentDay}:${Object.values(state.positions).map(position => `${position.symbol}:${position.qty}`).sort().join('|')}`;
    const jobs = this.sentNotices.has(bookKey) ? alerts : [{
      key: bookKey,
      text: formatHybridBookNotice({
        positions: Object.values(state.positions),
        equity: state.accountEquity,
        dayPnl: state.currentDayPnl,
      }),
    }, ...alerts];
    for (const job of jobs) {
      if (this.sentNotices.has(job.key)) continue;
      try {
        const ids = await sendHybridTelegram(job.text);
        if (!ids.length) return;
        this.sentNotices.add(job.key);
        await fs.writeFile(this.noticeFile(), JSON.stringify({ keys: [...this.sentNotices] }));
        console.log(`[HybridLiveWorker] telegram_sent ${job.key} ${ids.join(',')}`);
      } catch (error) {
        console.error('[HybridLiveWorker] telegram_error', error instanceof Error ? error.message : error);
        return;
      }
    }
  }
}

// Auto-run if executed directly
if (require.main === module) {
  const worker = new HybridLiveWorker();
  void worker.start();
}
