# AUTH_LOGIN_FEEDBACK_AND_VALIDATION_FIX_V1

日期：2026-10-04（Asia/Shanghai）。本次登录反馈修复状态：**PRODUCTION_ACCEPTANCE_PASSED**。

第 1–15 节保留实现阶段记录。随后经单独授权完成生产发布及隔离线上验收，详见 [生产发布报告](AUTH_LOGIN_FEEDBACK_AND_VALIDATION_FIX_V1_PRODUCTION_DEPLOY.md)。没有修改 Supabase Auth 设置、数据库、Worker 或真实业务数据。

## 1. Confirmed Issues

- 原登录页将所有异常替换为同一笼统提示，无法区分凭据、邮箱确认、限流、网络、服务或客户端异常。
- 360 / 390 视口中，提示位于弹窗可视区域下方。
- 登录与注册共用至少 8 位的密码检查，错误阻止合法的 6–7 位历史凭据进入 SDK。
- 真实 Safari 在 2026-10-04 00:33 左右进入了统一异常分支；底层原因仍是 UNKNOWN。本任务不把它归因为网络或密码错误。

## 2. Login Validation Before

`src/universe-sync-ui.js` 原登录/注册共享 `!email || password.length < 8` 分支，密码输入框也带有 `minlength="8"`。

## 3. Login Validation After

新 `src/auth-login-feedback.js` 只检查邮箱去除首尾空白后非空、密码非空。密码不 trim、不转换、不套用创建密码规则。登录控件去掉 minlength；真实 SDK 继续负责验证凭据。

空邮箱提示“请输入邮箱。”，空密码提示“请输入密码。”，不发请求。6、7 位密码均通过真实 SDK + 模拟 Auth 的按钮登录测试。

## 4. Error Mapping

| 分类 | 白名单依据 | 用户文案 |
| --- | --- | --- |
| invalid_credentials | `invalid_credentials` | 邮箱或密码不正确。 |
| email_unconfirmed | `email_not_confirmed` | 该账户的邮箱尚未完成确认，请先完成邮箱确认。 |
| rate_limited | HTTP 429 / `over_request_rate_limit` / `over_email_send_rate_limit` | 尝试次数过多，请稍后再试。 |
| service | HTTP 5xx / `unexpected_failure` | 登录服务暂时不可用，请稍后再试。 |
| network | status 0 / 408、`request_timeout`、稳定网络异常名称；TypeError 仅匹配固定 fetch 失败文案 | 无法连接登录服务，请检查网络后重试。 |
| unknown | 其余客户端、session 或未识别异常 | 登录未完成，请重试。 |

5xx 优先于 `AuthRetryableFetchError` 名称判断，因此 SDK 包装后的服务错误不会误标为网络错误。普通 TypeError 不一概归为网络错误。未知 code 不直接显示或保存；不输出邮箱存在/不存在、原始 message、response body 或 stack。

映射核对了 [Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes) 和本仓锁定的 `@supabase/supabase-js 2.114.0`。浏览器夹具保留官方 API version 响应头及跨域 expose header，保证真实 SDK 能读取稳定错误码。依赖未升级。

## 5. Mobile Feedback Placement

账户表单位于设备用途 fieldset 前面，顺序为邮箱、密码、登录、登录反馈、忘记密码/注册、注册说明。`#universeLoginFeedback` 紧邻登录按钮。

布局首先保证窄屏反馈位置；反馈变化时辅以 `scrollIntoView({block:'nearest'})`，仅在账户弹窗显示时执行。加载时按钮文字为“登录中…”，禁用登录、注册和凭据输入，阻止重复提交。请求结束恢复控件。失败继续清空密码，错误原因同时可见。

输入修改、下一次提交、成功、忘记密码、关闭及重新打开弹窗均清理旧错误。revision 检查防止已关闭/重开的弹窗被迟到的失败响应写回旧错误。

