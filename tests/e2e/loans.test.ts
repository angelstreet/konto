import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, dualScreenshot, url } from './helpers.js';

describe('Loans pages (sandbox)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
    await page.goto(`${url()}?demo=1`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      localStorage.setItem('konto_scope', 'all');
      sessionStorage.removeItem('konto_logged_out');
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('renders loans overview and opens details', async () => {
    await page.goto(url('loans'), { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Emprunts') || document.body.innerText.includes('Loans'), { timeout: 10_000 });
    await dualScreenshot(page, 'loans-overview');

    const hasRows = await page.evaluate(() => {
      return document.querySelectorAll('tbody tr').length > 0 || document.body.innerText.includes('Prêt');
    });
    expect(hasRows).toBe(true);

    await page.goto(url('loans/8'), { waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => document.body.innerText.includes('Échéances payées') || document.body.innerText.includes('Installments paid'),
      { timeout: 10_000 },
    );
    await dualScreenshot(page, 'loan-detail');

    const hasTabs = await page.evaluate(() => {
      const txt = document.body.innerText;
      return txt.includes('Synthèse') || txt.includes('Summary');
    });
    expect(hasTabs).toBe(true);
  });
});
