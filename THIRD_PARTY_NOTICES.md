# 第三方来源

本项目的 Grok OAuth 设备码流程和本机加密存储来自 [SuperX](https://github.com/bwjoke/SuperX)，Copyright (c) 2026 SuperX contributors，MIT 许可。

于 2026-10-27 获取的文件（LF 行尾）：

| 本项目路径 | 上游路径 | 获取时的 SHA-256 | 当前 SHA-256 |
| --- | --- | --- | --- |
| extension/vendor/oauth-provider.js | extension/oauth-provider.js | b7077b4f7bbf349b7f758bef80cfe682e95c932e6d660a0d1ce0ddbe55320e65 | ae1e99279bca5bd873be85c53c7bd24f431483cda193a02895e19cb03ef6924b（2026-11-10 修改，见下） |
| extension/vendor/key-store.js | extension/key-store.js | eea24431e3855accd1c92d48b81dd0a0d7fc04d20c889fff404b44b4497fb491 | 同左，未修改 |

2026-11-10 对 `oauth-provider.js` 的修改（上游截至 2026-10-30 的 1.1.6 版仍是原来的做法）：

- 续期登录时如果连不上 xAI（断网、超时）或 xAI 返回临时错误（5xx、408、429、`temporarily_unavailable`、`server_error`），不再删除保存的登录，而是保留登录，按 30 秒、1 分钟、2 分钟、5 分钟、之后每 15 分钟重试，翻译请求也会立即重试。只有 xAI 明确拒绝（`invalid_grant`、`access_denied` 等 4xx）或返回格式错误的凭据时才要求重新登录。
- 续期进行中浏览器关闭或扩展进程被终止，下次启动时用保存的凭据继续续期，不再要求重新登录；仅本次会话登录时，会话存储里的续期记录保留刷新凭据。
- 记录最近一次续期失败的类型（网络或 HTTP 状态码和 OAuth 错误码、次数、时间，不含凭据），保存在 `superxOAuthRefreshFailure`，显示在设置页。

原因：上游把任何没有确认的续期都当成凭据可能已被消耗、立即要求重新登录。实际使用中，电脑休眠或浏览器启动后网络还没连上，第一次续期失败就会丢掉登录，导致几乎每天都要重新授权。用同一个刷新凭据重试，最坏的情况是 xAI 明确拒绝，结果和原来一样是重新登录。

对应许可证保存在 `extension/vendor/LICENSE-SuperX.txt`，随安装包分发。`tests/oauth-provider.test.js` 和 `tests/key-store.test.js` 同样来自 SuperX，调整了被测模块路径；`oauth-provider.test.js` 里关于续期失败和中断的测试按上面的修改改写，并新增了断网重试的测试。上游测试中的产品名称、其他加密用途及历史情境属于其原有回归覆盖，不代表本插件提供那些功能。

OAuth 共享客户端的授权页可能显示 Grok Build，本插件不声称拥有该客户端身份或与 xAI 官方合作。

开发工具 Playwright 和 fflate 仅用于测试及打包，不在扩展运行时加载。
