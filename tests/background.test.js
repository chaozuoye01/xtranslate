const test = require('node:test');
const assert = require('node:assert/strict');
const Controller = require('../extension/background-controller.js');
const ID = 'a'.repeat(32);
const page = { id: ID, url: `chrome-extension://${ID}/options.html` };
const x = { id: ID, url: 'https://x.com/alex/status/123', tab: { id: 7 }, frameId: 0, documentId: 'doc-1' };
function setup({ connected = true, models = ['grok-4.3'], translate, settings = {}, ensure, extra = {} } = {}) {
  const saved = { grokInputSettings: settings }; const sent = []; const calls = [];
  let state = { connected, state: connected ? 'connected' : 'disconnected', credentialId: connected ? 'account-1' : null, catalogModels: models, remember: true, accessToken: 'must-stay-private', refreshToken: 'also-private', device: { userCode: 'ABCD', verificationUriComplete: 'https://auth.x.ai/oauth2/device?user_code=ABCD', expiresAt: 9999999999999 }, ...extra };
  const chrome = { runtime: { id: ID, getURL: name => `chrome-extension://${ID}/${name}`, async openOptionsPage() { calls.push('openOptions'); }, async sendMessage(value) { sent.push(value); } }, storage: { local: { async get(key) { return { [key]: saved[key] }; }, async set(value) { Object.assign(saved, value); } } }, tabs: { async query() { return [{ id: 7 }]; }, async sendMessage(id, value) { sent.push(value); } } };
  const oauth = {
    async initialize() {}, status: () => structuredClone(state),
    async setRemember(remember) { state.remember = remember; calls.push(['remember', remember]); },
    async startLogin(value) { calls.push(['login', value]); state.connected = false; state.state = 'awaiting_authorization'; return state; },
    async cancelLogin() { calls.push('cancel'); }, async logout() { state.connected = false; state.credentialId = null; calls.push('logout'); },
    async catalog() { return state; }, async ensureAccessToken() { if (ensure) return ensure(); return { accessToken: 'must-stay-private', credentialId: state.credentialId }; }
  };
  const controller = Controller.create({ chrome, oauth, translate: translate || (async () => 'Hello') });
  return { controller, calls, saved, sent, setState: next => Object.assign(state, next) };
}
test('only exact extension UI URLs may control login, while X content may translate', async () => {
  const h = setup();
  for (const sender of [x, { ...page, url: `chrome-extension://${ID}/other.html` }, { ...page, id: 'other' }, { ...x, url: 'https://evil.com/' }, { ...x, url: 'https://x.com.evil.com/' }]) {
    const result = await h.controller.handle({ type: 'LOGIN', remember: false }, sender);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'FORBIDDEN');
  }
  assert.equal((await h.controller.handle({ type: 'LOGIN', remember: false }, page)).ok, true);
  assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'login').length, 1);
});
test('connection state never exposes raw tokens and content scripts cannot receive authorization links', async () => {
  const h = setup();
  const state = (await h.controller.handle({ type: 'GET_STATE' }, page)).state;
  assert.equal(state.accessToken, undefined); assert.equal(state.refreshToken, undefined);
  assert.equal(state.device.userCode, 'ABCD');
  const content = await h.controller.handle({ type: 'GET_STATE' }, x);
  assert.equal(content.state.device, undefined);
  assert.doesNotMatch(JSON.stringify(content), /private|user_code/);
});
test('a fresh install remembers the login on this device by default, and an explicit session-only choice is kept', async () => {
  const fresh = setup();
  assert.equal((await fresh.controller.handle({ type: 'GET_STATE' }, page)).state.remember, true);
  assert.equal(fresh.saved.grokInputSettings.remember, true);
  assert.equal(fresh.calls.some(c => Array.isArray(c) && c[0] === 'remember'), false);
  const chosen = setup({ settings: { remember: false } });
  assert.equal((await chosen.controller.handle({ type: 'GET_STATE' }, page)).state.remember, false);
  assert.equal(chosen.calls.some(c => Array.isArray(c) && c[0] === 'remember' && c[1] === false), true);
});
test('while the sign-in renewal is retrying, X gets a network error and the settings page sees only safe failure details', async () => {
  const failure = { at: 1800000000000, kind: 'network', count: 2, retryAt: 1800000060000, secret: 'must-stay-private' };
  const h = setup({ extra: { errorCode: 'OAUTH_REFRESH_RETRYING', refreshFailure: failure }, ensure: async () => { throw Object.assign(Error('private'), { code: 'OAUTH_REFRESH_RETRYING' }); }, translate: async ({ authorization, signal }) => { await authorization.getAccessToken(signal); return 'Hello'; } });
  const result = await h.controller.handle({ type: 'TRANSLATE', requestId: 'req-1', text: '你好', surface: 'reply' }, x);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'NETWORK_ERROR');
  const state = (await h.controller.handle({ type: 'GET_STATE' }, page)).state;
  assert.equal(state.errorCode, 'OAUTH_REFRESH_RETRYING');
  assert.deepEqual(state.refreshFailure, { at: 1800000000000, kind: 'network', count: 2, retryAt: 1800000060000 });
  assert.equal((await h.controller.handle({ type: 'GET_STATE' }, x)).state.refreshFailure, undefined);
});
test('defaults to the fast non-reasoning model, then other non-reasoning models, then grok-4.3, and keeps an explicit choice', async () => {
  const models = ['grok-4.20-0309-reasoning', 'grok-4.3', 'grok-5-non-reasoning', 'grok-4.20-0309-non-reasoning', 'grok-imagine-image'];
  for (const [catalog, expected] of [[models, 'grok-4.20-0309-non-reasoning'], [['grok-4.3', 'grok-5-non-reasoning'], 'grok-5-non-reasoning'], [['grok-4.20-0309-reasoning', 'grok-4.3'], 'grok-4.3']]) {
    assert.equal((await setup({ models: catalog }).controller.handle({ type: 'GET_STATE' }, page)).state.model, expected, catalog.join());
  }
  const chosen = setup({ models, settings: { model: 'grok-4.3' } });
  assert.equal((await chosen.controller.handle({ type: 'GET_STATE' }, page)).state.model, 'grok-4.3');
});
test('requires an explicit choice when no recommended model is available', async () => {
  const h = setup({ models: ['grok-4.7'] });
  assert.equal((await h.controller.handle({ type: 'GET_STATE' }, page)).state.model, '');
  assert.equal((await h.controller.handle({ type: 'TRANSLATE', requestId: 'req-1', text: '你好', surface: 'reply' }, x)).error.code, 'MODEL_REQUIRED');
  assert.equal((await h.controller.handle({ type: 'SELECT_MODEL', model: 'grok-4.7' }, page)).ok, true);
  assert.equal((await h.controller.handle({ type: 'SELECT_MODEL', model: 'grok-madeup' }, page)).ok, false);
  assert.equal((await h.controller.handle({ type: 'TRANSLATE', requestId: 'req-1', text: '你好', surface: 'reply' }, x)).translated, 'Hello');
});
test('validates text and request IDs and requires connected authentication before inference', async () => {
  let calls = 0; const h = setup({ connected: false, translate: async () => { calls++; } });
  for (const message of [{ type: 'TRANSLATE', requestId: 'x', text: '', surface: 'reply' }, { type: 'TRANSLATE', requestId: '', text: '你好', surface: 'reply' }, { type: 'TRANSLATE', requestId: 'x', text: '你好', surface: 'reply', url: 'https://evil.com/' }]) assert.equal((await h.controller.handle(message, x)).ok, false);
  assert.equal((await h.controller.handle({ type: 'TRANSLATE', requestId: 'valid-id', text: '你好', surface: 'reply' }, x)).error.code, 'AUTH_REQUIRED');
  assert.equal(calls, 0);
});
test('X Chat drafts are refused until the user enables chat from the extension settings page', async () => {
  let calls = 0; const h = setup({ translate: async () => { calls++; return 'Hello'; } });
  const chat = { type: 'TRANSLATE', requestId: 'chat-1', text: '你好', surface: 'chat' };
  assert.equal((await h.controller.handle({ type: 'GET_STATE' }, x)).state.chat, false);
  assert.equal((await h.controller.handle(chat, x)).error.code, 'CHAT_DISABLED');
  for (const surface of [undefined, 'dm', '']) assert.equal((await h.controller.handle({ ...chat, surface }, x)).error.code, 'INVALID_INPUT');
  // A page or content script can never switch chat on; only the settings page can.
  assert.equal((await h.controller.handle({ type: 'SET_CHAT', enabled: true }, x)).error.code, 'FORBIDDEN');
  assert.equal((await h.controller.handle({ type: 'SET_CHAT', enabled: 'yes' }, page)).error.code, 'INVALID_INPUT');
  assert.equal(calls, 0);
  const on = await h.controller.handle({ type: 'SET_CHAT', enabled: true }, page);
  assert.equal(on.state.chat, true); assert.equal(h.saved.grokInputSettings.chat, true);
  assert.equal(h.sent.some(m => m.type === 'STATE_CHANGED' && m.state.chat === true), true);
  assert.equal((await h.controller.handle(chat, x)).translated, 'Hello');
  assert.equal((await h.controller.handle({ type: 'SET_CHAT', enabled: false }, page)).state.chat, false);
  assert.equal((await h.controller.handle({ ...chat, requestId: 'chat-2' }, x)).error.code, 'CHAT_DISABLED');
  assert.equal(calls, 1);
});
test('switching chat off cancels a chat translation already in flight but not a reply', async () => {
  const release = {};
  const h = setup({ settings: { chat: true }, translate: ({ text, signal }) => new Promise((resolve, reject) => { release[text] = resolve; signal.addEventListener('abort', () => reject(Object.assign(Error('x'), { code: 'CANCELLED' }))); }) });
  const chat = h.controller.handle({ type: 'TRANSLATE', requestId: 'chat-1', text: '聊天', surface: 'chat' }, x);
  const reply = h.controller.handle({ type: 'TRANSLATE', requestId: 'reply-1', text: '回复', surface: 'reply' }, x);
  await new Promise(r => setTimeout(r, 0));
  await h.controller.handle({ type: 'SET_CHAT', enabled: false }, page);
  assert.equal((await chat).error.code, 'CANCELLED');
  release['回复']('Reply');
  assert.equal((await reply).translated, 'Reply');
});
test('deduplicates active IDs and discards results after logout even if transport ignores abort', async () => {
  let resolve; let calls = 0;
  const h = setup({ translate: async () => { calls++; return new Promise(r => { resolve = r; }); } });
  const pending = h.controller.handle({ type: 'TRANSLATE', requestId: 'req-1', text: '你好', surface: 'reply' }, x);
  while (!resolve) await new Promise(r => setImmediate(r));
  assert.equal((await h.controller.handle({ type: 'TRANSLATE', requestId: 'req-1', text: '你好', surface: 'reply' }, x)).error.code, 'BUSY');
  await h.controller.handle({ type: 'LOGOUT' }, page); resolve('Late result');
  assert.equal((await pending).ok, false); assert.equal(calls, 1);
});
test('cancellation is scoped to the sending document and a removed tab invalidates the job', async () => {
  let resolve; const h = setup({ translate: () => new Promise(r => { resolve = r; }) });
  const pending = h.controller.handle({ type: 'TRANSLATE', requestId: 'req-1', text: '你好', surface: 'reply' }, x);
  while (!resolve) await new Promise(r => setImmediate(r));
  await h.controller.handle({ type: 'CANCEL_TRANSLATION', requestId: 'req-1' }, { ...x, documentId: 'other-doc' });
  h.controller.onTabRemoved(7); resolve('Late');
  assert.equal((await pending).ok, false);
});
test('an explicit session-only preference survives restoring a real OAuth blocked marker', async () => {
  const OAuth = require('../extension/vendor/oauth-provider.js');
  const stored = { grokInputSettings: { remember: false }, [OAuth.STORAGE_KEY]: { schema: 1, kind: 'blocked', credentialId: null, errorCode: 'OAUTH_REFRESH_UNCERTAIN' } };
  const area = data => ({ async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(values) { Object.assign(data, structuredClone(values)); } });
  const chrome = { runtime: { id: ID, async sendMessage() {} }, storage: { local: area(stored), session: area({}) }, tabs: { async query() { return []; } }, alarms: { async clear() {}, async get() {} } };
  const oauth = OAuth.create({ chrome, crypto: require('node:crypto').webcrypto, fetch: async () => { throw Error('No network expected'); }, keyStore: { async clear() {} } });
  const controller = Controller.create({ chrome, oauth, translate: async () => { throw Error('No inference expected'); } });
  try {
    const result = await controller.handle({ type: 'GET_STATE' }, page);
    assert.equal(result.ok, true);
    assert.equal(result.state.state, 'reauth_required');
    assert.equal(result.state.remember, false);
    assert.equal(stored.grokInputSettings.remember, false);
  } finally { oauth.dispose(); }
});
