import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LiveBroker, LiveIncome } from './live-broker';

export interface CashFlowRecord {
  tranId: string;
  timestamp: number;
  dateUtc: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  asset: string;
  note: string;
}

export interface CashFlowLedger {
  baselineDate: string;
  baselineEquity: number;
  lastSyncTime: number;
  flows: CashFlowRecord[];
}

export interface CashFlowSummary {
  baselineDate: string;
  baselineEquity: number;
  cumulativeDeposits: number;
  cumulativeWithdrawals: number;
  netInjectedCapital: number;
  adjustedBaselineEquity: number;
  strategyNetPnl: number;
  strategyRoiPct: number;
}

export class CashFlowManager {
  private filePath: string;
  private ledger: CashFlowLedger;

  constructor(
    customPath?: string,
    defaultBaselineDate = '2026-10-30',
    defaultBaselineEquity = 26.0
  ) {
    this.filePath = customPath || path.resolve(
      __dirname,
      '../../data/portfolio-live/cashflows.json'
    );
    this.ledger = {
      baselineDate: defaultBaselineDate,
      baselineEquity: defaultBaselineEquity,
      lastSyncTime: new Date('2026-10-29T00:00:00Z').getTime(),
      flows: [],
    };
  }

  getLedger(): Readonly<CashFlowLedger> {
    return this.ledger;
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.flows)) {
        this.ledger = {
          baselineDate: parsed.baselineDate || this.ledger.baselineDate,
          baselineEquity: Number.isFinite(parsed.baselineEquity) ? parsed.baselineEquity : this.ledger.baselineEquity,
          lastSyncTime: Number.isFinite(parsed.lastSyncTime) ? parsed.lastSyncTime : this.ledger.lastSyncTime,
          flows: parsed.flows,
        };
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        await this.save();
      } else {
        console.error('[CashFlowManager] Error reading ledger file:', err);
      }
    }
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.ledger, null, 2), 'utf-8');
    } catch (err) {
      console.error('[CashFlowManager] Error saving ledger file:', err);
    }
  }

  getCumulativeDeposits(): number {
    return this.ledger.flows
      .filter(f => f.type === 'DEPOSIT')
      .reduce((sum, f) => sum + f.amount, 0);
  }

  getCumulativeWithdrawals(): number {
    return this.ledger.flows
      .filter(f => f.type === 'WITHDRAWAL')
      .reduce((sum, f) => sum + f.amount, 0);
  }

  getNetInjectedCapital(): number {
    return this.getCumulativeDeposits() - this.getCumulativeWithdrawals();
  }

  getBaselineEquity(): number {
    return this.ledger.baselineEquity;
  }

  getAdjustedBaselineEquity(): number {
    return this.ledger.baselineEquity + this.getNetInjectedCapital();
  }

  computeStrategyNetPnl(currentEquity: number): number {
    return currentEquity - this.getAdjustedBaselineEquity();
  }

  computeStrategyRoiPct(currentEquity: number): number {
    const adj = this.getAdjustedBaselineEquity();
    if (!Number.isFinite(adj) || adj <= 0) return 0;
    return ((currentEquity - adj) / adj) * 100;
  }

  getSummary(currentEquity: number): CashFlowSummary {
    const cumulativeDeposits = Math.round(this.getCumulativeDeposits() * 100) / 100;
    const cumulativeWithdrawals = Math.round(this.getCumulativeWithdrawals() * 100) / 100;
    const netInjectedCapital = Math.round(this.getNetInjectedCapital() * 100) / 100;
    const adjustedBaselineEquity = Math.round(this.getAdjustedBaselineEquity() * 100) / 100;
    const strategyNetPnl = Math.round(this.computeStrategyNetPnl(currentEquity) * 100) / 100;
    const strategyRoiPct = Math.round(this.computeStrategyRoiPct(currentEquity) * 100) / 100;

    return {
      baselineDate: this.ledger.baselineDate,
      baselineEquity: this.ledger.baselineEquity,
      cumulativeDeposits,
      cumulativeWithdrawals,
      netInjectedCapital,
      adjustedBaselineEquity,
      strategyNetPnl,
      strategyRoiPct,
    };
  }

  async addManualFlow(
    type: 'DEPOSIT' | 'WITHDRAWAL',
    amount: number,
    note = 'Manual user entry',
    asset = 'USDT'
  ): Promise<CashFlowRecord> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid cash flow amount: ${amount}`);
    }
    const now = Date.now();
    const record: CashFlowRecord = {
      tranId: `manual_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      dateUtc: new Date(now).toISOString().split('T')[0],
      type,
      amount: Math.round(amount * 100) / 100,
      asset,
      note,
    };
    this.ledger.flows.push(record);
    await this.save();
    return record;
  }

  /**
   * Automatically queries Binance API for income of type TRANSFER.
   * Isolates external deposits/withdrawals without human intervention.
   */
  async syncFromBroker(
    broker: LiveBroker
  ): Promise<{ newDeposits: CashFlowRecord[]; newWithdrawals: CashFlowRecord[] }> {
    const newDeposits: CashFlowRecord[] = [];
    const newWithdrawals: CashFlowRecord[] = [];

    try {
      const startTime = Math.max(0, this.ledger.lastSyncTime - 60_000);
      const incomes: LiveIncome[] = await broker.getIncome({
        incomeType: 'TRANSFER',
        startTime,
        limit: 100,
      });

      if (!Array.isArray(incomes) || incomes.length === 0) {
        return { newDeposits, newWithdrawals };
      }

      const existingTranIds = new Set(this.ledger.flows.map(f => f.tranId));
      let maxSeenTime = this.ledger.lastSyncTime;

      for (const inc of incomes) {
        if (!inc || !inc.tranId) continue;
        const tranId = String(inc.tranId);
        const time = typeof inc.time === 'number' ? inc.time : Date.now();
        if (time > maxSeenTime) {
          maxSeenTime = time;
        }

        if (existingTranIds.has(tranId)) {
          continue;
        }

        const rawAmount = parseFloat(inc.income);
        if (!Number.isFinite(rawAmount) || rawAmount === 0) continue;

        const asset = inc.asset || 'USDT';
        const dateUtc = new Date(time).toISOString().split('T')[0];
        const isDeposit = rawAmount > 0;
        const type: 'DEPOSIT' | 'WITHDRAWAL' = isDeposit ? 'DEPOSIT' : 'WITHDRAWAL';
        const amount = Math.abs(rawAmount);

        const record: CashFlowRecord = {
          tranId,
          timestamp: time,
          dateUtc,
          type,
          amount,
          asset,
          note: `Binance TRANSFER (${inc.info || 'fapi/v1/income'})`,
        };

        this.ledger.flows.push(record);
        existingTranIds.add(tranId);

        if (isDeposit) {
          newDeposits.push(record);
        } else {
          newWithdrawals.push(record);
        }
      }

      this.ledger.lastSyncTime = maxSeenTime;

      if (newDeposits.length > 0 || newWithdrawals.length > 0) {
        await this.save();
        console.log(
          `[CashFlowManager] Synced ${newDeposits.length} deposits (+${newDeposits.reduce((s, d) => s + d.amount, 0)}u) and ${newWithdrawals.length} withdrawals (-${newWithdrawals.reduce((s, w) => s + w.amount, 0)}u) from Binance.`
        );
      }
    } catch (err) {
      console.error('[CashFlowManager] Failed to sync cash flows from broker:', err);
    }

    return { newDeposits, newWithdrawals };
  }
}
