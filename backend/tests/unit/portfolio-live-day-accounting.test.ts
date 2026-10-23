import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import type { LiveBroker } from '../../src/portfolio/live-broker';
import { advanceLivePortfolio, LIVE_POLICY_ID, LIVE_SYMBOLS, type AdvanceLivePortfolioOptions, type LivePortfolioWallet } from '../../src/portfolio/live-service';
import { readLiveWallet, writeLiveWallet } from '../../src/portfolio/live-store';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const d = (value: string | number) => new Money(value);
const BOUNDARY = Date.parse('2026-10-17T17:00:00Z');
const directories: string[] = [];
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

/** Authenticated account cash and its income publication are deliberately independent. */
class DayAccountingBroker {
  identity = 'day-accounting-authenticated-account';
  now = BOUNDARY - 4000;
  wallet = d('100');
  income: any[] = [];
  published = new Set<string>();
  async getAccount() {
    return { canTrade: true, totalWalletBalance: this.wallet.toString(), totalUnrealizedProfit: '0',
      totalMarginBalance: this.wallet.toString(), availableBalance: this.wallet.toString(),
      assets: [{ asset: 'USDT', walletBalance: this.wallet.toString(), unrealizedProfit: '0' }] };
  }
  async getPositions() { return LIVE_SYMBOLS.map(symbol => ({ symbol, positionAmt: '0', entryPrice: '0', markPrice: '100',
    unRealizedProfit: '0', positionSide: 'BOTH', leverage: '10', marginType: 'cross', isolatedWallet: '0' })); }
  async getPositionMode() { return { dualSidePosition: false }; }
  async getOpenOrders() { return []; }
  async getOpenAlgoOrders() { return []; }
  async getMarkPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, markPrice: '100', time: this.now })); }
  async getTickerPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, price: '100', time: this.now })); }
  async getCommissionRate(symbol: string) { return { symbol, makerCommissionRate: '.0002', takerCommissionRate: '.0005' }; }
  async getSymbolConfiguration() { return LIVE_SYMBOLS.map(symbol => ({ symbol, marginType: 'CROSSED', leverage: '10' })); }
  async getExchangeInfo() { return { symbols: LIVE_SYMBOLS.map(symbol => ({ symbol, status: 'TRADING', contractType: 'PERPETUAL',
    quoteAsset: 'USDT', marginAsset: 'USDT', filters: [
      { filterType: 'LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' },
      { filterType: 'MARKET_LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' },
      { filterType: 'MIN_NOTIONAL', notional: '1' },
    ] })) }; }
  async getIncome(query: any) { return this.income.filter(row => this.published.has(row.tranId)
    && row.time >= query.startTime && row.time <= query.endTime); }
  async getUserTrades() { return []; }
  async queryOrder() { throw Object.assign(new Error('Order missing'), { binanceCode: -2013 }); }
  async submitMarketOrder() { throw new Error('Day accounting must never submit an order'); }
  cash(type: 'FUNDING_FEE' | 'TRANSFER' | 'INTERNAL_TRANSFER', amount: string, id: string) {
    this.wallet = this.wallet.plus(amount);
    this.income.push({ incomeType: type, income: amount, time: this.now, tranId: id, asset: 'USDT',
      symbol: type === 'FUNDING_FEE' ? 'BTCUSDT' : '' });
  }
}

async function fixture() {
  const broker = new DayAccountingBroker();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'live-day-accounting-test-'));
  directories.push(directory);
  const receiptPath = path.join(directory, 'handoff.json');
  await fs.writeFile(receiptPath, JSON.stringify({ owner: LIVE_POLICY_ID, accountIdentity: broker.identity,
    legacyWorkerStopped: true, legacyMutationsBlocked: true, verifiedAtMs: broker.now,
    verifiedSetup: { positionMode: 'ONE_WAY', marginType: 'CROSSED', leverage: '10', symbols: [...LIVE_SYMBOLS] } }));
  const options: AdvanceLivePortfolioOptions = { broker: broker as unknown as LiveBroker, directory,
    accountIdentity: broker.identity, handoff: { owner: LIVE_POLICY_ID, receiptPath }, now: () => broker.now };
  const wallet = await advanceLivePortfolio(options);
  return { broker, options, wallet };
}

