# AUTH_PASSWORD_RECOVERY_V1_REMOTE_ACCEPTANCE

2026-10-03（Asia/Shanghai）阶段记录。任务进行中，等待用户完成 Supabase Dashboard 登录；尚未进入真实邮件阶段，不宣称 WAITING_FOR_USER_EMAIL_CONFIRMATION 或生产通过。

本轮无生产/测试 Auth 配置写入，无账户创建/修改，无邮件发送，无前端 push/deploy。原实现状态 AUTH_PASSWORD_RECOVERY_NEEDS_FIX 尚未提升。

## 1. Production Auth Baseline

`investment-workbench / fntslvdxnupmdljnadec`：MCP 确认 ACTIVE_HEALTHY，ap-southeast-1。

公开 `GET /auth/v1/settings` 返回 HTTP 200，以下字段采用显式投影读取，未读取任何 session 凭据：

| 字段 | 实际值 | 含义 |
| --- | --- | --- |
| external.email | true | 邮箱提供方启用 |
| disable_signup | false | 注册未关闭 |
| mailer_autoconfirm | false | 邮箱确认启用 |
| external.anonymous_users | false | 匿名用户登录关闭 |

完整 Auth 管理配置、SMTP 状态、密码要求与 recovery 邮件限制仍待 Dashboard 登录后核验。未读取 CLI token、password hash、access token 或 refresh token。

## 2. Test Auth Baseline

`investment-analysis-test-s01 / lblyapnsngqnjimgskkp`：MCP 确认 ACTIVE_HEALTHY，ap-southeast-1。上述四项公开 Auth 字段与生产相同。用户已指定可收信的独立测试邮箱；仓库报告不公开该私人邮箱地址。

仅对该邮箱进行 `auth.users` 的 email/created_at 投影查询，结果为空：本轮开始前尚无该测试账户。未读取密码字段或凭据。

## 3. Site URL

使用明确无效的测试字符串，向各项目 Auth verify 端点发起一次不带 redirect_to 的 GET，禁止自动跟随回跳；仅提取无凭据的 Location 目的地址及错误码。

| 项目 | 观察到的默认目的地 | HTTP / error |
| --- | --- | --- |
| Production | `https://flyinlemon-h.github.io/investment-workbench-mobile/` | 303 / otp_expired |
| Test | `http://localhost:3000/` | 303 / otp_expired |

这是远端默认回跳的实态证据；Dashboard 中的 Site URL 配置值仍需读屏核对。

## 4. Redirect URLs

各项目再发起一次带目标 redirect_to 的无效链接 GET；未使用、读取或消费任何真实 recovery token，未发邮件，未建立 session，未修改账户。

| 项目 | 请求目的地 | 实际目的地 | 结论 |
| --- | --- | --- | --- |
| Production | `https://flyinlemon-h.github.io/investment-workbench-mobile/?auth=recovery` | 与请求完全相同 | 已允许 |
| Test | `http://127.0.0.1:8899/?auth=recovery` | 与请求完全相同 | 已允许 |

两者均为 303 / otp_expired。生产与测试所需目的地已被远端行为确认覆盖，**无需重复新增 URL**。完整 Additional Redirect URLs 列表尚未取得；不推断具体是哪条 allowlist 覆盖。

依据：[Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) 与 [官方 Auth redirect 验证实现](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)。当前开源实现除 allowlist glob 外还处理 Site URL 同源与 loopback；具体托管版本可能不同，因此以本轮实际响应为目标匹配证据，不能只按字符串相等判断。

Auth 变更审计：Before/After 管理列表尚未读取；Change = NONE。未增加 wildcard，未改 Site URL 或任何其他策略。

## 5. Password Policy

最低长度、字符要求、secure password change、其他密码策略仍待读取。现有 UI 的 8 位最低检查与服务器错误提示待同真实配置核对，不宣称生产策略就是 8 位。

## 6. Real Email Result

NOT_RUN。独立测试邮箱已提供，但尚未创建账户或发送邮件。当前没有需要用户点击的测试邮件。SMTP/default provider、可用收件人范围和发送限制尚未核实。

## 7. Recovery Redirect Result

无效链接的远端回跳目标匹配 PASS；真实邮件内链接及实际点击回跳 NOT_RUN。两者不能等同。

