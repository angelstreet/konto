import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, dualScreenshot, login, url } from './helpers.js';

describe('Navigation', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
    await login(page);
  });

  afterAll(async () => {
    await browser.close();
  });

  it('navigates to Accounts page', async () => {
    await page.goto(url('accounts'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('aside, nav', { timeout: 10_000 });
    await dualScreenshot(page, 'nav-accounts');
    expect(page.url()).toContain('/accounts');
  });

  it('navigates to Companies page', async () => {
    await page.goto(url('companies'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('aside, nav', { timeout: 10_000 });
    await dualScreenshot(page, 'nav-companies');
    expect(page.url()).toContain('/companies');
  });

  it('navigates to Transactions page', async () => {
    await page.goto(url('transactions'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('aside, nav', { timeout: 10_000 });
    await dualScreenshot(page, 'nav-transactions');
    expect(page.url()).toContain('/transactions');
  });

  it('navigates to Settings page', async () => {
    await page.goto(url('settings'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('aside, nav', { timeout: 10_000 });
    await dualScreenshot(page, 'nav-settings');
    expect(page.url()).toContain('/settings');
  });

  it('shows bottom navigation on mobile viewport', async () => {
    await page.setViewport({ width: 375, height: 812 });
    await page.goto(url(), { waitUntil: 'networkidle2' });
    await page.waitForSelector('nav', { timeout: 10_000 });

    // Bottom nav is a <nav> with fixed positioning at the bottom
    const hasBottomNav = await page.evaluate(() => {
      const navs = document.querySelectorAll('nav');
      for (const nav of navs) {
        const style = window.getComputedStyle(nav);
        if (style.position === 'fixed' && parseInt(style.bottom) <= 0) return true;
      }
      return false;
    });

    await dualScreenshot(page, 'nav-mobile-bottom');
    expect(hasBottomNav).toBe(true);
  });
});
