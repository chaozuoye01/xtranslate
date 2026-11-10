(function () {
  'use strict';
  if (globalThis.__grokInputTranslator) return;
  globalThis.__grokInputTranslator = true;
  const Core = globalThis.GrokInputCore, Adapter = globalThis.GrokInputAdapter;
  const VERSION = chrome.runtime.getManifest?.().version || '';
  const bindings = new Map();
  let connection = null, scanTimer, hidden = false;
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const send = message => chrome.runtime.sendMessage(message);
  function element(tag, className, value) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function action(label, callback, className = 'secondary') {
    const node = element('button', className, label); node.type = 'button';
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (event.isTrusted) callback(); });
    return node;
  }
  function key(state) { return state ? `${state.credentialId || ''}:${!!state.connected}:${state.model || ''}` : ''; }
  function updateConnection(next) {
    if (connection && key(connection) !== key(next)) for (const binding of bindings.values()) reset(binding);
    connection = next;
  }
  function current(binding) {
    return !hidden && !binding.disposed && binding.host.isConnected && Adapter.locate(binding.editor)?.contextKey === binding.contextKey;
  }
  function synchronize(binding) {
    if (binding.writing) return;
    const value = Adapter.read(binding.editor);
    if (value !== binding.lastText) { binding.version++; binding.lastText = value; }
    updateButton(binding);
  }
  function updateButton(binding) {
    binding.translate.disabled = binding.pending || binding.composing || binding.writing || !binding.lastText.trim();
    text(binding.translate, binding.pending ? '翻译中…' : '译成英文');
    binding.translate.setAttribute('aria-busy', String(binding.pending));
    if (binding.restore) binding.restore.disabled = !binding.result || binding.composing || binding.writing || binding.appliedVersion !== binding.version || binding.lastText !== binding.result.translated;
  }
  function cancel(binding) {
    if (binding.requestId) void send({ type: 'CANCEL_TRANSLATION', requestId: binding.requestId }).catch(() => {});
    binding.requestId = null; binding.sequence++; binding.pending = false;
  }
  function reset(binding) {
    cancel(binding); binding.result = null; binding.appliedVersion = null;
    binding.restore = null;
    binding.comparison.replaceChildren(); binding.comparison.hidden = true; text(binding.notice, '');
    updateButton(binding);
  }
  function dispose(binding) {
    cancel(binding); binding.disposed = true; binding.events.abort(); binding.host.remove(); bindings.delete(binding.editor);
  }
  // X re-renders the composer (collapsed row → expanded editor and toolbar) without replacing the
  // draft. Follow it by moving the panel; translation state stays with the draft.
  function place(binding, found) {
    const { panelParent, panelAfter, panelBefore } = found, host = binding.host;
    // Replies mount after the composer; chat mounts before its input row (panelBefore).
    const placed = host.parentElement === panelParent && (panelBefore ? host.nextElementSibling === panelBefore : panelAfter ? host.previousElementSibling === panelAfter : !host.nextElementSibling);
    if (!placed) panelParent.insertBefore(host, panelBefore || (panelAfter ? panelAfter.nextSibling : null));
    // Line the panel up with the composer's content, not X's avatar column, chat side area or dialog edge.
    const box = host.getBoundingClientRect(), edge = found.area.getBoundingClientRect(), css = getComputedStyle(found.area);
    const [left, right] = [edge.left + parseFloat(css.paddingLeft) - box.left, box.right - edge.right + parseFloat(css.paddingRight)].map(value => `${Math.min(240, Math.max(0, Math.round(value)))}px`);
    if (host.style.paddingLeft !== left || host.style.paddingRight !== right) Object.assign(host.style, { paddingLeft: left, paddingRight: right });
    const color = getComputedStyle(binding.editor).color;
    if (host.style.color !== color) {
      host.style.color = color;
      const [r, g, b] = (color.match(/\d+(\.\d+)?/g) || []).map(Number);
      host.dataset.theme = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? 'dark' : 'light';
    }
  }
  const filled = binding => binding.surface === 'chat' ? '英文已填入，发送前可继续修改。' : '英文已填入，发布前可继续修改。';
  async function copy(value, node) {
    try { await navigator.clipboard.writeText(value); text(node, '已复制'); }
    catch { text(node, '复制失败，请选中文字复制'); }
  }
  async function apply(binding, value) {
    if (!current(binding) || binding.composing || binding.writing) return false;
    const before = binding.lastText;
    binding.writing = true; updateButton(binding);
    let success;
    try { success = await Adapter.write(binding.editor, value); } finally { binding.writing = false; }
    if (binding.disposed) return false;
    binding.version++; binding.lastText = Adapter.read(binding.editor); updateButton(binding);
    if (!success) text(binding.notice, binding.lastText === before ? '未能填入，草稿未改动，请复制译文后粘贴。' : '填入结果与译文不一致，请核对草稿；可按 Ctrl+Z 撤销。');
    return success;
  }
  function compare(binding) {
    const result = binding.result;
    binding.comparison.replaceChildren(); binding.comparison.hidden = false;
    const header = element('div', 'compare-header');
    header.append(element('strong', '', '中英文对照'), action('关闭对照', () => reset(binding), 'close'));
    const columns = element('div', 'columns');
    for (const [label, value] of [['中文原文', result.original], ['英文译文', result.translated]]) {
      const column = element('section', 'column'); column.append(element('span', 'label', label), element('p', 'translation', value)); columns.append(column);
    }
    const actions = element('div', 'actions');
    const fill = action('填入英文', async () => {
      if (await apply(binding, result.translated)) { binding.appliedVersion = binding.version; text(binding.notice, filled(binding)); updateButton(binding); }
    });
    binding.restore = action('恢复中文', async () => {
      synchronize(binding);
      if (binding.version === binding.appliedVersion && binding.lastText === result.translated && await apply(binding, result.original)) {
        binding.appliedVersion = null; text(binding.notice, '已恢复本次中文原文。'); updateButton(binding);
      }
    });
    const copyEnglish = action('复制英文', () => copy(result.translated, copyEnglish));
    const copyChinese = action('复制中文', () => copy(result.original, copyChinese), 'text-button');
    actions.append(fill, binding.restore, copyEnglish, copyChinese);
    binding.comparison.append(header, columns, actions); updateButton(binding);
  }
  async function run(binding) {
    if (binding.pending || !current(binding) || binding.composing || binding.writing) return;
    synchronize(binding);
    try { Core.validateDraft(binding.lastText); } catch (error) { text(binding.notice, Core.safeError(error).message); return; }
    if (!connection?.connected || !connection.model) {
      text(binding.notice, !connection?.connected ? '请先连接 Grok，完成后返回这里翻译。' : Core.MESSAGES.MODEL_REQUIRED);
      await send({ type: 'OPEN_SETTINGS' }).catch(() => {}); return;
    }
    if (binding.surface === 'chat' && !connection.chat) { text(binding.notice, Core.MESSAGES.CHAT_DISABLED); return; }
    reset(binding); binding.pending = true;
    const sequence = binding.sequence, original = binding.lastText, version = binding.version, account = key(connection);
    binding.requestId = crypto.randomUUID(); updateButton(binding); text(binding.notice, '正在翻译，仍可继续编辑草稿…');
    try {
      const response = await send({ type: 'TRANSLATE', requestId: binding.requestId, text: original, surface: binding.surface });
      if (binding.sequence !== sequence || binding.disposed || key(connection) !== account) return;
      const live = current(binding);
      if (!live && !Adapter.isCovered(binding.editor)) return;
      if (!response?.ok) throw response?.error || Core.error('SERVICE_ERROR');
      if (typeof response.translated !== 'string' || !response.translated.trim() || response.translated.length > 100000 || response.credentialId !== connection.credentialId) throw Core.error('INVALID_RESPONSE');
      synchronize(binding); binding.result = { original, translated: response.translated };
      compare(binding);
      if (!live) text(binding.notice, '回复框暂时被遮挡，返回后可点击“填入英文”。');
      else if (binding.version === version && !binding.composing && binding.lastText === original) {
        if (await apply(binding, response.translated) && binding.sequence === sequence) { binding.appliedVersion = binding.version; text(binding.notice, filled(binding)); }
      } else text(binding.notice, Core.MESSAGES.DRAFT_CHANGED);
    } catch (error) {
      if (binding.sequence === sequence && !binding.disposed) text(binding.notice, Core.safeError(error).message);
    } finally {
      if (binding.sequence === sequence) { binding.pending = false; binding.requestId = null; updateButton(binding); }
    }
  }
  function attach(found) {
    const host = element('grok-input-panel');
    host.style.cssText = 'display:block;width:100%;min-width:0;flex:0 0 auto;box-sizing:border-box;';
    if (VERSION) host.dataset.version = VERSION;
    host.dataset.surface = found.surface;
    // Keep panel clicks and keys away from X's handlers (post navigation, single-key shortcuts);
    // Escape and Tab still reach X so its dialog can close and keep focus inside.
    const isolate = event => { if (!/^(Escape|Tab)$/.test(event.key || '')) event.stopPropagation(); };
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress']) host.addEventListener(type, isolate);
    const shadow = host.attachShadow({ mode: 'open' }), style = element('link');
    style.rel = 'stylesheet'; style.href = chrome.runtime.getURL('panel.css'); shadow.append(style);
    const wrapper = element('div', 'wrapper'), toolbar = element('div', 'toolbar');
    const binding = { editor: found.editor, surface: found.surface, contextKey: found.contextKey, host, version: 0, sequence: 0, lastText: Adapter.read(found.editor), pending: false, events: new AbortController(), composing: false, writing: false };
    binding.translate = action('译成英文', () => void run(binding), 'primary');
    binding.notice = element('div', 'notice'); binding.notice.setAttribute('role', 'status'); binding.notice.setAttribute('aria-live', 'polite');
    binding.comparison = element('div', 'comparison'); binding.comparison.hidden = true;
    toolbar.append(binding.translate, element('span', 'brand', 'Grok · 中文 → English'));
    wrapper.append(toolbar, binding.notice, binding.comparison); shadow.append(wrapper);
    place(binding, found);
    const eventOptions = { signal: binding.events.signal };
    found.editor.addEventListener('input', () => { if (!binding.writing) { binding.version++; binding.lastText = Adapter.read(found.editor); updateButton(binding); } }, eventOptions);
    found.editor.addEventListener('compositionstart', () => { binding.composing = true; binding.version++; updateButton(binding); }, eventOptions);
    found.editor.addEventListener('compositionend', () => { binding.composing = false; binding.version++; synchronize(binding); }, eventOptions);
    bindings.set(found.editor, binding); updateButton(binding);
  }
  function scan() {
    scanTimer = null; if (hidden) return;
    // X Chat is private: it is only looked at, watched or given a panel while the user has switched it on.
    const chat = !!connection?.chat;
    for (const binding of [...bindings.values()]) {
      const found = binding.surface === 'chat' && !chat ? null : Adapter.locate(binding.editor);
      if (found?.contextKey === binding.contextKey) { place(binding, found); synchronize(binding); }
      else if (found || binding.surface === 'chat' || !Adapter.isCovered(binding.editor)) dispose(binding);
    }
    const editors = Adapter.getReplyEditors(document);
    if (chat) {
      for (const shadow of Adapter.chatRoots(document)) if (!watched.has(shadow)) { watched.add(shadow); observer.observe(shadow, OBSERVE); }
      editors.push(...Adapter.getChatEditors(document));
    }
    for (const found of editors) if (!bindings.has(found.editor)) attach(found);
  }
  const schedule = () => { if (!scanTimer) scanTimer = setTimeout(scan, 60); };
  const OBSERVE = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'contenteditable', 'aria-hidden', 'hidden', 'inert', 'data-testid'] };
  const observer = new MutationObserver(schedule);
  let watched = new WeakSet();
  observer.observe(document.body, OBSERVE);
  function receive(state) {
    // Stop watching the chat shadow root as soon as chat translation is switched off.
    if (connection?.chat && !state?.chat) { observer.disconnect(); observer.observe(document.body, OBSERVE); watched = new WeakSet(); }
    updateConnection(state); schedule();
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender?.id === chrome.runtime.id && message?.type === 'STATE_CHANGED') receive(message.state);
  });
  addEventListener('pagehide', () => { hidden = true; for (const binding of [...bindings.values()]) dispose(binding); });
  addEventListener('pageshow', () => { hidden = false; schedule(); void send({ type: 'GET_STATE' }).then(value => { if (value?.ok) receive(value.state); }).catch(() => {}); });
  addEventListener('popstate', schedule);
  setInterval(schedule, 600);
  void send({ type: 'GET_STATE' }).then(value => { if (value?.ok) receive(value.state); }).catch(() => {});
  scan();
})();
