'use strict';
document.getElementById('settings').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(value => {
  if (!value?.ok) throw Error();
  const state = value.state;
  document.getElementById('status').textContent = state.connected ? (state.errorCode === 'OAUTH_REFRESH_RETRYING' ? '已连接 · 暂时连不上 xAI，会自动重试' : `已连接${state.model ? ` · ${state.model}` : ' · 请在设置中选择模型'}`) : state.state === 'awaiting_authorization' ? '等待官方授权，请返回设置继续' : '尚未连接 Grok';
  document.getElementById('settings').textContent = state.connected ? '打开连接设置' : '连接 Grok';
}).catch(() => { document.getElementById('status').textContent = '无法读取连接，请打开设置检查。'; });
