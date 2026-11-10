const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
let browser;
const root = path.resolve(__dirname, '..');
const fixture = (dialog = false) => `${dialog ? '<div role="dialog">' : '<main>'}<article data-testid="tweet"><a href="/alice/status/123">Original post</a></article><form id="reply"><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0" style="min-height:70px;width:480px;border:1px solid #ddd">这个观点很有启发，谢谢分享！</div><button type="button" data-testid="${dialog ? 'tweetButton' : 'tweetButtonInline'}">Reply</button></form>${dialog ? '</div>' : '</main>'}`;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
});
after(async () => { await browser?.close(); });
async function setup(html = fixture(), url = 'https://x.com/alice/status/123', { beforeScripts } = {}) {
  const page = await browser.newPage({ viewport: { width: 980, height: 900 } });
  await page.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><head><meta charset="utf-8"><style>body{font:16px Arial;margin:60px}form{max-width:540px}button{padding:10px}</style></head><body>${html}</body></html>` }));
  await page.goto(url);
  await page.evaluate(() => {
    window.testCalls = []; window.testDelay = 20; window.testError = false; window.testOutput = 'That is an insightful point. Thanks for sharing!'; window.testEvents = [];
    window.chrome = { runtime: { id: 'test-extension', getURL: name => `https://test-extension.invalid/${name}`, onMessage: { addListener(fn) { window.testListeners = [fn]; } }, async sendMessage(message) {
      window.testCalls.push(message);
      if (message.type === 'GET_STATE') return { ok: true, state: { connected: true, credentialId: 'account-1', model: 'grok-4.3', chat: window.testChat === true } };
      if (message.type === 'TRANSLATE') { await new Promise(r => setTimeout(r, window.testDelay)); return window.testError ? { ok: false, error: { code: 'INVALID_RESPONSE', message: 'Grok 未返回完整译文，草稿已保留，请手动重试。' } } : { ok: true, translated: window.testOutput, credentialId: 'account-1' }; }
      return { ok: true };
    } } };
    document.addEventListener('input', e => window.testEvents.push(e.target.textContent));
  });
  await page.route('https://test-extension.invalid/panel.css', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(root, 'extension/panel.css'), 'utf8') }));
  if (beforeScripts) await beforeScripts(page);
  for (const script of ['core.js', 'editor-adapter.js', 'content.js']) await page.addScriptTag({ path: path.join(root, 'extension', script) });
  return page;
}
const editor = page => page.locator('#reply [contenteditable]');
const translate = page => page.getByRole('button', { name: '译成英文', exact: true });
async function done(page) { await page.getByText('英文译文', { exact: true }).waitFor(); }
// Writing waits for the editor to adopt the selection before pasting, so the draft settles shortly after the comparison appears.
async function expectText(locator, value) {
  for (let attempt = 0; attempt < 80 && await locator.innerText() !== value; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(await locator.innerText(), value);
}
test('inline and dialog replies fill English, show comparison and safely restore Chinese', async () => {
  for (const dialog of [false, true]) {
    const page = await setup(fixture(dialog), dialog ? 'https://x.com/compose/post' : undefined);
    await translate(page).click(); await done(page);
    await expectText(editor(page), 'That is an insightful point. Thanks for sharing!');
    assert.equal(await page.getByText('中文原文', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.testEvents.length > 0), true);
    await page.getByRole('button', { name: '恢复中文', exact: true }).click();
    await expectText(editor(page), '这个观点很有启发，谢谢分享！');
    await page.close();
  }
});
test('does not attach to new posts, search or messages', async () => {
  const page = await setup('<form><div contenteditable="true" data-testid="tweetTextarea_0" role="textbox">你好</div><button data-testid="tweetButtonInline">Post</button></form><input placeholder="Search"><div contenteditable="true" data-testid="dmComposerTextInput">你好</div>', 'https://x.com/home');
  assert.equal(await translate(page).count(), 0); await page.close();
});
test('protects a later edit and an edit-then-revert, while allowing deliberate manual fill', async () => {
  for (const revert of [false, true]) {
    const page = await setup(); await page.evaluate(() => window.testDelay = 350);
    await translate(page).click(); await editor(page).fill('我又补充了一句');
    if (revert) await editor(page).fill('这个观点很有启发，谢谢分享！');
    await done(page);
    assert.equal(await editor(page).innerText(), revert ? '这个观点很有启发，谢谢分享！' : '我又补充了一句');
    await page.getByText('草稿已更改，请核对后手动填入。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '填入英文', exact: true }).click();
    await expectText(editor(page), 'That is an insightful point. Thanks for sharing!');
    await editor(page).fill('I added my own thought.');
    assert.equal(await page.getByRole('button', { name: '恢复中文', exact: true }).isDisabled(), true);
    await page.close();
  }
});
test('IME composition prevents automatic replacement even when the final text matches', async () => {
  const page = await setup(); await page.evaluate(() => window.testDelay = 200);
  await translate(page).click();
  await editor(page).dispatchEvent('compositionstart'); await editor(page).dispatchEvent('compositionend');
  await done(page); assert.equal(await editor(page).innerText(), '这个观点很有启发，谢谢分享！'); await page.close();
});
test('navigation, reused reply context, removal and signout discard pending results', async () => {
  for (const kind of ['navigation', 'context', 'remove', 'signout']) {
    const page = await setup(fixture(true), 'https://x.com/compose/post'); await page.evaluate(() => window.testDelay = 250);
    await translate(page).click();
    await page.evaluate(kind => {
      if (kind === 'navigation') history.pushState({}, '', '/bob/status/456');
      if (kind === 'context') document.querySelector('article a').href = '/bob/status/456';
      if (kind === 'remove') document.querySelector('#reply').remove();
      if (kind === 'signout') window.testListeners[0]({ type: 'STATE_CHANGED', state: { connected: false, credentialId: null, model: '' } }, { id: 'test-extension' });
    }, kind);
    await page.waitForTimeout(400);
    if (kind !== 'remove') assert.equal(await editor(page).innerText(), '这个观点很有启发，谢谢分享！');
    assert.equal(await page.getByText('英文译文', { exact: true }).count(), 0); await page.close();
  }
});
test('does not duplicate requests, cross-fill another editor or interpret output as HTML', async () => {
  const second = fixture().replaceAll('id="reply"', 'id="reply2"').replaceAll('/status/123', '/status/456');
  const page = await setup(fixture() + second); await page.evaluate(() => { window.testDelay = 150; window.testOutput = '<img src=x onerror=alert(1)> is just text'; });
  await translate(page).first().click(); assert.equal(await translate(page).count(), 1);
  await done(page);
  assert.equal(await page.locator('#reply2 [contenteditable]').innerText(), '这个观点很有启发，谢谢分享！');
  assert.equal(await page.locator('grok-input-panel img').count(), 0);
  assert.equal(await page.evaluate(() => window.testCalls.filter(c => c.type === 'TRANSLATE').length), 1); await page.close();
});
test('failure leaves the original draft and shows a readable error', async () => {
  const page = await setup(); await page.evaluate(() => window.testError = true);
  await translate(page).click(); await page.getByText('Grok 未返回完整译文，草稿已保留，请手动重试。', { exact: true }).waitFor();
  assert.equal(await editor(page).innerText(), '这个观点很有启发，谢谢分享！'); await page.close();
});
test('page scripts cannot synthesize clicks to initiate translation or replace a draft', async () => {
  const page = await setup();
  await page.evaluate(() => document.querySelector('grok-input-panel').shadowRoot.querySelector('button.primary').click());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.testCalls.filter(c => c.type === 'TRANSLATE').length), 0);
  assert.equal(await editor(page).innerText(), '这个观点很有启发，谢谢分享！');
  await translate(page).focus(); await translate(page).press('Enter'); await done(page);
  await expectText(editor(page), 'That is an insightful point. Thanks for sharing!');
  await editor(page).fill('我的新草稿');
  await page.evaluate(() => [...document.querySelector('grok-input-panel').shadowRoot.querySelectorAll('button')].find(n => n.textContent === '填入英文').click());
  await page.waitForTimeout(250);
  assert.equal(await editor(page).innerText(), '我的新草稿');
  await page.getByRole('button', { name: '填入英文', exact: true }).click();
  await expectText(editor(page), 'That is an insightful point. Thanks for sharing!');
  await page.evaluate(() => [...document.querySelector('grok-input-panel').shadowRoot.querySelectorAll('button')].find(n => n.textContent === '恢复中文').click());
  await page.waitForTimeout(250);
  assert.equal(await editor(page).innerText(), 'That is an insightful point. Thanks for sharing!');
  await page.getByRole('button', { name: '恢复中文', exact: true }).press('Enter');
  await expectText(editor(page), '这个观点很有启发，谢谢分享！');
  await page.close();
});
test('clearing comparison releases the detached restore button and its captured draft', async () => {
  const page = await setup(); await translate(page).click(); await done(page);
  await page.evaluate(() => {
    window.oldRestore = new WeakRef([...document.querySelector('grok-input-panel').shadowRoot.querySelectorAll('button')].find(n => n.textContent === '恢复中文'));
    window.testListeners[0]({ type: 'STATE_CHANGED', state: { connected: false, credentialId: null, model: '' } }, { id: 'test-extension' });
  });
  await page.getByText('英文译文', { exact: true }).waitFor({ state: 'detached' });
  // Allow the queued DOM observer/scan and native detached-node bookkeeping to finish before GC.
  await page.waitForTimeout(100);
  const session = await page.context().newCDPSession(page); await session.send('HeapProfiler.collectGarbage'); await session.detach();
  assert.equal(await page.evaluate(() => window.oldRestore.deref() === undefined), true);
  await page.close();
});
const rowFixture = ({ outerRow = false, constraint = '' } = {}) => {
  const shell = `<div id="composer-shell" style="display:flex;flex-direction:column;flex:1;min-height:0;min-width:0"><div id="outer-row" style="display:flex;flex-direction:${outerRow ? 'row' : 'column'};min-width:0"><div id="reply-row" style="display:flex;align-items:center;gap:12px;flex:1;min-width:0"><div style="width:40px;height:40px;flex:0 0 40px;background:#b7dcff;border-radius:50%">头像</div><div id="editor-cell" style="flex:1 1 0%;min-width:0"><div role="textbox" contenteditable="true" data-testid="tweetTextarea_0" style="min-height:44px;font-size:18px;line-height:24px;overflow-wrap:anywhere">这是正常显示的中文评论</div></div><button type="button" data-testid="tweetButtonInline" style="flex:0 0 64px;white-space:nowrap">回复</button></div>${outerRow ? '<span id="native-action" style="flex:0 0 30px">⋯</span>' : ''}</div></div>`;
  const composer = constraint ? `<div id="fixed-region" style="display:flex;flex-direction:column;height:110px;overflow:${constraint}">${shell}</div>` : shell;
  return `<main style="width:540px;max-width:100%;font-size:18px;line-height:24px"><article data-testid="tweet"><a href="/alice/status/123">Original post</a></article><form id="reply" style="margin:0;width:100%;max-width:none">${composer}</form><article id="following" style="border-top:1px solid #ccd;margin-top:12px">下一条评论</article></main>`;
};
test('horizontal X reply rows keep editor width and give the translation panel its own vertical space', async () => {
  for (const [name, viewport, options] of [['desktop', 980, {}], ['narrow', 390, {}], ['nested-row', 980, { outerRow: true }], ['fixed-parent', 980, { constraint: 'visible' }], ['clipped-parent', 980, { constraint: 'hidden' }]]) {
    const page = await setup(rowFixture(options), undefined, { beforeScripts: async page => {
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.evaluate(() => { window.nativeBefore = { width: document.querySelector('[contenteditable]').getBoundingClientRect().width, rowHeight: document.querySelector('#reply-row').getBoundingClientRect().height }; });
    } });
    try {
      await translate(page).waitFor();
      const dimensions = await page.evaluate(() => {
        const editor = document.querySelector('[contenteditable]').getBoundingClientRect(), row = document.querySelector('#reply-row').getBoundingClientRect(), panel = document.querySelector('grok-input-panel').getBoundingClientRect(), next = document.querySelector('#following').getBoundingClientRect();
        return { before: window.nativeBefore, editorWidth: editor.width, rowHeight: row.height, rowBottom: row.bottom, panelTop: panel.top, panelBottom: panel.bottom, nextTop: next.top };
      });
      fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'test-results', `reply-layout-${name}.png`) });
      assert.ok(dimensions.editorWidth >= dimensions.before.width - 1, `${name}: editor shrank from ${dimensions.before.width}px to ${dimensions.editorWidth}px`);
      assert.ok(dimensions.rowHeight <= dimensions.before.rowHeight + 1, `${name}: native row grew vertically`);
      assert.ok(dimensions.panelTop >= dimensions.rowBottom - 1, `${name}: panel overlaps the native reply row`);
      assert.ok(dimensions.nextTop >= dimensions.panelBottom - 1, `${name}: panel overlaps the next comment`);
      assert.equal(await editor(page).innerText(), '这是正常显示的中文评论');
      await translate(page).click(); await done(page);
      const expanded = await page.evaluate(() => ({ panelBottom: document.querySelector('grok-input-panel').getBoundingClientRect().bottom, nextTop: document.querySelector('#following').getBoundingClientRect().top }));
      assert.ok(expanded.nextTop >= expanded.panelBottom - 1, `${name}: comparison overlaps the next comment`);
      await page.screenshot({ path: path.join(root, 'test-results', `reply-layout-${name}.png`) });
    } finally { await page.close(); }
  }
});
// Structures below mirror x.com as inspected in a signed-in Chrome on 2026-10-30: #react-root and body
// use height:100%, replies live in absolutely positioned virtual-list cells, the inline composer turns
// its collapsed row (editor | Reply) into editor + sticky toolbar on focus, and reply dialogs carry the
// target in history.state while the replied-to post has no /status/ link.
function virtualList() {
  const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
  const layout = () => { let y = 0; for (const cell of cells) { cell.style.transform = `translateY(${y}px)`; y += cell.offsetHeight; } document.querySelector('#timeline').style.height = `${y}px`; };
  const observer = new ResizeObserver(layout); cells.forEach(cell => observer.observe(cell)); layout();
}
function draftLike(selector) {
  // Like Draft.js: blocks per paragraph, paste handled in JS, and selection state that only follows
  // the DOM on the asynchronous selectionchange event (a too-early paste lands at the old caret).
  const editor = document.querySelector(selector); let all = false; window.pastes = 0;
  const text = () => [...editor.querySelectorAll('[data-block="true"]')].map(block => block.textContent).join('\n');
  const render = value => editor.replaceChildren(...value.split('\n').map(line => { const block = document.createElement('div'); block.dataset.block = 'true'; if (line) block.textContent = line; else block.append(document.createElement('br')); return block; }));
  render(editor.textContent);
  document.addEventListener('selectionchange', () => { const selection = getSelection(); all = selection.rangeCount > 0 && editor.contains(selection.anchorNode) && selection.toString().replace(/\s/g, '') === editor.textContent.replace(/\s/g, ''); });
  editor.addEventListener('paste', event => { event.preventDefault(); window.pastes++; const value = event.clipboardData.getData('text/plain'); render(all ? value : text() + value); });
}
function expandOnFocus() {
  document.querySelector('[data-testid="tweetTextarea_0"]').addEventListener('focus', () => {
    const line = document.querySelector('#line'); if (line.dataset.expanded) return; line.dataset.expanded = '1';
    line.style.flexDirection = 'column'; document.querySelector('#send').remove(); document.querySelector('#replying').hidden = false;
    const bar = document.createElement('div'); bar.dataset.testid = 'toolBar';
    bar.style.cssText = 'position:sticky;top:0;bottom:-1px;z-index:1;background:#fff;display:flex;justify-content:space-between;align-items:center;height:48px';
    bar.innerHTML = '<nav>▧ ☺ ▦</nav><button type="button" data-testid="tweetButtonInline">回复</button>'; line.append(bar);
  });
}
const xStyle = '<style>html,body{height:100%}body{margin:0!important}#react-root{height:100%;display:flex;flex-direction:column}main{display:flex;flex-direction:column;width:600px;margin:0 auto}#timeline{position:relative}[data-testid=cellInnerDiv]{position:absolute;left:0;right:0;top:0}.row{display:flex;flex-direction:row}.col{display:flex;flex-direction:column;min-width:0}.avatar{flex:0 0 40px;height:40px;border-radius:50%;background:#b7dcff;margin-right:8px}article{padding:12px 16px}</style>';
const xInline = () => `${xStyle}<div id="react-root"><main role="main"><section id="timeline">
  <div data-testid="cellInnerDiv"><article data-testid="tweet" style="height:120px">焦点帖子 <a href="/alice/status/123">10:27</a></article></div>
  <div data-testid="cellInnerDiv"><div data-testid="inline_reply_offscreen" class="col" style="padding:4px 16px 12px"><div id="replying" hidden>回复 @alice</div>
    <div class="row"><div class="avatar"></div><div class="col" id="composer" style="flex:1"><div class="row" id="line"><div class="col" style="flex:1"><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0" style="min-height:28px;font-size:20px;line-height:28px">这个观点很有启发，谢谢分享！</div></div><div id="send" style="flex:0 0 64px"><button type="button" data-testid="tweetButtonInline">回复</button></div></div></div></div>
  </div></div>
  <div data-testid="cellInnerDiv" id="next-cell"><article data-testid="tweet">下一条评论</article></div>
</section></main></div><script>(${virtualList})();(${draftLike})('[data-testid="tweetTextarea_0"]');(${expandOnFocus})();</script>`;
const xDialog = ({ reply = true, quoteAfter = false, button = '回复' } = {}) => `${xStyle}<div id="react-root"><main role="main" aria-hidden="true"><div class="col" id="home"><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0" id="home-editor">首页草稿</div><button type="button" data-testid="tweetButtonInline">发帖</button></div></main>
  <div role="dialog" aria-modal="true" class="col" style="position:fixed;top:30px;left:50%;transform:translateX(-50%);width:560px;max-height:820px;overflow:hidden;background:#fff"><div id="scroller" class="col" style="overflow-y:auto;min-height:0">
    ${reply ? `<article data-testid="tweet" class="row"><div class="avatar"></div><div class="col"><div data-testid="User-Name"><a href="/carol">Carol</a> · <time datetime="2026-10-30T10:31:24.000Z">2小时</time></div><div data-testid="tweetText">${'很长的原帖正文。'.repeat(24)}</div><div data-testid="tweetPhoto" style="height:120px;background:#ddd"></div><div role="link" style="border:1px solid #ccd;border-radius:12px;padding:8px"><div data-testid="User-Name"><a href="/dave">Dave</a></div><div data-testid="tweetText">被引用的帖子</div></div></div></article><div style="padding:0 16px 4px 64px">回复 <a href="/carol">@carol</a></div>` : ''}
    <div id="composer" class="col" style="padding-left:16px"><div class="row"><div class="avatar"></div><div class="col" style="flex:1"><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0" id="dialog-editor" style="min-height:96px">说得好，我也觉得要相信官方渠道。</div></div></div>
      ${quoteAfter ? '<article data-testid="tweet" style="border:1px solid #ccd;border-radius:12px"><div data-testid="User-Name"><a href="/erin">Erin</a></div><div data-testid="tweetText">被引用的帖子</div></article>' : ''}
      <div data-testid="toolBar" class="row" style="position:sticky;top:0;bottom:-1px;z-index:1;background:#fff;justify-content:space-between;align-items:center;height:48px"><nav>▧ ☺</nav><button type="button" data-testid="tweetButton">${button}</button></div></div>
  </div></div></div>`;
