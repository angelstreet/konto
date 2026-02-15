const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('https://example.com', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/tmp/puppeteer-screenshot.png', fullPage: false });
  await browser.close();
  console.log('Screenshot saved');
})();
