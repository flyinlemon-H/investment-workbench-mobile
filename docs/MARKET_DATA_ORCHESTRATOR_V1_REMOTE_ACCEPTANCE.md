# MARKET_DATA_ORCHESTRATOR_V1 测试项目远端验收

状态：**READY_FOR_PRODUCTION_REVIEW**。2026-10-02 验收通过，仅具备进入生产部署评审的条件；没有部署生产、推送 Git 或发布 Pages。

## 目标、基线和实际迁移

唯一远端目标：`investment-analysis-test-s01` / `lblyapnsngqnjimgskkp`。浏览器使用独立 Chromium context（390×844），真实页面代码由本机 HTTP 提供，仅在测试服务器响应中替换 Supabase 公开配置。Auth/任务 RPC 均为真实测试项目请求；没有 mock 远端 registry/result store。未将它描述为真实手机硬件验收或已发布的网站。

部署前于 2026-10-02 01:59:18 UTC 记录 PostgreSQL 17.6 的 schema、列、约束、索引、RLS、ACL、函数签名/定义摘要及 4 条既有 migration。基线见 [test-baseline](market-data-orchestrator-test-baseline.json)。既有迁移：`20260801054602`、`20260801054642`、`20260903123919`、`20260903125657`。

| 实际远端 version | 名称 | 仓库 migration |
|---|---|---|
| `20261002020030` | `market_data_orchestrator_v1` | `20261001155527_market_data_orchestrator_v1.sql` |
| `20261002021340` | `market_data_worker_capability_lock` | `20261002021235_market_data_worker_capability_lock.sql` |

通过测试项目 MCP apply_migration 执行；远端记录采用执行时的 version，SQL 与对应本地文件一致。后续生产评审应同时审查这两份 SQL，并依据目标 migration ledger 制定执行顺序，不能把不同 version 误认为需要重复执行。

变更范围：

- 新建 `market_private`；表 `workers`、`tasks`、`results`，共 8 个索引（含主键/唯一索引）。`market_one_active` 保证每 owner/symbol 最多一个 queued/running 任务。
- 新建函数 `market_private.task_json`、`market_private.account`、`market_private.worker`、`public.market_data_account`、`public.market_data_worker`。
- 三表全部 RLS；策略 `no_direct_workers`、`no_direct_tasks`、`no_direct_results` 使用 `USING(false) WITH CHECK(false)`，anon/authenticated 无直接表权限。
- public 包装函数为 SECURITY INVOKER。private 的 account/worker 为 SECURITY DEFINER，空 search_path；分别仅授权 authenticated/anon 调用，额外检查用户身份或哈希 capability。
- 第二个迁移只替换 account/worker 两个实现，统一 owner 事务锁，并在获得锁后以 clock_timestamp 重新检查 capability；修复并发轮换、多凭据及撤销后继续 claim/finish 的竞态，也使账户队列配额检查串行化。未改变表、policy 或既有 grant。

部署后逐项比较：原有 schema、列、约束、索引、relation/RLS/ACL、函数定义和 policy 均保持一致。原有 9 张业务表 count/内容 MD5 均未变，全部仍为空。完整结果见 [test-after](market-data-orchestrator-test-after.json)。未迁移真实用户数据、持仓、Plan 或订单。

## 隔离账户与权限模型

仅在测试项目创建两个已确认 email 的 disposable Auth 账户（不发送邮件）：

| 用途 | User ID | Email |
|---|---|---|
| owner | `5dcea3e7-25dd-438b-8e18-a782f8694cdf` | `market-orch-owner-5dcea3e7-25dd-438b-8e18-a782f8694cdf@example.invalid` |
| outsider | `4797acf6-2b76-4c37-b7ef-1240f4efede1` | `market-orch-outsider-4797acf6-2b76-4c37-b7ef-1240f4efede1@example.invalid` |

随机口令由测试数据库现有 pgcrypto 生成/哈希，只在隔离测试中使用，Windows DPAPI 加密临时保存。两者是普通 authenticated 用户，无管理员或 service_role 权限。所有权来自 auth.uid()，不信任请求中的 owner 或 user_metadata。Worker 使用随机 256-bit capability，数据库仅保存 SHA-256；它只允许 claim/finish 固定日线任务，不能创建任务或执行任意 shell/path/URL。

验收结束：全部 capability 撤销，0 个活动 Worker、0 个 queued/running 任务；两个账户禁用至 2100 年、口令再次随机重置，sessions/refresh_tokens 均为 0，旧口令真实登录返回 user_banned。浏览器与 Worker 进程已退出，临时 DPAPI 凭据文件已删除。任务、两个有效版本及禁用账户保留为测试审计记录。已发 access JWT 依原 TTL 过期，未声称 sign-out/ban 会立即撤销 JWT；测试未持久化这些令牌。

## 真实远端闭环

标的 `601869.SS`。种子来自真实 ProviderChain，移除末尾 3 根完整日线并重算指标，构成 365 根、截至 2026-09-24 的隔离测试历史。