## 6. Accessibility

反馈采用 `role="status"`、`aria-live="polite"`、`aria-atomic="true"`；邮箱/密码通过 `aria-describedby` 关联反馈，加载按钮设置 `aria-busy="true"`。播报内容仅为固定安全文案。反馈不强行夺取焦点。

## 7. Safe Logging

没有新增 console dump、远端遥测、调试 token 面板、session viewer、URL payload 或持久化记录。

`AuthLoginFeedback.getDiagnostic()` 仅返回本页内存中的最后一次安全诊断副本：`timestamp`、固定 `operation=sign_in`、白名单 `code`（否则 null）、数字 `status`（否则 null）和六选一 `category`。不保留 error 对象；不记录邮箱、密码、token、session、Authorization header 或原始响应。清理反馈时同时清理诊断。

单元测试使用带敏感哨兵字段的错误对象验证字段和值白名单；浏览器测试确认页面和诊断不暴露原始错误，console 不含模拟邮箱/密码/token 哨兵。

## 8. Success State

`src/supabase-browser-client.js` 和 `src/universe-auto-add.js` 与生产 Candidate 字节内容保持不变。保留唯一 client、原 storage key、`SIGNED_IN` 监听和队列状态刷新。

真实 SDK + 模拟响应验证：请求成功 → SDK storage → SIGNED_IN → signedIn → 隐藏登录字段 → 明确显示“已登录”及“退出此设备登录”。刷新恢复、直接 SDK SIGNED_IN、sign-out、共享 client 和同步回归通过。

## 9. Recovery Regression

`src/auth-password-recovery.js`、`src/auth-password-recovery-ui.js` 未修改。新密码仍至少 8 位。6 位新密码拒绝且零 update 请求；正常登录失败不打开 recovery；PASSWORD_RECOVERY 能正常打开设置新密码界面。原恢复浏览器 45 项全部通过，包含链接状态、过期、session、重复提交和注册登录退出。

## 10. Signup Regression

保留原邮箱非空且密码至少 8 位的注册校验。6 位注册拒绝、零 signup 请求；符合原要求的注册仍提示邮件确认。没有新增确认邮件重发功能、发送真实邮件或创建账户。

## 11. Mobile Viewports

360 / 390 / 1280 全通过。环境为 **Chromium mobile viewport simulation**，不是实际 iOS Safari，也未运行 WebKit。

360 / 390 额外将可视高度缩到 460，模拟软键盘挤压可视区域；这不等价于真实系统软键盘。断言错误反馈处于弹窗与视口交集内，无需用户手动滚动。

登录专项产生 35 张截图，位于 `test-results/auth-login-feedback/`：每个宽度均覆盖 A-login、B-loading、C-invalid、D-network、E-unconfirmed、F-success、G-forgot、H-recovery；另有 rate / service / unknown 和两张 keyboard-feedback。已人工查看窄屏错误、成功和缩小可视区域截图。

## 12. Automated Tests

| 检查 | 结果 |
| --- | --- |
| 新登录反馈单元测试 | 23 / 23 PASS |
| Auth 定向组合：登录、Recovery、integration hardening、自动同步 | 82 / 82 PASS |
| 新登录浏览器专项，覆盖用户 CASE 1–22 | 65 / 65 PASS |
| 原 Password Recovery 浏览器 | 45 / 45 PASS |
| 原 shared session / sync 浏览器 | PASS，one client / one subscription / restore / refresh / signout / concurrent modules / reload |
| 全量 JS / SQL | 1213 / 1213 PASS，0 fail，0 skipped |

浏览器测试使用真实打包 SDK 和隔离 HTTP 响应，外部请求被拦截；不使用生产凭据、不访问邮箱。

