# AUTH_PASSWORD_RECOVERY_V1

日期：2026-10-03（Asia/Shanghai）。最终状态：**AUTH_PASSWORD_RECOVERY_NEEDS_FIX**。

后续远端验收已开始，见 [AUTH_PASSWORD_RECOVERY_V1_REMOTE_ACCEPTANCE.md](AUTH_PASSWORD_RECOVERY_V1_REMOTE_ACCEPTANCE.md)。远端错误回跳已实证生产目标 `?auth=recovery` 被接受，无需为该目标新增 Redirect URL；完整配置、密码策略及真实邮件仍待验收。下文未核实配置的描述保留为本地实现阶段记录，以远端报告的新证据为准。

产品实现及自动测试已完成；尚缺生产 Auth 配置只读确认和隔离账户真实邮件闭环证据，因此不宣称 READY_FOR_PRODUCTION_REVIEW。这里的 NEEDS_FIX 表示验收缺口，当前自动测试未发现未修复的恢复流程故障。

- 开发分支：`codex/auth-password-recovery-v1`，独立 worktree。
- 基线：`945691f9cffba3d54e877548b0a63c08d18025db`，包含已验收生产 Candidate `9d02277fd271848116d5f3bd41c9c3303f921351`。
- 实现提交：`0fa4ac691e5d6d5d826960e43b1ec82afc211c99`。
- 本地待评审资源版本：`auth-password-recovery-v1-20261003`。
- 清单：91 个发布资源，连同清单文件合计 92 个 artifact 文件；完整性、脚本依赖、缓存版本及凭据扫描通过。
- 未 push、未部署 Pages、未修改生产 Auth/业务数据库、未发送真实恢复邮件、未创建或修改任何真实账户。未改动另一 worktree 的 Worker 工作或两份本地行情文件。

## 1. Current Auth Architecture

现有 `src/supabase-browser-client.js` 统一创建一个 Supabase client、一个 SDK Auth listener，Universe 与 Analysis Sync 共用 session。SDK 为锁定的 `@supabase/supabase-js` / `@supabase/auth-js` 2.114.0，已有 `persistSession`、`autoRefreshToken`、`detectSessionInUrl`；沿用 `universe-auth-${projectRef}` 存储键与默认 implicit flow。本任务没有升级 SDK 或切换 Auth flow。

开发前阅读了锁定版本的 GoTrueClient：恢复初始化先验证用户、保存 SDK session，再异步发送 PASSWORD_RECOVERY；updateUser 使用当前 session 并在成功后保存会话、发送 USER_UPDATED。业务消费者仍在 SDK callback 之外执行，避免 Auth lock 重入。

生产地址经公开页面与清单核实为 `https://flyinlemon-h.github.io/investment-workbench-mobile/`。生产现行资源版本仍为 `market-data-orchestrator-v1-integration-20261002`；本文描述的是未发布的新实现。

## 2. Existing Gap

旧产品只有注册、密码登录、退出、session restore，未接入恢复邮件、PASSWORD_RECOVERY 或新密码表单。SDK 内有能力，不代表原产品已有用户入口。

变更文件：

| 文件 | 变更 |
| --- | --- |
| `src/auth-password-recovery.js` | 新增恢复状态、官方 SDK 调用、会话验证、错误归类 |
| `src/auth-password-recovery-ui.js` | 新增邮箱与设置新密码弹窗、可访问性及安全清理 |
| `src/supabase-browser-client.js` | 保留统一 client；接收 recovery 事件且不被同 session 去重吞掉 |
| `src/universe-sync-ui.js` | 原未登录账户弹窗增加“忘记密码？” |
| `index.html` | 按依赖顺序加载两个模块，更新资源缓存版本 |
| `scripts/generate_publish_manifest.js` / `publish-manifest.json` | 纳入新资源及新缓存版本 |
| `tests/auth_password_recovery.test.js` | 31 项新增状态、安全及 SDK 合约测试 |
| `tests/auth_password_recovery_browser.cjs` | 实际应用、实际 SDK、模拟 HTTP 三视口测试 |
| `tests/integration_auth_browser.cjs` | 旧测试补上当前可见的“更多→工具→同步”导航 |
| `tests/workbench_market_bridge_release.test.js` | 验证新版本及新增 Auth 脚本缓存串，保留原模块检查 |

