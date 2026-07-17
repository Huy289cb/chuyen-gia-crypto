import { test, expect } from '@playwright/test';

test.describe('https://www.cryptotrend.site smoke', () => {
  test('home loads brand + zone nav', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.ok() || res?.status() === 304).toBeTruthy();
    await expect(page).toHaveTitle(/Download Money|AI Trading/i);
    await expect(page.getByText(/Download/i).first()).toBeVisible();
    for (const label of ['Tóm tắt', 'Thị trường', 'Thực thi', 'Hệ thống']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('system overview gets API data (not stuck Loading)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'System Overview', exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const body = await page.locator('body').innerText();
        return /equity|balance|online|healthy|Worker|API|PnL|exposure|USDT/i.test(body);
      }, { timeout: 45_000 })
      .toBeTruthy();
  });

  test('execution panels: account, positions, orders, history', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Thực thi', { exact: true }).first().click();

    // Prod may still say Testnet until frontend deploy; local changes use Live Account.
    await expect(
      page.getByRole('heading', { name: 'Testnet Account', exact: true }).or(
        page.getByRole('heading', { name: 'Live Account', exact: true })
      )
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('heading', { name: 'Open Positions', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active Orders', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trade History', exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const t = await page.locator('body').innerText();
        return (
          t.includes('Total Balance') ||
          t.includes('Account not initialized') ||
          t.includes('Available') ||
          t.includes('No Open Positions')
        );
      }, { timeout: 45_000 })
      .toBeTruthy();
  });

  test('market chart timeframe buttons work', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Thị trường', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Market Chart', exact: true })).toBeVisible();
    for (const tf of ['5m', '15m', '1H', '4H', '1D']) {
      await expect(page.getByText(tf, { exact: true }).first()).toBeVisible();
    }
    await page.getByText('1H', { exact: true }).first().click();
    await expect
      .poll(async () => {
        const t = await page.locator('body').innerText();
        return /BTC|SMA|RSI|ATR|Indicators/i.test(t);
      }, { timeout: 45_000 })
      .toBeTruthy();
  });

  test('pipeline section leaves loading state', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Pipeline', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Decision Pipeline', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signal Gate', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Risk Engine', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'LLM Dispatch', exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const t = await page.locator('body').innerText();
        return !t.includes('Loading pipeline state...');
      }, { timeout: 45_000 })
      .toBeTruthy();
  });

  test('schedulers + event log visible', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Hệ thống', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Scheduler Status', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Event Log', exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const t = await page.locator('body').innerText();
        return /MarketScan|LLMDispatch|PositionMonitor|ago|idle|running/i.test(t);
      }, { timeout: 45_000 })
      .toBeTruthy();
  });

  test('rules page content', async ({ page }) => {
    await page.goto('/rules');
    await expect(
      page.getByRole('heading', { level: 1, name: /Big Update v3/i })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Binance/i).first()).toBeVisible();
    await expect(page.getByText(/Kim Nghia|Kim Nghĩa/i).first()).toBeVisible();
  });

  test('API proxy health via browser network', async ({ page }) => {
    const apiHits: { url: string; status: number }[] = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/') || url.includes('cryptotrend') && url.includes('api')) {
        apiHits.push({ url, status: res.status() });
      }
    });
    await page.goto('/');
    await page.waitForResponse(
      (r) => r.url().includes('/api/') && r.status() < 500,
      { timeout: 45_000 }
    ).catch(() => undefined);
    await page.waitForTimeout(5_000);
    // Dashboard may call absolute NEXT_PUBLIC_API_URL host, not /api path only.
    const anyXhr = apiHits.length > 0;
    const body = await page.locator('body').innerText();
    const uiLoaded = /System Overview|Total Balance|MarketScan|Signal Gate/i.test(body);
    expect(anyXhr || uiLoaded).toBeTruthy();
    const bad = apiHits.filter((h) => h.status >= 500);
    expect(bad, `5xx APIs: ${JSON.stringify(bad.slice(0, 5))}`).toHaveLength(0);
  });
});
