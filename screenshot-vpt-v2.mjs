import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ 
  headless: true, 
  args: ['--no-sandbox', '--ignore-certificate-errors'] 
});
const page = await browser.newPage();

// Try 65.108.14.251 (debug env - no login)
console.log('Testing https://65.108.14.251 ...');
await page.setViewport({ width: 1280, height: 800 });
await page.goto('https://65.108.14.251/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
const html1 = await page.content();
const hasLogin1 = html1.includes('Sign in') || html1.includes('login') || html1.includes('email');
console.log('65.108.14.251 has login:', hasLogin1);
await page.screenshot({ path: '/tmp/vpt-65108251.png' });

// Try local 192.168.0.105:5073
console.log('Testing http://192.168.0.105:5073 ...');
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://192.168.0.105:5073/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
const html2 = await page.content();
const hasLogin2 = html2.includes('Sign in') || html2.includes('login') || html2.includes('email');
console.log('192.168.0.105:5073 has login:', hasLogin2);
await page.screenshot({ path: '/tmp/vpt-local.png' });

await browser.close();
console.log('Done!');
