'use strict';
const $ = id => document.getElementById(id);
let busy = false, state = null, catalogSignature = '', authNotice = '';
const labels = { disconnected: '尚未连接', starting: '正在连接', awaiting_authorization: '等待授权', connected: '已连接', refreshing: '刷新登录中', reauth_required: '需要重新连接', error: '连接未完成' };
const authErrors = {
  OAUTH_AUTH_UNAVAILABLE: '暂时无法连接 xAI 授权服务，请检查网络后重试。',
  OAUTH_ACCESS_DENIED: '本次授权被拒绝，可重新连接。',
  OAUTH_DEVICE_EXPIRED: '短码已过期，请重新连接获取新短码。',
  OAUTH_DEVICE_INVALID: '官方授权响应无效，请重新连接。',
  OAUTH_REFRESH_UNCERTAIN: '登录刷新未能确认，请重新连接。',
  OAUTH_REFRESH_RETRYING: '暂时连不上 xAI，登录已保留，会自动重试；在 X 上点「译成英文」时也会马上重试。',
  OAUTH_LOGIN_REQUIRED: 'xAI 拒绝了登录续期（登录已过期或被撤销），请重新连接。',
  OAUTH_STORAGE_ERROR: '登录无法安全保存，请检查浏览器存储后重新连接。',
  OAUTH_CATALOG_UNAVAILABLE: '暂时无法加载模型，请点击“刷新模型列表”。'
};
function setNotice(value) { $('notice').textContent = value || ''; }
function clock(time) { const d = new Date(time), p = n => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
// Why the last automatic renewal failed, so a recurring sign-in problem can be told apart from a network one.
function failureText(f) {
  const reason = f.kind === 'network' ? '网络连不上 xAI' : f.kind === 'http' ? `xAI 返回 ${f.status || '错误'}${f.error ? ` ${f.error}` : ''}` : 'xAI 返回的凭据无效';
  const outcome = f.recoveredAt ? '已自动恢复' : f.retryAt ? `第 ${f.count || 1} 次，${clock(f.retryAt).slice(6)} 再试` : '需要重新连接';
  return `最近一次自动续期失败：${clock(f.at)} · ${reason} · ${outcome}`;
}
function render(next) {
  state = next;
  const pending = ['starting', 'awaiting_authorization'].includes(next.state);
  $('connection-status').textContent = labels[next.state] || '连接未完成';
  $('connection-status').classList.toggle('online', next.connected);
  $('connect').hidden = pending || next.connected; $('connect').disabled = busy;
  $('cancel').hidden = !pending; $('cancel').disabled = busy;
  $('logout').hidden = !next.connected; $('logout').disabled = busy;
  // While a change is pending, keep the box the user just ticked instead of redrawing the old state.
  if (!busy) { $('remember').checked = !!next.remember; $('chat').checked = next.chat === true; }
  $('remember').disabled = busy; $('chat').disabled = busy;
  $('chat-status').textContent = next.chat === true ? '已开启' : '已关闭'; $('chat-status').classList.toggle('online', next.chat === true);
  $('reload').disabled = busy || !next.connected;
  const device = next.device;
  $('device').hidden = !device || next.state !== 'awaiting_authorization';
  if (device && next.state === 'awaiting_authorization') {
    let valid = false;
    try { const url = new URL(device.verificationUriComplete); valid = ['https://auth.x.ai', 'https://accounts.x.ai'].includes(url.origin) && /^\/oauth2\/device\/?$/.test(url.pathname) && !url.username && !url.password && url.searchParams.get('user_code') === device.userCode; } catch { /* No unvalidated link. */ }
    $('authorize').hidden = !valid;
    $('authorize').href = valid ? device.verificationUriComplete : '#';
    $('user-code').textContent = typeof device.userCode === 'string' ? device.userCode : '';
    $('expiry').textContent = `短码剩余约 ${Math.max(0, Math.ceil((device.expiresAt - Date.now()) / 1000))} 秒`;
  }
  const models = Array.isArray(next.catalogModels) ? next.catalogModels : [];
  const signature = JSON.stringify([models, next.connected]);
  if (signature !== catalogSignature) {
    catalogSignature = signature;
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = next.connected ? '请选择可用模型' : '请先连接 Grok';
    $('model').replaceChildren(placeholder);
    const recommended = GrokInputCore.recommendedModels(models);
    for (const model of models) { const option = document.createElement('option'); option.value = model; option.textContent = recommended.includes(model) ? `${model} · 推荐` : model; $('model').append(option); }
  }
  $('model').value = next.model || ''; $('model').disabled = busy || !next.connected || models.length === 0;
  $('model-hint').textContent = !next.connected ? '连接后加载账号可用的模型，不会自动发送翻译请求。' : !next.model ? '请选择账号可用的模型后再翻译。不会自动改用其他模型。' : '仅点击评论框中的翻译按钮时使用所选模型。';
  const failure = next.refreshFailure, recent = failure && !(failure.recoveredAt && Date.now() - failure.recoveredAt > 86400000);
  $('refresh-note').hidden = !recent; $('refresh-note').textContent = recent ? failureText(failure) : '';
  const message = next.errorCode || next.catalogErrorCode ? authErrors[next.errorCode || next.catalogErrorCode] || '需要重新连接 Grok，请核对账号资格及授权状态。' : '';
  // Clear a connection notice once its cause is gone, but never a message from the user's last action.
  if (message) { setNotice(message); authNotice = message; } else if (authNotice && $('notice').textContent === authNotice) { setNotice(''); authNotice = ''; }
}
async function refresh() {
  if (busy) return;
  try { const value = await chrome.runtime.sendMessage({ type: 'GET_STATE' }); if (value.ok) render(value.state); else setNotice(value.error?.message || '无法读取连接状态。'); }
  catch { setNotice('扩展连接已中断，请重新加载此设置页。'); }
}
async function perform(message) {
  if (busy) return;
  busy = true; setNotice(''); if (state) render(state);
  try {
    const value = await chrome.runtime.sendMessage(message);
    if (!value?.ok) throw value?.error || Error('连接未完成');
    busy = false; if (value.state) render(value.state);
  } catch (error) { busy = false; setNotice(GrokInputCore.safeError(error).message); if (state) render(state); }
}
$('connect').addEventListener('click', () => void perform({ type: 'LOGIN', remember: $('remember').checked }));
$('cancel').addEventListener('click', () => void perform({ type: 'CANCEL_LOGIN' }));
$('logout').addEventListener('click', () => void perform({ type: 'LOGOUT' }));
$('remember').addEventListener('change', () => void perform({ type: 'SET_REMEMBER', remember: $('remember').checked }));
$('chat').addEventListener('change', () => void perform({ type: 'SET_CHAT', enabled: $('chat').checked }));
$('model').addEventListener('change', () => { if ($('model').value) void perform({ type: 'SELECT_MODEL', model: $('model').value }); });
$('reload').addEventListener('click', () => void perform({ type: 'RELOAD_MODELS' }));
$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('user-code').textContent); $('copy-code').textContent = '已复制'; }
  catch { setNotice('未能复制，请手动选择短码复制。'); }
});
chrome.runtime.onMessage.addListener((message, sender) => { if (sender?.id === chrome.runtime.id && message?.type === 'STATE_CHANGED') void refresh(); });
setInterval(() => { if (!document.hidden) void refresh(); }, 1000);
void refresh();
