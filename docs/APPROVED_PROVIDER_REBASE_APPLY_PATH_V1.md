# APPROVED_PROVIDER_REBASE_APPLY_PATH_V1

状态：**PRODUCTION_SCHEMA_CHANGE_REVIEW_REQUIRED**。

已完成最新生产基线核对、真实生产 catalog 只读核验、失败链路分析、当前 approval/hash 回读和最小可信迁移状态设计。按用户第 44 节停止：没有修改产品代码、没有新增或执行 migration/RPC、没有 push/deploy、没有真实 Apply/rollback。

## 1. 停止依据

用户第 44 节明确要求：

> 如果发现必须新增schema/RPC 才能安全实现……停止：PRODUCTION_SCHEMA_CHANGE_REVIEW_REQUIRED，不要擅自部署。

本次不是因开发难度或普通测试失败而停下。用户同时要求 migration intent 不能由客户端自报；Remote Result 必须由服务端/可信 migration state 证明 approval；审批消费、current-version conflict、完整 previous version、审计与 rollback 必须原子一致。当前系统缺少手机可查询的、具有这些保证的远端状态和接口。

普通 mixed → single-source guard 仍应拒绝，没有计划放宽该规则或为 2899/Yahoo 写特例。

## 2. 最新生产基线

- 已重新 fetch origin/main：`d3f578d764e3bed111e850cf3c419013575b8241`。
- 当前工作分支保留该完整生产基线；其后的本地提交仅是已有审计报告。
- Pages workflow：37315264781，success，同一部署提交。
- 实时 public manifest 与冻结 approval package 的 deploymentCommit/assetVersion/guard hash 一致。
- assetVersion：market-write-guard-v1-20261005。
- 当前生产项目：investment-workbench / fntslvdxnupmdljnadec。

## 3. 实际生产 catalog 只读核验

通过已连接的 Supabase `execute_sql` 仅查询 `pg_proc`、`pg_namespace`、`pg_class`、`pg_attribute` 和权限元数据。未读取 Auth 用户行、业务 payload、token、password hash 或 Worker 凭据。

实际存在的相关远端函数：

| schema/function | 当前动作/用途 | approval/migration 校验 |
|---|---|---|
| market_private.account | request / read / register_worker / revoke_worker | 无 |
| market_private.worker | claim / finish | 无 |
| market_private.task_json | daily task 展示 | 无 |
| public.market_data_account | account wrapper | 无 |
| public.market_data_worker | worker wrapper | 无 |

实际 `market_private` 表：

| 表 | 字段概要 | RLS | authenticated 直接 INSERT/UPDATE |
|---|---|---|---|
| tasks | id,owner,symbol,status,requested_at,started_at,completed_at,worker_id,lease_until,error,result_version | true | false / false |
| results | version,owner,symbol,completed_at,payload | true | false / false |
| workers | id,owner,token_hash,expires_at | true | false / false |

应用相关 schema 中未发现 migration/rebase/approval 注册表；catalog 查询另命中 realtime.schema_migrations，它是内部 schema 版本记录，不能拿来存业务迁移审批。

原始 catalog 回执存于 `.rebase/approved-apply-path/production-functions.json` 和 `production-schema-details.json`。

## 4. 失败链路定位

1. `src/provider-rebase-review-ui.js` 读取本地候选文件。Approve 当前只显示短语，不调用可信远端 approval lookup；没有真正的 Apply action。
2. 真实 approval 由 operator CLI 写入 `.rebase/production-refreeze/pilot.sqlite`；`scripts/provider_rebase/store.py` 正确校验并绑定精确 candidate/request/hash，但该数据库不是手机可以读取的远端 registry。
3. `scripts/provider_rebase/projection.py` 的 deliver 只处理一个本地 JSON target，不建立远端 migration state。
4. 远端普通行情链为 `src/market-data-orchestrator.js:createClient.sync → market_data_account(read) → validateResult → apply callback`。返回的是已成功 daily task 的结果。
5. `src/market-data-task-ui.js:13` 与 `src/market-data-bridge.js:8` 均调用 `assertMarketHistoryContinuity`。
6. `src/state.js` 看到旧历史 mixed-provider 即返回 MIXED_HISTORY_REBASE_REQUIRED。这里没有可信 migration context，拒绝正确。

