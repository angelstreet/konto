import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ 
  headless: true, 
  args: ['--no-sandbox', '--ignore-certificate-errors'] 
});
const page = await browser.newPage();

const routes = [
  { path: '/', name: 'dashboard' },
  { path: '/device-control', name: 'device-control' },
  { path: '/builder/test-builder', name: 'test-builder' },
  { path: '/builder/campaign-builder', name: 'campaign-builder' },
  { path: '/run/tests', name: 'run-tests' },
  { path: '/configuration', name: 'configuration' },
  { path: '/ai-agent', name: 'ai-agent' },
];

for (const route of routes) {
  console.log(`Taking ${route.name} desktop...`);
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`https://65.108.14.251${route.path}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: `/tmp/vpt-${route.name}-desktop.png` });
  
  console.log(`Taking ${route.name} mobile...`);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`https://65.108.14.251${route.path}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: `/tmp/vpt-${route.name}-mobile.png` });
}

await browser.close();
console.log('All screenshots done!');
