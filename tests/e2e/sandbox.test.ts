import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, url } from './helpers.js';

describe('Sandbox demo mode', () => {
  let browser: Browser;
  let page: Page;
  const pageErrors: string[] = [];

  beforeAll(async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
  });

  afterAll(async () => {
    await browser.close();
  });

  it('activates demo mode from URL and keeps sandbox flags', async () => {
    await page.goto(`${url()}?demo=1`, { waitUntil: 'networkidle2' });

    await page.waitForFunction(
      () => localStorage.getItem('konto_sandbox') === 'true' && document.body.innerText.includes('Demo'),
      { timeout: 10_000 },
    );

    const flags = await page.evaluate(() => ({
      sandbox: localStorage.getItem('konto_sandbox'),
      auth: localStorage.getItem('konto_auth'),
    }));
    expect(flags.sandbox).toBe('true');
    expect(flags.auth).toBe('true');
  });

  it('returns stable analytics/dashboard shape and avoids known crashes', async () => {
    await page.goto(url('analysis?demo=1'), { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Budget'), { timeout: 10_000 });

    const shape = await page.evaluate(async () => {
      const analytics = await fetch('/konto/api/analytics?period=2026-02').then((r) => r.json());
      const dashboard = await fetch('/konto/api/dashboard?usage=professional').then((r) => r.json());
      return {
        analyticsOk:
          typeof analytics.totalIncome === 'number' &&
          typeof analytics.totalExpenses === 'number' &&
          typeof analytics.savingsRate === 'number' &&
          Array.isArray(analytics.topCategories) &&
          Array.isArray(analytics.trends),
        dashboardOk: !!dashboard?.financial?.accountsByType,
      };
    });

    expect(shape.analyticsOk).toBe(true);
    expect(shape.dashboardOk).toBe(true);

    const crashLike = pageErrors.some((m) =>
      m.includes('toLocaleString') || m.includes('accountsByType') || m.includes('Cannot read properties of undefined'),
    );
    expect(crashLike).toBe(false);
  });
});
