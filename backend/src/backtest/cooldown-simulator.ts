import { resolveLossCooldownUntil } from '../config/risk-policy';

/** Walk-forward loss-streak cooldown (mirrors runtime tiered policy). */
export class BacktestCooldownState {
  private consecutiveLosses = 0;
  private cooldownUntil = 0;

  isBlocked(ts: number): boolean {
    return this.cooldownUntil > ts;
  }

  onTradeClose(pnlUsd: number, closeTime: number): void {
    if (pnlUsd < 0) {
      this.consecutiveLosses += 1;
      const until = resolveLossCooldownUntil(this.consecutiveLosses, new Date(closeTime));
      if (until) {
        this.cooldownUntil = Math.max(this.cooldownUntil, until.getTime());
      }
    } else if (pnlUsd > 0) {
      this.consecutiveLosses = 0;
    }
  }
}
