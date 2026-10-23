const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../frontend/e2e-runner/node_modules/@playwright/test');
const { PORTFOLIO_PAPER_DASHBOARD_HTML } = require('../dist-portfolio-paper-candidate/portfolio/paper-dashboard');
const pkg = path.resolve(__dirname, '../../docs/audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z');
const auditDirectory = process.env.PORTFOLIO_UI_AUDIT_DIR || path.resolve(__dirname, '../../docs/audits/futures-quick-win/momentum-paper-watchdog-20261014T092700Z/ui');
fs.mkdirSync(auditDirectory, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let requestCount = 0;
  let data = { mode: 'paper', enabled: true, policy: { initialBalance: 100, dailyLossLimit: 10, timezone: 'Asia/Ho_Chi_Minh' },
    state: null, summary: null, latestTestbed: null, testbedJob: null };
  await page.route('http://paper.test/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith('/view')) return route.fulfill({ contentType: 'text/html', body: PORTFOLIO_PAPER_DASHBOARD_HTML });
    if (request.method() === 'POST') {
      assert.equal(url.pathname, '/api/portfolio-paper/testbed');
      assert.deepEqual(request.postDataJSON(), { days: 14 }); requestCount++;
      data.testbedJob = { id: 'ui-fixture', status: 'running' };
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ success: true, data: data.testbedJob }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.goto('http://paper.test/api/portfolio-paper/view');
  await page.waitForFunction(() => document.querySelector('#initial').textContent.includes('100'));
  assert.equal(await page.locator('#equity').textContent(), 'Chưa có dữ liệu');
  assert.equal(await page.locator('#net-pnl').textContent(), 'Chưa có dữ liệu');
  await page.locator('#testbed').click();
  await page.waitForFunction(() => document.querySelector('#testbed').disabled);
  assert.equal(requestCount, 1);
  const base = JSON.parse(fs.readFileSync(path.join(pkg, 'outputs/base/report.json')));
  data.testbedJob = { id: 'ui-fixture', status: 'complete' };
  data.latestTestbed = { period: { start: '2026-09-29T17:00:00Z', end: '2026-10-13T17:00:00Z', days: 14 },
    cases: [{ name: 'base', netPnl: base.summary.netPnl, meanDailyPnl: base.summary.meanNetPerCalendarDay,
      fees: base.summary.totalFees, funding: base.summary.fundingPnl, slippage: base.summary.totalSlippage,
      worstDay: base.summary.worstDayNetPnl, budgetBreaches: base.summary.maxDailyBreachUsd, fills: base.summary.fillCount }] };
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#cases').textContent.includes('226'));
  assert((await page.locator('#cases').textContent()).includes('-1,1382'));
  assert.equal(errors.length, 0);
  await page.screenshot({ path: path.join(auditDirectory, 'dashboard-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(auditDirectory, 'dashboard-mobile.png'), fullPage: true });
  assert(await page.locator('#testbed').isVisible());
  data.worker = { status: 'degraded' };
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#enabled-state').textContent.includes('Giá đang chậm'));
  assert(await page.locator('#advance').isDisabled());
  assert(await page.locator('#testbed').isEnabled());
  await browser.close();
  const receipt = { status: 'PASS', browser: 'Chromium', checks: ['missing values stay missing', 'registered days14 request', 'running job blocks duplicate clicks', 'actual base report renders', 'no browser errors', 'desktop and mobile', 'stale quotes block advance while offline testbed remains available'], financialRuns: 0 };
  fs.writeFileSync(path.join(auditDirectory, 'ui-check.json'), JSON.stringify(receipt, null, 2)+'\n');
  console.log(JSON.stringify(receipt));
})().catch(error => { console.error(error); process.exitCode = 1; });
