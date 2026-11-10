const test = require('node:test');
const assert = require('node:assert/strict');
const Provider = require('../extension/translation-provider.js');
const completed = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });
const authorization = { getAccessToken: async () => 'old-secret-token', onUnauthorized: async () => 'new-secret-token' };
test('sends only the draft to the fixed official endpoint with bearer authorization', async () => {
  let seen;
  const result = await Provider.translate({ text: '你好 @alex', model: 'grok-4.3', authorization, fetchImpl: async (url, init) => {
    seen = { url, init }; return new Response(JSON.stringify(completed('Hello @alex')), { status: 200 });
  } });
  assert.equal(result, 'Hello @alex');
  assert.equal(seen.url, 'https://api.x.ai/v1/responses');
  assert.equal(seen.init.headers.Authorization, 'Bearer old-secret-token');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(JSON.parse(seen.init.body).store, false);
});
test('recovers an initial 401 once and rejects a second 401 without exposing body or tokens', async () => {
  let calls = 0;
  const options = { text: '你好', model: 'grok-4.3', authorization, fetchImpl: async () => {
    calls++; return calls === 1 ? new Response('old-secret-token', { status: 401 }) : new Response(JSON.stringify(completed('Hello')));
  } };
  assert.equal(await Provider.translate(options), 'Hello');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(Provider.translate({ ...options, fetchImpl: async () => { calls++; return new Response('new-secret-token', { status: 401 }); } }), e => e.code === 'AUTH_REQUIRED' && !/secret-token/.test(e.message));
  assert.equal(calls, 2);
});
test('never replays an accepted request after invalid JSON, refusal, incomplete output or network failure', async () => {
  for (const value of ['not json', JSON.stringify({ status: 'incomplete' }), JSON.stringify({ status: 'completed', output: [] })]) {
    let calls = 0;
    await assert.rejects(Provider.translate({ text: '你好', model: 'grok-4.3', authorization, fetchImpl: async () => { calls++; return new Response(value); } }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(Provider.translate({ text: '你好', model: 'grok-4.3', authorization, fetchImpl: async () => { calls++; throw Error('old-secret-token'); } }), e => e.code === 'NETWORK_ERROR' && !/secret/.test(e.message));
  assert.equal(calls, 1);
});
test('maps rate-limit and permission responses to safe errors', async () => {
  for (const [status, code] of [[429, 'RATE_LIMIT'], [403, 'PERMISSION_DENIED'], [503, 'SERVICE_ERROR']]) {
    await assert.rejects(Provider.translate({ text: '你好', model: 'grok-4.3', authorization, fetchImpl: async () => new Response('private raw error', { status }) }), { code });
  }
});
test('does not request when already aborted or invalid and rejects tokens echoed by the model', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify(completed('old-secret-token'))); };
  await assert.rejects(Provider.translate({ text: '你好', model: 'grok-4.3', authorization, signal: AbortSignal.abort(), fetchImpl }), { code: 'CANCELLED' });
  await assert.rejects(Provider.translate({ text: '', model: 'grok-4.3', authorization, fetchImpl }), { code: 'EMPTY_DRAFT' });
  assert.equal(calls, 0);
  await assert.rejects(Provider.translate({ text: '你好', model: 'grok-4.3', authorization, fetchImpl }), { code: 'INVALID_RESPONSE' });
});
test('a malformed content fragment after valid text never reaches the editor as a successful translation', async () => {
  const response = completed('First half only.');
  response.output[0].content.push({ type: 'output_text', text: { invalid: true } });
  await assert.rejects(Provider.translate({ text: '完整的中文草稿', model: 'grok-4.3', authorization, fetchImpl: async () => new Response(JSON.stringify(response)) }), { code: 'INVALID_RESPONSE' });
});
test('a sign-in renewal that xAI could not be reached for is reported as a network problem, not as a lost login', async () => {
  let requests = 0;
  const retrying = Object.assign(Error('private'), { code: 'OAUTH_REFRESH_RETRYING' });
  for (const failing of [{ getAccessToken: async () => { throw retrying; } }, { getAccessToken: async () => 'old-secret-token', onUnauthorized: async () => { throw retrying; } }]) {
    await assert.rejects(Provider.translate({ text: '你好', model: 'grok-4.3', authorization: failing, fetchImpl: async () => { requests++; return new Response('expired', { status: 401 }); } }), { code: 'NETWORK_ERROR' });
  }
  assert.equal(requests, 1);
  await assert.rejects(Provider.translate({ text: '你好', model: 'grok-4.3', authorization: { getAccessToken: async () => { throw Object.assign(Error('x'), { code: 'OAUTH_LOGIN_REQUIRED' }); } }, fetchImpl: async () => { throw Error('unexpected'); } }), { code: 'AUTH_REQUIRED' });
});