无 migration；Worker、Orchestrator、行情、持仓、Plan、订单、Discussion 产品逻辑均未修改。

## 3. Recovery Flow

未登录账户 → 忘记密码 → 输入邮箱 → `resetPasswordForEmail` → 用户打开邮件 → Supabase 验证链接并跳回应用 → SDK PASSWORD_RECOVERY → `auth.getUser()` 服务端验证 → 设置新密码 → `updateUser({password})` → 密码已更新 → 保持 SDK 登录会话 → 返回应用继续既有账户操作。

失效、非法、已使用链接或无法建立有效会话进入失效页面；“重新发送重置邮件”只回到邮箱表单，必须再由用户主动提交。

## 4. UI Flow

入口：**首页 → 更多 → 工具 → 账户 → 账户与同步设置 → 忘记密码？**。

另一入口：更多 → 工具 → 同步 → 自动同步设置，同样打开现有账户弹窗。按钮在 `#universeLoginFields` 内，未登录时显示，已登录时随原登录表单隐藏。复用已有邮箱值，关闭原弹窗时清空原密码输入。

新 UI 为 `#passwordRecoveryDialog`，包含恢复邮箱、新密码、确认新密码、发送/更新/重发/关闭按钮。不要求旧密码。错误及成功信息使用 textContent，邮箱不会拼进 HTML。关闭后的迟到邮件响应不会重新打开弹窗。

## 5. resetPasswordForEmail

使用共享 SDK 的 `auth.resetPasswordForEmail(email, {redirectTo})`；前端只校验基础邮箱格式、长度及正在发送状态。没有管理员接口、service_role、SQL、自产 token 或自造恢复邮件链接。

接口依据：[Supabase resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)，并与本地锁定 SDK 源码核对。

## 6. Redirect Strategy

生产项目 `fntslvdxnupmdljnadec` 的精确目标：

`https://flyinlemon-h.github.io/investment-workbench-mobile/?auth=recovery`

固定到已验证的正式域名和仓库路径，不接受调用页面 origin、用户输入或查询参数提供任意跳转目标。测试项目 `lblyapnsngqnjimgskkp` 只允许当前 localhost、127.0.0.1、[::1] 测试站点的目录根路径；其他项目或测试远端域名拒绝发送。真实手机测试若需独立公网测试站点，要先明确并允许该精确测试目的地，不能借此绕过 redirect 检查。

`?auth=recovery` 仅代表 UI 意图，不是认证凭据。回调参数由 SDK 消费；本模块只检测敏感参数是否存在，不复制其值。链接处理后清理 callback hash/查询参数，成功或退出时清理 auth 标记。

## 7. PASSWORD_RECOVERY Handling

必须收到真实 SDK PASSWORD_RECOVERY 且服务端 getUser 验证相同用户后才进入 ready。普通 SIGNED_IN、INITIAL_SESSION、TOKEN_REFRESHED 不创建 recovery intent。仅 URL 标记不能进入密码表单。

共享 listener 在 session 去重前处理恢复事件，确保同一 session 的语义事件不会丢失。验证用 setTimeout 离开 SDK Auth callback 后调用 SDK，避免锁重入。

有 callback 参数却没成功事件的页面拒绝回退到旧 intent，即使浏览器另有普通有效 session，也不以此放行恢复表单。

## 8. updateUser Password

前端要求非空、两次一致、至少 8 位；8 位沿用原账户 UI 的最低检查，**不是已经核实的生产 Auth 最低要求**。尚需读取真实生产密码策略。服务器的 weak_password、same_password 等错误映射成固定中文提示，不展示原始响应。

