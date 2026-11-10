(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.GrokInputCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GrokInputProvider = api;
})(globalThis, function (Core) {
  'use strict';
  const ENDPOINT = 'https://api.x.ai/v1/responses';
  async function translate({ text, model, authorization, fetchImpl = globalThis.fetch, signal }) {
    if (signal?.aborted) throw Core.error('CANCELLED');
    const request = Core.buildRequest(text, model);
    const secrets = [];
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    try {
      if (!authorization?.getAccessToken) throw Core.error('AUTH_REQUIRED');
      let token = await authorization.getAccessToken(controller.signal);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (typeof token !== 'string' || token.length < 1 || controller.signal.aborted) throw Core.error(controller.signal.aborted ? 'CANCELLED' : 'AUTH_REQUIRED');
        secrets.push(token);
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(request), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal
        });
        if (response.redirected || (response.url && response.url !== ENDPOINT)) throw Core.error('NETWORK_ERROR');
        if (response.status === 401) {
          await response.body?.cancel().catch(() => {});
          if (attempt || !authorization.onUnauthorized) throw Core.error('AUTH_REQUIRED');
          token = await authorization.onUnauthorized(token, controller.signal);
          if (secrets.includes(token)) throw Core.error('AUTH_REQUIRED');
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw Core.error(response.status === 429 ? 'RATE_LIMIT' : response.status === 403 ? 'PERMISSION_DENIED' : 'SERVICE_ERROR');
        }
        let raw = '';
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder(); let bytes = 0;
          try {
            while (true) {
              const item = await reader.read(); if (item.done) break;
              bytes += item.value.byteLength;
              if (bytes > 512000) { await reader.cancel(); throw Core.error('INVALID_RESPONSE'); }
              raw += decoder.decode(item.value, { stream: true });
            }
            raw += decoder.decode();
          } finally { reader.releaseLock(); }
        } else raw = await response.text();
        if (controller.signal.aborted) throw Core.error('CANCELLED');
        let body; try { body = JSON.parse(raw); } catch { throw Core.error('INVALID_RESPONSE'); }
        const translated = Core.extractTranslation(body);
        if (secrets.some(secret => translated.includes(secret))) throw Core.error('INVALID_RESPONSE');
        return translated;
      }
      throw Core.error('AUTH_REQUIRED');
    } catch (value) {
      if (timedOut) throw Core.error('TIMEOUT');
      if (signal?.aborted || controller.signal.aborted) throw Core.error('CANCELLED');
      if (Object.hasOwn(Core.MESSAGES, value?.code)) throw Core.error(value.code);
      // The sign-in renewal could not reach xAI: the login is kept and retried, so this is a network problem.
      if (value?.code === 'OAUTH_REFRESH_RETRYING') throw Core.error('NETWORK_ERROR');
      if (/^OAUTH_/.test(value?.code || '')) throw Core.error('AUTH_REQUIRED');
      throw Core.error('NETWORK_ERROR');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
  return Object.freeze({ translate, ENDPOINT });
});