const rect = (page, selector) => page.evaluate(s => document.querySelector(s)?.getBoundingClientRect().toJSON(), selector);
const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
// Where the panel's content starts after the alignment padding, compared with the composer's content box.
const contentLefts = (page, composer) => page.evaluate(s => { const host = document.querySelector('grok-input-panel'), area = document.querySelector(s); return [host.getBoundingClientRect().left + parseFloat(host.style.paddingLeft), area.getBoundingClientRect().left + parseFloat(getComputedStyle(area).paddingLeft)]; }, composer);
test('x.com inline reply: attaches under height:100% roots, keeps the native row, and follows the expanded composer', async () => {
  const page = await setup(xInline(), 'https://x.com/alice/status/123', { beforeScripts: async page => {
    await page.evaluate(() => { window.nativeBefore = { editor: document.querySelector('[data-testid="tweetTextarea_0"]').getBoundingClientRect().width, button: document.querySelector('[data-testid="tweetButtonInline"]').getBoundingClientRect().toJSON() }; });
  } });
  try {
    await translate(page).waitFor();
    const before = await page.evaluate(() => window.nativeBefore), line = await rect(page, '#line'), panel = await rect(page, 'grok-input-panel');
    assert.ok((await rect(page, '[data-testid="tweetTextarea_0"]')).width >= before.editor - 1, 'editor lost width');
    assert.deepEqual(await rect(page, '[data-testid="tweetButtonInline"]'), before.button);
    assert.ok(panel.top >= line.bottom - 1, 'panel overlaps the collapsed reply row');
    // The list re-measures on its ResizeObserver tick after the panel's stylesheet loads.
    await page.waitForFunction(() => document.querySelector('#next-cell').getBoundingClientRect().top >= document.querySelector('grok-input-panel').getBoundingClientRect().bottom - 1, null, { timeout: 2000 });
    await page.evaluate(() => { window.testDelay = 150; window.testOutput = 'Line one.\n\nLine two with @alice #BNB 🚀'; });
    await translate(page).click(); await done(page);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-block="true"]')].map(b => b.textContent).join('\n') === window.testOutput);
    assert.equal(await page.evaluate(() => window.pastes), 1);
    // Filling focused the editor, so the composer expanded and the panel moved below the sticky toolbar's parent.
    const toolbar = await rect(page, '[data-testid="toolBar"]'), moved = await rect(page, 'grok-input-panel');
    assert.equal(await page.evaluate(() => document.querySelector('#line').contains(document.querySelector('grok-input-panel'))), false);
    assert.ok(moved.top >= toolbar.bottom - 1, 'panel sits under the sticky toolbar');
    for (const selector of ['[data-testid="tweetTextarea_0"]', '[data-testid="tweetButtonInline"]']) assert.equal(overlaps(moved, await rect(page, selector)), false, `panel covers ${selector}`);
    await page.waitForFunction(() => document.querySelector('#next-cell').getBoundingClientRect().top >= document.querySelector('grok-input-panel').getBoundingClientRect().bottom - 1);
    const [panelLeft, composerLeft] = await contentLefts(page, '#composer');
    assert.ok(Math.abs(panelLeft - composerLeft) <= 1, `panel content starts at ${panelLeft}px, composer at ${composerLeft}px`);
    assert.equal(await page.getByText('英文已填入，发布前可继续修改。', { exact: true }).count(), 1);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results', 'x-inline-reply.png') });
  } finally { await page.close(); }
});
test('x.com reply dialog: finds the target in history state although the post has no status link and quotes another post', async () => {
  const page = await setup(xDialog(), 'https://x.com/compose/post', { beforeScripts: page => page.evaluate(() => history.replaceState({ key: 'k1', state: { inReplyToStatusId: '2116124832584904742', fromApp: true } }, '', '/compose/post')) });
  try {
    await translate(page).waitFor(); assert.equal(await translate(page).count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.querySelector('grok-input-panel')) && !document.querySelector('#composer').contains(document.querySelector('grok-input-panel'))), true);
    await page.evaluate(() => window.testOutput = 'Well said. I also think we should trust official channels.');
    await translate(page).click(); await done(page);
    await expectText(page.locator('#dialog-editor'), 'Well said. I also think we should trust official channels.');
    assert.equal(await page.locator('#home-editor').innerText(), '首页草稿');
    const panel = await rect(page, 'grok-input-panel');
    assert.equal(overlaps(panel, await rect(page, '[data-testid="tweetButton"]')), false);
    // Inside the dialog's own scroll area, so a tall comparison scrolls with the draft instead of being clipped.
    assert.equal(await page.evaluate(() => document.querySelector('#scroller').contains(document.querySelector('grok-input-panel'))), true);
    const [panelLeft, composerLeft] = await contentLefts(page, '#composer');
    assert.ok(Math.abs(panelLeft - composerLeft) <= 1, `panel content starts at ${panelLeft}px, composer content at ${composerLeft}px`);
    await page.screenshot({ path: path.join(root, 'test-results', 'x-reply-dialog.png') });
  } finally { await page.close(); }
});
test('new-post and quote-post dialogs never get the panel', async () => {
  for (const options of [{ reply: false, button: '发帖' }, { reply: false, quoteAfter: true, button: '发帖' }, { reply: false, quoteAfter: true, button: 'Send' }]) {
    const page = await setup(xDialog(options), 'https://x.com/compose/post', { beforeScripts: page => page.evaluate(() => history.replaceState({ key: 'k2', state: { fromApp: true } }, '', '/compose/post')) });
    await page.waitForTimeout(300);
    assert.equal(await translate(page).count(), 0, JSON.stringify(options)); await page.close();
  }
});
test('an inline draft covered by a reply dialog keeps its result and can be filled after the dialog closes', async () => {
  const page = await setup(xInline(), 'https://x.com/alice/status/123');
  try {
    await page.evaluate(() => window.testDelay = 300);
    await translate(page).click();
    await page.evaluate(() => { document.querySelector('main').setAttribute('aria-hidden', 'true'); history.pushState({ state: { inReplyToStatusId: '9' } }, '', '/compose/post'); });
    await done(page);
    await page.getByText('回复框暂时被遮挡，返回后可点击“填入英文”。', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-testid="tweetTextarea_0"]').innerText(), '这个观点很有启发，谢谢分享！');
    await page.evaluate(() => { document.querySelector('main').removeAttribute('aria-hidden'); history.replaceState(null, '', '/alice/status/123'); });
    await page.waitForTimeout(700);
    assert.equal(await page.getByText('英文译文', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '填入英文', exact: true }).click();
    await expectText(page.locator('[data-testid="tweetTextarea_0"]'), 'That is an insightful point. Thanks for sharing!');
  } finally { await page.close(); }
});
// X Chat as inspected on 2026-11-09: the app renders in an open shadow root on xchatEmbedRoute; the
// composer is absolutely pinned to the bottom, grows upward and X reserves its height in the message
// list; the input is a React-controlled textarea whose Voice button turns into Send when it has text.
function xChatApp() {
  const shadow = document.querySelector('[data-testid="xchatEmbedRoute"]').attachShadow({ mode: 'open' });
  // X Chat's theme sets shadcn-style HSL tokens on every element; they also reach the panel's host.
  shadow.innerHTML = `<style>*{--accent:196 100% 80%;--muted:210 40% 96%;--border:214 32% 91%;--surface:0 0% 100%}.col{display:flex;flex-direction:column}.row{display:flex;flex-direction:row}</style>
  <div data-testid="dm-conversation-content" class="col" style="position:relative;width:640px;height:640px">
    <div data-testid="dm-message-scroller" style="height:640px;overflow-y:auto"><div style="padding:16px">${'<p>对方的消息</p>'.repeat(12)}</div><div id="spacer"></div></div>
    <div data-testid="dm-composer-container" style="position:absolute;left:0;right:0;bottom:0;padding:16px;background:#fff"><div><div class="col" style="position:relative">
      <input type="file" data-testid="dm-composer-file-input" style="display:none">
      <div class="row"><div style="display:grid;grid-template-columns:120px 1fr;width:100%"><div style="overflow:hidden">⊕ GIF ☺</div>
        <form data-testid="dm-composer-form" style="position:relative"><div data-testid="dm-composer-input-container" class="col" style="overflow:hidden;border:1px solid #ccd;border-radius:16px"><div class="row">
          <textarea data-testid="dm-composer-textarea" rows="1" placeholder="私信" aria-label="私信" style="flex:1;border:0;resize:none;font:16px Arial">你好，最近怎么样？</textarea><button type="button" data-testid="dm-composer-voice-button">🎤</button>
        </div></div></form>
      </div></div>
    </div></div></div>
  </div>`;
  const composer = shadow.querySelector('[data-testid="dm-composer-container"]'), spacer = shadow.querySelector('#spacer'), area = shadow.querySelector('textarea');
  new ResizeObserver(() => { spacer.style.height = `${composer.offsetHeight}px`; }).observe(composer);
  window.chatState = area.value; window.sent = 0;
  area.addEventListener('input', () => { window.chatState = area.value; shadow.querySelector('form button').dataset.testid = area.value ? 'dm-composer-send-button' : 'dm-composer-voice-button'; });
  area.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) window.sent++; });
}
const xChat = () => `${xStyle}<div id="react-root"><main role="main"><div data-testid="xchatEmbedRoute"></div></main></div><script>(${xChatApp})()</script>`;
const inChat = (page, script, arg) => page.evaluate(([source, value]) => (0, eval)(`(${source})`)(document.querySelector('[data-testid="xchatEmbedRoute"]').shadowRoot, value), [script.toString(), arg]);
test('X Chat gets no panel while chat translation is switched off', async () => {
  const page = await setup(xChat(), 'https://x.com/i/chat/111-222');
  try {
    await page.waitForTimeout(800);
    assert.equal(await inChat(page, shadow => shadow.querySelectorAll('grok-input-panel').length), 0);
    assert.equal(await translate(page).count(), 0);
  } finally { await page.close(); }
});
test('X Chat with chat translation on: panel above the input, fills the controlled textarea, never sends, and drops a result after switching conversation', async () => {
  const page = await setup(xChat(), 'https://x.com/i/chat/bots/aaa', { beforeScripts: page => page.evaluate(() => { window.testChat = true; }) });
  const textarea = page.locator('[data-testid="dm-composer-textarea"]');
  try {
    await translate(page).waitFor();
    const layout = await inChat(page, shadow => {
      const box = node => node.getBoundingClientRect().toJSON(), panel = shadow.querySelector('grok-input-panel');
      return { panel: box(panel), input: box(shadow.querySelector('[data-testid="dm-composer-input-container"]')), send: box(shadow.querySelector('form button')), composer: box(shadow.querySelector('[data-testid="dm-composer-container"]')), content: box(shadow.querySelector('[data-testid="dm-conversation-content"]')), form: box(shadow.querySelector('form')), padding: parseFloat(panel.style.paddingLeft), spacer: shadow.querySelector('#spacer').offsetHeight };
    });
    assert.ok(layout.panel.bottom <= layout.input.top + 1, 'panel must sit above the input row');
    for (const key of ['input', 'send']) assert.equal(overlaps(layout.panel, layout[key]), false, `panel covers ${key}`);
    assert.ok(Math.abs(layout.composer.bottom - layout.content.bottom) <= 1, 'composer stays pinned to the bottom and grows upward');
    assert.ok(Math.abs(layout.spacer - layout.composer.height) <= 1, 'message list reserves the taller composer');
    assert.ok(Math.abs(layout.panel.left + layout.padding - layout.form.left) <= 1, 'panel lines up with the input box');
    // The button must keep its own blue fill and white label despite the page's --accent on every element.
    // In chat the button sits at the right edge of the input box, next to Send, with the hint to its left.
    const button = await inChat(page, shadow => { const host = shadow.querySelector('grok-input-panel'), box = node => node.getBoundingClientRect().toJSON(); return { button: box(host.shadowRoot.querySelector('button.primary')), brand: box(host.shadowRoot.querySelector('.brand')) }; });
    assert.ok(Math.abs(button.button.right - layout.form.right) <= 1, `button ends at ${button.button.right}px, input box at ${layout.form.right}px`);
    assert.ok(button.brand.right <= button.button.left, 'hint sits left of the button');
    await page.waitForTimeout(400); // let the button's .15 s background transition settle
    assert.deepEqual(await inChat(page, shadow => { const style = getComputedStyle(shadow.querySelector('grok-input-panel').shadowRoot.querySelector('button.primary')); return [style.backgroundColor, style.color]; }), ['rgb(22, 132, 232)', 'rgb(255, 255, 255)']);
    await page.evaluate(() => window.testOutput = 'Hi, how have you been lately?');
    await translate(page).click(); await done(page);
    for (let i = 0; i < 40 && await textarea.inputValue() !== 'Hi, how have you been lately?'; i++) await page.waitForTimeout(25);
    assert.equal(await textarea.inputValue(), 'Hi, how have you been lately?');
    assert.equal(await page.evaluate(() => window.chatState), 'Hi, how have you been lately?');
    assert.equal(await inChat(page, shadow => !!shadow.querySelector('[data-testid="dm-composer-send-button"]')), true);
    assert.equal(await page.evaluate(() => window.sent), 0);
    assert.deepEqual(await page.evaluate(() => window.testCalls.filter(c => c.type === 'TRANSLATE').map(c => [c.surface, c.text])), [['chat', '你好，最近怎么样？']]);
    await page.screenshot({ path: path.join(root, 'test-results', 'x-chat.png') });
    await page.getByRole('button', { name: '恢复中文', exact: true }).click();
    for (let i = 0; i < 40 && await textarea.inputValue() !== '你好，最近怎么样？'; i++) await page.waitForTimeout(25);
    await page.evaluate(() => window.testDelay = 300);
    await translate(page).click();
    await page.evaluate(() => history.pushState({}, '', '/i/chat/bots/bbb'));
    await page.waitForTimeout(700);
    assert.equal(await textarea.inputValue(), '你好，最近怎么样？', 'a translation for one conversation must never fill another');
    assert.equal(await page.getByText('英文译文', { exact: true }).count(), 0);
    await translate(page).waitFor();
    await page.evaluate(() => window.testListeners[0]({ type: 'STATE_CHANGED', state: { connected: true, credentialId: 'account-1', model: 'grok-4.3', chat: false } }, { id: 'test-extension' }));
    await page.waitForTimeout(300);
    assert.equal(await inChat(page, shadow => shadow.querySelectorAll('grok-input-panel').length), 0, 'switching chat off removes the panel');
    assert.equal(await page.evaluate(() => window.sent), 0);
  } finally { await page.close(); }
});
module.exports = { setup, fixture };
