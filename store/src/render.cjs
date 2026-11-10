// Renders the Chrome Web Store images into store/images:  node store/src/render.cjs
// 1. Loads a copy of the real extension in Edge with a synthetic network (fake sign-in, fixed
//    translations; nothing reaches xAI or X), opens X-like pages at x.com addresses and captures
//    the reply box, the X Chat box, the popup and the settings page into store/src/raw (2x).
//    raw/reply-hero.png, raw/chat.png and raw/popup.png are also the product images of zuoye.si/xtranslate/.
// 2. Lays those captures out with shots.html and saves 1280×800 screenshots plus the 440×280 and
//    1400×560 promo tiles as 24-bit PNGs without alpha, as the store requires.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const { replyPage, chatPage } = require('./mock-x.cjs');

const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(__dirname, 'raw');
const OUT = path.join(__dirname, '../images');
const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const REPLY = { zh: '恭喜！从第一周就在关注你们，产品进步很明显。期待下一个里程碑！', en: "Congrats! I've been following you since week one, and the product has improved so much. Looking forward to the next milestone!" };
const CHAT = { zh: '会去的！到时候一起喝杯咖啡，顺便聊聊合作的事？', en: "I'll be there! Want to grab a coffee and talk about working together?" };
const MESSAGES = [['them', 'Loved your thread on cross-border payments!'], ['me', 'Thank you, that means a lot 🙏'], ['them', 'Also, thanks again for the intro yesterday 🙌'], ['me', 'Anytime! Glad you two connected.'], ['them', 'Are you coming to the builders meetup in Singapore next week?']];

// Replaces fetch in the extension's service worker, like tests/extension.test.cjs.
const harness = `globalThis.fetch = async (url, init = {}) => {
  const address = String(url); let data;
  if (address === 'https://auth.x.ai/oauth2/device/code') data = {device_code:'store-device',user_code:'ABCD-EFGH',verification_uri:'https://auth.x.ai/oauth2/device',verification_uri_complete:'https://auth.x.ai/oauth2/device?user_code=ABCD-EFGH',expires_in:600,interval:1};
  else if (address === 'https://auth.x.ai/oauth2/token') data = {access_token:'store-access',refresh_token:'store-refresh',token_type:'Bearer',expires_in:3600};
  else if (address === 'https://api.x.ai/v1/models') data = {data:[{id:'grok-4.20-0309-non-reasoning'},{id:'grok-4.20-0309-reasoning'},{id:'grok-4.3'}]};
  else if (address === 'https://api.x.ai/v1/responses') {
    const text = JSON.parse(init.body).input[0].content[0].text;
    data = {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:${JSON.stringify({ [REPLY.zh]: REPLY.en, [CHAT.zh]: CHAT.en })}[text] || 'Thanks!'}]}]};
  } else if (address === 'https://auth.x.ai/oauth2/revoke') data = {};
  else throw new Error('Blocked non-synthetic network: ' + address);
  return new Response(JSON.stringify(data), {status:200,headers:{'Content-Type':'application/json'}});
};
`;

