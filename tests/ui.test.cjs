const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true }); });
after(async () => { await browser?.close(); });
async function ui(name = 'options.html') {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.uiCalls = [];
    window.uiState = { state: 'disconnected', connected: false, remember: true, model: '', catalogModels: [] };
    window.chrome = { runtime: { id: 'fake-ui', onMessage: { addListener() {} }, getURL: n => `https://extension.test/${n}`, async openOptionsPage() { window.uiCalls.push({ type: 'OPEN_SETTINGS' }); }, async sendMessage(m) {
      window.uiCalls.push(m);
      if (m.type === 'LOGIN') Object.assign(window.uiState, { state: 'awaiting_authorization', device: { userCode: 'ABCD-EFGH', verificationUriComplete: 'https://auth.x.ai/oauth2/device?user_code=ABCD-EFGH', expiresAt: Date.now() + 300000 } });
      if (m.type === 'CANCEL_LOGIN' || m.type === 'LOGOUT') Object.assign(window.uiState, { connected: false, state: 'disconnected', device: null });
      if (m.type === 'SET_REMEMBER') window.uiState.remember = m.remember;
      if (m.type === 'SET_CHAT') window.uiState.chat = m.enabled;
      if (m.type === 'SELECT_MODEL') window.uiState.model = m.model;
      return { ok: true, state: { ...window.uiState } };
    } } };
  });
  await page.route('https://extension.test/**', route => {
    const file = path.join(__dirname, '../extension', new URL(route.request().url()).pathname);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    const ext = path.extname(file);
    return route.fulfill({ contentType: ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[ext] || 'image/png', body: fs.readFileSync(file) });
  });
  await page.goto(`https://extension.test/${name}`); return page;
}
test('connect shows an official short-code link, remembers the login on this device by default and can cancel', async () => {
  const page = await ui();
  assert.equal(await page.getByLabel('在本机记住登录').isChecked(), true);
  assert.match(await page.locator('label:has(#remember) + .hint').innerText(), /默认在本机加密保存登录.*取消勾选/);
  await page.getByRole('button', { name: '连接 Grok', exact: true }).click();
  await page.getByText('ABCD-EFGH', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '前往 xAI 官方页面授权' }).getAttribute('href'), 'https://auth.x.ai/oauth2/device?user_code=ABCD-EFGH');
  assert.equal(await page.evaluate(() => window.uiCalls.find(c => c.type === 'LOGIN').remember), true);
  await page.getByRole('button', { name: '取消授权', exact: true }).click();
  assert.equal(await page.getByText('ABCD-EFGH', { exact: true }).isVisible(), false); await page.close();
});
test('marks every fast non-reasoning model as recommended and no longer grok-4.3', async () => {
  const page = await ui();
  await page.evaluate(() => Object.assign(window.uiState, { connected: true, state: 'connected', catalogModels: ['grok-4.20-0309-non-reasoning', 'grok-4.20-0309-reasoning', 'grok-4.3', 'grok-5-non-reasoning'], model: 'grok-4.20-0309-non-reasoning' }));
  const select = page.getByRole('combobox', { name: '翻译模型' });
  await select.locator('option[value="grok-4.3"]').waitFor({ state: 'attached' });
  assert.deepEqual(await select.locator('option').allTextContents(), ['请选择可用模型', 'grok-4.20-0309-non-reasoning · 推荐', 'grok-4.20-0309-reasoning', 'grok-4.3', 'grok-5-non-reasoning · 推荐']);
  assert.equal(await select.inputValue(), 'grok-4.20-0309-non-reasoning'); await page.close();
});
test('unavailable preferred model requires selection and explicit remember updates are persisted', async () => {
  const page = await ui();
  await page.evaluate(() => Object.assign(window.uiState, { connected: true, state: 'connected', catalogModels: ['grok-4.7'], model: '' }));
  await page.getByRole('combobox', { name: '翻译模型' }).locator('option[value="grok-4.7"]').waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('combobox', { name: '翻译模型' }).inputValue(), '');
  await page.getByRole('combobox', { name: '翻译模型' }).selectOption('grok-4.7');
  await page.getByLabel('在本机记住登录').uncheck();
  assert.equal(await page.evaluate(() => window.uiCalls.some(c => c.type === 'SET_REMEMBER' && c.remember === false)), true);
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await page.getByText('尚未连接', { exact: true }).waitFor(); await page.close();
});
test('popup offers settings and explains the Chinese-to-English reply workflow', async () => {
  const page = await ui('popup.html');
  await page.getByRole('button', { name: '连接 Grok', exact: true }).click();
  assert.equal(await page.evaluate(() => window.uiCalls.some(c => c.type === 'OPEN_SETTINGS')), true);
  assert.equal(await page.getByText('在 X 评论框写中文', { exact: false }).isVisible(), true); await page.close();
});
test('popup and settings carry the product name, slogan and icon', async () => {
  assert.equal(require('../extension/manifest.json').name, 'X 评论聊天翻译');
  assert.equal(require('../extension/manifest.json').action.default_title, 'X 评论聊天翻译');
  for (const file of ['popup.html', 'options.html']) {
    const page = await ui(file);
    assert.match(await page.title(), /^X 评论聊天翻译/);
    assert.equal(await page.locator('.brand strong').innerText(), 'X 评论聊天翻译');
    assert.equal(await page.locator('.brand span').innerText(), '消除语言的隔阂');
    assert.equal(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth > 0 && img.getAttribute('src')), 'assets/icon.svg');
    await page.close();
  }
});
test('X Chat translation is off by default, explains the privacy trade-off and can be switched on and off', async () => {
  const page = await ui();
  const toggle = page.getByLabel('在 X 聊天中启用翻译');
  await page.locator('#chat-status').getByText('已关闭', { exact: true }).waitFor();
  assert.equal(await toggle.isChecked(), false);
  assert.match(await page.locator('#chat').locator('xpath=ancestor::section').innerText(), /默认关闭[\s\S]*只有你点击翻译时[\s\S]*不读取聊天记录/);
  await toggle.check();
  await page.locator('#chat-status').getByText('已开启', { exact: true }).waitFor();
  await toggle.uncheck();
  await page.locator('#chat-status').getByText('已关闭', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.uiCalls.filter(c => c.type === 'SET_CHAT').map(c => c.enabled)), [true, false]);
  await page.close();
});
test('popup and settings credit the author and website like the other zuoye.si extensions', async () => {
  for (const name of ['popup.html', 'options.html']) {
    const page = await ui(name);
    assert.equal(await page.getByRole('link', { name: /作业借你抄 @chaozuoye/ }).getAttribute('href'), 'https://x.com/chaozuoye', name);
    assert.equal(await page.getByRole('link', { name: 'zuoye.si', exact: true }).getAttribute('href'), 'https://zuoye.si/', name);
    assert.equal(await page.locator('.credits').evaluate(node => node.innerText.replace(/\s+/g, ' ').trim()), '作者：作业借你抄 @chaozuoye 网站：zuoye.si', name);
    fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../test-results', `credits-${name.replace('.html', '')}.png`), fullPage: true });
    await page.close();
  }
});
test('a retrying sign-in renewal keeps the connection, explains the automatic retry and clears the notice once it recovers', async () => {
  const page = await ui();
  await page.evaluate(() => Object.assign(window.uiState, { connected: true, state: 'connected', catalogModels: ['grok-4.3'], model: 'grok-4.3', errorCode: 'OAUTH_REFRESH_RETRYING', refreshFailure: { at: Date.now() - 60000, kind: 'network', count: 2, retryAt: Date.now() + 60000 } }));
  await page.locator('#notice').getByText('登录已保留', { exact: false }).waitFor();
  assert.match(await page.locator('#notice').innerText(), /暂时连不上 xAI.*自动重试/);
  assert.equal(await page.locator('#connection-status').innerText(), '已连接');
  assert.match(await page.locator('#refresh-note').innerText(), /最近一次自动续期失败.*网络连不上 xAI.*第 2 次/);
  await page.evaluate(() => Object.assign(window.uiState, { errorCode: null, refreshFailure: { ...window.uiState.refreshFailure, recoveredAt: Date.now() } }));
  await page.locator('#refresh-note').getByText('已自动恢复', { exact: false }).waitFor();
  assert.equal(await page.locator('#notice').innerText(), '');
  await page.close();
});
test('the popup says a retrying renewal is waiting for the network instead of naming the model', async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { window.chrome = { runtime: { id: 'fake-ui', async openOptionsPage() {}, async sendMessage() { return { ok: true, state: { connected: true, state: 'connected', model: 'grok-4.3', errorCode: 'OAUTH_REFRESH_RETRYING' } }; } } }; });
  await page.route('https://extension.test/**', route => { const file = path.join(__dirname, '../extension', new URL(route.request().url()).pathname); return fs.existsSync(file) ? route.fulfill({ contentType: ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[path.extname(file)] || 'image/png', body: fs.readFileSync(file) }) : route.fulfill({ status: 404, body: '' }); });
  await page.goto('https://extension.test/popup.html');
  await page.locator('#status').getByText('自动重试', { exact: false }).waitFor();
  assert.match(await page.locator('#status').innerText(), /^已连接 · 暂时连不上 xAI/);
  await page.close();
});