生产公开根路径 `/?auth=recovery` GET HTTP 200，query 保留，未出现 Pages 404；线上仍为旧版本，不含 recovery 产品脚本。

## 8. PASSWORD_RECOVERY Result

真实远端 session 事件 NOT_RUN。原本地实际 SDK + 模拟 HTTP 测试通过的结论不替代这一项。

## 9. Password Update Result

真实隔离账户 updateUser NOT_RUN。未触碰生产真实账户密码。

## 10. New Password Login

NOT_RUN，仍是发布硬门禁。

## 11. Old Password Rejection

NOT_RUN，仍是发布硬门禁。

## 12. Refresh Result

真实恢复会话刷新、成功后刷新不再进入 recovery：NOT_RUN。

## 13. Old Link Result

真实已使用邮件再次点击：NOT_RUN。明确无效字符串的错误回跳验证通过，但不能代替旧真实邮件复用验证。

## 14. Account Enumeration

真实已注册/不存在邮箱请求比较：NOT_RUN。无高频限流探测、无自动发信循环；保留原有文案与限流自动测试证据。

## 15. Production Baseline Integration

- `git ls-remote` 与 `git fetch origin main` 确认最新 main：`9d02277fd271848116d5f3bd41c9c3303f921351`。
- `git merge-base --is-ancestor origin/main HEAD` 通过，Auth 分支包含最新 main。
- 本轮重新执行 production_baseline_regression：**207/207 PASS**。
- 线上 manifest：assetVersion `market-data-orchestrator-v1-integration-20261002`，sourceCommit `a9e044d05b6920007c8a1af101c56a56438e1ba2`，deploymentCommit `9d02277fd271848116d5f3bd41c9c3303f921351`，89 个资源。
- 本轮未修改产品代码；既有 JS/SQL 1190/1190、Auth 定向 59/59、Entry Clarity 31/31、三视口 45 项/21 图与新清单 91 个资源完整性结果，见前置报告。这些是已有精确实现版本的自动证据，发布前仍需按最终 Candidate 确认门禁。

## 16. Release Candidate

实现提交 `0fa4ac691e5d6d5d826960e43b1ec82afc211c99`；已有报告/清单提交 `47781a7920ef56b392c609ecfa90c3cf319c3a8f`。待发布版本 `auth-password-recovery-v1-20261003`。

最终 production release Candidate 尚未定版：真实邮件硬门禁未通过。当前阶段文档提交不代表发布批准或远端验收通过。

## 17. Production Publish

NOT_RUN。没有 push main、push 分支、触发 Pages 或部署 Auth 配置。

## 18. Production Online Acceptance

仅核实线上旧版本、发布 commit、Pages 根路径 query 和 Auth 错误回跳。新“忘记密码？”入口尚未生产发布。不得通知用户已可在生产恢复密码。

## 19. Test Account Cleanup

未创建测试账户、session、capability 或业务数据；当前无本轮远端测试资源需要清理。未启动 Worker。

## 20. Known Limitations

Chrome 工具报告请求头策略加载失败。应用内浏览器能打开 Supabase Dashboard，但进入登录页。尝试现有界面的“Continue with GitHub”被自动审批拒绝，理由是转到 GitHub 的 OAuth 登录未明确授权。未绕过拒绝，未读取凭据，已把可见登录页交给用户自行登录。

继续所需：用户在右侧完成 Supabase 登录，或提供两项目非敏感 URL/密码/邮件配置。之后核实配置 → 准备隔离测试应用和账户 → 真实 recovery 邮件及密码闭环 → 清理 → 完成最终 Candidate/发布门禁 → 授权范围内发布 → 线上验收。用户的真实密码仍由本人设置。

## 21. Final Status

尚无新的最终判定；任务暂停于 Dashboard 登录/完整配置核验，原状态 **AUTH_PASSWORD_RECOVERY_NEEDS_FIX** 保持，原因是未完成验收而非已确认的代码缺陷。

不标记 READY_FOR_PRODUCTION_DEPLOY 或 READY_FOR_USER_PASSWORD_RESET，也不将尚未发送的邮件写成 WAITING_FOR_USER_EMAIL_CONFIRMATION。用户登录后从当前步骤继续，保留已有授权和本轮证据。
