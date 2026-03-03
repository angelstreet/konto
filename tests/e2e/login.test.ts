import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, dualScreenshot, url } from './helpers.js';

describe('Entry and demo access', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('renders entry screen', async () => {
    await page.goto(url(), { waitUntil: 'networkidle2' });
    await page.waitForSelector('h1', { timeout: 10_000 });
    await dualScreenshot(page, 'login-page');

    const heading = await page.$eval('h1', (el) => el.textContent || '');
    expect(heading).toContain('Konto');
  });

  it('activates demo mode via query and lands on dashboard', async () => {
    await page.goto(`${url()}?demo=1`, { waitUntil: 'networkidle2' });

    await page.waitForFunction(
      () => localStorage.getItem('konto_sandbox') === 'true' && (document.querySelector('aside') !== null || document.querySelector('nav') !== null),
      { timeout: 10_000 },
    );

    await dualScreenshot(page, 'login-success');

    const flags = await page.evaluate(() => ({
      sandbox: localStorage.getItem('konto_sandbox'),
      auth: localStorage.getItem('konto_auth'),
      url: window.location.pathname,
    }));

    expect(flags.sandbox).toBe('true');
    expect(flags.auth).toBe('true');
    expect(flags.url).toContain('/konto');
  });

  it('shows demo indicator in app shell', async () => {
    await page.goto(`${url()}?demo=1`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => document.body.innerText.includes('Demo') || document.body.innerText.includes('démo'),
      { timeout: 10_000 },
    );
    await dualScreenshot(page, 'login-error');
    const hasIndicator = await page.evaluate(() => document.body.innerText.includes('Demo') || document.body.innerText.includes('démo'));
    expect(hasIndicator).toBe(true);
  });
});
