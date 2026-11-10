const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const base = 'http://127.0.0.1:4173/alice/status/123';
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const dir = path.join(__dirname, '../test-results'); fs.mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
    // The host blocks loopback TCP, so fulfill the demo's actual local files at the browser boundary.
    await page.route('http://127.0.0.1:4173/**', route => {
      let name = new URL(route.request().url()).pathname;
      if (/\/status\/\d+$/.test(name)) name = '/demo/index.html';
      const file = path.join(__dirname, '..', name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    page.on('pageerror', error => console.error('Demo page error:', error.message));
    await page.goto(base); await page.getByRole('button', { name: '译成英文', exact: true }).click();
    try { await page.getByText('英文译文', { exact: true }).waitFor({ timeout: 5000 }); }
    catch (error) { console.error('Demo state:', await page.locator('grok-input-panel').evaluateAll(nodes => nodes.map(node => node.shadowRoot?.textContent))); throw error; }
    await page.screenshot({ path: path.join(dir, 'demo-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 950 }); await page.screenshot({ path: path.join(dir, 'demo-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1000 }); await page.getByRole('button', { name: '切换深浅主题' }).click();
    // The panel takes its text colour from the reply editor on the next periodic scan (≤600 ms).
    await page.waitForTimeout(900); await page.screenshot({ path: path.join(dir, 'demo-dark.png'), fullPage: true });
    console.log('Captured demo-desktop.png, demo-mobile.png and demo-dark.png (synthetic translations only).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
