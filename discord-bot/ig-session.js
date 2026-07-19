/**
 * Instagram session manager.
 * Logs in once with Puppeteer, saves cookies, reuses them for all checks.
 */
const path = require('path');
const fs   = require('fs');

const COOKIES_PATH = path.join(global.__basedir || __dirname, 'ig-cookies.json');
const CHROME_PATH  = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--window-size=1280,800',
];

let _cookies = null; // in-memory cache

function loadCookies() {
  if (_cookies) return _cookies;
  try {
    _cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    return _cookies;
  } catch (_) {
    return null;
  }
}

function saveCookies(cookies) {
  _cookies = cookies;
  try { fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2)); } catch (_) {}
}

async function loginAndSaveCookies() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    console.log('[ig-session] Navigating to Instagram login...');
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Dismiss cookie banner if present
    try {
      const acceptBtn = await page.$('button[tabindex="0"]');
      if (acceptBtn) await acceptBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    } catch (_) {}

    // Wait for the login form
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });

    // Type credentials
    await page.type('input[name="username"]', process.env.IG_USERNAME || '', { delay: 80 });
    await new Promise(r => setTimeout(r, 500));
    await page.type('input[name="password"]', process.env.IG_PASSWORD || '', { delay: 80 });
    await new Promise(r => setTimeout(r, 500));

    // Submit
    await page.click('button[type="submit"]');
    console.log('[ig-session] Login submitted, waiting...');

    // Wait for redirect away from login page
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    const url = page.url();
    console.log('[ig-session] After login URL:', url);

    if (url.includes('/accounts/login/') || url.includes('/challenge/')) {
      console.warn('[ig-session] Login may have failed or requires 2FA. URL:', url);
      await browser.close();
      return false;
    }

    const cookies = await page.cookies();
    saveCookies(cookies);
    console.log(`[ig-session] Logged in successfully. Saved ${cookies.length} cookies.`);
    await browser.close();
    return true;
  } catch (err) {
    console.error('[ig-session] Login error:', err.message);
    await browser.close().catch(() => {});
    return false;
  }
}

async function getPage(username) {
  const puppeteer = require('puppeteer');
  let cookies = loadCookies();

  if (!cookies) {
    console.log('[ig-session] No cookies found, logging in...');
    const ok = await loginAndSaveCookies();
    if (!ok) return null;
    cookies = loadCookies();
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Inject saved cookies
    await page.setCookie(...cookies);

    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await new Promise(r => setTimeout(r, 4000));

    const result = await page.evaluate(() => {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      const ogImg  = document.querySelector('meta[property="og:image"]');
      const title  = document.title || '';
      const url    = window.location.href;
      const bodyTxt = document.body?.innerText?.slice(0, 500) || '';
      return {
        desc:    ogDesc ? ogDesc.getAttribute('content') : '',
        img:     ogImg  ? ogImg.getAttribute('content')  : '',
        title,
        url,
        bodyTxt,
        loginPage: !!document.querySelector('input[name="username"]'),
      };
    });

    // If we got kicked to login, cookies expired — clear and retry once
    if (result.loginPage || result.url.includes('/accounts/login/')) {
      console.log('[ig-session] Session expired, re-logging in...');
      _cookies = null;
      fs.unlink(COOKIES_PATH, () => {});
      await browser.close();
      const ok = await loginAndSaveCookies();
      if (!ok) return null;
      return getPage(username); // one retry
    }

    // Check for rate limit
    if (result.url.includes('chromewebdata') || result.bodyTxt.includes('429')) {
      console.warn('[ig-session] 429 rate limit hit even with session.');
      await browser.close();
      return { rateLimited: true };
    }

    // Fetch profile pic buffer
    let profilePic = null;
    if (result.img) {
      try {
        const b64 = await page.evaluate(async (url) => {
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = () => {
              if (xhr.status === 200) {
                const bytes = new Uint8Array(xhr.response);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                resolve(btoa(binary));
              } else resolve(null);
            };
            xhr.onerror  = () => resolve(null);
            xhr.ontimeout = () => resolve(null);
            xhr.timeout  = 8000;
            xhr.send();
          });
        }, result.img);
        if (b64) profilePic = Buffer.from(b64, 'base64');
      } catch (_) {}
    }

    await browser.close();
    return { ...result, profilePic };
  } catch (err) {
    console.error('[ig-session] getPage error:', err.message);
    await browser.close().catch(() => {});
    return null;
  }
}

module.exports = { getPage, loginAndSaveCookies, loadCookies };