因此不能把当前链路描述为“approval 已在服务器验证、仅少传了一个 intent”。实际上缺少 approval registry 的远端同步、服务端消费/CAS、migration/current lookup 和客户端原子接收这几段。

不是 approval missing：本地真实 approval 存在。不是 candidate corruption、三个 hash mismatch 或 source contract mismatch：本次重新计算与回读均通过。

## 5. 为什么现有通道不能安全代用

- 将 `approved=true` 或 applyIntent 放进 result/technicalIndicators：Worker 可提交这些扩展 JSON，但现有 RPC 不核对其中的 approval、candidateHash、消费状态和 expectedCurrentVersion，不能构成可信 migration state。
- 将 migration 包伪装成 UPDATE_DAILY_MARKET_DATA：违反普通 task 白名单语义，而且不产生审批消费与独立版本事务。
- 浏览器读取本地 JSON/SQLite 导出的 approval：文件 hash 只证明一致性，不能证明谁批准、是否已消费、当前服务器版本是否变化。
- GitHub Pages 静态文件能提供受发布控制的字节，但现有发布契约没有私有 owner-bound approval/current registry、事务性消费、冲突锁或受控 rollback。把审批和迁移生命周期新建为公开静态发布协议会改变可信模型及隐私/审批语义，不是现有接口的安全复用；本任务不临时引入这种替代控制面。
- 复用 analysis/Plan/Discussion 等不相关表会混淆权限和业务语义，不采用。

在现有 Supabase 远端任务架构内，要满足本任务全部原子状态和权限约束，须新增迁移专用持久状态与 RPC。不能只改 UI。

## 6. 最小生产 schema/RPC 审查提案（尚未实现或部署）

建议继续使用现有 `market_private` 私有 schema，独立增加四类对象；最终 SQL/索引数量在授权后实现阶段冻结审查，不把以下设计冒充已完成 migration。

| 拟议私有表 | 责任/关键约束 |
|---|---|
| migration_records | owner,symbol,migrationType,candidateId,三个 hash,targetSourceContract,expectedCurrentVersion,approvalId/approvedAt,guardVersion,candidate payload,状态/消费版本；identity/payload/approval 写入后不可任意改写；同一 owner+symbol 活跃迁移唯一 |
| migration_versions | owner,symbol,versionId,完整 bars/sourceContract/technical/freshness bundle；immutable；完整 previous snapshot 保留 |
| migration_heads | owner+symbol 唯一，currentVersion/previousVersion/generation；CAS 更新权威当前指针 |
| migration_events | append-only，migrationId/actor/action/fromVersion/toVersion/approvalId/时间/原因；与版本切换同事务 |

拟议 API 边界：

- 新增 `public.market_data_migration` wrapper 与私有实现。Browser 只读 read/status/current，以及经认证 owner 的明确 approve/apply/rollback 操作；仅提交 migrationId/exact hashes/expectedCurrentVersion，不能提交可信状态或任意替换 bars。
- 既有本地 approval 如需同步，走受限 operator import，先回读验证完整冻结对象与用户批准，再绑定实际 production owner。该能力不对普通浏览器或 Worker 暴露，不接受客户端自报 actor/approved timestamp 当授权证据。
- 如 Worker 需读取 applied current，新增只读的 migration-current 查询通路，以现有有效 capability 限定同 owner/symbol；不授予 Worker approve/apply/rollback，不创建新的任意任务类型或远程命令能力。
- 不修改既有 daily RPC 的授权含义、不放宽旧表 grants、不修改 Auth 设置、不扩大日常 Worker taskType。

