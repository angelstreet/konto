import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ 
  headless: true, 
  args: ['--no-sandbox', '--ignore-certificate-errors'] 
});
const page = await browser.newPage();

// Desktop - Dashboard (65.108.14.251)
await page.setViewport({ width: 1280, height: 800 });
await page.goto('https://65.108.14.251/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-desktop-65.png' });
console.log('Desktop Dashboard (65.108.14.251) done');

// Mobile - Dashboard (65.108.14.251)
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto('https://65.108.14.251/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-mobile-65.png' });
console.log('Mobile Dashboard (65.108.14.251) done');

// Desktop - Devices page
await page.setViewport({ width: 1280, height: 800 });
await page.goto('https://65.108.14.251/devices', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-devices-65.png' });
console.log('Devices page (65.108.14.251) done');

// Mobile - Devices page
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto('https://65.108.14.251/devices', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/vpt-devices-mobile-65.png' });
console.log('Mobile Devices (65.108.14.251) done');

await browser.close();
console.log('All screenshots done!');
