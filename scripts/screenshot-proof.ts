#!/usr/bin/env npx tsx
/**
 * Screenshot Proof Script
 * 
 * Usage:
 *   npx tsx scripts/screenshot-proof.ts <task-id> [url]
 * 
 * Examples:
 *   npx tsx scripts/screenshot-proof.ts 649 http://localhost:5173
 *   npx tsx scripts/screenshot-proof.ts 123 http://localhost:3000
 * 
 * Generates desktop (1280x800) and mobile (375x812) screenshots
 * Saves to proofs/task-{id}-{viewport}.png
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const VIEWPORTS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
  mobile: { width: 375, height: 812, deviceScaleFactor: 2 }, // iPhone X dimensions
};

async function takeScreenshot(taskId: string, url: string, viewport: string) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    const vp = VIEWPORTS[viewport as keyof typeof VIEWPORTS];
    
    await page.setViewport(vp);
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Wait a bit for any animations to settle
    await new Promise(r => setTimeout(r, 500));

    const projectRoot = path.resolve(__dirname, '..');
    const screenshotPath = path.join(projectRoot, 'proofs', `task-${taskId}-${viewport}.png`);

    await page.screenshot({ 
      path: screenshotPath,
      fullPage: false,
    });

    console.log(`✅ Screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  } finally {
    await browser.close();
  }
}

async function main() {
  const taskId = process.argv[2];
  const url = process.argv[3] || 'http://localhost:5173';

  if (!taskId) {
    console.error('Usage: npx tsx scripts/screenshot-proof.ts <task-id> [url]');
    process.exit(1);
  }

  // Ensure proofs directory exists
  const projectRoot = path.resolve(__dirname, '..');
  const proofsDir = path.join(projectRoot, 'proofs');
  if (!fs.existsSync(proofsDir)) {
    fs.mkdirSync(proofsDir, { recursive: true });
  }

  console.log(`📸 Taking screenshots for task #${taskId} at ${url}...\n`);

  try {
    for (const viewport of Object.keys(VIEWPORTS)) {
      await takeScreenshot(taskId, url, viewport);
    }
    console.log('\n✨ All screenshots completed!');
  } catch (error) {
    console.error('❌ Error taking screenshots:', error);
    process.exit(1);
  }
}

main();
