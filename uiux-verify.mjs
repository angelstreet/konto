import puppeteer from 'puppeteer';

const BASE_URL = 'https://65.108.14.251';

const browser = await puppeteer.launch({ 
  headless: true, 
  args: ['--no-sandbox', '--ignore-certificate-errors'] 
});

const page = await browser.newPage();

// Task 1: Footer version check - check if version string is hidden
await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE_URL + '/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

// Get footer content
const footerContent = await page.evaluate(() => {
  const footer = document.querySelector('footer');
  return footer ? footer.textContent : 'No footer found';
});
console.log('Footer content:', footerContent);

// Check if version string is visible
const hasVersion = footerContent.includes('debug-');
console.log('Has debug version in footer:', hasVersion);
await page.screenshot({ path: '/tmp/task1-footer-check.png' });
console.log('Task 1: Footer screenshot saved');

// Task 2: Empty states - Test Cases page
await page.goto(BASE_URL + '/test-plan/test-cases', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/task2-testcases-empty.png' });
console.log('Task 2: Test cases empty state saved');

// Task 2b: Campaign page empty state
await page.goto(BASE_URL + '/test-plan/campaigns', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/task2-campaigns-empty.png' });
console.log('Task 2: Campaigns empty state saved');

// Task 3: Mobile device cards - Device Control page
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(BASE_URL + '/device-control', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/task3-mobile-device-cards.png' });
console.log('Task 3: Mobile device cards saved');

await browser.close();
console.log('All screenshots taken!');
