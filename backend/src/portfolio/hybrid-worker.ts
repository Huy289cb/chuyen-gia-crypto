import dotenv from 'dotenv';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDefaultLiveBroker, type LiveBroker, type LiveExchangeInfo } from './live-broker';
import {
  formatHybridBookNotice,
  formatHybridBreakerNotice,
  formatHybridStopNotice,
  formatHybridRebalanceNotice,
  formatHybridTpNotice,
  sendHybridTelegram,
  startHybridTelegramCommandListener,
} from './hybrid-live-notice';
import { SOURCE_MOMENTUM_SYMBOLS } from './market-data';
import { HYBRID_POLICY_ID } from './source-hybrid';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ICT_OFFSET = 7 * 3_600_000;
const CHECK_INTERVAL_MS = 3_000;
const DAILY_LOSS_LIMIT_USD = 12.0;
const MOMENTUM_SL_PCT = 0.12;
const MOMENTUM_ALLOC_USD = 25.0;
const BTC_GRID_TICKET_USD = 15.0;
const BTC_GRID_MAX_LEVELS = 3;
const BTC_GRID_STEP_PCT = 0.02;
const BTC_GRID_TP_PCT = 0.03;
const BTC_CRASH_GATE_PCT = 0.06;

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
  lastRebalanceUtcDay?: string;
  daysSinceRebalance?: number;
  nativeStopsActive?: string[];
}

interface SymbolFilterInfo {
  stepSize: number;
  tickSize: number;
  minQty: number;
  minNotional: number;
}

function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = step.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function formatToTick(price: number, tickSize: number): string {
  const decimals = stepDecimals(tickSize);
  const floored = tickSize > 0 ? Math.floor(price / tickSize + 1e-9) * tickSize : price;
  return floored.toFixed(decimals);
}

function formatToStep(qty: number, stepSize: number): string {
  const decimals = stepDecimals(stepSize);
  const floored = stepSize > 0 ? Math.floor(qty / stepSize + 1e-9) * stepSize : qty;
  return floored.toFixed(decimals);
}

