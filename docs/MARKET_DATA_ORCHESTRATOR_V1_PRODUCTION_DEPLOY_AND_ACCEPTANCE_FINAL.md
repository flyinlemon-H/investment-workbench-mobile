# MARKET_DATA_ORCHESTRATOR_V1_PRODUCTION_DEPLOY_AND_ACCEPTANCE_FINAL

最终状态：**PRODUCTION_ACCEPTANCE_PASSED**。

验收日期：2026-10-03（Asia/Shanghai；下列 lifecycle 时间使用 UTC）。本轮从 M1+M2 单事务恢复，使用已授权验证工具提交 25739ec，未修改 M1/M2、Candidate 产品代码或发布清单。数据库、Pages、真实 PC Worker 闭环、隔离权限、撤销、freshness、Discussion readiness、Entry Clarity 与清理均完成。

机器证据：[market-data-production-final-resume-evidence.json](market-data-production-final-resume-evidence.json)。此前登录阻塞及旧事务验证缺陷均属历史阶段；本报告以此次恢复后的实态为准。

## 1. Production baseline

- 项目：investment-workbench / `fntslvdxnupmdljnadec`，ap-southeast-1。
- 部署前和验收清理后均为 ACTIVE_HEALTHY；PostgreSQL 17.6.1.141。
- 部署前远端 main：`27731979dc4b63b57d7a6ed262478261140484a4`。
- 即时 ledger 与上次评审完全一致，仅原两条股票池 migration，statements 摘要不变。
- 目标 schema、表、函数和 policy 无冲突；部署前完整应用 catalog 与批准基线差异为零。

## 2. Candidate commit

唯一发布 Candidate：`9d02277fd271848116d5f3bd41c9c3303f921351`。
源码：`a9e044d05b6920007c8a1af101c56a56438e1ba2`。
部署验证工具：`25739ec065075b020569e779e3735ce682e7081c`。

Candidate 包含原 production main，保留 Entry Decision Clarity、Discussion、Plan、Runtime，并包含 Orchestrator V1、Unified Freshness、Worker Client、Task UI、versioned result read 与新 manifest。验证工具提交未作为前端发布来源。

## 3. Push result

成功推送批准 Candidate 到 `codex/market-data-orchestrator-v1-production-integration`。
现有 Pages 环境仅允许 main/gh-pages 发布，因此通过正常快进将 main 从 2773197 更新为同一批准 Candidate 9d02277，触发既有 workflow。
未 force push，未更改环境发布策略，未混入工具修复或其他提交。
原工作树两份行情文件未暂存或改写；最终 SHA-256 与任务开始前相同。

## 4. DB transaction result

使用官方已登录 Supabase CLI 2.109.1，执行工具提交中的：
`supabase/review/market_data_orchestrator_production.sql`。

事务顺序：BEGIN → 锁 ledger / preflight → 原 M1 → 原 M2 → catalog/security/capability 断言 → SAVEPOINT 内隔离身份行为断言 → 回滚临时 fixtures → 两条 ledger INSERT → 最终检查 → COMMIT。

CLI 返回 `[]`；随后独立只读核验 ledger、对象、权限、数据及项目状态，确认 COMMIT 成功。没有 db push、apply_migration 外层 ledger 或中间 COMMIT。仅使用 CLI 正常认证，未读取、打印或导出 CLI token。进程内非秘密 DB_PASSWORD 占位仅绕过 CLI 不使用的连接初始化，实际 SQL 仍走 CLI 已登录的 Management API 通道。

此前旧验证脚本的 array_agg 错误已由 25739ec 修复；本轮固定事务生成结果与提交文件逐字一致。

## 5. M1/M2 result

| Ledger version / name | 结果 | 批准 SHA-256 |
|---|---|---|
| 20261002020030_market_data_orchestrator_v1 | COMMIT | 626f36d353c5490e5cdf68b747bbaf26584d68739d239510cedc4643570e2098 |
| 20261002021340_market_data_worker_capability_lock | COMMIT | ba6e5d809f052fffd6f5bfaf3af76cf104e87559eba6bfcdde773bc71eb3f30a |

沿用既有 LF 规范化完整性规则，M1/M2 内容未修改。

## 6. Ledger result

最终恰有四条：原 20260903132654、20260903132704，以及本次 M1/M2。
原 statements MD5：`ea140f2862d4aa615e3429defb5a19be`、`387b5e4eed8246aa197cdeefba5caded`。
新 statements MD5：`114173ea93139caa1fa693050266fd6b`、`906ff7ef0d60c81903cc94098c1b879c`。