提交前必须处于 ready，intent 未超时，并再次服务端验证同一用户。然后只调用 `auth.updateUser({password})`。更新期间防重复提交；验证结束时已过期不发请求；服务端确认更新成功后，即使本地截止时间刚好经过，也如实显示成功。

接口依据：[Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)。

## 9. Session Lifecycle

成功更新后沿用 SDK 实際行为保持登录，清除本模块 intent，显示“密码已更新。”。未调用 signOut 后伪称仍登录，也未自行制造 session。返回应用后可继续现有登录依赖功能；本任务没有生成 Worker capability。

恢复中主动取消使用现有本机 scope 的 signOut。账户变更、SIGNED_OUT、服务端失效阻止更新。坏链接在 SDK 按官方行为保留既有普通 session 时，只拒绝恢复 UI，不破坏该正常会话。

刷新恢复仅保存 `sessionStorage` 中的 `{userId, until}`，最长 30 分钟且不超过初始 SDK session expiry；恢复时仍要求 SDK session 的同一用户及服务端 getUser 验证。它是可修改的 UI 流程标记，**不是服务端授权证明**，不能取代 Supabase 的用户认证与密码更新权限。未自定义存储 access/refresh/recovery token。禁用 sessionStorage 时当前页面仍可完成，刷新恢复不保证。

## 10. GitHub Pages Compatibility

使用仓库根路径加 query，不新增深层路由，避免 Pages 静态路径 404。实际 SDK 浏览器测试验证初始化、清理 hash、刷新恢复；依赖顺序是 vendor SDK → recovery logic → shared client → recovery UI → 既有消费者。

新 manifest 的 sourceCommit 为 `0fa4ac691e5d6d5d826960e43b1ec82afc211c99`，资源缓存串统一更新。91 个资源与依赖完整性通过。本地页面兼容通过；生产 Auth 是否接受目的地、真实邮件点击后能否按该路径返回仍待确认。本次未发布新版本。

## 11. Account Enumeration Protection

成功统一文案：“如果该邮箱已注册，我们会发送密码重置邮件。请查看收件箱和垃圾邮件。”。user_not_found / email_not_confirmed 不显示“邮箱不存在”；已注册/未知邮箱 UI 测试响应一致。格式错误、网络故障、限流可单独提示。

该结论针对产品文案和错误归类；不宣称消除了邮件服务或网络时序层面的所有账户枚举侧信道。

## 12. Rate Limit Handling

429 与 Supabase 限流 code 显示“请求过于频繁，请稍后再试。”；发送中禁用按钮，双击不会重复请求。应用没有自动重试恢复邮件。网络失败显示可理解提示，由用户主动重试。单元和实际 SDK 模拟 HTTP 测试均覆盖。

## 13. Token / Password Logging Protection

新增逻辑无 console 输出；只显示固定中文错误。密码仅作为输入瞬时值传给官方 SDK，提交完成/失败、模式切换、关闭及 pagehide 清空输入。不记录请求体、Authorization header、链接凭据或原始 Auth 错误；没有自定义 localStorage/IndexedDB 凭据副本。

浏览器自动测试使用内存构造、不可用于真实登录的合成 session；不访问真实邮箱，不保存 HAR、trace 或 video。控制台断言没有测试密码、合成 refresh 值及原始敏感错误。生产 CLI token、password hash、service_role 均未读取或输出。

## 14. Mobile Flow

手机使用步骤（未来部署并确认 redirect 后）：按第 4 节进入 → 输入自己的注册邮箱 → 发送 → 收件箱/Gmail 打开链接 → 正式程序自动显示设置新密码 → 输入并确认 → 更新 → 返回应用。

360、390、1280 三个 Chromium 视口各检查登录、忘记密码、邮件已发送、设置新密码、密码不一致、链接失效、更新成功，共 21 张截图，弹窗无横向溢出。具备 label、aria-live、标题、焦点恢复和 Tab/Shift+Tab 限定。实际 iOS Safari、Android Chrome、Gmail 内嵌浏览器及键盘遮挡尚未用实体设备验收。