| 阶段 | 真实证据 |
|---|---|
| Browser 创建 UPDATE_DAILY_MARKET_DATA | task `128adedf-d7f0-44a4-93d1-cca6a28e0f11`；requestedAt `02:15:14.670523 UTC` |
| remote queued | PC Worker 尚未启动时保持 queued；startedAt/workerId 为 null；页面“等待执行端” |
| PC Worker claim → running | startedAt `02:15:24.853392 UTC`；浏览器显示“正在更新行情” |
| ProviderChain / daily incremental / technical | 复用现有 PC updater/merge/indicators；Yahoo 回退，365→368 根，dataUpdated=true |
| versioned result → succeeded | completedAt `02:15:32.567117 UTC`；resultVersion 等于 taskId，任务与结果原子提交 |
| Browser 回读 | 页面“行情已更新至 2026-09-30”，显示相同 UUID 版本 |
| freshness / Discussion | latestCompleteBar=technicalAsOf=`2026-09-30`；页面 fresh=true；Discussion technical.ready=true、dataStatus=fresh，resultVersion 相同 |

真实增量指纹：`786d8f0d59ef9626b9ce23c45d4dad1959d7748b070c92e9be53fa6f9c5af2ce`。成功链路没有替换 ProviderChain 或伪造成功结果；记录 `provider_fallback` 警告，未绕过 provider/复权连续性保护。

## 失败、幂等与权限验收

主远端验收 48 项，补充安全验收 7 项，全部通过。机器可读证据见 [remote-results](market-data-orchestrator-remote-results.json)。

- 未登录创建任务、伪造 capability、匿名 Auth 身份、非法 symbol/taskType、额外 command/path/URL/owner 参数均拒绝。
- outsider 无法读 owner 的任务/结果，也无法 finish owner 的任务；未授权直接 REST 访问三张 private 表被拒绝。额外事务内临时授予 SELECT 后，anon/authenticated 仍看不到任何行，验证 RLS 本身有效；事务已 rollback。
- 8 次并行 request 返回同一 active task；运行中第二次 claim 返回 null。8 次并行凭据轮换仅 1 份可用，7 份因 42501 拒绝。
- Worker 离线至少 6 秒保持 queued；running 仅来自真实 claim。观察运行状态的测试 Worker 在真实 claim 后额外等待 3 秒，未写入假状态。
- task `48d33631-8fde-4a53-a20d-db9de2eb6827` 经真实队列和 Worker 注入 Provider Timeout，终态 failed/provider_or_pipeline_failure；上一份远端 payload 字节等价、浏览器结果版本保持不变。这是明确的故障注入，不是声称当时 Provider 自然宕机。
- retry `c6fda1ea-b2ae-4ae6-9bf5-a832ac272cd7` 再次真实 ProviderChain，succeeded/dataUpdated=false，指纹未变；重复 finish 不改终态或重复写版本。
- 不完整 bar 结果提交被拒绝，任务仍 running、旧有效结果保持；运行中轮换返回 worker_busy；撤销将任务置 failed/worker_revoked，旧 capability 无法再 finish，旧结果仍保持。
- 浏览器本地隔离数据中 shares、plans、orders 无变化；无自动 AI 请求，无页面异常或横向溢出。网络拦截只放行本机资产、测试 Auth 和本任务 RPC，阻止既有 universe 自动写入及一切其它来源。

Security advisor 无本任务数据库/RLS/函数告警。初始 advisor 返回空；完成 Auth 验收后出现 1 个项目级 WARN：`auth_leaked_password_protection`（泄露密码检查未开启）。本任务没有修改 Auth 配置；测试口令为高熵随机值、已作废。该全局设置属于生产评审检查项，不在本次授权范围内扩展修改。

## 代码、回归及评审边界

本轮修改代码：浏览器 client 在状态 read 已进行时保留用户新发出的更新请求，继续合并重复点击；新增对应回归测试。另有上述最小 SQL 并发修复、真实远端测试脚本与审计文档。

- npm test：1106/1106；Python unittest：27/27。
- 修复后三视口：1280×900、390×844、360×800，全部通过（本地真实 SQL/浏览器隔离回归）；远端真实链路为 390×844。
- 远端 queued/running/succeeded/failed 截图已查看，在忽略目录 `test-results/market-remote/`。截图不包含凭据。
- 既有两个未提交 bridge 文件 SHA256 保持原值，未纳入新 commit。PC 源库只读取，没有更改原有行情文件或手动流程。
- freshness 继续采用已有工作日宽限逻辑，未新增交易所节假日日历；长假可能保守显示 stale。成功状态不能强制把陈旧行情判为 fresh。
- 未调用生产项目部署/数据库接口，未修改生产配置、权限、真实用户数据；未执行 Git push/Pages deploy，也未添加任何通用远端命令执行能力。

具备进入生产部署评审条件。生产评审需处理 migration ledger 映射、全局 Auth WARN 和后续明确发布授权；本次结束状态为 **READY_FOR_PRODUCTION_REVIEW**。
