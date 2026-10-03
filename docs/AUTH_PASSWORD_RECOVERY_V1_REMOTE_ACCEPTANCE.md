# AUTH_PASSWORD_RECOVERY_V1_REMOTE_ACCEPTANCE

2026-10-03（Asia/Shanghai）阶段记录。用户已明确调整最终验收策略：取消“独立隔离邮箱真实 recovery 闭环先于发布”的硬门禁；允许其他自动、redirect、安全和生产基线门禁通过后先发布，再由用户本人对现有生产账户执行手机恢复。发布后必须停在 **WAITING_FOR_USER_PASSWORD_RECOVERY**；真实用户操作及后续验收完成前不得标记 PRODUCTION_ACCEPTANCE_PASSED。

**当前状态：WAITING_FOR_USER_PASSWORD_RECOVERY。** Candidate 已发布、静态资源及线上入口验收通过；真实用户尚未执行邮件恢复，因此不是 PRODUCTION_ACCEPTANCE_PASSED。本阶段无生产/测试 Auth 配置写入、无账户创建/修改、无代理发信。不得读取、生成、记录或代替用户输入新密码；不新增 Team 成员、不配置 Custom SMTP、不修改其他 Auth 设置。

## 1. Production Auth Baseline

`investment-workbench / fntslvdxnupmdljnadec`：MCP 确认 ACTIVE_HEALTHY，ap-southeast-1。

公开 `GET /auth/v1/settings` 返回 HTTP 200，以下字段采用显式投影读取，未读取任何 session 凭据：

| 字段 | 实际值 | 含义 |
| --- | --- | --- |
| external.email | true | 邮箱提供方启用 |
| disable_signup | false | 注册未关闭 |
| mailer_autoconfirm | false | 邮箱确认启用 |
| external.anonymous_users | false | 匿名用户登录关闭 |

用户人工核验：默认 Supabase 邮件服务，自定义 SMTP 未配置，发送限制 2 emails/hour；密码最小长度 6，无额外字符复杂度；Prevent leaked passwords 关闭。Email provider、Confirm email、Anonymous sign-in 与上述远端公开设置一致。未读取 CLI token、password hash、access token 或 refresh token。未核实的其他策略（例如 secure password change）不自行推断。

## 2. Test Auth Baseline

`investment-analysis-test-s01 / lblyapnsngqnjimgskkp`：MCP 确认 ACTIVE_HEALTHY，ap-southeast-1。上述四项公开 Auth 字段与生产相同。用户已指定可收信的独立测试邮箱；仓库报告不公开该私人邮箱地址。

仅对该邮箱进行 `auth.users` 的 email/created_at 投影查询，结果为空：本轮开始前尚无该测试账户。未读取密码字段或凭据。

用户人工核验：默认 Supabase 邮件服务、自定义 SMTP 未配置、2 emails/hour；密码最小长度 6，无额外字符复杂度；Email OTP expiration 3600 seconds，Email OTP length 8 digits。

## 3. Site URL

使用明确无效的测试字符串，向各项目 Auth verify 端点发起一次不带 redirect_to 的 GET，禁止自动跟随回跳；仅提取无凭据的 Location 目的地址及错误码。

| 项目 | 观察到的默认目的地 | HTTP / error |
| --- | --- | --- |
| Production | `https://flyinlemon-h.github.io/investment-workbench-mobile/` | 303 / otp_expired |
| Test | `http://localhost:3000/` | 303 / otp_expired |

用户人工核验的 Site URL：生产为上表生产地址；测试为 `http://localhost:3000`。与默认回跳结果一致（测试响应补上末尾 `/`）。证据来源分别为用户 Dashboard 核验与 agent 实际 HTTP 响应，并未把人工记录写成 agent 读屏结果。

## 4. Redirect URLs

各项目再发起一次带目标 redirect_to 的无效链接 GET；未使用、读取或消费任何真实 recovery token，未发邮件，未建立 session，未修改账户。

| 项目 | 请求目的地 | 实际目的地 | 结论 |
| --- | --- | --- | --- |
| Production | `https://flyinlemon-h.github.io/investment-workbench-mobile/?auth=recovery` | 与请求完全相同 | 已允许 |
| Test | `http://127.0.0.1:8899/?auth=recovery` | 与请求完全相同 | 已允许 |

两者均为 303 / otp_expired。生产与测试所需目的地已被远端行为确认覆盖，**无需新增 URL**。

用户确认的完整 Additional Redirect URLs：

- Production：`https://flyinlemon-h.github.io/investment-workbench-mobile/`；`http://127.0.0.1:8768/`。
- Test：空列表（No Redirect URLs）。

生产 `?auth=recovery` 的覆盖来自 Site URL 同源规则；不能把根路径 allowlist 条目当作任意 query 的通配符。测试 `http://127.0.0.1:8899/?auth=recovery` 在空允许列表下仍被实际接受，与官方 loopback 特例一致。因此测试邮件闭环使用这一精确目标即可，不为它添加冗余配置，不新增 wildcard。该地址供当前 PC 上的浏览器使用，手机 localhost 不能访问 PC。