## 15. Existing Auth Regression

- 注册、密码登录、退出、既有 session restore / refresh 通过。
- 共用一个 SDK client、一个 Auth listener 通过。
- Universe 待同步队列、并发分析同步、失去登录时保护、重新登录恢复、缺少本地股票零写入、错误同步响应拒绝、重读对账通过（模拟 HTTP）。
- 恢复 UI 浏览器用例前后业务 state 相同。
- Entry Decision Clarity 31/31；生产基线发布门禁 207/207，通过且保护测试内容未改。

## 16. Tests

| 验证 | 结果 | 证据/范围 |
| --- | --- | --- |
| 全量 JS/SQL `npm test` | 1190/1190 PASS | 本地 Node/PGlite，未执行远端 SQL |
| 恢复 unit | 31/31 PASS | 新测试；包含并发、账户变更与截止时间竞态 |
| 恢复 + 共享 Auth + Universe 定向回归 | 59/59 PASS | 最终实现再次核验 |
| production_baseline_regression | 207/207 PASS | 既有功能、合约与基线保护 |
| Entry Clarity | 31/31 PASS | 单独确认；也包含在全量/门禁中，不能重复累加 |
| Recovery browser | 45 项 PASS | 实际应用 + 锁定 SDK + 模拟 Auth HTTP；外部请求 0 |
| Shared Auth browser | PASS | `test-results/integration-hardening/shared-auth-sdk.json` |
| 三视口 | 360/390/1280 PASS | `test-results/auth-password-recovery/report.json`、21 张截图 |
| 发布资源 | 91/91 PASS | 加清单共 92 文件；完整性、缓存、依赖、凭据扫描 |
| 真实 Supabase recovery / 邮件 | NOT_RUN | 未提供可收信独立测试邮箱；没有真实测试账户或邮件 |

全量首轮受 sandbox 写入限制影响；放开本地测试产物写入后仅有既有 wrapper 测试要求相邻行情源码的问题。为预检临时连接真实相邻源码，重跑后 1190/1190，通过后只移除连接。未修改/执行行情更新。旧浏览器测试补充可见菜单导航后通过，没有用强制点击绕过可见性检查。

用户要求的 CASE 对照（均为自动/模拟证据）：

| CASE | 结果 |
| --- | --- |
| 1 未登录入口 | 浏览器通过 |
| 2 空邮箱 | unit + 浏览器；不请求 |
| 3 合法邮箱 | 官方 SDK 方法及 redirect 参数通过 |
| 4 未知邮箱 | 与已注册模拟响应文案相同 |
| 5 非法邮箱 | unit；不请求 |
| 6 rate limit | unit + 浏览器；无自动重试 |
| 7 network error | unit + 浏览器；固定提示 |
| 8 PASSWORD_RECOVERY | 实际 SDK 模拟回调自动打开表单 |
| 9 不一致 | unit + 浏览器；不更新 |
| 10 密码要求 | 短密码及服务器 weak/same 错误通过；真实生产策略待核实 |
| 11 有效 session update | unit + 实际 SDK 模拟 PUT 通过 |
| 12 成功 | 明确提示、输入清理、SDK 会话保留 |
| 13 过期 | 模拟过期回调拒绝 |
| 14 无效 | 模拟服务端 401 及仅 URL 标记拒绝 |
| 15 旧链接 | 模拟 Supabase 拒绝已使用链接后安全失败；真实邮件复用未验收 |
| 16 SIGNED_IN | 不进入 recovery |
| 17 TOKEN_REFRESHED | 不进入 recovery |
| 18 刷新 | 同一用户有效 session + intent 恢复；换用户拒绝 |
| 19 注册 | 原 UI 与 SDK 模拟请求通过 |
| 20 登录 | 原 UI 与 SDK 模拟请求通过 |
| 21 退出 | 原 UI/session 状态通过 |
| 22 日志保护 | 新增源码检查与浏览器控制台断言通过 |

