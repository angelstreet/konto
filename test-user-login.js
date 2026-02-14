const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  try {
    const page = await browser.newPage();

    // Navigate to konto
    console.log('🔗 Navigating to konto...');
    await page.goto('https://65.108.14.251:8080/konto/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Fill in user/user credentials
    console.log('👤 Logging in with user/user...');
    await page.waitForSelector('input[type="text"]', { timeout: 5000 });
    await page.type('input[type="text"]', 'user');
    await page.type('input[type="password"]', 'user');
    await page.click('button[type="submit"]');

    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });

    // Check what page we're on
    const url = page.url();
    console.log(`📍 Current URL: ${url}`);

    // Check if we see onboarding or dashboard
    const pageContent = await page.content();

    if (pageContent.includes('welcome_konto') || pageContent.includes('connect_bank') || pageContent.includes('onboarding')) {
      console.log('❌ FAIL: Onboarding screen is showing');
      console.log('Page title:', await page.title());
    } else if (pageContent.includes('Dashboard') || pageContent.includes('Transactions') || pageContent.includes('Accounts')) {
      console.log('✅ PASS: Dashboard is showing (no onboarding)');
      console.log('Page title:', await page.title());
    } else {
      console.log('⚠️  UNKNOWN: Cannot determine page type');
      console.log('Page title:', await page.title());
    }

    // Take a screenshot
    await page.screenshot({ path: '/tmp/konto-login-test.png', fullPage: true });
    console.log('📸 Screenshot saved to /tmp/konto-login-test.png');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
