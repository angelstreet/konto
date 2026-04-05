import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ 
  headless: true, 
  args: ['--no-sandbox', '--ignore-certificate-errors'] 
});
const page = await browser.newPage();

// Desktop - Device Control page
await page.setViewport({ width: 1280, height: 800 });
await page.goto('https://65.108.14.251/device-control', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-device-control.png' });
console.log('Device Control done');

// Mobile - Device Control page
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto('https://65.108.14.251/device-control', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-device-control-mobile.png' });
console.log('Device Control Mobile done');

await browser.close();
console.log('Done!');
