import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, dualScreenshot, url } from './helpers.js';

describe('Login page', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('renders the login form', async () => {
    await page.goto(url(), { waitUntil: 'networkidle2' });
    await page.waitForSelector('h1', { timeout: 10_000 });
    await dualScreenshot(page, 'login-page');

    const heading = await page.$eval('h1', (el) => el.textContent);
    expect(heading).toContain('Kompta');

    const inputs = await page.$$('input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error on bad credentials', async () => {
    await page.goto(url(), { waitUntil: 'networkidle2' });
    await page.waitForSelector('input', { timeout: 10_000 });

    const inputs = await page.$$('input');
    await inputs[0].type('wrong');
    await inputs[1].type('wrong');
    await page.click('button[type="submit"]');

    // Wait for error message
    await page.waitForFunction(
      () => document.querySelector('p[class*="red"]') !== null,
      { timeout: 5000 },
    );
    await dualScreenshot(page, 'login-error');

    const errorText = await page.$eval('p[class*="red"]', (el) => el.textContent);
    expect(errorText).toBeTruthy();
  });

  it('logs in successfully with correct credentials', async () => {
    await page.goto(url(), { waitUntil: 'networkidle2' });
    await page.waitForSelector('input', { timeout: 10_000 });

    const inputs = await page.$$('input');
    await inputs[0].type('user');
    await inputs[1].type('user');
    await page.click('button[type="submit"]');

    // Wait for dashboard to load
    await page.waitForFunction(
      () => document.querySelector('aside') !== null || document.querySelector('nav') !== null,
      { timeout: 10_000 },
    );
    await dualScreenshot(page, 'login-success');

    const currentUrl = page.url();
    expect(currentUrl).toContain('/kompta');
  });
});
