const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
test('installed MV3 worker, device login, isolated content script and signout work together with synthetic transport', { timeout: 90000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const scratch = path.join(root, '.superpowers/sdd/2026-10-27-grok-input-translator');
  fs.mkdirSync(scratch, { recursive: true });
  const extension = fs.mkdtempSync(path.join(scratch, 'extension-smoke-'));
  fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
  const harness = `
globalThis.__syntheticRequests = [];
globalThis.fetch = async (url, init = {}) => {
  const address = String(url); let data;
  if (address === 'https://auth.x.ai/oauth2/device/code') data = {device_code:'synthetic-device-private-8493204832',user_code:'ABCD-EFGH',verification_uri:'https://auth.x.ai/oauth2/device',verification_uri_complete:'https://auth.x.ai/oauth2/device?user_code=ABCD-EFGH',expires_in:600,interval:1};
  else if (address === 'https://auth.x.ai/oauth2/token') data = {access_token:'synthetic-access-private-8493204832',refresh_token:'synthetic-refresh-private-8493204832',token_type:'Bearer',expires_in:3600};
  else if (address === 'https://api.x.ai/v1/models') data = {data:[{id:'grok-4.3'}]};
  else if (address === 'https://api.x.ai/v1/responses') {globalThis.__syntheticRequests.push(JSON.parse(init.body));data={status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Thank you for sharing this perspective.'}]}]};}
  else if (address === 'https://auth.x.ai/oauth2/revoke') data = {};
  else throw new Error('Blocked non-synthetic network');
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
`;
  fs.writeFileSync(path.join(extension, 'background.js'), harness + fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8'));
  const context = await chromium.launchPersistentContext(path.join(extension, 'test-profile'), {
    executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).hostname;
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await options.getByRole('button', { name: '连接 Grok', exact: true }).click();
    await options.getByText('ABCD-EFGH', { exact: true }).waitFor();
    await options.getByText('已连接', { exact: true }).waitFor({ timeout: 10000 });
    // The page handles paste itself like X's Draft.js editor; the content script's paste event and
    // DataTransfer come from the isolated world, and the reply dialog's target from history.state.
    const draft = `<script>const e=document.querySelector('[data-testid="tweetTextarea_0"]');window.pastes=0;e.addEventListener('paste',v=>{v.preventDefault();window.pastes++;e.textContent=v.clipboardData.getData('text/plain');});</script>`;
    const pages = {
      '/alice/status/123': `<main><form><div role="textbox" contenteditable="true" data-testid="tweetTextarea_0" style="width:550px;min-height:100px">谢谢分享这个观点。</div><button type="button" data-testid="tweetButtonInline">Reply</button></form></main>${draft}`,
      '/compose/post': `<script>history.replaceState({key:'k',state:{inReplyToStatusId:'2116124832584904742'}},'','/compose/post')</script><div role="dialog" aria-modal="true"><div role="textbox" contenteditable="true" data-testid="tweetTextarea_0">谢谢分享这个观点。</div><button type="button" data-testid="tweetButton">回复</button></div>`,
      // X Chat lives in an open shadow root; the isolated content script must reach into it only when chat is on.
      '/i/chat/111-222': `<div data-testid="xchatEmbedRoute"></div><script>document.querySelector('[data-testid="xchatEmbedRoute"]').attachShadow({mode:'open'}).innerHTML='<div data-testid="dm-composer-container"><div style="display:flex;flex-direction:column"><div style="display:flex"><form><textarea data-testid="dm-composer-textarea" aria-label="私信">最近怎么样？</textarea></form></div></div></div>';</script>`
    };
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${pages[new URL(route.request().url()).pathname]}</body></html>` }));
    const dialog = await context.newPage(); await dialog.goto('https://x.com/compose/post');
    await dialog.getByRole('button', { name: '译成英文', exact: true }).waitFor(); await dialog.close();
    const x = await context.newPage(); await x.goto('https://x.com/alice/status/123');
    await x.getByRole('button', { name: '译成英文', exact: true }).click();
    await x.getByText('英文译文', { exact: true }).waitFor();
    await x.getByText('英文已填入，发布前可继续修改。', { exact: true }).waitFor();
    assert.equal(await x.locator('[contenteditable]').innerText(), 'Thank you for sharing this perspective.');
    assert.equal(await x.evaluate(() => window.pastes), 1);
    assert.equal(await x.locator('grok-input-panel').getAttribute('data-version'), require('../extension/manifest.json').version);
    const requests = await worker.evaluate(() => globalThis.__syntheticRequests);
    assert.equal(requests.length, 1); assert.equal(requests[0].store, false);
    assert.equal(requests[0].input[0].content[0].text, '谢谢分享这个观点。');
    const saved = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    assert.equal(JSON.stringify(saved.local).includes('synthetic-access-private'), false);
    assert.equal(JSON.stringify(saved.local).includes('synthetic-refresh-private'), false);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await x.screenshot({ path: path.join(root, 'test-results/extension-smoke.png') });
    const chat = await context.newPage(); await chat.goto('https://x.com/i/chat/111-222');
    await chat.waitForTimeout(1200);
    assert.equal(await chat.getByRole('button', { name: '译成英文', exact: true }).count(), 0, 'chat stays untouched while switched off');
    assert.equal(await options.getByLabel('在 X 聊天中启用翻译').isChecked(), false);
    await options.getByLabel('在 X 聊天中启用翻译').check();
    await options.getByText('已开启', { exact: true }).waitFor();
    await chat.getByRole('button', { name: '译成英文', exact: true }).click();
    await chat.getByText('英文已填入，发送前可继续修改。', { exact: true }).waitFor();
    assert.equal(await chat.locator('[data-testid="dm-composer-textarea"]').inputValue(), 'Thank you for sharing this perspective.');
    assert.equal((await worker.evaluate(() => globalThis.__syntheticRequests)).at(-1).input[0].content[0].text, '最近怎么样？');
    await options.getByLabel('在 X 聊天中启用翻译').uncheck();
    await chat.getByRole('button', { name: '译成英文', exact: true }).waitFor({ state: 'detached' });
    await chat.close();
    await options.getByRole('button', { name: '退出登录', exact: true }).click();
    await options.getByText('尚未连接', { exact: true }).waitFor();
    await x.getByText('英文译文', { exact: true }).waitFor({ state: 'detached' });
  } finally { await context.close(); }
});
