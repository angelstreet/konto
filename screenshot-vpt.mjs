import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ 
  headless: true, 
  args: ['--no-sandbox', '--ignore-certificate-errors'] 
});
const page = await browser.newPage();

// Desktop screenshot
await page.setViewport({ width: 1280, height: 800 });
await page.goto('https://www.virtualpytest.com', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/vpt-desktop.png' });
console.log('Desktop screenshot taken');

// Mobile screenshot
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto('https://www.virtualpytest.com', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/vpt-mobile.png' });
console.log('Mobile screenshot taken');

await browser.close();
console.log('Done!');