未修改旧 ledger，未补齐历史 analysis drift。

## 7. Schema / RLS / function verification

仅新增批准对象：

- market_private.workers、tasks、results 三张私有表；8 个索引。
- market_private.task_json、account、worker；public.market_data_account、market_data_worker 共 5 个函数。
- no_direct_workers、no_direct_tasks、no_direct_results 三条 deny-all policy。
- 必要 schema USAGE、函数 EXECUTE 和表权限收紧；FK/约束及其系统内部触发器均来自原 M1。

所有原 catalog 项均未删除或变化。验收后 catalog 与 COMMIT 后 catalog 差异为零。

五函数均 owner=postgres、固定空 search_path。private account/worker 为 SECURITY DEFINER，其余 INVOKER；签名、返回类型、语言、prokind、ACL 与规范化函数体 hash 均匹配批准定义。无未授权 overload、动态 SQL 或用户可写 search_path。PUBLIC 不获得函数 EXECUTE；authenticated 仅 account 路径，anon 仅 capability-gated worker 路径；私有表无浏览器直接权限。

事务内与远端验收确认匿名创建/私有读取禁止，owner 隔离、直接表访问禁止、非法 taskType/symbol/参数拒绝、Worker capability 校验与撤销生效。Worker 授权依据服务器存储的 token 摘要/owner/expiry，非客户端自报 role。

## 8. Frontend publish result