权限策略：新增私有表启用 RLS，普通客户端禁止直接写；read 限当前 auth.uid owner，anonymous 无读写；受控函数安全 search_path、最小 grants、显式 owner 检查，revoke PUBLIC 默认执行权限。RLS 与 grants 是不同层，必须一起验证。[Supabase 官方说明](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 7. Approved Migration Context 及接收方案

applyIntent 明确区分 ordinary_incremental、explicit_import、provider_rebase_apply、same_provider_revision_apply、rollback。

可信 context 由验证后的远端 migration record 构造，绑定：

- owner/symbol/migrationType；
- candidateId/candidateHash/contentHash/approvalPackageHash；
- targetSourceContract；
- previousVersion/expectedCurrentVersion/newCurrentVersion/generation；
- approvalId/approvalTimestamp/consumedByMigration；
- guardVersion 与适用的 migration-contract version。

客户端自报 intent/context 不具有授权效力。Remote Result adapter 先从独立迁移 RPC 核实 record；普通行情继续调用原 guard；只有可信、完全匹配的 approved migration 才进入独立 migration receiver。

2899 primary type 保持 provider_rebase，分红修订仅为附加证据；不改成 revision-only。不 hardcode symbol/provider。

## 8. 原子性、幂等和 rollback 设计

服务器事务获取 owner+symbol 锁后，校验审批未消费、三个 hash、candidate/source contract、expected head+generation、无冲突/无 blocker、guard compatibility。将完整旧 bundle 存为不可变 previous，插入完整新版本，一次切换 head、消费 approval、追加 event 后 COMMIT；任一步失败 ROLLBACK。

同一 migration 成功后的重复请求返回 already_applied，不能创建第二次版本切换或改写 previous pointer。回滚后不恢复旧 approval 为未消费；如需再次 Apply 必须新的明确迁移授权。

Browser 是服务器 canonical version 的投影：同一个本地持久化事务更新四项市场事实、migration state、previous snapshot/audit；保存失败不采用新 state。保持 holding/Plan/orders/Discussion 和 AI 判断正文。AI judgment 标记 needs_review，不调用 AI。

服务器事务与手机存储不能跨网络构成同一个 ACID 事务。应明确区分 server applied / client delivery_pending / client adopted；若手机保存失败，保留旧完整投影并允许从同一权威版本幂等重读，不能谎报整个闭环已经通过，也不能盲目自动回滚服务器。这是审批保证需要评审的一部分。

rollback RPC 必须 exact migration/version/generation 与 explicit reason，原子切回归档 previous；客户端以相同独立通路接收 rollback，ordinary guard 不承担迁移回滚职责。

## 9. 安全验证与后续执行门禁

授权 schema 范围后先完成本地/测试项目验证：用户列出的 16 项矩阵、泛化 symbol/provider fixtures、跨 owner/anonymous/Worker 越权、伪造 context、审批消费后重放、current CAS 冲突、并发 active 冲突、bars/technical 切换中断及事务回滚、重复 Apply、回滚后完整恢复。

再跑全量 JS/SQL、Python、Release Gate、三视口、8-path ordinary regression；审查 migration diff/RLS/grants 后才允许生产迁移及 Pages 发布。不能把本报告当成这些验证已经通过。

当前仅完成只读核查与 hash/approval 复核；未运行新迁移测试、未编写新产品实现、未生成新 manifest。

## 10. Hash 和现有 approval 状态

现有未修改代码重新构建原 Candidate，三个值全部一致：

- candidateHash：`070b3c14465c91f1ca7ae91eed47e1bbdc07b9179d2912dd5055c2f9f6909b86`
- contentHash：`3504c6fe5941eb5df494bc3c04580a1202125c0f82c43794138b475e8ae3cc12`
- approvalPackageHash：`e54cc2f4ce6e7736492bda99a70c0ad08385f2871d18853957f9247e119561fe`

当前 approvals=1、active=0，旧 approval 保留、未消费；真实 Apply=0、rollback=0。

但是现有包显式包含 `evidence.productionDeployment.commit`、guardFiles、guardImplementationHash；`deployment.py` 要求 exact deploymentCommit 和 guard hashes。实现新迁移可信模型/保证并发布以后，不能预先保证审批包不变。尤其不能删掉这些绑定来保住旧 approval。

后续应按用户第 25/27/28/50 节在最终代码及正式保证下重算，任何一个 hash 改变即进入 PILOT_REAPPROVAL_REQUIRED。此刻没有新实现/新包，因此不虚构 new hash，也不把旧 approval 当成未来 schema/API 的授权。

## 11. 现场保护与待决范围

原保护文件 hash 复核通过；真实 approval store 仍 objects=2/events=6/approvals=1/active=0。没有修改任何正式标的、投资判断或 Auth/Worker 凭据。

待用户审查的是上述迁移专用私有表/RPC/权限最小增量，以及 server canonical + client projection 的事务边界；当前停止源自用户给定的 production schema 授权边界，不是 Supabase skill 额外要求确认。

**PRODUCTION_SCHEMA_CHANGE_REVIEW_REQUIRED**。不部署、不 Apply，不扩展到其他 22 个标的。
