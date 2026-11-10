'use strict';
const listeners = [];
window.chrome = { runtime: { id: 'grok-local-demo', getURL: file => '/extension/' + file, onMessage: { addListener(fn) { listeners.push(fn); } }, async sendMessage(message) {
  if (message.type === 'GET_STATE') return { ok: true, state: { connected: true, credentialId: 'local-demo', model: 'grok-4.3' } };
  if (message.type === 'TRANSLATE') {
    await new Promise(resolve => setTimeout(resolve, document.querySelector('#slow').checked ? 2500 : 450));
    return { ok: true, credentialId: 'local-demo', translated: message.text.includes('非常认同') ? "I completely agree. Language shouldn't be a barrier to communication." : 'This is an insightful perspective. Thanks for sharing! Good tools should help us express ourselves more naturally.' };
  }
  return { ok: true };
} } };
document.querySelector('#theme').addEventListener('click', () => document.body.classList.toggle('dark'));
document.querySelector('#dialog').addEventListener('click', () => document.querySelector('#modal').hidden = false);
document.querySelector('#close-modal').addEventListener('click', () => document.querySelector('#modal').hidden = true);
document.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => event.preventDefault()));
