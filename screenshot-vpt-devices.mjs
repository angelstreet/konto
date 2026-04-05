import puppeteer from 'puppeteer';

const AUTO_SIGN_TOKEN = '1f36fe19e305f9b83fd97596296e2dfaa17f982b04407f2ba31f96777cad4f47';
const BASE_URL = 'https://www.virtualpytest.com';

const browser = await puppeteer.launch({ 
  headless: true, 
  args: ['--no-sandbox', '--ignore-certificate-errors'] 
});
const page = await browser.newPage();

// Desktop - Devices page
await page.setViewport({ width: 1280, height: 800 });
await page.goto(`${BASE_URL}/devices?auto_signed=${AUTO_SIGN_TOKEN}`, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-desktop-devices.png' });
console.log('Desktop Devices done');

// Mobile - Devices page
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(`${BASE_URL}/devices?auto_signed=${AUTO_SIGN_TOKEN}`, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-mobile-devices.png' });
console.log('Mobile Devices done');

await browser.close();
console.log('Done!');