依据：[Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) 与 [官方 Auth redirect 验证实现](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)。当前开源实现除 allowlist glob 外还处理 Site URL 同源与 loopback；具体托管版本可能不同，因此以本轮实际响应为目标匹配证据，不能只按字符串相等判断。

Auth 变更审计：Before 为上述用户确认列表；Change = NONE；After 与 Before 相同（未执行写操作）。未改 Site URL、password policy、provider、email confirmation、anonymous login、leaked password protection、SMTP 或其他 Auth 设置。

## 5. Password Policy

两项目密码最小长度均为 6，无额外字符复杂度要求，来源为用户 Dashboard 人工核验。产品的 8 位最低输入检查沿用原账户 UI，比服务端最低长度更严格，能够满足已核实要求；“至少 8 位”是当前应用的输入要求，不是 Supabase 配置值。服务端错误继续由固定中文提示处理。未降低/修改任何密码策略，也未增加新的复杂度策略。

## 6. Real Email Result

NOT_RUN。独立测试邮箱已提供，但用户确认它**不是现有组织 Team 成员邮箱**。根据 [Supabase 默认 SMTP 官方限制](https://supabase.com/docs/guides/auth/auth-smtp)，未配置自定义 SMTP 时，只会向现有团队成员邮箱发送 Auth 邮件，其他地址被拒绝。应用 Auth 用户与组织 Team 成员是不同概念。

旧策略阶段因该限制停在发送前，未创建 Auth 测试账户、未扩大团队权限、未配置 SMTP。用户随后明确取消独立邮箱前置硬门禁，改由发布后的生产真实账户本人操作。本轮代理真实邮件发送数 **0**；截至交付，用户尚未请求邮件，不宣称邮件送达。

当前计划无需注册测试账户。用户在手机点击一次发送 recovery 邮件即可开始验收；项目默认限制为 2 emails/hour，还可能被该项目前一小时其他邮件占用。无重复发送、无自动重试、无限流压力测试；不保证额度只被本任务使用。

## 7. Recovery Redirect Result

无效链接的远端回跳目标匹配 PASS；真实邮件内链接及实际点击回跳 NOT_RUN。两者不能等同。

生产公开根路径 `/?auth=recovery` GET HTTP 200，query 保留，未出现 Pages 404；发布后两个 recovery 产品脚本均已上线并通过 hash 校验。真实邮件 callback/session 尚待用户操作。

## 8. PASSWORD_RECOVERY Result

真实远端 session 事件 NOT_RUN，等待用户本人手机操作。实际 SDK + 模拟 HTTP 的自动测试不替代这一项。

## 9. Password Update Result

真实隔离账户 updateUser NOT_RUN。未触碰生产真实账户密码。

## 10. New Password Login

NOT_RUN。按用户修订策略改为发布后由用户本人执行，尚无真实登录验收结论。

## 11. Old Password Rejection

NOT_RUN。Codex 不读取旧/新密码，也不代用户尝试；不能用自动测试结果宣称真实旧密码已失效。用户修订后的后续验收明确包含 session、正常登录、recovery UI 退出与旧 recovery link 行为。

## 12. Refresh Result

真实恢复会话刷新、成功后刷新不再进入 recovery：NOT_RUN。

## 13. Old Link Result

真实已使用邮件再次点击：NOT_RUN。明确无效字符串的错误回跳验证通过，但不能代替旧真实邮件复用验证。

## 14. Account Enumeration

真实已注册/不存在邮箱请求比较：NOT_RUN。无高频限流探测、无自动发信循环；保留原有文案与限流自动测试证据。

## 15. Production Baseline Integration

- `git ls-remote` 与 `git fetch origin main` 确认最新 main：`9d02277fd271848116d5f3bd41c9c3303f921351`。
- `git merge-base --is-ancestor origin/main HEAD` 通过，Auth 分支包含最新 main。
- 按新策略再次执行 production_baseline_regression：**207/207 PASS**。
- 线上 manifest：assetVersion `market-data-orchestrator-v1-integration-20261002`，sourceCommit `a9e044d05b6920007c8a1af101c56a56438e1ba2`，deploymentCommit `9d02277fd271848116d5f3bd41c9c3303f921351`，89 个资源。
- 本轮未修改产品代码；按新策略重新运行 JS/SQL **1190/1190**、Auth 定向 **59/59**、Entry Clarity **31/31**、三视口 **45 项/21 图**、原 Auth/同步浏览器回归，全部 PASS。浏览器 Auth HTTP 为模拟，不发真实邮件。原业务产品文件与 production main 无差异。

## 16. Release Candidate

实现提交 `0fa4ac691e5d6d5d826960e43b1ec82afc211c99`；已有报告/清单提交 `47781a7920ef56b392c609ecfa90c3cf319c3a8f`。待发布版本 `auth-password-recovery-v1-20261003`。

最终 Production Candidate：`7df5f7b56e70b8c40324bf2137cf93928ec6128b`。

重新生成的 manifest sourceCommit：`67ff5c3bb7ea213d9f878a613f6bb7456c81f0be`。assetVersion：`auth-password-recovery-v1-20261003`。包含原 production main `9d02277fd271848116d5f3bd41c9c3303f921351`，通过非强制 fast-forward 发布；无产品代码新改动，仅策略文档和发布清单更新。91 个资源，含 manifest 共 92 个 artifact 文件。

## 17. Production Publish

PASS。先推送 `codex/auth-password-recovery-v1`，再将 main 从 `9d02277…` 非强制快进至 `7df5f7b…`。两步均成功。

[Pages workflow 37135438868](https://github.com/flyinlemon-H/investment-workbench-mobile/actions/runs/37135438868) conclusion = success；build 与 deploy 均成功。工作流开始 `2026-10-03T16:03:18Z`，完成状态时间 `2026-10-03T16:04:09Z`（UTC）。CI 内生产基线门禁及资源校验通过。

未改 Supabase 配置或业务数据库。部署后审计文档提交不等同于线上 deploymentCommit；线上版本以本节 Candidate 和 manifest 为准。

## 18. Production Online Acceptance

线上版本、manifest sourceCommit、deploymentCommit 与 Candidate 完全一致。`2026-10-03T16:05:27.838Z`（UTC）逐一 GET 并校验所有发布资源：**91/91 PASS**，无 hash/长度不匹配。

使用下载并重新校验的生产资源运行原 Entry Clarity 测试：**31/31 PASS**；合成 fixture 不含真实投资数据。门禁确认 preserved Entry Clarity、Discussion/Plan/Runtime、Orchestrator、Unified Freshness 产品文件没有发生回退。

在生产应用实际点击：更多 → 工具 → 账户 → 账户与同步设置 → 忘记密码？。入口可见，打开“找回密码”表单，邮箱为空，发送按钮可用；未点击发送，未尝试登录/注册/密码更新。

线上入口/找回密码三视口：

| viewport | modal left/right | clientWidth / scrollWidth | 结果 |
| --- | --- | --- | --- |
| 360 | 10 / 335 | 323 / 323 | PASS，无横向溢出 |
| 390 | 10 / 365 | 353 / 353 | PASS，无横向溢出 |
| 1280 | 420 / 860 | 438 / 438 | PASS，无横向溢出 |

三视口的邮件已发送、设置密码、成功/失败等完整状态仍属于发布前模拟 HTTP 验收；本轮没有用生产真实密码或伪造真实会话重做这些状态。浏览器视口已恢复；生产应用页保留供用户继续，代理停止凭据相关操作。

## 19. Test Account Cleanup

未创建测试账户、session、capability 或业务数据；当前无本轮远端测试资源需要清理。未启动 Worker。

## 20. Known Limitations

Chrome 工具报告请求头策略加载失败。应用内浏览器能打开 Supabase Dashboard，但进入登录页。尝试现有界面的“Continue with GitHub”被自动审批拒绝，理由是转到 GitHub 的 OAuth 登录未明确授权。未绕过拒绝，未读取凭据，已把可见登录页交给用户自行登录。

原 Dashboard 读取阻塞已通过用户人工提供配置消除，无须继续 GitHub OAuth 操作。独立邮箱不具备默认服务收件资格的事实保持；用户已明确取消它作为前置发布硬门禁。不得为此新增组织成员或配置 Custom SMTP，也无需继续寻找其他测试邮箱。

按修订策略，自动、redirect、安全与生产基线门禁通过后可以先发布 Candidate。生产真实账户邮箱已由用户确认是现有组织 Team 成员，符合默认邮件服务的收件人资格；尚无真实送达证据，仍受 2 emails/hour 及服务可用性限制。

发布后由用户本人在手机端点击“忘记密码？”、请求生产账户的真实 recovery 邮件、打开邮件并自行输入新密码。Codex 不主动发信、不读取/生成/记录/代输新密码。用户完成后，再继续核验 session、正常登录、恢复 UI 退出及旧邮件链接行为；不得要求用户发送密码或完整 recovery URL。

## 21. Final Status

**WAITING_FOR_USER_PASSWORD_RECOVERY**。

独立邮箱的前置门禁已由用户明确取消，其他发布门禁通过，前端已成功发布并完成上述线上安全验收。不是 PRODUCTION_ACCEPTANCE_PASSED。

此时真实邮件、改密、新密码登录及旧链接行为仍未验收，不标记 PRODUCTION_ACCEPTANCE_PASSED。仅在用户本人完成操作、后续验证通过后更新最终 Production Acceptance。

用户下一步：手机打开正式应用，更多 → 工具 → 账户 → 账户与同步设置 → 忘记密码？ → 输入已确认具有 Team 收件资格的现有生产账户邮箱 → 发送一次 → 自行收取并打开 recovery 邮件 → 自行输入及确认新密码。成功后只回复“已恢复”，不要发送密码、token 或完整邮件链接。

用户确认完成后再继续核验正常 session、本人正常登录、恢复 UI 已退出且刷新不重复、旧 recovery 邮件链接行为。不会继续 Worker pairing 或行情任务。