async function tick(f: Awaited<ReturnType<typeof fixture>>, time: number) {
  f.broker.now = time;
  return advanceLivePortfolio(f.options);
}

describe('daily risk accounting when authenticated income publishes across ICT midnight', () => {
  it('does not credit withheld prior-day positive funding as profit or extra loss headroom today', async () => {
    const f = await fixture();
    f.broker.now = BOUNDARY - 2000;
    f.broker.cash('FUNDING_FEE', '1', 'prior-funding');
    const withheld = await advanceLivePortfolio(f.options);
    expect(withheld.unreconciledWalletDelta).toBe('1');
    expect(withheld.equity).toBe('100');
    await tick(f, BOUNDARY);
    f.broker.published.add('prior-funding');
    const reconciled = await tick(f, BOUNDARY + 2000);
    expect(reconciled.equityQuality).toBe('reconciled');
    expect(reconciled.equity).toBe('101');
    expect(reconciled.fundingPnl).toBe('1');
    expect(reconciled.netPnl).toBe('1');
    expect(reconciled.currentDay.anchorEquity).toBe('101');
    expect(reconciled.currentDay.netPnl).toBe('0');
    expect(reconciled.currentDay.breachUsd).toBe('0');
    expect(reconciled.config.dailyLossLimitUsd).toBe('12');
    // Yesterday's delayed credit must not let an actual12.4u loss today appear
    // as11.4u and bypass the 12u daily protection.
    f.broker.now = BOUNDARY + 4000;
    f.broker.cash('FUNDING_FEE', '-12.4', 'today-debit');
    f.broker.published.add('today-debit');
    const stopped = await advanceLivePortfolio(f.options);
    expect(stopped.currentDay.netPnl).toBe('-12.4');
    expect(stopped.currentDay.breachUsd).toBe('0.4');
    expect(stopped.currentDay.riskLatched).toBe(true);
    expect(stopped.currentDay.latchReason).toBe('fixed_daily_loss_observed');
  });

  it('counts funding dated after the new day anchor as current-day profit', async () => {
    const f = await fixture();
    const boundary = await tick(f, BOUNDARY);
    expect(boundary.currentDay.anchorEquity).toBe('100');
    f.broker.now = BOUNDARY + 2000;
    f.broker.cash('FUNDING_FEE', '1', 'today-funding');
    const withheld = await advanceLivePortfolio(f.options);
    expect(withheld.equity).toBe('100');
    f.broker.published.add('today-funding');
    const reconciled = await tick(f, BOUNDARY + 4000);
    expect(reconciled.equityQuality).toBe('reconciled');
    expect(reconciled.currentDay.anchorEquity).toBe('100');
    expect(reconciled.currentDay.netPnl).toBe('1');
    expect(reconciled.fundingPnl).toBe('1');
  });

  it.each([0, 1000])('does not subtract a transfer captured %sms after the account snapshot from an anchor that never included it', async offset => {
    const f = await fixture();
    const account = f.broker.getAccount.bind(f.broker);
    let delayed = false;
    f.broker.getAccount = async () => {
      // The account response describes cash100. An external credit can arrive
      // while this response is in flight, even within the same millisecond.
      const captured = await account();
      if (!delayed) {
        delayed = true;
        f.broker.now = BOUNDARY + offset;
        f.broker.cash('TRANSFER', '1', 'after-account-snapshot');
        f.broker.now = BOUNDARY + 1500;
      }
      return captured;
    };
    const boundary = await tick(f, BOUNDARY);
    expect(delayed).toBe(true);
    expect(boundary.lastObservedAtMs).toBe(BOUNDARY + 1500);
    expect(boundary.currentDay.anchorEquity).toBe('100');
    f.broker.getAccount = account;
    f.broker.published.add('after-account-snapshot');
    const reconciled = await tick(f, BOUNDARY + 3500);
    expect(reconciled.equityQuality).toBe('reconciled');
    expect(reconciled.netCashflow).toBe('1');
    expect(reconciled.equity).toBe('100');
    expect(reconciled.currentDay.anchorEquity).toBe('100');
    expect(reconciled.currentDay.netPnl).toBe('0');
    expect(reconciled.currentDay.breachUsd).toBe('0');
  });

  it.each([
    ['TRANSFER', '1'],
    ['TRANSFER', '-1'],
    ['INTERNAL_TRANSFER', '1'],
    ['INTERNAL_TRANSFER', '-1'],
  ] as const)('rebases late prior-anchor %s %s exactly once and keeps the correction across restart', async (type, amount) => {
    const f = await fixture();
    f.broker.now = BOUNDARY - 2000;
    f.broker.cash(type, amount, 'late-external-flow');
    await advanceLivePortfolio(f.options);
    await tick(f, BOUNDARY);
    f.broker.published.add('late-external-flow');
    const corrected = await tick(f, BOUNDARY + 2000);
    expect(corrected.equityQuality).toBe('reconciled');
    expect(corrected.netCashflow).toBe(amount);
    expect(corrected.equity).toBe('100');
    expect(corrected.netPnl).toBe('0');
    expect(corrected.currentDay.anchorEquity).toBe('100');
    expect(corrected.currentDay.netCashflow).toBe('0');
    expect(corrected.currentDay.netPnl).toBe('0');
    const durable = await readLiveWallet<LivePortfolioWallet>(f.options.directory);
    expect(durable?.currentDay.anchorEquity).toBe('100');
    const restarted = new Proxy(f.broker, { get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as LiveBroker;
    f.options.broker = restarted;
    const repeated = await tick(f, BOUNDARY + 32_000);
    expect(repeated.currentDay.anchorEquity).toBe('100');
    expect(repeated.currentDay.netPnl).toBe('0');
    expect(repeated.netCashflow).toBe(amount);
    expect(repeated.incomes).toHaveLength(1);
    expect(repeated.processedIncomeIds).toHaveLength(1);
  });

  it('keeps an existing legacy day anchor usable without reconstructing its missing provenance', async () => {
    const f = await fixture();
    const stored = await readLiveWallet<LivePortfolioWallet>(f.options.directory);
    const current = stored!.currentDay;
    // This is the complete old schema, intentionally excluding future optional
    // provenance fields. Deployment must preserve its existing budget and cursor.
    stored!.currentDay = { day: current.day, anchorEquity: current.anchorEquity, anchorTimeMs: current.anchorTimeMs,
      anchorQuality: current.anchorQuality, netCashflow: current.netCashflow, netPnl: current.netPnl,
      worstNetPnl: current.worstNetPnl, breachUsd: current.breachUsd, riskLatched: current.riskLatched,
      latchReason: current.latchReason };
    await writeLiveWallet(f.options.directory, stored);
    const continued = await tick(f, BOUNDARY - 2000);
    expect(continued.currentDay.anchorEquity).toBe(current.anchorEquity);
    expect(continued.currentDay.netPnl).toBe('0');
    expect(continued.sourceCursorMs).toBe(stored!.sourceCursorMs);
    expect(continued.config.dailyLossLimitUsd).toBe('12');
    expect(continued.status).toBe('flat');
    expect(continued.intents).toHaveLength(0);
    // A newly published transfer with the same timestamp as an old anchor is
    // insufficient evidence to reconstruct that anchor retrospectively.
    f.broker.cash('TRANSFER', '1', 'legacy-anchor-transfer');
    f.broker.income[0].time = current.anchorTimeMs;
    f.broker.published.add('legacy-anchor-transfer');
    const classified = await advanceLivePortfolio(f.options);
    expect(classified.currentDay.anchorEquity).toBe(current.anchorEquity);
    expect(classified.currentDay.netPnl).toBe('0');
    expect(classified.netCashflow).toBe('1');
  });
});