async function capture() {
  fs.mkdirSync(RAW, { recursive: true });
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'xtr-store-ext-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xtr-store-profile-'));
  fs.cpSync(path.join(ROOT, 'extension'), ext, { recursive: true });
  fs.writeFileSync(path.join(ext, 'background.js'), harness + fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: EDGE, headless: true, deviceScaleFactor: 2, colorScheme: 'light',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).hostname;
    await ctx.route('https://x.com/**', route => {
      const chat = new URL(route.request().url()).pathname.startsWith('/i/chat/');
      const body = chat ? chatPage({ draft: CHAT.zh, messages: MESSAGES }) : replyPage({ draft: REPLY.zh });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>X</title></head><body>${body}</body></html>` });
    });

    const options = await ctx.newPage();
    await options.setViewportSize({ width: 760, height: 1100 });
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.getByRole('button', { name: '连接 Grok', exact: true }).click();
    await options.getByText('已连接', { exact: true }).waitFor({ timeout: 20000 });
    await options.getByLabel('在 X 聊天中启用翻译').check();
    await options.getByText('已开启', { exact: true }).waitFor();
    await options.locator('option[value="grok-4.20-0309-non-reasoning"]').waitFor({ state: 'attached' });
    await options.mouse.move(0, 0); await options.waitForTimeout(500);
    await options.screenshot({ path: path.join(RAW, 'options.png'), fullPage: true });

    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByText('已连接', { exact: false }).first().waitFor();
    await popup.waitForTimeout(300);
    await popup.locator('body').screenshot({ path: path.join(RAW, 'popup.png') });

    const reply = await ctx.newPage();
    await reply.setViewportSize({ width: 680, height: 1000 });
    await reply.goto('https://x.com/alexlee/status/1855000000000000123');
    await reply.getByRole('button', { name: '译成英文', exact: true }).click();
    await reply.getByText('英文已填入，发布前可继续修改。', { exact: true }).waitFor();
    await reply.evaluate(() => { document.activeElement?.blur(); getSelection().removeAllRanges(); });
    await reply.mouse.move(0, 0); await reply.waitForTimeout(800);
    const clip = await reply.evaluate(() => { const main = document.querySelector('main').getBoundingClientRect(), list = document.querySelector('#timeline').getBoundingClientRect(); return { x: main.left, y: 0, width: main.width, height: list.bottom }; });
    await reply.screenshot({ path: path.join(RAW, 'reply.png'), clip });
    // The post and the translated reply alone (no top bar, no next reply), for the zuoye.si/xtranslate page.
    const hero = await reply.evaluate(() => { const main = document.querySelector('main').getBoundingClientRect(), cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].map(cell => cell.getBoundingClientRect()); return { x: main.left, y: cells[0].top, width: main.width, height: cells[2].top - cells[0].top }; });
    await reply.screenshot({ path: path.join(RAW, 'reply-hero.png'), clip: hero });

    const chat = await ctx.newPage();
    await chat.setViewportSize({ width: 680, height: 720 });
    await chat.goto('https://x.com/i/chat/1855000000-2026000000');
    await chat.getByRole('button', { name: '译成英文', exact: true }).click();
    await chat.getByText('英文已填入，发送前可继续修改。', { exact: true }).waitFor();
    await chat.evaluate(() => document.querySelector('[data-testid="xchatEmbedRoute"]').shadowRoot.activeElement?.blur());
    await chat.mouse.move(0, 0); await chat.waitForTimeout(800);
    await chat.screenshot({ path: path.join(RAW, 'chat.png') });
  } finally {
    await ctx.close();
    fs.rmSync(ext, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
  }
}

// Screenshots come back as RGBA; the store wants 24-bit PNG without alpha.
function toRGB(png) {
  let pos = 8, ihdr; const idat = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8), data = png.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') ihdr = data; else if (type === 'IDAT') idat.push(data);
    pos += 12 + length; if (type === 'IEND') break;
  }
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), colour = ihdr[9];
  if (ihdr[8] !== 8 || ihdr[12] !== 0) throw new Error('unexpected PNG format');
  if (colour === 2) return png;
  if (colour !== 6) throw new Error(`unexpected PNG colour type ${colour}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 4, out = Buffer.alloc(height * (1 + width * 3));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      let add = 0;
      if (filter === 1) add = a; else if (filter === 2) add = b; else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + add) & 255;
    }
    const o = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      if (line[x * 4 + 3] !== 255) throw new Error(`transparent pixel at ${x},${y}`);
      out[o + 1 + x * 3] = line[x * 4]; out[o + 2 + x * 3] = line[x * 4 + 1]; out[o + 3 + x * 3] = line[x * 4 + 2];
    }
    prev = line;
  }
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), head = Buffer.alloc(4), crc = Buffer.alloc(4); head.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(body)); return Buffer.concat([head, body, crc]); };
  const header = Buffer.from(ihdr); header[9] = 2;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const SHOTS = [
  ['screenshot-1-reply.png', '1', 1280, 800],
  ['screenshot-2-chat.png', '2', 1280, 800],
  ['screenshot-3-settings.png', '3', 1280, 800],
  ['promo-small-440x280.png', 'tile', 440, 280],
  ['promo-marquee-1400x560.png', 'marquee', 1400, 560]
];
async function compose() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    // Serve store/src and the extension icon from one https origin so web fonts load without file:// limits.
    await page.route('https://store.test/**', route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname);
      const file = name.startsWith('/extension/') ? path.join(ROOT, name) : path.join(__dirname, name);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      const type = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
      return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
    });
    for (const [file, shot, width, height] of SHOTS) {
      await page.setViewportSize({ width, height });
      await page.goto(`https://store.test/shots.html?shot=${shot}`);
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode())); });
      fs.writeFileSync(path.join(OUT, file), toRGB(await page.screenshot()));
      console.log(`${file}  ${width}×${height}`);
    }
  } finally { await browser.close(); }
  fs.copyFileSync(path.join(ROOT, 'extension/assets/icon-128.png'), path.join(OUT, 'store-icon-128x128.png'));
  console.log('store-icon-128x128.png  128×128');
}

(async () => {
  if (!process.argv.includes('--compose-only')) await capture();
  if (!process.argv.includes('--capture-only')) await compose();
})().catch(error => { console.error(error); process.exitCode = 1; });
