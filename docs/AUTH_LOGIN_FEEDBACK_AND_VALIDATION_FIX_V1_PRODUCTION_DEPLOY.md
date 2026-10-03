# AUTH_LOGIN_FEEDBACK_AND_VALIDATION_FIX_V1_PRODUCTION_DEPLOY

日期：2026-10-04（Asia/Shanghai）。最终状态：**PRODUCTION_ACCEPTANCE_PASSED**，仅适用于本次登录反馈与校验前端发布。

## Production baseline and integration

发布前 fetch 确认 main 为 `7df5f7b56e70b8c40324bf2137cf93928ec6128b`，线上 deploymentCommit 与之相同，release 为 `auth-password-recovery-v1-20261003`，91 个资源。批准 Candidate `d21c88cb66fb280347c68f31e9b8da8608424a0e` 已包含当前生产基线，没有新增生产提交需要合并。

实现源码提交保持 `dc8107a9e216e0abfb33e7dba40ae12df4f7d1c5`。按照本次授权，从最终整合候选重新生成清单，新增 build commit：

`156d97b42c5bbaffd88d1c361979665d6707313a`

该提交只更新 manifest 的 sourceCommit，没有改变产品代码。它既是最终发布 Candidate，也是当前生产 main / 线上 deploymentCommit。

对发布前 production main 的源码差异检查确认：Supabase browser client、自动同步、Recovery 核心/UI、Orchestrator/task UI、Unified Freshness、navigation、Entry Decision、Discussion、Plan、Runtime、SQL/migrations 与行情文件均未改动。未混入原工作区的 Worker Shortcut 未完成修改、行情文件或 provider mismatch 调查代码。

## Release manifest and resources

| 字段 | 值 |
| --- | --- |
| assetVersion | `auth-login-feedback-v1-20261004` |
| sourceCommit | `d21c88cb66fb280347c68f31e9b8da8608424a0e` |
| deploymentCommit | `156d97b42c5bbaffd88d1c361979665d6707313a` |
| 发布资源 | 92，含 manifest 共 93 个 artifact 文件 |
| 发布前完整性 | 92/92 PASS |
| 线上完整性 | 92/92 PASS，hash 和 bytes 均匹配 |

保留全部原生产资源，包含新 auth feedback module、账户 UI、Supabase SDK/client、Recovery、导航、Entry Decision、Orchestrator 和 Unified Freshness。未重建或升级 SDK。

## Pre-deployment tests

全部在最终发布前重新运行，使用空的临时 LOCALAPPDATA 隔离既有 PC 配置；没有修改测试断言降低门禁。

| 门禁 | 结果 |
| --- | --- |
| 登录单元测试 | 23/23（包含在以下 82 项中） |
| Auth 定向组合 | 82/82 PASS |
| 登录浏览器专项 | 65/65 PASS |
| Recovery 浏览器 | 45/45 PASS |
| Session / 同步联合浏览器 | PASS |
| 全量 JS/SQL | 1213/1213 PASS，0 fail，0 skipped |
| Entry Clarity | 31/31 PASS，受保护测试未改动 |
| Production Release Gate | 207/207 PASS |
| 360 / 390 / 1280 | PASS |

日志位于 `test-results/auth-login-feedback/deploy-*.log`；资源预检为 `deploy-integrity.json`。CI 的 build job 再次运行生产门禁及 artifact 检查并通过。

## Push and Pages deployment

非强制推送 integration branch `codex/auth-login-feedback-and-validation-fix-v1` 成功；再次确认原 main 未变化后，非强制 fast-forward main：`7df5f7b… → 156d97b…`。

