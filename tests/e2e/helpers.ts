import puppeteer, { type Browser, type Page } from 'puppeteer';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve(import.meta.dirname, 'screenshots');
const BASE = 'http://localhost:5176/kompta/';

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
} as const;

/** Build a full URL from a route path like "accounts" or "" */
export function url(route = ''): string {
  return `${BASE}${route}`;
}

export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

export async function dualScreenshot(page: Page, name: string): Promise<void> {
  // Desktop
  await page.setViewport(VIEWPORTS.desktop);
  await sleep(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-desktop.png`), fullPage: false });

  // Mobile
  await page.setViewport(VIEWPORTS.mobile);
  await sleep(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-mobile.png`), fullPage: false });

  // Reset to desktop
  await page.setViewport(VIEWPORTS.desktop);
}

export async function login(page: Page): Promise<void> {
  await page.goto(url(), { waitUntil: 'networkidle2' });

  // Wait for React to mount
  await page.waitForSelector('input', { timeout: 10_000 });

  // Type credentials
  const inputs = await page.$$('input');
  await inputs[0].type('user');
  await inputs[1].type('user');

  // Submit
  await page.click('button[type="submit"]');

  // Wait for dashboard to load (sidebar appears)
  await page.waitForFunction(
    () => document.querySelector('aside') !== null || document.querySelector('nav') !== null,
    { timeout: 10_000 },
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { SCREENSHOT_DIR };
