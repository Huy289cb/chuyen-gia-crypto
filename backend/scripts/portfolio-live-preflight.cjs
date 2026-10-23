/* Explicit deployment preflight. The only order endpoint used is order/test. */
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const root = path.resolve(__dirname, '..');
const build = process.env.PORTFOLIO_PREFLIGHT_BUILD || 'dist-portfolio-live-candidate';
const { createDefaultLiveBroker } = require(path.join(root, build, 'portfolio/live-broker'));
const { loadCctCurrentMarket } = require(path.join(root, build, 'portfolio/market-data'));
const { buildConstantDirectionSourceTargets } = require(path.join(root, build, 'portfolio/source-constant-direction'));
const { projectCctTargets } = require(path.join(root, build, 'portfolio/target-projection'));
const { request } = require(path.join(root, build, 'services/binance/client'));
const { LIVE_POLICY_ID, LIVE_SYMBOLS, LIVE_CONFIG } = require(path.join(root, build, 'portfolio/live-service'));
const { Decimal } = require('@prisma/client/runtime/library');
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const capital = '31.47744546';
const directory = path.join(root, 'data/portfolio-live', LIVE_POLICY_ID);
const receiptDir = '/home/ubuntu/futures-live-20261016';
async function save(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function cleanAccount(broker) {
  const [account, positions, orders, algos, mode] = await Promise.all([
    broker.getAccount(), broker.getPositions(), broker.getOpenOrders(), broker.getOpenAlgoOrders(), broker.getPositionMode(),
  ]);
  const active = positions.filter(p => !new Money(p.positionAmt).isZero());
  if (active.length || orders.length || algos.length) throw new Error('Account must be flat with no regular/algo orders before handoff');
  if (mode.dualSidePosition || account.multiAssetsMargin || account.canTrade === false) throw new Error('Unsupported account mode');
  if (new Money(account.availableBalance).lt(capital)) throw new Error('Available balance below authorized allocation');
  return { account, activePositions: active, openOrders: orders.length, openAlgoOrders: algos.length, mode };
}
async function main() {
  const broker = createDefaultLiveBroker();
  const before = await cleanAccount(broker);
  if (process.argv[2] === 'setup-and-test') {
    // This command is only invoked after the legacy writer has been stopped.
    for (const symbol of LIVE_SYMBOLS) await broker.setLeverage(symbol, 10);
  }
  const [settings, feeRows, prior] = await Promise.all([
    broker.getSymbolConfiguration(), Promise.all(LIVE_SYMBOLS.map(s => broker.getCommissionRate(s))),
    fs.readFile(path.join(directory, 'source-bridge.json'), 'utf8').then(JSON.parse).catch(e => {
      if (e.code === 'ENOENT') return undefined; throw e;
    }),
  ]);
  const market = await loadCctCurrentMarket({ sourceBridge: prior, fundingAfterMs: Date.now(), fundingSymbols: [] });
  const utc = Math.floor(Date.now() / 86400000) * 86400000;
  const target = buildConstantDirectionSourceTargets(market.closedDailyRows, utc);
  const weights = Object.fromEntries(LIVE_SYMBOLS.map(s => [s, target.decimalWeights[s]]));
  const feeRate = feeRows.reduce((v, r) => Money.max(v, r.takerCommissionRate), new Money(0)).toString();
  const projection = projectCctTargets({ weights, positions: {}, equity: capital, marks: market.marks,
    references: market.tradePrices, filters: market.filters, grossCap: LIVE_CONFIG.grossCap,
    feeRate, slippageBps: LIVE_CONFIG.slippageBps, leverage: LIVE_CONFIG.leverage,
    dayAnchor: capital, dayNetCashflow: '0', dailyLossBudget: '15', closeBuffer: '6.1' });
  await save(path.join(directory, 'source-bridge.json'), market.sourceBridge);
  const tested = [];
  if (process.argv[2] === 'setup-and-test') {
    for (const symbol of LIVE_SYMBOLS) {
      const setting = settings.find(s => s.symbol === symbol);
      if (!setting || String(setting.leverage) !== '10' || String(setting.marginType).toUpperCase() !== 'CROSSED') {
        throw new Error('Leverage/margin setup verification failed for ' + symbol);
      }
    }
    if (!projection.feasible || !projection.orders.length) throw new Error('No executable projected basket at actual capital');
    for (const order of projection.orders) {
      const quantity = new Money(order.quantity);
      await request('POST', '/fapi/v1/order/test', { symbol: order.symbol,
        side: quantity.gt(0) ? 'BUY' : 'SELL', type: 'MARKET', quantity: quantity.abs().toString(),
        positionSide: 'BOTH', newClientOrderId: 'pfcheck-' + Date.now() + '-' + order.symbol,
      }, true, { quietErrors: true, executionOwner: LIVE_POLICY_ID });
      tested.push({ symbol: order.symbol, quantity: order.quantity, accepted: true, endpoint: '/fapi/v1/order/test' });
    }
  }
  const after = await cleanAccount(broker);
  const result = { observedAt: new Date().toISOString(), policyId: LIVE_POLICY_ID, accountIdentity: broker.identity,
    initialCapital: capital, dailyBudget: '15', availableBalance: after.account.availableBalance,
    accountWalletBalance: after.account.totalWalletBalance, positionMode: 'ONE_WAY',
    activePositions: after.activePositions, openOrders: after.openOrders, openAlgoOrders: after.openAlgoOrders,
    settings: settings.filter(s => LIVE_SYMBOLS.includes(s.symbol)), feeRate,
    filters: market.filters, previewSourceAt: new Date(utc).toISOString(), sourceRevision: target.sourceRevision,
    weights, projection, orderTests: tested, realOrdersSubmitted: 0,
    nextSourceAt: new Date(utc + 86400000).toISOString(),
    beforeAvailableBalance: before.account.availableBalance };
  await save(path.join(receiptDir, process.argv[2] === 'setup-and-test' ? 'venue-setup-tested.json' : 'venue-preview.json'), result);
  await save(path.join(directory, 'readiness.json'), { ...result, accountIdentity: undefined });
  console.log(JSON.stringify({ ...result, accountIdentity: undefined, filters: undefined, settings: undefined }, null, 2));
}
main().catch(e => { console.error(JSON.stringify({ status: 'PREFLIGHT_FAILED', error: e.name,
  code: e.binanceCode || e.response?.data?.code, message: e.response ? 'Venue request rejected (payload redacted)' : e.message })); process.exitCode = 1; });
