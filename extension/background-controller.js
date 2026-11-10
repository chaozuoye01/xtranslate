(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.GrokInputCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GrokInputController = api;
})(globalThis, function (Core) {
  'use strict';
  const SETTINGS = 'grokInputSettings';
  const schemas = {
    GET_STATE: [], OPEN_SETTINGS: [], TRANSLATE: ['requestId', 'text', 'surface'], CANCEL_TRANSLATION: ['requestId'],
    LOGIN: ['remember'], CANCEL_LOGIN: [], LOGOUT: [], SET_REMEMBER: ['remember'], SET_CHAT: ['enabled'], SELECT_MODEL: ['model'], RELOAD_MODELS: []
  };
  function create({ chrome, oauth, translate }) {
    let settings = {}, epoch = 0, lastIdentity = null;
    const jobs = new Map();
    const ready = (async () => {
      settings = (await chrome.storage.local.get(SETTINGS))[SETTINGS] || {};
      await oauth.initialize();
      // New installs remember the login on this device: the refresh token is encrypted with a key that cannot be
      // exported, and the settings page can switch it off. An explicit earlier choice is kept.
      if (typeof settings.remember !== 'boolean') {
        settings.remember = true;
        await chrome.storage.local.set({ [SETTINGS]: settings });
      }
      // A blocked OAuth marker can lose the vendor's in-memory preference on worker restart.
      // The user's explicit setting stays authoritative in every authorization state.
      if (oauth.status().remember !== settings.remember) await oauth.setRemember(settings.remember);
      lastIdentity = identity();
    })();
    // Why the last automatic sign-in renewal failed, for the settings page only. Never contains credentials.
    function safeFailure(value) {
      const time = v => Number.isSafeInteger(v) && v > 0;
      if (!value || !['network', 'http', 'invalid_response'].includes(value.kind) || !time(value.at)) return undefined;
      const failure = { at: value.at, kind: value.kind };
      if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) failure.status = value.status;
      if (typeof value.error === 'string' && /^[a-z_]{1,40}$/.test(value.error)) failure.error = value.error;
      if (Number.isSafeInteger(value.count) && value.count > 0) failure.count = value.count;
      if (time(value.retryAt)) failure.retryAt = value.retryAt;
      if (time(value.recoveredAt)) failure.recoveredAt = value.recoveredAt;
      return failure;
    }
    function identity() { const s = oauth.status(); return `${s.credentialId || ''}:${!!s.connected}`; }
    function invalidate() { epoch++; for (const job of jobs.values()) job.abort.abort(); jobs.clear(); }
    function source(sender) {
      if (sender?.id !== chrome.runtime.id) return null;
      try {
        const url = new URL(sender.url);
        if (url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id && !url.search && !url.hash && ['/options.html', '/popup.html'].includes(url.pathname)) return 'ui';
        if (url.protocol === 'https:' && ['x.com', 'twitter.com'].includes(url.hostname) && !url.port && !url.username && !url.password && Number.isInteger(sender.tab?.id)) return 'content';
      } catch { /* Reject unknown sender origins. */ }
      return null;
    }
    function safeState(ui = false) {
      const s = oauth.status();
      const catalogModels = [...new Set((s.catalogModels || []).filter(Core.validModel))].slice(0, 500);
      const model = settings.model ? (catalogModels.includes(settings.model) ? settings.model : '') : Core.defaultModel(catalogModels);
      const state = {
        state: ['disconnected', 'starting', 'awaiting_authorization', 'connected', 'refreshing', 'reauth_required', 'error'].includes(s.state) ? s.state : 'error',
        connected: !!s.connected, remember: !!s.remember, credentialId: s.credentialId || null,
        errorCode: /^OAUTH_[A-Z_]{1,60}$/.test(s.errorCode || '') ? s.errorCode : null,
        catalogErrorCode: s.catalogErrorCode === 'OAUTH_CATALOG_UNAVAILABLE' ? s.catalogErrorCode : null,
        catalogModels, model, chat: settings.chat === true
      };
      if (ui && safeFailure(s.refreshFailure)) state.refreshFailure = safeFailure(s.refreshFailure);
      if (ui && s.device) state.device = { userCode: s.device.userCode, verificationUriComplete: s.device.verificationUriComplete, expiresAt: s.device.expiresAt };
      return state;
    }
    async function broadcast() {
      const state = safeState(false);
      try { await chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state }); } catch { /* Popup may be closed. */ }
      try {
        const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
        await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'STATE_CHANGED', state })));
      } catch { /* No X tabs may be open. */ }
    }
    function onAuthChange() {
      if (lastIdentity !== null && lastIdentity !== identity()) invalidate();
      lastIdentity = identity();
      void ready.then(broadcast).catch(() => {});
    }
    function onTabRemoved(tabId) {
      for (const [key, job] of jobs) if (job.tabId === tabId) { job.abort.abort(); jobs.delete(key); }
    }
    function jobKey(sender, requestId) { return `${sender.tab?.id}:${sender.documentId || `${sender.frameId || 0}:${sender.url}`}:${requestId}`; }
    function validate(message) {
      if (!message || typeof message !== 'object' || Array.isArray(message) || !Object.hasOwn(schemas, message.type)) throw Core.error('INVALID_INPUT');
      if (Object.keys(message).some(key => key !== 'type' && !schemas[message.type].includes(key))) throw Core.error('INVALID_INPUT');
      if (['TRANSLATE', 'CANCEL_TRANSLATION'].includes(message.type) && (typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(message.requestId))) throw Core.error('INVALID_INPUT');
      if (['LOGIN', 'SET_REMEMBER'].includes(message.type) && typeof message.remember !== 'boolean') throw Core.error('INVALID_INPUT');
      if (message.type === 'SET_CHAT' && typeof message.enabled !== 'boolean') throw Core.error('INVALID_INPUT');
      if (message.type === 'TRANSLATE' && !['reply', 'chat'].includes(message.surface)) throw Core.error('INVALID_INPUT');
    }
    async function handle(message, sender) {
      try {
        const from = source(sender);
        if (!from) throw Core.error('FORBIDDEN');
        if (from === 'content' && !['GET_STATE', 'OPEN_SETTINGS', 'TRANSLATE', 'CANCEL_TRANSLATION'].includes(message?.type)) throw Core.error('FORBIDDEN');
        validate(message); await ready;
        const type = message.type;
        if (type === 'GET_STATE') return { ok: true, state: safeState(from === 'ui') };
        if (type === 'OPEN_SETTINGS') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
        if (type === 'CANCEL_TRANSLATION') {
          const key = jobKey(sender, message.requestId); jobs.get(key)?.abort.abort(); jobs.delete(key);
          return { ok: true };
        }
        if (type === 'TRANSLATE') {
          if (from !== 'content') throw Core.error('FORBIDDEN');
          Core.validateDraft(message.text);
          // Chat drafts are private messages: refused here too unless the user switched chat on in settings.
          if (message.surface === 'chat' && settings.chat !== true) throw Core.error('CHAT_DISABLED');
          const state = safeState();
          if (!state.connected) throw Core.error('AUTH_REQUIRED');
          if (!state.model) throw Core.error('MODEL_REQUIRED');
          const key = jobKey(sender, message.requestId);
          if (jobs.has(key) || jobs.size >= 3) throw Core.error('BUSY');
          const job = { abort: new AbortController(), epoch, account: state.credentialId, tabId: sender.tab.id, surface: message.surface };
          jobs.set(key, job);
          try {
            const token = async (signal, forceRefresh, rejectedAccessToken) => {
              if (job.epoch !== epoch || job.abort.signal.aborted) throw Core.error('CANCELLED');
              const result = await oauth.ensureAccessToken({ signal, forceRefresh, rejectedAccessToken, expectedCredentialId: job.account });
              if (result.credentialId !== job.account || job.epoch !== epoch || job.abort.signal.aborted) throw Core.error('CANCELLED');
              return result.accessToken;
            };
            const translated = await translate({ text: message.text, model: state.model, signal: job.abort.signal, authorization: {
              getAccessToken: signal => token(signal, false), onUnauthorized: (rejected, signal) => token(signal, true, rejected)
            } });
            if (job.epoch !== epoch || job.abort.signal.aborted || identity() !== `${job.account}:true` || job.surface === 'chat' && settings.chat !== true) throw Core.error('CANCELLED');
            return { ok: true, translated, credentialId: job.account, requestId: message.requestId };
          } finally { if (jobs.get(key) === job) jobs.delete(key); }
        }
        if (type === 'SELECT_MODEL') {
          if (!safeState().catalogModels.includes(message.model)) throw Core.error('MODEL_REQUIRED');
          invalidate(); settings = { ...settings, model: message.model };
          await chrome.storage.local.set({ [SETTINGS]: settings });
        } else if (type === 'SET_CHAT') {
          if (!message.enabled) for (const [key, job] of jobs) if (job.surface === 'chat') { job.abort.abort(); jobs.delete(key); }
          settings = { ...settings, chat: message.enabled };
          await chrome.storage.local.set({ [SETTINGS]: settings });
        } else if (type === 'SET_REMEMBER') {
          await oauth.setRemember(message.remember);
          settings = { ...settings, remember: message.remember };
          await chrome.storage.local.set({ [SETTINGS]: settings });
        } else if (type === 'LOGIN') {
          invalidate(); settings = { ...settings, remember: message.remember };
          await chrome.storage.local.set({ [SETTINGS]: settings });
          await oauth.startLogin({ remember: message.remember });
        } else if (type === 'CANCEL_LOGIN') { invalidate(); await oauth.cancelLogin(); }
        else if (type === 'LOGOUT') { invalidate(); await oauth.logout(); }
        else if (type === 'RELOAD_MODELS') await oauth.catalog();
        lastIdentity = identity(); await broadcast();
        return { ok: true, state: safeState(true) };
      } catch (value) {
        // A renewal that could not reach xAI keeps the login; the page should suggest retrying, not reconnecting.
        const safe = value?.code === 'OAUTH_REFRESH_RETRYING' ? Core.error('NETWORK_ERROR') : /^OAUTH_/.test(value?.code || '') ? Core.error('AUTH_REQUIRED') : value;
        return { ok: false, error: Core.safeError(safe) };
      }
    }
    return Object.freeze({ handle, onAuthChange, onTabRemoved, ready });
  }
  return Object.freeze({ create });
});
