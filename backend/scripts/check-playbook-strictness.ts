import { analyzeSetupGate } from '../src/analyzers/setup-gate.analyzer';
import { getKlines } from '../src/services/binance/market';

async function count(tf: string, limit: number) {
  const kl = await getKlines('BTCUSDT', tf, limit);
  const candles = kl.map((k) => ({
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    timestamp: k.openTime,
  }));
  let ls = 0;
  let bo = 0;
  let none = 0;
  let bothWould = 0;
  const need = 80;
  for (let i = need; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const r = await analyzeSetupGate({ candles: slice, symbol: 'BTC', timeframe: tf });
    if (r.playbookKey === 'liquidity_sweep_reclaim') ls++;
    else if (r.playbookKey === 'breakout_volume') bo++;
    else none++;
    const pbs = r.evidence?.playbooks ?? [];
    const lsDet = pbs.find(
      (p) => p.playbook === 'liquidity_sweep' && p.detected && (p.grade === 'A' || p.grade === 'B')
    );
    const boDet = pbs.find(
      (p) => p.playbook === 'breakout_volume' && p.detected && (p.grade === 'A' || p.grade === 'B')
    );
    if (lsDet && boDet) bothWould++;
  }
  return {
    tf,
    bars: candles.length - need,
    ls,
    bo,
    none,
    bothAorB: bothWould,
    gatePass: ls + bo,
    passPct: +(((ls + bo) / (candles.length - need)) * 100).toFixed(1),
  };
}

async function main() {
  console.log(await count('5m', 500));
  console.log(await count('15m', 400));
  console.log('LS priority only swaps winner when bothAorB>0; BO alone still passes.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
