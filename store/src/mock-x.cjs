// X-like pages for the store screenshots. They are served at x.com addresses to the real extension,
// so its content script attaches exactly as on X. The structure follows the fixtures in
// tests/browser.test.cjs, which mirror x.com as inspected on 2026-10-30 and 2026-11-09.
// People, posts and messages are made up; no real account or timeline appears.

const ICON = {
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  gif: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10H8.5a1.5 1.5 0 0 0 0 4H10v-2M13 10v4M16 14v-4h2.2M16 12h1.8"/>',
  emoji: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  reply: '<path d="M4 12a7 7 0 0 1 7-7h2a7 7 0 0 1 0 14h-1l-5 3v-4.2A7 7 0 0 1 4 12z"/>',
  repost: '<path d="M7 7h10l-3-3M17 17H7l3 3M17 7v6M7 17v-6"/>',
  like: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  views: '<path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/>',
  back: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const svg = (key, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24">${ICON[key]}</svg>`;
const FONT = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';

// Same behaviour as the test fixtures: a virtual list that re-measures its cells, and a Draft.js-like editor.
function virtualList() {
  const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
  const layout = () => { let y = 0; for (const cell of cells) { cell.style.transform = `translateY(${y}px)`; y += cell.offsetHeight; } document.querySelector('#timeline').style.height = `${y}px`; };
  const observer = new ResizeObserver(layout); cells.forEach(cell => observer.observe(cell)); layout();
}
function draftLike(selector) {
  const editor = document.querySelector(selector); let all = false;
  const text = () => [...editor.querySelectorAll('[data-block="true"]')].map(block => block.textContent).join('\n');
  const render = value => editor.replaceChildren(...value.split('\n').map(line => { const block = document.createElement('div'); block.dataset.block = 'true'; if (line) block.textContent = line; else block.append(document.createElement('br')); return block; }));
  render(editor.textContent);
  document.addEventListener('selectionchange', () => { const selection = getSelection(); all = selection.rangeCount > 0 && editor.contains(selection.anchorNode) && selection.toString().replace(/\s/g, '') === editor.textContent.replace(/\s/g, ''); });
  editor.addEventListener('paste', event => { event.preventDefault(); const value = event.clipboardData.getData('text/plain'); render(all ? value : text() + value); });
}

const replyPage = ({ draft }) => `<style>
html,body{height:100%}body{margin:0;background:#fff;color:#0f1419;font:15px/20px ${FONT}}
#react-root{height:100%;display:flex;flex-direction:column}
main{display:flex;flex-direction:column;width:600px;margin:0 auto;border-left:1px solid #eff3f4;border-right:1px solid #eff3f4;min-height:100%}
.top{height:53px;display:flex;align-items:center;gap:28px;padding:0 16px;font-size:20px;font-weight:800}
.top svg{width:20px;height:20px;fill:none;stroke:#0f1419;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#timeline{position:relative}
[data-testid=cellInnerDiv]{position:absolute;left:0;right:0;top:0}
.row{display:flex;flex-direction:row}.col{display:flex;flex-direction:column;min-width:0}
.avatar{flex:0 0 40px;height:40px;border-radius:50%;margin-right:8px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:15px}
.name{font-weight:700}.handle{color:#536471}
.post{padding:12px 16px 0}
.post .text{font-size:17px;line-height:24px;margin:12px 0}
.meta{color:#536471;padding-bottom:16px;border-bottom:1px solid #eff3f4}
.meta a{color:#536471;text-decoration:none}
.meta b{color:#0f1419}
.acts{display:flex;justify-content:space-around;height:48px;align-items:center;color:#536471;border-bottom:1px solid #eff3f4;font-size:13px}
.acts span{display:flex;align-items:center;gap:6px}
svg.i{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.reply{padding:4px 16px 4px;border-bottom:1px solid #eff3f4}
#replying{color:#536471;padding:8px 0 2px 48px}#replying span{color:#1d9bf0}
[data-testid=tweetTextarea_0]{font-size:20px;line-height:28px;min-height:28px;padding:10px 0 14px;outline:none;white-space:pre-wrap}
[data-testid=toolBar]{position:sticky;top:0;bottom:-1px;z-index:1;background:#fff;display:flex;justify-content:space-between;align-items:center;height:48px}
[data-testid=toolBar] nav{display:flex;gap:14px;color:#1d9bf0}
[data-testid=tweetButtonInline]{background:#0f1419;color:#fff;border:0;border-radius:999px;font:700 15px ${FONT};height:36px;padding:0 18px}
.other{padding:12px 16px;border-bottom:1px solid #eff3f4}
.other .text{margin-top:2px}
</style>
<div id="react-root"><main role="main">
  <div class="top">${svg('back', '')}帖子</div>
  <section id="timeline">
    <div data-testid="cellInnerDiv"><article data-testid="tweet" class="post">
      <div class="row"><div class="avatar" style="background:#7c5cff">AL</div><div class="col"><span class="name">Alex Lee</span><span class="handle">@alexlee</span></div></div>
      <div class="text">Building in public, week 12: we just crossed 1,000 users 🎉<br>Thank you all for the feedback. Every single reply helped us ship a better product.</div>
      <div class="meta"><a href="/alexlee/status/1855000000000000123">10:27 AM · Nov 10, 2026</a> · <b>18.4K</b> Views</div>
      <div class="acts"><span>${svg('reply')}86</span><span>${svg('repost')}41</span><span>${svg('like')}512</span><span>${svg('views')}18K</span></div>
    </article></div>
    <div data-testid="cellInnerDiv"><div data-testid="inline_reply_offscreen" class="col reply"><div id="replying">回复 <span>@alexlee</span></div>
      <div class="row"><div class="avatar" style="background:#ff5a1f">你</div><div class="col" id="composer" style="flex:1"><div class="col" id="line">
        <div class="col" style="flex:1"><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0">${draft}</div></div>
        <div data-testid="toolBar"><nav>${['image', 'gif', 'emoji', 'pin', 'flag'].map(k => svg(k)).join('')}</nav><button type="button" data-testid="tweetButtonInline">回复</button></div>
      </div></div></div>
    </div></div>
    <div data-testid="cellInnerDiv"><article data-testid="tweet" class="other row"><div class="avatar" style="background:#00a37a">SK</div><div class="col"><div><span class="name">Sam Kim</span> <span class="handle">@samkim · 2h</span></div><div class="text">Huge milestone, congrats to the whole team!</div></div></article></div>
  </section>
</main></div><script>(${virtualList})();(${draftLike})('[data-testid="tweetTextarea_0"]');</script>`;

// X Chat renders inside an open shadow root; the composer is pinned to the bottom and grows upward.
function xChatApp(data) {
  const shadow = document.querySelector('[data-testid="xchatEmbedRoute"]').attachShadow({ mode: 'open' });
  const bubble = ([who, text]) => `<div class="msg ${who}"><div class="b">${text}</div></div>`;
  shadow.innerHTML = `<style>
  *{--accent:196 100% 80%;--muted:210 40% 96%;--border:214 32% 91%;--surface:0 0% 100%}
  .col{display:flex;flex-direction:column}.row{display:flex;flex-direction:row}
  .wrap{width:680px;height:720px;display:flex;flex-direction:column;border-left:1px solid #eff3f4;border-right:1px solid #eff3f4;font:15px/20px ${data.font};color:#0f1419;background:#fff}
  .head{height:64px;flex:0 0 64px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #eff3f4}
  .av{width:40px;height:40px;border-radius:50%;background:#7c5cff;color:#fff;display:grid;place-items:center;font-weight:700}
  .head small{display:block;color:#536471;font-size:13px}
  .msg{display:flex;margin:4px 0}.msg.me{justify-content:flex-end}
  .b{max-width:72%;padding:10px 14px;border-radius:20px;background:#eff3f4;font-size:15px;line-height:20px}
  .me .b{background:#1d9bf0;color:#fff}
  .day{text-align:center;color:#536471;font-size:13px;margin:8px 0 12px}
  .plus{width:40px;height:40px;border-radius:50%;background:#eff3f4;display:grid;place-items:center}
  .plus svg,.voice svg{width:20px;height:20px;fill:none;stroke:#0f1419;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  .pill{border-radius:24px;background:#eff3f4;padding:4px 6px 4px 18px}
  textarea{flex:1;border:0;background:transparent;resize:none;outline:none;font:16px/24px ${data.font};color:#0f1419;padding:8px 0;height:24px}
  .voice{width:36px;height:36px;border:0;border-radius:50%;background:#fff;display:grid;place-items:center;align-self:center}
  .voice.send{background:#d81b60}.voice.send svg{stroke:#fff;stroke-width:2.4}
  </style>
  <div class="wrap">
    <div class="head"><div class="av">AL</div><div><b>Alex Lee</b><small>@alexlee</small></div></div>
    <div data-testid="dm-conversation-content" class="col" style="position:relative;flex:1;min-height:0">
      <div data-testid="dm-message-scroller" id="scroller" style="height:100%;overflow-y:auto"><div style="padding:16px"><div class="day">今天</div>${data.messages.map(bubble).join('')}</div><div id="spacer"></div></div>
      <div data-testid="dm-composer-container" style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 16px;background:#fff"><div><div class="col" style="position:relative">
        <input type="file" data-testid="dm-composer-file-input" style="display:none">
        <div class="row"><div style="display:grid;grid-template-columns:52px 1fr;width:100%;align-items:end"><div class="plus">${data.plus}</div>
          <form data-testid="dm-composer-form" style="position:relative"><div data-testid="dm-composer-input-container" class="col pill"><div class="row">
            <textarea data-testid="dm-composer-textarea" rows="1" placeholder="开始新消息" aria-label="开始新消息">${data.draft}</textarea><button type="button" class="voice" data-testid="dm-composer-voice-button">${data.mic}</button>
          </div></div></form>
        </div></div>
      </div></div></div>
    </div>
  </div>`;
  const composer = shadow.querySelector('[data-testid="dm-composer-container"]'), spacer = shadow.querySelector('#spacer'), scroller = shadow.querySelector('#scroller');
  // Like X Chat, the voice button turns into a Send button once the box has text.
  const area = shadow.querySelector('textarea'), voice = shadow.querySelector('form button'), mic = voice.innerHTML;
  const sync = () => { voice.dataset.testid = area.value ? 'dm-composer-send-button' : 'dm-composer-voice-button'; voice.classList.toggle('send', !!area.value); voice.innerHTML = area.value ? data.send : mic; };
  area.addEventListener('input', sync); sync();
  new ResizeObserver(() => { spacer.style.height = `${composer.offsetHeight}px`; scroller.scrollTop = scroller.scrollHeight; }).observe(composer);
}
const chatPage = ({ draft, messages }) => `<style>html,body{height:100%}body{margin:0;background:#fff}#react-root{height:100%}main{width:680px;margin:0 auto}</style>
<div id="react-root"><main role="main"><div data-testid="xchatEmbedRoute"></div></main></div>
<script>(${xChatApp})(${JSON.stringify({ draft, messages, font: FONT, plus: svg('plus', ''), mic: svg('mic', ''), send: svg('send', '') })})</script>`;

module.exports = { replyPage, chatPage };