async function fetch14dReturn(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=16`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
    if (data.length < 15) return null;
    const yesterdayClose = parseFloat(data[data.length - 2][4]);
    const pastClose = parseFloat(data[0][4]);
    if (pastClose <= 0 || !Number.isFinite(yesterdayClose) || !Number.isFinite(pastClose)) return null;
    return (yesterdayClose - pastClose) / pastClose;
  } catch {
    return null;
  }
}

async function computeMomentumUniverse(): Promise<Array<{ symbol: string; score: number }>> {
  const results: Array<{ symbol: string; score: number }> = [];
  const chunkSize = 5;
  for (let i = 0; i < SOURCE_MOMENTUM_SYMBOLS.length; i += chunkSize) {
    const chunk = SOURCE_MOMENTUM_SYMBOLS.slice(i, i + chunkSize);
    const chunkRes = await Promise.all(
      chunk.map(async (sym) => {
        const ret = await fetch14dReturn(sym);
        return ret !== null ? { symbol: sym, score: ret } : null;
      })
    );
    for (const r of chunkRes) {
      if (r && r.score >= 0.02) results.push(r);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

async function fetchBtcGridSignal(): Promise<{ ema10: number; oneDayReturn: number; crashGateTripped: boolean }> {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=12', {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { ema10: 0, oneDayReturn: 0, crashGateTripped: false };
    const data = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
    if (data.length < 11) return { ema10: 0, oneDayReturn: 0, crashGateTripped: false };
    const closes = data.slice(-11, -1).map((k) => parseFloat(k[4]));
    const yesterdayClose = closes[closes.length - 1];
    const dayBeforeYesterday = closes[closes.length - 2];
    const oneDayReturn = (yesterdayClose - dayBeforeYesterday) / dayBeforeYesterday;
    const ema10 = closes.reduce((sum, v) => sum + v, 0) / closes.length;
    const crashGateTripped = oneDayReturn < -BTC_CRASH_GATE_PCT;
    return { ema10, oneDayReturn, crashGateTripped };
  } catch {
    return { ema10: 0, oneDayReturn: 0, crashGateTripped: false };
  }
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
  private exchangeFilters: Record<string, SymbolFilterInfo> = {};
  private nativeStops = new Set<string>();
  private stopRetryAt = new Map<string, number>();
  private daysSinceRebalance = 0;
  private lastRebalanceUtcDay = '';
  private btcGridLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }> = [];
  private tickCounter = 0;

  constructor() {
    this.broker = createDefaultLiveBroker({
      requestTimeoutMs: 5_000,
      retryReads: true,
      executionOwner: process.env.PORTFOLIO_EXECUTION_OWNER?.trim() || HYBRID_POLICY_ID,
    });
    this.stateDir = path.resolve(__dirname, '../../data/portfolio-live', HYBRID_POLICY_ID);
  }

  public async start(): Promise<void> {
    console.log(`[HybridLiveWorker] Starting Phase 2 Multi-Sleeve Live Worker (${HYBRID_POLICY_ID})...`);
    await fs.mkdir(this.stateDir, { recursive: true });

    this.running = true;
    this.setupSignalHandlers();

    await this.loadExchangeFilters();
    await this.restoreDayAnchor();

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

  private async loadExchangeFilters(): Promise<void> {
    try {
      const info: LiveExchangeInfo = await this.broker.getExchangeInfo();
      for (const s of info.symbols) {
        const lot = s.filters.find((f: Record<string, unknown>) => f.filterType === 'LOT_SIZE') as Record<string, string> | undefined;
        const price = s.filters.find((f: Record<string, unknown>) => f.filterType === 'PRICE_FILTER') as Record<string, string> | undefined;
        const notional = s.filters.find((f: Record<string, unknown>) => f.filterType === 'MIN_NOTIONAL') as Record<string, string> | undefined;
        if (lot && price) {
          this.exchangeFilters[s.symbol] = {
            stepSize: parseFloat(lot.stepSize || '1'),
            tickSize: parseFloat(price.tickSize || '0.0001'),
            minQty: parseFloat(lot.minQty || '1'),
            minNotional: parseFloat(notional?.notional || '5.0'),
          };
        }
      }
      console.log(`[HybridLiveWorker] Loaded exchange filters for ${Object.keys(this.exchangeFilters).length} symbols.`);
    } catch (err) {
      console.warn('[HybridLiveWorker] Could not load exchange filters on start:', err);
    }
  }

  /** Keep the 12 USDT day anchor, rebalance state, and grid state across restarts. */
  private async restoreDayAnchor(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.stateDir, 'worker-status.json'), 'utf8')) as HybridLiveState;
      const observed = Date.parse(raw.lastObservedAt);
      if (Array.isArray(raw.btcGridLevels)) {
        this.btcGridLevels = raw.btcGridLevels;
      }
      if (typeof raw.lastRebalanceUtcDay === 'string') {
        this.lastRebalanceUtcDay = raw.lastRebalanceUtcDay;
      }
      if (typeof raw.daysSinceRebalance === 'number') {
        this.daysSinceRebalance = raw.daysSinceRebalance;
      }
      if (!Number.isFinite(observed) || !Number.isFinite(raw.dayStartEquity) || raw.dayStartEquity <= 0) return;
      const observedDay = new Date(observed + ICT_OFFSET).toISOString().slice(0, 10);
      if (observedDay !== this.getUtcDay()) return;
      this.currentDay = observedDay;
      this.dayStartEquity = raw.dayStartEquity;
      this.breakerLatched = raw.breakerLatched === true;
      console.log(`[HybridLiveWorker] Restored day anchor ${raw.dayStartEquity} for ${observedDay}, daysSinceRebalance: ${this.daysSinceRebalance}`);
    } catch {
      // First boot has no status file.
    }
  }

  private async syncNativeStopLoss(symbol: string, qty: number, slPrice: number): Promise<boolean> {
    if (this.nativeStops.has(symbol)) return true;
    const retryAt = this.stopRetryAt.get(symbol) ?? 0;
    if (retryAt > Date.now()) return false;
    try {
      const filter = this.exchangeFilters[symbol];
      if (!filter) return false;
      const algoOrders = await this.broker.getOpenAlgoOrders(symbol);
      const existingStop = algoOrders.find((order) => order.orderType === 'STOP_MARKET' || order.type === 'STOP_MARKET');
      if (existingStop) {
        this.nativeStops.add(symbol);
        return true;
      }
      const stopPriceStr = formatToTick(slPrice, filter.tickSize);
      const qtyStr = formatToStep(Math.abs(qty), filter.stepSize);
      await this.broker.submitStopMarketOrder({
        symbol,
        side: qty > 0 ? 'SELL' : 'BUY',
        stopPrice: stopPriceStr,
        quantity: qtyStr,
        clientOrderId: `sl_${symbol.toLowerCase()}_${Date.now()}`.slice(0, 36),
        positionSide: 'BOTH',
        reduceOnly: true,
      });
      this.nativeStops.add(symbol);
      console.log(`[HybridLiveWorker] Native venue STOP_MARKET placed for ${symbol}: SL=${stopPriceStr}, Qty=${qtyStr}`);
      return true;
    } catch (err) {
      this.stopRetryAt.set(symbol, Date.now() + 60_000);
      console.warn(`[HybridLiveWorker] Could not place native STOP_MARKET for ${symbol}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  private async cancelSymbolStops(symbol: string): Promise<void> {
    this.nativeStops.delete(symbol);
    try {
      const algoOrders = await this.broker.getOpenAlgoOrders(symbol);
      for (const order of algoOrders) {
        const clientAlgoId = String(order.clientAlgoId ?? order.clientOrderId ?? '');
        if ((order.orderType === 'STOP_MARKET' || order.type === 'STOP_MARKET') && clientAlgoId) {
          await this.broker.cancelAlgoOrder(symbol, clientAlgoId);
          console.log(`[HybridLiveWorker] Cancelled open stop order for ${symbol}: ${clientAlgoId}`);
        }
      }
    } catch (err) {
      console.warn(`[HybridLiveWorker] Failed to cancel open stop orders for ${symbol}:`, err);
    }
  }

  private async rebalanceMomentum(): Promise<void> {
    console.log('[HybridLiveWorker] Starting 2-day Momentum Rebalance...');
    try {
      const ranked = await computeMomentumUniverse();
      const top2 = ranked.slice(0, 2).map((r) => r.symbol);
      console.log(`[HybridLiveWorker] Rebalance Top 2 Momentum: ${top2.join(', ')}`);

      const positions = await this.broker.getPositions();
      const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
      const activeSymbols = activePositions.map((p) => p.symbol);

      const closedSymbols: string[] = [];
      const openedPositions: Array<{ symbol: string; qty: number; entryPrice: number }> = [];

      // 1. Close symbols that fell out of Top 2 (excluding BTC if held in grid)
      for (const p of activePositions) {
        if (p.symbol === 'BTCUSDT' && this.btcGridLevels.length > 0) continue;
        if (!top2.includes(p.symbol)) {
          const qty = parseFloat(p.positionAmt);
          console.log(`[HybridLiveWorker] Rebalance: Rotating out of ${p.symbol} (no longer in Top 2)`);
          await this.broker.submitMarketOrder({
            symbol: p.symbol,
            side: qty > 0 ? 'SELL' : 'BUY',
            quantity: Math.abs(qty).toString(),
            clientOrderId: `reb_close_${p.symbol.toLowerCase()}_${Date.now()}`,
            positionSide: 'BOTH',
            reduceOnly: true,
          });
          await this.cancelSymbolStops(p.symbol);
          closedSymbols.push(p.symbol);
        }
      }

      // 2. Open new symbols in Top 2
      for (const sym of top2) {
        if (!activeSymbols.includes(sym)) {
          const filter = this.exchangeFilters[sym];
          if (!filter) continue;
          const markPrices = await this.broker.getMarkPrices(sym);
          const mark = parseFloat(markPrices[0]?.markPrice || '0');
          if (mark <= 0) continue;

          const targetQty = MOMENTUM_ALLOC_USD / mark;
          const qtyStr = formatToStep(targetQty, filter.stepSize);
          const numQty = parseFloat(qtyStr);
          if (numQty * mark < filter.minNotional || numQty < filter.minQty) {
            console.warn(`[HybridLiveWorker] Rebalance: ${sym} notional ${numQty * mark} < minNotional ${filter.minNotional}`);
            continue;
          }

          console.log(`[HybridLiveWorker] Rebalance: Opening Top 2 position ${sym} Qty=${qtyStr} (~$${MOMENTUM_ALLOC_USD})`);
          const order = await this.broker.submitMarketOrder({
            symbol: sym,
            side: 'BUY',
            quantity: qtyStr,
            clientOrderId: `reb_open_${sym.toLowerCase()}_${Date.now()}`,
            positionSide: 'BOTH',
          });
          const fillPrice = parseFloat(order.avgPrice || mark.toString());
          const slPrice = fillPrice * (1.0 - MOMENTUM_SL_PCT);
          openedPositions.push({ symbol: sym, qty: numQty, entryPrice: fillPrice });

          await this.syncNativeStopLoss(sym, numQty, slPrice);
        }
      }

      const nextDate = new Date(Date.now() + 2 * 86_400_000 + ICT_OFFSET).toISOString().slice(0, 10);
      const text = formatHybridRebalanceNotice({
        closed: closedSymbols,
        opened: openedPositions,
        nextRebalanceDate: nextDate,
      });
      await sendHybridTelegram(text);
    } catch (err) {
      console.error('[HybridLiveWorker] Error during momentum rebalance:', err);
    }
  }

  private async tickBtcGrid(): Promise<void> {
    const filter = this.exchangeFilters['BTCUSDT'];
    if (!filter) return;

    try {
      const [markPrices, btcSignal] = await Promise.all([
        this.broker.getMarkPrices('BTCUSDT'),
        fetchBtcGridSignal(),
      ]);
      const btcMark = parseFloat(markPrices[0]?.markPrice || '0');
      if (btcMark <= 0 || btcSignal.ema10 <= 0) return;

      // 1. Check Take Profit on existing active grid levels (+3.0%)
      const survivingLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }> = [];
      for (const lvl of this.btcGridLevels) {
        if (btcMark >= lvl.tpPrice) {
          console.log(`[HybridLiveWorker] BTC Grid Take Profit Triggered! Mark=${btcMark} >= TP=${lvl.tpPrice} (+${(BTC_GRID_TP_PCT * 100).toFixed(1)}%)`);
          const qtyStr = formatToStep(lvl.qty, filter.stepSize);
          await this.broker.submitMarketOrder({
            symbol: 'BTCUSDT',
            side: 'SELL',
            quantity: qtyStr,
            clientOrderId: `btc_grid_tp_${Date.now()}`,
            positionSide: 'BOTH',
            reduceOnly: true,
          });
          const pnl = (btcMark - lvl.entryPrice) * lvl.qty;
          const text = formatHybridTpNotice({
            symbol: 'BTCUSDT',
            qty: lvl.qty,
            exitPrice: btcMark,
            pnl,
          });
          await sendHybridTelegram(text);
        } else {
          survivingLevels.push(lvl);
        }
      }
      this.btcGridLevels = survivingLevels;

      // 2. Check Crash Gate: If 1d return < -6%, freeze new entries
      if (btcSignal.crashGateTripped) {
        console.warn(`[HybridLiveWorker] BTC Crash Gate Tripped (${(btcSignal.oneDayReturn * 100).toFixed(2)}% < -6%)! Freezing new Grid entries.`);
        return;
      }

      // 3. Check Dip Buy Levels (-2%, -4%, -6% under EMA10)
      if (this.btcGridLevels.length < BTC_GRID_MAX_LEVELS) {
        const nextLevelIndex = this.btcGridLevels.length + 1;
        const stepPct = BTC_GRID_STEP_PCT * nextLevelIndex;
        const dipThreshold = btcSignal.ema10 * (1.0 - stepPct);

        if (btcMark <= dipThreshold) {
          const targetQty = BTC_GRID_TICKET_USD / btcMark;
          const qtyStr = formatToStep(targetQty, filter.stepSize);
          const numQty = parseFloat(qtyStr);

          if (numQty * btcMark >= filter.minNotional) {
            console.log(`[HybridLiveWorker] BTC Grid Entry Level ${nextLevelIndex} Triggered: Mark=${btcMark} <= Dip=${dipThreshold.toFixed(2)} (-${(stepPct * 100).toFixed(1)}%)! Buying $${BTC_GRID_TICKET_USD}...`);
            const order = await this.broker.submitMarketOrder({
              symbol: 'BTCUSDT',
              side: 'BUY',
              quantity: qtyStr,
              clientOrderId: `btc_grid_buy_lvl${nextLevelIndex}_${Date.now()}`,
              positionSide: 'BOTH',
            });
            const entryPrice = parseFloat(order.avgPrice || btcMark.toString());
            const tpPrice = entryPrice * (1.0 + BTC_GRID_TP_PCT);
            this.btcGridLevels.push({ entryPrice, qty: numQty, tpPrice });
            await sendHybridTelegram(
              `⚡ KHỚP LƯỚI BTC TẦNG ${nextLevelIndex} (SLEEVE 2)\n` +
              `• MUA ${qtyStr} BTC @ ${entryPrice} (~${BTC_GRID_TICKET_USD} USDT)\n` +
              `• Chốt lời kỳ vọng: ${tpPrice.toFixed(2)} (+${(BTC_GRID_TP_PCT * 100).toFixed(1)}%)\n` +
              `• 10-EMA hiện tại: ${btcSignal.ema10.toFixed(2)}`
            );
          }
        }
      }
    } catch (err) {
      console.warn('[HybridLiveWorker] Error in BTC Grid tick:', err instanceof Error ? err.message : err);
    }
  }

  private async tick(): Promise<void> {
    this.tickCounter++;
    const today = this.getUtcDay();
    if (this.currentDay !== today) {
      console.log(`[HybridLiveWorker] Day roll: ${this.currentDay || 'init'} -> ${today}`);
      const isFirstBoot = !this.currentDay;
      this.currentDay = today;
      this.breakerLatched = false;

      // Re-anchor start equity
      try {
        const acc = await this.broker.getAccount();
        this.dayStartEquity = parseFloat(acc.totalMarginBalance || acc.totalWalletBalance || '100');
      } catch {
        this.dayStartEquity = 100.0;
      }

      // Check 2-day rebalance boundary
      if (!isFirstBoot) {
        this.daysSinceRebalance++;
        if (this.daysSinceRebalance >= 2 && !this.breakerLatched) {
          await this.rebalanceMomentum();
          this.daysSinceRebalance = 0;
          this.lastRebalanceUtcDay = today;
        }
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

      // Ensure native STOP_MARKET order is on Binance matching engine
      if (!this.breakerLatched && qty > 0) {
        void this.syncNativeStopLoss(p.symbol, qty, slPrice);
      }

      // In-memory fallback check
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
          await this.cancelSymbolStops(p.symbol);
          console.log(`[HybridLiveWorker] STOP LOSS order submitted successfully for ${p.symbol}`);
          alerts.push({ key: `sl:${today}:${p.symbol}`, text: formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: true }) });
        } catch (err) {
          console.error(`[HybridLiveWorker] Failed to execute stop loss for ${p.symbol}:`, err);
          alerts.push({ key: `sl-fail:${today}:${p.symbol}`, text: formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: false }) });
        }
      }
    }

    const currentDayPnl = accountEquity - this.dayStartEquity;

    // Check 12 USDT Daily Circuit Breaker
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
            await this.cancelSymbolStops(p.symbol);
            console.log(`[HybridLiveWorker] Breaker flatten submitted for ${p.symbol}`);
          } catch (err) {
            breakerOk = false;
            console.error(`[HybridLiveWorker] Breaker flatten error for ${p.symbol}:`, err);
          }
        }
      }
      alerts.push({ key: `breaker:${today}`, text: formatHybridBreakerNotice(currentDayPnl, breakerOk) });
    }

    // Tick BTC Grid every 20 ticks (~60s)
    if (!this.breakerLatched && this.tickCounter % 20 === 0) {
      await this.tickBtcGrid();
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
      btcGridLevels: this.btcGridLevels,
      lastRebalanceUtcDay: this.lastRebalanceUtcDay,
      daysSinceRebalance: this.daysSinceRebalance,
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