[Pages workflow 37140317555](https://github.com/flyinlemon-H/investment-workbench-mobile/actions/runs/37140317555)：build / deploy 均 success。北京时间 2026-10-04 01:23:20 创建，01:23:56 完成。

公开站点：[投资工作手册](https://flyinlemon-h.github.io/investment-workbench-mobile/)。北京时间 01:25:33 重新读取 manifest 并逐一下载 92 个资源，均与最终 Candidate 一致。最终只读核验 remote main 仍为 `156d97b…`。

部署后验收文档另行提交到 integration branch，不再次推动 production main 或触发文档专用生产发布。

## Online acceptance method and results

在线浏览器直接加载正式 GitHub Pages 页面/脚本，使用新建隔离上下文。仅 public configuration 和 Auth/RPC 响应由 harness 替换；Supabase 域名的所有请求都由 route handler 本地 fulfill/abort，不放行真实 Auth 请求。邮箱、凭据和 session 全部是合成测试值，不使用用户浏览器 profile。

| 线上检查 | 结果 |
| --- | --- |
| 登录完整专项 | 65/65 PASS |
| Recovery 隔离回归 | 45/45 PASS |
| 下载的生产模块运行原 Entry Clarity | 31/31 PASS |
| 下载的生产模块运行 Orchestrator / Technical Freshness | 11/11 PASS |
| 未登录账户页：邮箱/密码/登录/注册/忘记密码 | 360 / 390 / 1280 PASS |
| loading / 防重复提交 / 错误 / 成功 / forgot / recovery UI | 360 / 390 / 1280 PASS |
| 研究资料 → 技术面 → 更新行情入口 | 三视口 PASS；0 Auth 请求、0 创建任务 |

线上 Clarity harness 首次因测试夹具缺失而未能加载测试；补齐原有 fixtures 后，原 31 项完整通过，未修改产品代码或测试断言。

验收记录位于 `test-results/auth-login-feedback-online/`：`integrity.json`、`report.json`、`entry-clarity.log`、`market-freshness.log`、`entry-smoke.json` 和截图。Recovery 报告在 `test-results/auth-password-recovery-online/report.json`。已查看线上窄屏错误、loading 及成功截图。

## Login validation, signup and recovery rules

登录仅要求邮箱/密码非空；6、7 位密码均发出模拟 SDK 请求，不被前端长度检查阻止。空邮箱和空密码不提交。

注册仍至少 8 位；6 位注册零请求。Recovery 设置新密码仍至少 8 位，6 位新密码零 update 请求。线上模拟仅用于确认前端行为，不创建生产账户、不验证真实旧密码、不发送 recovery 邮件。

## Error mapping, feedback and accessibility

六类映射均通过线上模拟：invalid_credentials → “邮箱或密码不正确。”；email_unconfirmed → 邮箱确认提示；rate_limited → 稍后重试；network → 检查网络；service → 服务暂不可用；unknown → “登录未完成，请重试。”

反馈紧邻登录按钮，账户表单位于设备用途设置之前。360/390 失败后无需用户额外寻找；缩小可视高度的键盘遮挡模拟也通过。加载显示“登录中…”并禁止重复提交，失败后恢复按钮并清空密码。

保留 `aria-live`、`aria-describedby`、`aria-busy`；输入修改、重新提交、关闭/打开、成功和进入忘记密码时清理错误。迟到的失败响应不会恢复旧错误。

## Safe diagnostics and successful login state

仅内存保存 timestamp、固定 operation、白名单 code、数字 status、固定 category。不保留或输出原始 error、stack、payload、邮箱、密码、token、session 或 Authorization header；无新增 console dump、持久记录或遥测。线上模拟哨兵检测通过。

成功链路在线模拟通过：SDK storage → SIGNED_IN → signedIn=true → 登录表单隐藏 → 已登录/退出按钮可见；刷新恢复及直接 SDK 事件仍正确。SDK singleton、storage key 和成功监听链路未修改。

## Password Recovery / Entry Clarity / Market Data preservation

忘记密码入口、resetPasswordForEmail、PASSWORD_RECOVERY、query 处理和新密码 UI 保留；45 项隔离回归通过。没有继续真实邮件闭环。

Entry Clarity 线上下载资源 31/31；部署前和 CI 的生产门禁 207/207。原 Discussion / Plan / Runtime 被完整保留。

Orchestrator 入口三视口存在；Freshness 与 Orchestrator 原测试在发布资源上通过 11/11。未点击创建行情任务或 pairing，不启动 Worker、不运行 ProviderChain、不修改行情历史或 technical result。

## Production Auth and data protection

本任务 Production Auth 配置修改：**NO CHANGE**。没有执行 Supabase 配置写入、SQL、migration、Auth 用户管理或真实 Auth POST/PUT 请求；Site URL、Redirect URLs、SMTP、password policy、provider、confirmation、anonymous login、leaked password protection 均未由本任务改动。

真实 holding、Plan、orders、market history、technical result、Discussion state 未被本任务写入。合成标的和 session 仅存在于独立测试浏览器上下文，关闭后销毁。没有退出用户或要求用户重新登录。

## Known limitations and separate follow-ups

- 用户在部署前已确认真实手机可以成功登录；之前 Safari 失败底层原因仍 **UNKNOWN**。
- 自动化是 Chromium mobile viewport simulation，不是真实 iOS Safari / VoiceOver，也不是实际系统软键盘验收。
- 本任务的 PASS 不代表 Password Recovery 独立真实邮件最终验收已完成；其状态不变。
- Worker Shortcut 仍等待正式 pairing / 用户验收，本任务未修改其状态。
- Provider mismatch：**SEPARATE_FOLLOWUP**。没有调查、修复、放宽保护或强制 merge。

## Final status

**PRODUCTION_ACCEPTANCE_PASSED** — 仅本次 AUTH_LOGIN_FEEDBACK_AND_VALIDATION_FIX_V1_PRODUCTION_DEPLOY。

用户可自然继续使用现有登录状态，无需为本次发布退出或重新登录。如果以后真实 Safari 登录再次失败，应依据新版安全分类继续调查，不预设是密码或网络问题。
