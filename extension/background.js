'use strict';
importScripts('vendor/key-store.js', 'vendor/oauth-provider.js', 'core.js', 'translation-provider.js', 'background-controller.js');
let controller;
const boot = (async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  ]);
  const oauth = SuperXOAuth.create({ chrome, fetch: globalThis.fetch.bind(globalThis), crypto: globalThis.crypto,
    keyStore: SuperXKeyStore.create({ purpose: 'oauth-refresh' }), onChange: () => controller?.onAuthChange() });
  controller = GrokInputController.create({ chrome, oauth, translate: GrokInputProvider.translate });
  chrome.alarms.onAlarm.addListener(alarm => { void oauth.handleAlarm(alarm).catch(() => {}); });
  await controller.ready;
  return controller;
})();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  boot.then(c => c.handle(message, sender)).then(sendResponse).catch(() => sendResponse({ ok: false, error: { code: 'STORAGE_ERROR', message: GrokInputCore.MESSAGES.STORAGE_ERROR } }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => controller?.onTabRemoved(tabId));