首次全量运行有 1 个既有 `universe_handoff_e2e` 测试被本机已配置的 PC 只读环境影响，测试夹具之外的清单使断言数量不符。随后仅将测试进程 `LOCALAPPDATA` 指向空的临时目录，重新完整运行 1213 项全部通过；未修改 Worker、行情脚本或相关测试断言。既有 preflight 所需邻接源码使用临时 Junction，结束后仅移除核验过的链接本身。

日志：`test-results/auth-login-feedback/full-js-sql-isolated.log`、`production-gate.log`、`entry-clarity.log`、`browser.log`、`recovery-browser.log`。截图/测试结果均为忽略的本地产物，不进入发布包。

## 13. Production Baseline Regression

- 只读确认远端 main 为 `7df5f7b56e70b8c40324bf2137cf93928ec6128b`。
- 修复分支 `codex/auth-login-feedback-and-validation-fix-v1` 包含该 Candidate 和此前仅记录发布结果的文档提交 `e56766fd3a8768e4bcbdaad11859cc7b1d97f2df`。
- 本任务源码提交：`dc8107a9e216e0abfb33e7dba40ae12df4f7d1c5`。
- Entry Decision Clarity：**31 / 31 PASS**；原受保护测试未修改。
- Production Release Gate：**207 / 207 PASS**。
- Orchestrator、Freshness、Discussion、Plan、Entry Decision、Recovery 核心、Auth client、自动同步、migrations 均未修改。
- 新 release：`auth-login-feedback-v1-20261004`；manifest sourceCommit 为上述源码提交；**92 / 92 资源完整性 PASS**，加 manifest 为 93 个 artifact 文件。
- 新模块通过 HTML 版本化 script 和发布清单显式包含，旧功能的 cache version 同步更新。`prepare_pages_artifact.artifactPlan` 验证源码哈希、脚本依赖、版本号和凭据扫描。

本任务修改：`src/auth-login-feedback.js`、`src/universe-sync-ui.js`、`index.html`、manifest generator / manifest、两份新增登录测试、原 release cache-version 断言和本文件。原工作区两份未提交行情文件未改动、未混入提交。

## 14. Known Unknowns

真实 Safari 失败底层类别仍 UNKNOWN。当前修复确保下一次失败有可操作的安全分类，不能保证登录凭据或手机网络本身正常。真实手机 cache、console/network、键盘、VoiceOver 尚未现场验证；未宣称生产验收通过。

## 15. Safari Acceptance Plan

仅在后续单独授权生产发布后，由用户本人在正式手机 Safari：更多 → 工具 → 账户 → 账户与同步设置 → 输入自己的凭据 → 登录。

用户不向 Codex 提供密码、token、session 或恢复链接。观察“登录中…”；若失败，仅记录安全文案/分类和时间，按类别继续调查。若成功，确认登录字段消失、“已登录”及退出按钮出现，并验证保持登录。Worker pairing 等留给后续任务，不在本次修改范围。

## 16. Final Status

实现阶段完成时为 **READY_FOR_PRODUCTION_DEPLOY**。单独授权生产发布后，本登录反馈任务现为 **PRODUCTION_ACCEPTANCE_PASSED**。

最终生产提交 `156d97b42c5bbaffd88d1c361979665d6707313a`；release `auth-login-feedback-v1-20261004`；重新生成的 manifest sourceCommit `d21c88cb66fb280347c68f31e9b8da8608424a0e`。Pages workflow `37140317555` 成功，线上 92/92 资源、登录 65/65、Recovery 隔离回归 45/45、Entry Clarity 31/31、Orchestrator/Freshness 11/11 及三个视口入口检查通过。

用户在部署前已经确认手机可正常登录；本任务未退出用户、要求重新登录或操作真实凭据。线上浏览器验收采用全新上下文和完全拦截的模拟 Auth 响应；不代表真实 iOS Safari 再次验收。Password Recovery 的独立真实邮件最终验收仍未完成，不将该任务标记为通过。Worker Shortcut pairing 和 provider mismatch 留给独立后续任务。
