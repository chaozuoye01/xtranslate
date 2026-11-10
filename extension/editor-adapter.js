(function (root) {
  'use strict';
  const SELECTOR = '[data-testid^="tweetTextarea_"][contenteditable="true"],textarea[data-testid^="tweetTextarea_"]';
  const PUBLISH = '[data-testid="tweetButton"],[data-testid="tweetButtonInline"]';
  const INLINE_REPLY = '[data-testid="inline_reply_offscreen"]';
  const NEW_POST = /^(post|post all|tweet|tweet all|发帖|全部发帖|發佈|發布|发布|发推)$/i;
  // X Chat (x.com/i/chat) renders inside this host's open shadow root (verified 2026-11-09).
  const CHAT_HOST = '[data-testid="xchatEmbedRoute"]';
  const CHAT_EDITOR = 'textarea[data-testid="dm-composer-textarea"]';
  const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
  function read(editor) {
    if (editor.tagName === 'TEXTAREA') return editor.value;
    // Draft.js renders one element per paragraph; innerText adds layout newlines (an empty draft reads "\n").
    const blocks = editor.querySelectorAll('[data-block="true"]');
    return blocks.length ? [...blocks].map(block => block.textContent).join('\n') : editor.innerText.replace(/\r\n?/g, '\n');
  }
  function isEditable(editor) {
    if (!editor?.isConnected || editor.disabled || editor.readOnly || editor.closest('[inert],[aria-hidden="true"],[hidden]')) return false;
    const style = editor.ownerDocument.defaultView.getComputedStyle(editor);
    return (editor.tagName === 'TEXTAREA' || editor.isContentEditable) && style.display !== 'none' && style.visibility !== 'hidden' && editor.getClientRects().length > 0;
  }
  // X hides the page under a reply dialog or photo viewer; that composer is paused, not gone.
  function isCovered(editor) { return !!editor?.isConnected && !!editor.closest('[inert],[aria-hidden="true"]'); }
  function statusId(href) {
    try { return new URL(href).pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/)?.[1] || ''; } catch { return ''; }
  }
  function composerOf(editor, boundary) {
    for (let node = editor.parentElement; node && boundary.contains(node); node = node.parentElement) {
      const buttons = node.querySelectorAll(PUBLISH);
      if (buttons.length) return buttons.length === 1 ? { composer: node, publish: buttons[0] } : null;
    }
    return null;
  }
  function target(editor, publish, dialog, view) {
    if (!dialog) {
      // Inline composers reply only on a post page; the home "What's happening?" box has no post in its URL.
      const id = statusId(view.location.href);
      return id && publish.matches('[data-testid="tweetButtonInline"]') ? `inline:${id}` : '';
    }
    const path = view.location.pathname;
    // X keeps the replied-to post in the dialog's history entry (verified on x.com 2026-10-30).
    const id = view.history.state?.state?.inReplyToStatusId;
    if (typeof id === 'string' && /^\d{1,25}$/.test(id)) return `dialog:${path}:${id}`;
    // Fallback if that state moves: a reply dialog shows the replied-to post above the draft,
    // while new and quote posts have nothing above it. Its link may be absent, so use author and time.
    const post = [...dialog.querySelectorAll('article')].find(node => !node.contains(editor) && node.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING);
    const link = post && [...post.querySelectorAll('a[href]')].map(a => statusId(new URL(a.getAttribute('href'), view.location.href).href)).find(Boolean);
    const author = post?.querySelector('a[href^="/"]')?.getAttribute('href'), time = post?.querySelector('time[datetime]')?.getAttribute('datetime');
    return link ? `dialog:${path}:${link}` : author && time ? `dialog:${path}:${author}@${time}` : '';
  }
  // The area that belongs to this draft: the whole composer (editor, toolbar, Reply) unless
  // thread drafts share one Reply button, in which case only this draft's own post block.
  function region(editor, composer) {
    if (composer.querySelectorAll(SELECTOR).length === 1) return composer;
    let own = editor;
    while (own.parentElement !== composer && own.parentElement.querySelectorAll(SELECTOR).length === 1) own = own.parentElement;
    return own;
  }
  function vertical(node) {
    const css = node.ownerDocument.defaultView.getComputedStyle(node);
    return /^(block|flow-root|list-item)$/.test(css.display) || /^(inline-)?flex$/.test(css.display) && css.flexDirection === 'column';
  }
  // A box that cannot grow (fixed height or max-height without its own scrolling) would clip the
  // panel or let it cover the next post. Percentages are not fixed: X's #react-root and body use
  // height:100%, and treating those as fixed is why 0.1.1 never attached on x.com.
  function fixed(node, view) {
    const css = view.getComputedStyle(node);
    if (/^(auto|scroll)$/.test(css.overflowY)) return false;
    let height = '';
    try { height = String(node.computedStyleMap().get('height')); } catch { /* Typed OM is optional; max-height still applies. */ }
    return css.maxHeight !== 'none' || /^[\d.]+px$/.test(height);
  }
  // Never mount inside X's horizontal rows (editor | Reply button): a block child there takes the
  // editor's flex space and squeezes the draft into a one-character column. Use the nearest vertical
  // flow at or above the draft's area, inside the virtual-list cell or dialog, so X re-measures it.
  function mountPoint(area, boundary, publish) {
    const view = area.ownerDocument.defaultView;
    let parent = area, after = null;
    const outside = node => { if (!after || node.contains(after)) { after = node; parent = node.parentElement; } };
    // X's toolbar is sticky (top and bottom) within its parent; a panel in that parent scrolls under it.
    for (let node = publish; node && node !== boundary; node = node.parentElement) {
      if (view.getComputedStyle(node).position === 'sticky' && node.parentElement.contains(area)) outside(node.parentElement);
    }
    for (let node = area; node && node !== boundary; node = node.parentElement) if (fixed(node, view)) outside(node);
    for (; parent && boundary.contains(parent); after = parent, parent = parent.parentElement) {
      if (vertical(parent)) return { panelParent: parent, panelAfter: after };
    }
    return null;
  }
  // The chat composer is pinned to the bottom and grows upward, and X re-measures it for the message
  // list. The panel goes directly above the input row, so it never covers the textarea or Send.
  function locateChat(editor) {
    const host = editor.getRootNode().host, view = editor.ownerDocument.defaultView;
    const container = editor.closest('[data-testid="dm-composer-container"]'), area = editor.closest('form');
    // Person and group chats are /i/chat/<id>; Grok bot chats are /i/chat/bots/<uuid>.
    const id = view.location.pathname.match(/^\/i\/chat\/(.+?)\/?$/)?.[1];
    if (!host?.matches(CHAT_HOST) || !container || !area || !id) return null;
    for (let child = area, parent = area.parentElement; parent && container.contains(parent); child = parent, parent = parent.parentElement) {
      if (vertical(parent)) return { editor, surface: 'chat', contextKey: `chat:${id}`, area, panelParent: parent, panelBefore: child };
    }
    return null;
  }
  function locate(editor) {
    if (!isEditable(editor)) return null;
    if (editor.matches(CHAT_EDITOR)) return locateChat(editor);
    const view = editor.ownerDocument.defaultView;
    const inline = editor.closest(INLINE_REPLY), dialog = inline ? null : editor.closest('[role="dialog"]');
    const boundary = editor.closest('[data-testid="cellInnerDiv"],[role="dialog"]') || inline || editor.closest('main,[role="main"]');
    const found = boundary && composerOf(editor, boundary);
    if (!found || NEW_POST.test(found.publish.innerText.trim())) return null;
    const contextKey = target(editor, found.publish, dialog, view);
    const area = contextKey && region(editor, found.composer), mount = area && mountPoint(area, boundary, found.publish);
    return mount ? { editor, surface: 'reply', contextKey, area, ...mount } : null;
  }
  function getReplyEditors(document) {
    return [...document.querySelectorAll(SELECTOR)].filter(node => !node.querySelector(SELECTOR)).map(locate).filter(Boolean);
  }
  function chatRoots(document) { return [...document.querySelectorAll(CHAT_HOST)].map(host => host.shadowRoot).filter(Boolean); }
  function getChatEditors(document) {
    return chatRoots(document).flatMap(shadow => [...shadow.querySelectorAll(CHAT_EDITOR)]).map(locate).filter(Boolean);
  }
  async function write(editor, text) {
    if (!isEditable(editor) || typeof text !== 'string') return false;
    const doc = editor.ownerDocument, view = doc.defaultView;
    editor.focus({ preventScroll: true });
    if (editor.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, 'value').set.call(editor, text);
      editor.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return read(editor) === text;
    }
    const before = read(editor), selection = view.getSelection(), range = doc.createRange();
    range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
    // Draft.js copies the DOM selection into its own state on the following selectionchange;
    // a paste sent earlier lands at the old caret instead of replacing the draft.
    await settle(50);
    if (!isEditable(editor) || doc.activeElement !== editor || read(editor) !== before) return false;
    // X's Draft.js editor takes a paste as one undoable edit and splits paragraphs itself.
    // execCommand('insertText') with line breaks desynchronises Draft and duplicates text.
    const data = new view.DataTransfer(); data.setData('text/plain', text);
    const paste = new view.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    editor.dispatchEvent(paste);
    if (!paste.defaultPrevented) doc.execCommand('insertText', false, text);
    for (let wait = 0; wait < 15 && read(editor) !== text; wait++) await settle(20);
    return read(editor) === text;
  }
  root.GrokInputAdapter = Object.freeze({ getReplyEditors, getChatEditors, chatRoots, locate, read, write, isEditable, isCovered });
})(globalThis);