[Pages workflow 37033106250](https://github.com/flyinlemon-H/investment-workbench-mobile/actions/runs/37033106250) SUCCESS。
CI Production Release Gate **207/207**，0 fail；构建交付 **90 files**。
线上逐文件重新下载，核对 bytes 与 SHA-256，**90/90 PASS**。
数据库提交至前端上线之间记录为 DATABASE_DEPLOYED_FRONTEND_PENDING，已完成后续发布。

## 9. Online commit

[生产 Pages](https://flyinlemon-h.github.io/investment-workbench-mobile/)：
deployed commit `9d02277fd271848116d5f3bd41c9c3303f921351`。
线上 sourceCommit：`a9e044d05b6920007c8a1af101c56a56438e1ba2`。
最终 origin/main 与 integration branch 均指向批准 Candidate。

## 10. Release manifest

assetVersion：`market-data-orchestrator-v1-integration-20261002`。
批准源码 manifest SHA-256：`a5482224eacf4df998d451427c30d314bea60f1bb9f625332548deda4d07dc98`。
线上构建清单的 sourceCommit、assetVersion、89 项资源清单逐值匹配；deploymentCommit 正确注入为 9d02277。含清单共 90 文件。未使用旧版本或 0b18c7e 清单。

## 11. Entry Clarity regression

- 已批准 Candidate 全量 JS/SQL **1159/1159**：未变版本历史证据沿用。
- 验证工具修复套件 **1186/1186**：原 1159 加 27 个工具测试，历史证据沿用。
- 本轮 CI Release Gate **207/207**。
- 重新下载且校验过的线上资源：Entry Clarity **31/31**。
- 实际生产 Pages、新浏览器上下文：8 场景 × 360/390/1280，**24/24**。
- 本轮 Python **27/27**。

setup_forming、entry_ready、entry_extended、setup_failed、旧 V3 Discussion fallback、Plan 分层、原判断/保护事实保持均通过。未调用 AI 或生成自动 Discussion/Plan。

## 12. Orchestrator lifecycle

| 字段 | 实测 |
|---|---|
| taskId / resultVersion | af678577-5cf0-4bc4-b1f0-fe3e90230cf3 |
| symbol | 601869.SS（隔离测试副本） |
| requestedAt | 2026-10-02T16:28:03.196416Z |
| startedAt | 2026-10-02T16:28:19.234015Z |
| completedAt | 2026-10-02T16:28:36.354613Z |
| lifecycle | queued → running → succeeded |
| latestCompleteBar | 2026-09-30 |
| technicalAsOf | 2026-09-30 |
| provider | yahoo（原 ProviderChain fallback） |
| 日线数量 | 364 → 367 |

## 13. Real production loop

实际线上 Browser 点击更新 → production queued → 本机单个 Worker claim → running → 原 ProviderChain → incremental daily → complete-bar validation / indicators → technical result → versioned result → succeeded → Browser RPC 回读 → Unified Freshness / Discussion Context 一致，全部通过。

运行的是批准 Candidate 的 Registry、execute_task 与 run_once。仅包装观察事件及本轮故障注入；无云 Worker、多 Worker、scheduler 或任意 command 执行入口。初始化只获取单一验收 symbol，不扫描股票池。

远端 harness 合计 **68 项检查通过**。证据含 lifecycle、provider、日期、版本与结果 fingerprint，不含秘密。

## 14. Worker offline result

Worker 启动前 Browser 创建任务，等待超过 6 秒并完成三个视口观察。
远端持续 queued，startedAt/workerId 为空；UI 显示“等待执行端”。启动 Worker 后才变为 running，“正在更新行情”可见。

## 15. Duplicate result

同一 owner/symbol 已 queued 时 8 个重复请求全部返回同一 taskId。
running 时第二次 claim 返回 null，无第二个 active execution。数据库 owner/symbol 唯一 active 索引与锁检查通过。

## 16. Failure protection result

安全注入 ProviderChain TimeoutError，任务：
`9782cf03-3aff-4888-b3d3-81a8838266ac`。
结果 failed / provider_or_pipeline_failure，resultVersion 为空。

上一份有效远端结果 JSON 完全相同，Browser 仍保留原 resultVersion。
三个视口显示“更新失败”，不伪装成功。

## 17. Illegal input result

远端拒绝非法 symbol、taskType、command、shell-like、script、path、URL、SQL-like 和伪造 owner 参数；Worker claim 的额外字段及 execute action 均拒绝。payload 仅作为验证输入，没有执行。
Worker 本地 validate_task 白名单与 complete-bar 保护由本轮 27 个 Python 测试覆盖。

## 18. Owner isolation result

临时 owner ID：`b0a69f45-2831-4d6c-9489-40d390344da9`。
临时 outsider ID：`e97092f1-8b27-4060-bb76-764ee748e05e`。

均为普通 authenticated email 身份，无管理员角色。实际 Auth 登录成功，密码随机且仅本机 DPAPI 保存。
owner 仅访问其任务/结果；outsider 按 taskId read 返回 null，不能 finish owner task；事务中同时验证 outsider claim 无 owner task。浏览器角色无法直接访问/修改三张私有表。客户端角色声明不能取得 Worker capability。

## 19. Credential revoke result

两份临时 capability：**configured → revoked**。
专门创建 queued 并 claim 为 running 的撤销测试任务：
`c63cf4ab-0d78-4f15-a0dd-01be7ec1334d`。
撤销后 owner/outsider capability 的 claim 与 finish 均被拒绝；running task 变为 failed / worker_revoked，旧有效结果保持。
随后 Auth global sign-out，清理账户、session 和本地 credential。未读取 CLI token；秘密未进入 Git、前端、日志或报告。

## 20. Unified freshness result

同一成功 resultVersion 与 2026-09-30 在 versioned result、Technical Page、dataReadiness、Discussion Context 中保持一致。
pageFresh=true、readiness.ready=true、dataStatus=fresh；技术日期与最新完整日相同。

初始化故意移除最后三根完整日 K：页面 stale，Discussion technical not ready。成功后切换到同一新 snapshot，不混用旧技术结果。

## 21. Discussion readiness result

成功回读后 Discussion Context 使用本次 resultVersion，technical ready=true。
失败任务不替换有效 snapshot。仅构建和检查 Context，没有自动 Discussion、Plan 或交易。
验收在非盘中；2026-09-30 为实际源数据的最新完整日，没有将未收盘当日日 K 写成 latestCompleteBar。盘中/future bar 拦截继续由原 Worker 规则及 Python 回归覆盖，未改规则。

## 22. Holding / Plan / Order comparison

远端原业务数据部署前、COMMIT 后、验收清理后三次 count/hash 完全一致：

| 原对象 | 行数 | 内容 MD5 |
|---|---:|---|
| analysis_private.analysis_sync_modules | 0 | d41d8cd98f00b204e9800998ecf8427e |
| public.input_queue | 2 | c41ff7d65ad85fdc54f1e291d910fb24 |
| public.stock_universe_entries | 23 | f84b0bfad86b59b17093382e88a9a0a5 |
| universe_private.reader_credentials | 2 | f617e88936d96ffc1b1f10a0cea8eacb |

仅比较摘要，不导出真实业务行。测试 Browser 使用新上下文、合成 watching stock、shares=0、plans=[]；shares/plans/orders 序列化前后一致。路由只允许生产页面资源、Auth 与 market account RPC，其他业务请求被拦截。真实用户浏览器存储未打开或改写。
PC latest_export.json 的最后写入时间仍为 2026-10-02T08:30:37Z，早于本轮；本轮 Worker 只更新内存中的测试副本。原工作树两份行情文件最终 hash 与开始前一致。没有真实 holding、Plan、order 或 portfolio 写操作。

## 23. Three viewport result

360、390、1280 三个宽度均观察到真实 queued/running/succeeded/failed 状态，更新按钮可见、无横向溢出或页面异常。
成功面板显示“行情已更新至 2026-09-30”和同一 resultVersion；等待时明确“等待执行端”。
另有 Clarity 24 个在线浏览器场景全部通过。截图保存在本地 `test-results/production-acceptance/` 和 `test-results/production-online/clarity-browser/`。

## 24. Test account cleanup

两账户已 global sign-out 后删除；其 identities、sessions、refreshTokens 只读计数全部为 0。
先删除其隔离 market results/tasks/workers，再删账户，未触碰其他 owner 数据。账户删除本身不被当作立即失效 JWT 的唯一保证：Worker capability 已先撤销；相关记录全部清空，账户外键也不再允许新任务/Worker 注册。
没有可用测试权限遗留。

## 25. Temporary capability cleanup

两份 capability 已 revoked，claim/finish 拒绝已实测。
本轮 DPAPI 目录文件数为 0；验收 Worker 进程数为 0。
最终 market_private 三表均 0 行，无 active task。完成审计元数据保存在本报告/机器证据；远端隔离结果已按账户清理。

## 26. Manual fallback result

原 PC 手动日 K 入口/runner/updater/bridge preparer/publisher 的 PreflightOnly 成功，未启动 scheduler 或全股票更新。
本轮 27 个 Python 测试包括原 universe 更新/bridge 输出及既有持仓/Plan 保护；真实闭环也复用了原日线 updater。
未替换原手动流程，未为验证而改写真实 PC export 或再次发布手动桥接数据。

## 27. Known limitations

- 本轮覆盖一个真实日线 symbol 及三个 CSS 视口，非多市场压力测试或实体手机设备测试。
- ProviderChain 实际使用 yahoo fallback，警告 provider_fallback 已记录；不是任务失败。
- 测试账户/capability 已清理，生产没有被留下常驻 Worker。普通用户后续执行任务仍需自己配置并启动授权 PC Worker。
- 原备份查询为 walg_enabled=true、pitr_enabled=false、backups=[]；本任务未改变备份或 Auth 配置。
- 本轮未发生产品代码修复；测试准备时 Node fs.cpSync 在本机退出，尚未运行任何回归。改用 PowerShell 复制测试 fixtures 后，线上 31/31 和浏览器 24/24 正式执行通过。
- 真实用户本地浏览器存储未被读取；其保护依据隔离上下文、严格网络范围及无真实用户写入路径，不把合成数据测试宣称为导出了用户的真实持仓。

## 28. Separate security follow-ups

- 旧 input_queue：**SEPARATE_SECURITY_FOLLOWUP**，原对象/数据不变，本任务不修复。
- Auth leaked password protection：**NON_BLOCKING_SECURITY_IMPROVEMENT**，未修改 Auth；[官方说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。
- 最终 security advisor 另提示既有 public.rls_auto_enable 的 anon/authenticated SECURITY DEFINER 可执行告警。该函数及其 ACL 与部署前逐值一致，不属于新增 market 对象；单列后续评审，未调用或修改。[匿名执行检查](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[登录用户执行检查](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)。
- 新增 market 对象无 advisor 告警；具体安全结论以事务内定义验证和隔离角色实际行为为依据。

## 29. Any new commit hashes

本轮产品代码：**无修改**。
已发布 Candidate：`9d02277fd271848116d5f3bd41c9c3303f921351`。
沿用工具修复：`25739ec065075b020569e779e3735ce682e7081c`。
本报告及机器证据在独立审计分支提交；其 commit hash 随最终交付返回。该文档提交不推送 production main，不改变线上 Candidate。

## 30. Final status

**PRODUCTION_ACCEPTANCE_PASSED**

M1/M2、ledger、schema/security/RLS/capability、批准前端、Clarity、真实 Browser→PC Worker→Browser、离线/重复/失败/非法输入/owner 隔离/撤销、freshness/Discussion、保护数据、清理、手动 fallback 与三视口要求均已完成。