复现：`node --test tests/auth_password_recovery.test.js`；`npm test`；`npm run test:production-baseline`；配置可用的 Playwright/Chromium 路径后运行 `node tests/auth_password_recovery_browser.cjs`。旧共享 Auth 浏览器测试需本地 127.0.0.1:8768 静态服务。新恢复脚本自行启动/关闭 loopback 服务，拦截外部请求，不使用真实服务。

## 17. Production Config Requirements

生产项目：investment-workbench / `fntslvdxnupmdljnadec`。

| 配置 | 当前值/判断 |
| --- | --- |
| Site URL | 未取得只读证据，UNKNOWN |
| Redirect URLs | 未取得只读证据，UNKNOWN |
| 密码最低长度/字符要求 | 未取得只读证据，UNKNOWN |
| 目的地已被允许 | 未验证，不能判断需不需要修改 |

原因：已安装官方 CLI 2.109.1 的 config 只有 push，没有只读 get/pull；未执行 push。现有 MCP 没有 Auth config 读取能力；浏览器工具两次报无法加载访问策略，未读取 Dashboard。没有改读 CLI token 或以写操作推断配置。

已请求用户从 Dashboard 的 Authentication → URL Configuration 提供 Site URL/Redirect URLs，以及密码要求；目前未收到。必须补齐真实当前值后作精确 diff。

条件性建议：若现有允许列表不匹配，仅新增精确 `https://flyinlemon-h.github.io/investment-workbench-mobile/?auth=recovery`，保留其他条目，不用广泛通配符，不顺手修改 Site URL 或其他 Auth 配置。这个条目只允许回到既有正式应用根路径；实际变更要在后续部署任务单独授权。

**现在不能确认 PRODUCTION_AUTH_CONFIG_CHANGE_REQUIRED，也不能宣称无需变更。** 若只读核实确实缺少该目的地，再标记这一状态。[Supabase Redirect URLs 规则](https://supabase.com/docs/guides/auth/redirect-urls)。

## 18. Known Limitations

待完成的真实测试应使用能收信的独立测试邮箱和隔离测试项目：准备/注册账户 → 发送恢复邮件 → 收件箱点击 → 回到允许的测试应用 → 设置新密码 → 新密码登录成功 → 原密码登录失败 → 旧邮件重用安全失败。不得以模拟 HTTP 代替该结论。

当前测试 redirect 仅支持本机地址：PC 邮件点击可使用允许的 localhost 测试站点；手机不能把 localhost 当作 PC，因此手机真实闭环要另行明确精确测试站点，或在单独授权的生产最终用户验收阶段进行。没有对生产账户发送邮件或改密。

需要补齐：生产 redirect/密码策略只读确认、真实测试邮件及新旧密码登录、iOS/Android 实机跳转。服务端 secure password change / reauthentication 若有额外要求，以真实配置及服务端结果为准；当前 reauthentication_needed 映射为重新发恢复邮件。

仅凭一个有效普通 session 加自定义 UI 标记不是新的安全权限；密码更新始终受 Supabase Auth 授权控制。本任务不新增服务器认证能力，也不更改现有 SDK token 存储策略。

## 19. Final Status

**AUTH_PASSWORD_RECOVERY_NEEDS_FIX**。

实现、自动回归、三视口和本地发布清单已完成；缺少生产 Auth 配置事实与真实隔离 recovery 核心闭环，暂不提升为 READY_FOR_PRODUCTION_REVIEW。无生产变更，无真实密码/凭据操作，无须清理测试账户或 capability。本地 HTTP 测试服务在验收后关闭。

源码提交：`0fa4ac691e5d6d5d826960e43b1ec82afc211c99`。清单与本报告在后续本地交付提交中保存；最终交付提交 hash 由任务答复给出。
