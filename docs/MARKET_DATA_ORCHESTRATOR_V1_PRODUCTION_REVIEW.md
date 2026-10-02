# MARKET_DATA_ORCHESTRATOR_V1_PRODUCTION_REVIEW

评审日期：2026-10-02（Asia/Shanghai）。评审实现：`4818a0fce774010504074709a664352057d23055`；交付清单：`0b18c7ea0530833d92aae0902292fd2f40225e22`。

## 1. Executive Summary

**PRODUCTION_REVIEW_NEEDS_FIX**。2026-10-02 后续部署前兼容性检查撤回原 READY 结论：待发布分支会撤回生产已上线的 Entry Decision Clarity，生产既有回归用例在候选源码上 17 项失败。见 [部署前停止报告](MARKET_DATA_ORCHESTRATOR_V1_PRODUCTION_DEPLOY_AND_ACCEPTANCE.md)。以下数据库审查及原部署计划保留为历史证据；它们不能替代完整前端兼容性验收。

用户恢复项目后，本轮取得 ACTIVE_HEALTHY 生产项目的真实 migration ledger、catalog、完整函数定义、RLS、grants、Data API 暴露范围和本任务所需 Auth 配置。此前 INACTIVE 导致的证据阻塞已解除。M1/M2 均未部署，目标 schema/RPC 无冲突。已有 analysis 对象与 ledger 存在历史差异，部署必须使用本报告的独立 M1/M2 事务包，禁止全仓 db push。

本地迁移、权限和故障回滚演练通过；未发现阻塞本功能部署的新增安全缺陷。本轮新增真实生产元数据证据、仅生成文件的部署包生成器及两项生产 catalog 重建测试。**没有执行生产迁移，没有创建生产凭据/任务，没有修改生产 Auth 或业务数据。** READY 表示评审通过，真正部署仍需下一次明确授权及部署当时的基线、备份和目标连接核验。

另确认：生产 GitHub Pages 仍是旧资产版本，尚无统一 freshness 模块。未来上线必须包含完整前端交付，数据库迁移本身不会修复页面与 Discussion 的判定差异。

## 2. 生产项目标识

| 项目 | 生产 | 测试 |
|---|---|---|
| name | investment-workbench | investment-analysis-test-s01 |
| id | `fntslvdxnupmdljnadec` | `lblyapnsngqnjimgskkp` |
| region | ap-southeast-1 | ap-southeast-1 |
| status | ACTIVE_HEALTHY（本轮） | ACTIVE_HEALTHY（此前测试验收） |
| PostgreSQL 元数据版本 | 17.6.1.141 | 17.6.1.155 |
| organization | pkmkmqhkbgwnsvvopkgx | 同左 |
| organization plan | Free / tier_free | 同左 |

生产环境角色的依据是仓库 `data/supabase_config.js`、PC PROJECTS 常量及 Supabase get_project 的一致映射，并非用项目名猜测；API 未返回独立 environment 标签。绝不将测试 ref 当作生产。

本轮证据：[resumed-review-evidence](market-data-production-resumed-review-evidence.json)、[生产 catalog 基线](market-data-production-live-baseline.json)。原 [review-evidence](market-data-production-review-evidence.json) 保留此前 INACTIVE 阻塞的历史记录，不代表当前状态。生产 PostgreSQL 版本来自管理面；生产 catalog 来自本轮成功的只读 SQL。

## 3. 当前生产 schema 基线与冲突分类

| 检查 | 结果 |
|---|---|
| migration history | 仅 `20260903132654_stock_universe_auto_add_v1a`、`20260903132704_stock_universe_private_rpc_boundary`；M1/M2 均无记录 |
| schema/tables/indexes/functions/triggers/policies/grants/extensions | 已取得当前 catalog；应用范围为 public、analysis_private、universe_private，4 张表、17 个函数；pgcrypto 1.3 位于 extensions |
| Auth | email 启用、开放注册、需邮箱确认；匿名登录关闭；泄露密码检查关闭 |
| security advisor | 3 个 WARN：泄露密码检查及同一 event-trigger 函数的 anon/authenticated EXECUTE；详见第 19 节 |
| A 不存在冲突 | 确认本任务目标 schema、表及 RPC 不存在；所需 digest/auth 函数存在 |
| B 同名对象 | 没有 market_private，也没有两个 public RPC 的任何同名重载 |
| C 功能重叠对象 | 有旧 input_queue、universe reader capability、analysis snapshot；已审阅定义，职责独立，不复用或覆盖 |
| D schema drift | analysis_private 及其 RPC 已存在，但 ledger 无相应记录；保留原状，不补跑历史迁移 |

已准备 [只读 catalog 查询](../scripts/market_data_review_baseline.sql)，覆盖所有非系统 namespace 的关系、列、约束、索引、函数完整定义/owner/search_path/ACL、普通及内部 trigger、event trigger、policy、default privileges、角色与 extension。查询使用 `BEGIN READ ONLY`，不读取业务行，不调用应用 RPC。特别注意：`market_data_account('read',...)` 会将过期 running 任务置 failed，**不属于本轮只读检查可调用的接口**。

4 张既有表为 `public.input_queue`、`public.stock_universe_entries`、`universe_private.reader_credentials`、`analysis_private.analysis_sync_modules`，均启用 RLS。旧 input_queue 是通用输入队列，没有本任务的 owner/lease/versioned result/capability 协议；reader 是只读股票池授权，analysis 是分析模块快照。没有证据表明应让本任务覆盖它们。

Data API 通过只读 GET、`Accept-Profile: market_private` 与 `limit=0` 核实：PGRST106 明确仅暴露 `public, graphql_public`。没有调用可能写状态的应用 RPC，没有读取真实业务行。anon/authenticated 在相关 schema 均无 CREATE、无超级用户/BYPASSRLS、无角色继承授权；service_role 的管理级 BYPASSRLS 不用于 Browser/Worker。现有 auth.users 只有内部 FK 检查，无自定义 Auth trigger；旧 universe 外键本来已有 NO ACTION 删除限制。新迁移会增加同类引用约束，未来删除用户必须先处理关联数据。

## 4. Migration diff

测试远端 version 与本地文件映射：

| 代号 | 测试远端 migration | 本地 SQL |
|---|---|---|
| M1 | `20261002020030_market_data_orchestrator_v1` | `20261001155527_market_data_orchestrator_v1.sql` |
| M2 | `20261002021340_market_data_worker_capability_lock` | `20261002021235_market_data_worker_capability_lock.sql` |

LF 规范化 SHA-256：M1 `626f36d353c5490e5cdf68b747bbaf26584d68739d239510cedc4643570e2098`；M2 `ba6e5d809f052fffd6f5bfaf3af76cf104e87559eba6bfcdde773bc71eb3f30a`。不要因 version 不同就重复执行；需核对目标 ledger 的名称、SQL 和对象定义。

| 操作 | M1 | M2 |
|---|---|---|
| 新建对象 | market_private、3 表、8 索引、5 函数、3 policy | 无新对象，前提为 M1 已成功 |
| 修改对象 | 新 schema/表/函数的 ACL，3 表 RLS | CREATE OR REPLACE private.account/private.worker |
| DROP | 无 | 无 |
| ALTER | 新表 ENABLE ROW LEVEL SECURITY | 无 ALTER TABLE |
| GRANT | schema USAGE 给 anon/authenticated；account execute 给 authenticated，worker execute 给 anon | 无 |
| REVOKE | schema、该 schema 全部表/函数及两个 public 包装函数，对 PUBLIC/anon/authenticated 收紧权限 | 无 |
| RLS | 3 条 ALL deny-all | 不变 |
| 函数 | 2 private DEFINER、1 private INVOKER、2 public INVOKER | 仅统一 owner 锁与锁后 capability 复验 |
| 显式 CREATE TRIGGER | 无 | 无 |
| 内部 trigger | 外键产生 RI trigger，含对 auth.users 的引用端触发器 | 无新增 |
| 索引 | 普通及唯一 B-tree，共 8 个 | 无 |
| extension 依赖 | 既有 extensions.digest(text,text)/pgcrypto，auth.uid()/auth.jwt()；内置 gen_random_uuid/hashtextextended 等 | 同 M1 |
| data backfill | 无 | 无 |
| data migration/rewrite | 无 | 无 |

预期是功能增量，不修改持仓/Plan/订单字段或重写旧业务表。**但不能称为“完全不影响已有对象”**：外键会在 auth.users 上增加内部参照完整性检查；仍有关联 orchestrator 记录时删除 Auth 用户会被 NO ACTION 拒绝，需先完成经过审批的该用户任务数据清理。

M1 在创建外键时需短暂持有引用表 `auth.users` 的 SHARE ROW EXCLUSIVE 锁，可能等待或阻塞 Auth 写入；建议短事务、低流量窗口、session 级 lock_timeout=5s/statement_timeout=60s，超时即失败退出，不自动杀会话。不会修改登录策略，但不能承诺零等待。[PostgreSQL 外键与锁](https://www.postgresql.org/docs/17/sql-createtable.html)

前置条件：生产 market_private 必须不存在，两个 public 函数名不得冲突；本轮实查满足。因为 M1 使用 `IF NOT EXISTS` 配合 schema 范围的 REVOKE，已有其它对象时可能收紧无关权限，所以部署包遇到该 schema 或任意同名 RPC 会直接拒绝。M2 必须紧接 M1，在同一事务提交之前执行，不能单独覆盖未知同名函数。

## 5. 三张表审查

测试实际 owner 均为 postgres；生产对象尚不存在，部署包强制 postgres 执行并检查新增对象边界，本地按生产定义重建后验证通过。RLS 均 enabled、非 FORCE；owner/受信任管理角色可绕过 RLS，普通用户不可。

| 表 | 用途 / PK | FK | unique / indexes |
|---|---|---|---|
| market_private.workers | capability 哈希与到期时间；PK id | owner → auth.users.id | workers_pkey、workers_token_hash_key、market_worker_owner(owner) |
| market_private.tasks | owner/symbol 队列及生命周期；PK id | owner → auth.users.id；worker_id → workers.id | tasks_pkey、market_one_active(owner,symbol) WHERE queued/running、market_task_owner_time(owner,requested_at DESC) |
| market_private.results | 不可覆盖的版本结果；PK version | version → tasks.id；owner → auth.users.id | results_pkey、market_result_owner_symbol(owner,symbol,completed_at DESC) |

三表 browser 直接 SELECT/INSERT/UPDATE/DELETE 均不授予；Worker 没有 SQL/table 凭据，只能通过 capability RPC。private DEFINER 函数作为表 owner 访问，并自行绑定 auth.uid 或 capability.owner。result_version 字段本身不是 FK；result.version FK 与 finish 同一事务保证正常接口的任务/结果绑定，普通 caller 不能直接改列。

历史版本不会自动删除；`tasks.worker_id` 没有独立索引，当前不在删除 Worker/清理任务的热路径。大规模保留/清理时应重新评估索引和容量，不能顺带启用定时清理。

## 6. 五个函数安全审查

下列测试 catalog 已实读，所有函数 owner=postgres、return=jsonb、search_path 显式为空。生产已确认无这些函数；生产 default privileges 与既有函数已实查，下面列的是批准部署包预期新增的边界，而非已部署状态。

| 函数 / 参数 | 模式 | 普通执行授权 | 校验与用途 |
|---|---|---|---|
| market_private.task_json(t market_private.tasks) | INVOKER | 无，postgres 内部调用 | 将数据库行序列化，taskType 恒定；不执行输入 SQL、不读其它用户行 |
| market_private.account(p_action text,p_input jsonb) | DEFINER | authenticated | auth.uid 非空、拒绝 is_anonymous；object/操作/字段白名单；request 只许固定 taskType、canonical symbol；所有读写 owner=auth.uid；注册 token 必须 64 位 hex |
| market_private.worker(p_token text,p_action text,p_input jsonb) | DEFINER | anon | capability SHA-256 查表、有效期、owner 锁后复验；只许 claim/finish；finish 校验 owner+workerId+taskId+lease、结果身份/大小/完整 bar/日期一致性 |
| public.market_data_account(p_action text,p_input jsonb) | INVOKER | authenticated | 固定调用 private.account，无动态分发或独立特权 |
| public.market_data_worker(p_token text,p_action text,p_input jsonb) | INVOKER | anon | 固定调用 private.worker；anon 仅有执行入口，未持有效 capability 不得访问任务 |

实际测试库两个 public 包装函数还保留默认 ACL 的 `service_role=X`，private 函数未显式授予 service_role。生产 postgres 在 public 的 function default ACL 当前为 `{postgres=X/postgres}`，与测试不同；配合 M1 显式 REVOKE/GRANT，生产预期不继承测试库的 service_role 包装函数授权。本轮已检查 default privileges 与角色继承，本地生产重建演练通过。服务端管理角色不进入 Browser/Worker 身份模型。

两个 DEFINER 均无 EXECUTE 动态 SQL，表/扩展引用限定 schema；内置函数由 pg_catalog 解析，不依赖可写 search_path。普通角色没有 market_private CREATE 权限；字符串参数不拼接成 SQL，未发现注入或跨 owner 提权路径。

结果校验是任务协议边界，不是可信行情证明：授权 Worker 对自己 owner 的行情结果具有写入权。DB 检查 close、日期和完整标志等核心约束；完整 OHLC/连续性校验还在 PC Worker 和浏览器进行，不声称三层逐字段完全相同。

## 7. RLS 审查

| policy | table | command | role | USING | WITH CHECK |
|---|---|---|---|---|---|
| no_direct_workers | market_private.workers | ALL | PUBLIC | false | false |
| no_direct_tasks | market_private.tasks | ALL | PUBLIC | false | false |
| no_direct_results | market_private.results | ALL | PUBLIC | false | false |

无表 grant + deny-all RLS + 非暴露 schema 是分层控制。PUBLIC 指 policy 适用所有普通角色，并不意味着授予权限。之前测试已验证直接 REST 拒绝、临时 SELECT grant 后 RLS 仍隐藏全部行、outsider 读/finish 拒绝；本轮本地再次验证普通角色所有 CRUD grant 均为 false。

Worker 通过受控 DEFINER 服务边界访问，**确实由表 owner 绕过 RLS**，不是给普通 caller BYPASSRLS。其安全依据是服务器端 token/owner 检查，不是客户端自报角色；不能说 RLS 会约束 postgres DEFINER。生产实际默认权限、角色与 schema 暴露范围兼容该设计，部署包本地复演通过；真实部署后仍须执行静态检查及隔离账户验收。

## 8. Capability lock

数据库 request 仅接受 UPDATE_DAILY_MARKET_DATA，task_json 固定输出该值，worker RPC 不提供任意执行动作；PC `validate_task` 再次验证 taskType、symbol、running 与字段白名单。白名单位于 **database + worker 双层**。task 不携带 shell/script/path/URL/SQL，provider 与 source-root 是本地受信任配置。

M2 将账户操作与 claim/finish 放在同一 owner advisory transaction lock 下。Worker 在等待锁后重读到期时间，采用 clock_timestamp，避免旧事务时间误认已撤销 capability。每 owner 仅一 running；active 唯一性为 owner+symbol，而非跨账户共享队列。

撤销与完成按锁串行：在 revoke 成功返回之后，旧凭据不能再 claim、finish 或写 result；若 finish 先获得锁并提交，已完成有效版本保留。撤销不能远程杀死已经在 PC 上执行的 Provider 网络调用，但能阻止它之后提交结果。租期 10 分钟，没有云调度或任意远程执行服务。

## 9. Browser 权限模型

真实实现允许**所有正常 authenticated、非匿名身份的用户**为自己的账户创建任务并注册 capability；不是只允许某一个固定 owner，也没有管理员/名单门槛。owner 来自当前应用 Supabase user id/auth.uid，不接受请求内的 owner。没有 portfolio ownership 或“必须已持仓/已加入自选”的额外检查；symbol 只校验 canonical 格式，不验证证券现实存在。

每用户最多 50 个 queued/running；不同账户的任务与结果隔离。anonymous role 与匿名 Auth session 均不能创建任务。生产实际为开放邮箱注册、要求邮箱确认、匿名登录关闭；完成注册并登录的普通用户都属于可创建自己任务的人群，不能假设事实单用户。如果产品目标变为只向指定单用户提供能力，需另行明确策略并补服务端校验，不能依靠隐藏按钮。

## 10. Worker 身份建议

推荐 **A：专用 capability credential**，由任务所属的现有普通用户在 Browser 一次性授权，绑定其 auth.uid，默认有效期 90 天。Worker 常态运行不使用账户密码、浏览器 JWT、管理员账户、service_role 或数据库口令。

不推荐无改动地换成 B（另一个普通服务账户）：当前 capability 只可领取注册者自己的任务，新服务账户无法领取真实 Browser 用户的任务。V1 无需新增跨账户委托模型。生产首配必须人工确认 projectRef=生产、userId=实际任务 owner、workerId/到期时间正确；本轮未生成或测试任何生产凭据。

## 11. Secret 存储

生产推荐路径：`%LOCALAPPDATA%\InvestmentWorkbench\market-worker\market-worker.bin`，非 OneDrive、非 Git 仓库，使用 Windows 用户 DPAPI。常规 --pair 通过隐藏输入读取 JSON，不放命令行参数，不从 env 加载秘密；常规运行从加密文件读取。测试 harness 的 env capability 只属于显式测试路径。

Browser 首配下载 `market-worker-credential.json` 是**短暂明文传输副本**；只交给同一可信 PC，配对后从下载目录/传输位置删除，禁止提交或上传静态站点。DPAPI 不能抵御已控制同一 Windows 用户或管理员的攻击；采用本机受控账户及其默认私有目录 ACL。

程序拒绝把 state-dir 放入本工作台仓库，但不会识别世界上所有 Git 根或同步目录，因此上述固定非同步位置是操作前置条件。outbox 仅行情 payload 和标识、不含 token；正常 Worker 日志只含状态、标的/版本和固定错误。API 禁止重定向，凭据只发往 PROJECTS 白名单地址。当前提交与发布清单未包含 Worker secret。

## 12. Rotation / revoke 操作方案

Rotate 的实际语义是 **新凭据注册事务同时撤销全部旧凭据**，不支持旧/新并行有效。因此采用可接受的短暂停机，而不是假装支持“切换完成后再撤旧”：

1. 停止旧 PC Worker 自动重试，等待其当前任务终态；确认 outbox 已成功交付并清空。若状态不明，先查远端终态，保留 outbox 审计副本，不能把旧 outbox 交给新 workerId。
2. 可信 Browser 以同一 owner 登录，生成新授权；running 时 register_worker 返回 worker_busy，不能绕过。新注册成功时旧 capability 已失效。
3. 本机 --pair 安全覆盖 DPAPI 文件，删除明文传输副本；启动 --once 做授权后的安全验收，再按需常驻。
4. 检查旧 capability 的请求被拒绝；**不要在最后点击“撤销执行端授权”**，该动作会撤销包括新凭据在内的全部授权。

PC 丢失/泄露时：从可信设备以同一 owner 调用现有“撤销执行端授权”，远端 capability 全部过期、running 任务 failed/worker_revoked。queued 保留，不伪装成功。验证旧凭据 claim/finish 拒绝；之后重新配对。禁用 Auth 用户或登出不能替代 capability 撤销；若 Browser 账户也失陷，应另行执行账户安全处置，防止对方再次授权。

## 13. Auth leaked password 告警

生产本轮 advisor 与此前测试 advisor 均明确报告泄露密码检查 disabled。本轮组织管理面再次确认 Free / tier_free；官方说明该托管功能需要 Pro 或以上，目前套餐不具备开启资格。[Supabase 密码安全](https://supabase.com/docs/guides/auth/password-security)

决策：启用该功能为 **NON_BLOCKING_SECURITY_IMPROVEMENT**，不把为本功能付费升级作为本次任务强制条件；如升级套餐并获得授权，建议开启。此前获取实际 Auth/注册配置的证据条件已满足：`GET /auth/v1/settings` 返回 email=true、anonymous_users=false、disable_signup=false、mailer_autoconfirm=false，其他社交/电话入口关闭。这里核验的是本任务需要的有效公开设置与 advisor 状态，没有声称读取了全部 SMTP、密码策略等管理配置；未登录、注册或重置任何生产账户。

开启影响：新用户设置密码、改密/重置时会执行加强的密码检查；官方说明已有用户仍可用原密码登录，弱密码可能携带警告。仓库所用 SDK 登录成功时将它放入 `data.weakPassword`，现有 signIn 仅抛出 error，因此未来可另行改进警告提示。不能承诺“只影响新密码，与登录完全无关”。该开关不是 session revoke 或 JWT key rotation；预计不主动使已有 session 失效，但生产真实部署行为尚未验证。实际密码重置本身的 session 影响应与开关变更区分。

本次未读取用户密码/哈希、未升级套餐、未修改 Auth。

## 14. Migration failure safety / dry review

M1 只应执行一次；再次运行会在已存在的表处报错，并非完全幂等。M2 在同一受控 schema 上重复替换为相同定义可保持结果/ACL，但仍应由 migration ledger 控制，不手工反复运行。

已核对本机 CLI v2.109.1 的官方 `MigrationFile.ExecBatch`：整份 SQL 及 ledger 插入在同一隐式事务内。适用于该已核实 CLI 路径，**不泛化为所有 SQL Editor/MCP 执行方式必定相同**。[CLI 事务实现](https://github.com/supabase/cli/blob/v2.109.1/apps/cli-go/pkg/migration/file.go)

两个原始 SQL 文件自身不含 BEGIN/COMMIT。本轮依据实际 ledger 的 6 列、主键及 idempotency_key 唯一约束，形成 [独立生产发布 SQL](../supabase/review/market_data_orchestrator_production.sql)，由 [仅文件生成器](../scripts/prepare_market_production_release.cjs) 可重复生成，**没有执行远端 SQL 的代码路径**。文件位于 review 目录，未加入自动 migration 目录。未知 MCP 服务端版本的事务实现不在本次证明范围内。

固定执行顺序为：同一连接 `BEGIN` → `SET LOCAL lock_timeout=5s / statement_timeout=60s` → 锁定并核对原两条 ledger 的 version/name → 检查执行者 postgres、无目标对象、依赖存在 → 原样 M1 → 原样 M2 → 对象/RLS/函数/grants/M2 后检查 → 插入两条对应 ledger → `COMMIT`。使用支持整文件、同一 session、遇错停止的受控 SQL runner；SQL 本身不能认证项目 URL，必须在执行前核验连接确为 `fntslvdxnupmdljnadec`。不得将该文件再包装为 apply_migration，以免额外增加第三条 ledger 记录。任何 schema/ledger 漂移都必须重新评审。

本地内存 PostgreSQL 演练：M1 失败无残留；M2 单独失败恢复到 M1；整个发布文件在两条新 ledger 都插入后注入 division-by-zero，所有新对象、grant、两条 ledger 均整体回滚，原两条记录不变。M1 重跑在前置检查安全拒绝，M2 独立重跑定义/ACL 不变。两份独立提交不满足上线要求：仅隐藏 UI 无法阻止直接 RPC，不允许留下可调用的 M1 窗口。

dry inventory 确认为 +3 表/+8 索引/+5 函数/+3 policy。新增演练将本轮真实应用表、完整函数定义、policy、相关 grants 及 ensure_rls event trigger 在本地 PGlite 重建；应用部署包后，重建的既有对象定义/ACL/policy/trigger 与两条原 ledger 保持不变，本地合成 input_queue 数据不变。它是**基于实际应用 catalog 的本地重建，不是生产完整实例或数据克隆**；Auth 函数、系统扩展用现有测试桩，非相关托管 event trigger 未全部重建，不能替代未来部署后的真实检查。没有复制生产用户或业务记录，也没有调用全仓 db push。

生产实查 extensions.pgcrypto 1.3 及 digest(text,text) 可用。已查 Supabase 当前 changelog；17.11 的 pgcrypto 破坏性变化针对 legacy PGP cipher，本任务使用 SHA-256 digest，不依赖这些算法，不需要为本任务升级数据库。[官方变化说明](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)

## 15. Rollback plan（计划，未执行）

优先 disable/revoke，保留审计数据，不自动 DROP：

1. 下线/回退 orchestrator UI 入口并暂停 PC Worker。浏览器隐藏按钮不是权限边界，必须同时在受控维护事务中收回 `public.market_data_account(text,jsonb)` 与 `market_private.account(text,jsonb)` 对 authenticated 的 EXECUTE（两层均收回）。这会同时停用行情任务 read/pair/revoke UI，既有其它业务 RPC 不变。
2. 收回 `public.market_data_worker(text,text,jsonb)` 与 `market_private.worker(text,text,jsonb)` 对 anon 的 EXECUTE；查 effective grants，确保没有其它非受信任角色入口。只处理本任务四个函数，不 revoke schema public 或其它项目函数。
3. 在 owner 锁保护下使 market_private.workers 的 capability 全部到期，并把本任务 running 标 failed/worker_revoked；保留 queued、results 和历史终态。锁内串行处理，等待已经开始的事务结束；提交后验证旧凭据不可访问。
4. 验证持仓/Plan/订单/登录/旧手动日K与静态 bridge 仍可用。保留经过授权的行情回读数据；不自动改动真实用户本地存储。
5. 如确需清理对象，先导出任务结果、检查依赖并另获授权；先 public 包装、private 函数，再 results/tasks/workers、最后空 schema。禁止 `DROP SCHEMA ... CASCADE`，禁止删除 auth.users 或回滚其它业务迁移。

原 schema 不存在时无需“恢复旧行情表”；重新启用时必须按本报告授权矩阵恢复本任务 grant，并验证 M2 仍在。若未来需要回滚，应依据届时已部署的 catalog 复核具体语句；本报告不提供自动执行的回滚脚本。

## 16. Production deployment plan（需后续明确授权）

1. 本轮只读评审已通过。取得下一次明确部署授权后，再核验项目 `investment-workbench / fntslvdxnupmdljnadec`、当前 catalog/ledger/Auth/暴露 schema 与本报告一致；如有变化先暂停并复审。
2. 记录可恢复 backup/PITR 或受控备份方案及基线，确认恢复步骤；当前 Free 计划不假设具备 PITR。固定 migration SHA、发布 commit、prod ref、执行角色、maintenance window 和两个 migration allowlist。
3. 保留当前未带 orchestrator 的公开 Pages。核验独立发布文件由已审查原始 SQL 生成；使用同一受控连接执行第 14 节整个文件，不逐份提交，不执行目录中其它历史 migration。备份/基线和项目连接核验是文件之外的必要部署步骤。
4. 事务依次执行 M1、M2、对象与权限检查、两条 ledger，最后一次 COMMIT。M1/M2 使用测试已验收的远端 version：`20261002020030`、`20261002021340`。发生锁超时、检查失败或执行错误即整体回滚，不能让客户端访问缺少 M2 的 M1。
5. 进行数据库静态权限检查：匿名/普通用户无直接表权限，account/worker 两层 grant 正确，private 未暴露，advisor 无新增相关问题；原有业务对象定义/ACL 与基线一致。
6. 通过仅供验收的受控页面版本加载完整已审查资产；不得只发布一两个 JS 文件。隔离生产安全账户与零持仓临时本地 workspace 中生成临时 capability，DPAPI 配对固定 PC；不使用真实 owner 密码充当 Worker 凭据。
7. 执行第 17 节最小验收。开始时 Worker 离线，确认 queued，再手动启动 --once；使用真实 ProviderChain 回读版本。所有行情测试仅属于隔离账户，不改真实业务对象。
8. 撤销临时 capability、退出/停用临时账户并保留最少审计记录；处理 outbox，确认没有遗留 running。若需清理测试行，应逐 owner 定向清理，按外键顺序并保留证据。
9. 校验发布 manifest、全部 script cache version 及生产公开配置；发布完整前端 `market-data-orchestrator-v1-20261002`，源码 commit `4818a0fce774010504074709a664352057d23055`，清单 commit `0b18c7ea0530833d92aae0902292fd2f40225e22`。清单包含 89 个源资产，加清单共 90 个交付文件；manifest SHA-256 为 `77d6a812512626b4470afb4f766563629ec81b5a26c7d83c51d9e69817c6cd53`。可由包含这些提交的本评审分支交付，但不得混入未审查资产。验证浏览器实际加载版本与统一 freshness；仅部署数据库不满足本功能上线要求。
10. 在可信 PC 为真实使用账户另行首配正式 capability，采用人工启动 CLI（常驻五秒轮询或 --once）。不要安装 Windows Task Scheduler、登录自启或云 Worker。开放正常按需 UI，观察基础状态后结束发布。

生产 API 实际授权仍是所有正常 authenticated 用户，不存在现成按用户 rollout 开关；受控验收页面只控制 UI 可见性，不能称为服务器端灰度名单。若要求维护期间完全禁止其它账户调用，应另行设计临时 grant/角色维护窗口后重验，不临时放宽 RLS。

## 17. Production acceptance plan（未执行）

使用两名隔离账户 owner/outsider、独立浏览器 context、本地零 shares/空 plans/orders、canonical 安全 symbol（例如 601869.SS，仅行情事实）。正常验收不读写真实账户数据。

| Case | 验收条件 |
|---|---|
| 1 Browser 创建 | 固定 UPDATE_DAILY_MARKET_DATA，远端 queued，归属 auth.uid |
| 2 Worker offline | PC 关闭/睡眠/进程未运行时保持 queued；startedAt/workerId null，UI 等待执行端 |
| 3 Worker online | 手工 --once 后真实 claim，running 与 workerId/start 时间一致 |
| 4 ProviderChain | 真实 provider + 日线 merge + indicators；必要连续性不满足时应 failed，不能绕过 guard 凑成功 |
| 5 versioned result | succeeded 与结果原子提交，Browser 回读同一 resultVersion/taskId |
| 6 freshness | latestCompleteBar=technicalAsOf；页面和 Discussion 使用同一版本/判定，陈旧结果也允许双方一致为 stale |
| 7 dedup | 同一 owner/symbol 并行创建复用一 active task，第二 claim 不重复执行 |
| 8 invalid symbol | 非 canonical symbol、taskType、额外 command/path/URL/owner 均拒绝 |
| 9 unauthorized | guest/匿名 Auth 不可创建；outsider 不可读/finish owner 任务结果，表直接读写拒绝 |
| 10 revoke | 撤销完成后旧 credential 无法 claim/finish/改状态/写结果；旧有效 result 不变 |

还应定向复核失败不覆盖旧结果及运行中轮换拒绝。保留状态时间线、版本、指纹、页面/Discussion 结果，不保存 token。若验收失败，立即停在 disable/revoke，恢复旧手动流程；不能自动扩大生产写入范围。

## 18. Blocking issues

| 编号 | 此前阻塞 | 本轮结论 |
|---|---|---|
| P0-01 | 生产 INACTIVE，真实 schema/ledger 未取得 | 已解除：Healthy、实际 catalog/ledger/依赖已取得，按真实应用定义完成本地 dry diff；历史漂移隔离处理 |
| P0-02 | Auth/注册/有效 grants/exposed schemas 未核实 | 已解除：已取得有效 Auth 设置、角色/默认授权、Data API 暴露范围；明确为所有已登录非匿名用户自己的任务 |
| P0-03 | 未形成绑定真实 ledger 的事务部署包 | 已解除：已生成并本地验证 M1→M2→后检查→两条 ledger 的单事务文件；后续部署仍须目标连接核验、备份及明确授权 |

后续部署前新增阻塞 P0-04：完整前端候选未包含生产已上线的 Entry Decision Clarity，相关生产回归 17 项失败，必须先整合并重新评审；原“无待修复阻塞”结论撤回。auth.users 已存在 NO ACTION 引用，新任务数据会增加用户删除前的清理需求；这项影响已记录，部署不会删除用户或改变登录设置。下列既有风险不纳入本任务修改，也不把本次评审表述为整个生产数据库已无安全问题。

## 19. Non-blocking improvements 与兼容性

- Auth 泄露密码检查：本轮记为 NON_BLOCKING_SECURITY_IMPROVEMENT，升级套餐/启用需单独授权；现有 Browser 高熵密码/MFA 运营策略不可用猜测替代。
- 既有 `public.input_queue` 的测试 policy 允许 anon SELECT/INSERT/UPDATE，是真实且应专项处理的存量权限风险；本轮仅 GET `select=id&limit=0` 与读取 policy/ACL，没有读取业务行或尝试写入。旧 [股票池文档](stock-universe-auto-add-v1a.md) 已记录这一遗留范围，本任务不调用该表，M1/M2 不改变其暴露面，因此不将无关 schema 修复并入本次发布。该结论不是认可其可长期保持公开。
- `public.rls_auto_enable()` 因默认 EXECUTE 被 advisor 标记两条 WARN。实查它返回 event_trigger、owner=postgres、search_path=pg_catalog，只遍历 CREATE TABLE 等 DDL 的 catalog 并作用于 public 新表。本地重放普通 SELECT 报“trigger functions can only be called as triggers”；不能把 advisor 描述直接当作已证实可通过匿名 RPC 任意执行 DDL。建议另行收紧其普通 EXECUTE；本轮不修改，也不在生产试调用。M1 创建 market_private 表时该 trigger 跳过；其它 DDL watch 是 PostgREST cache NOTIFY。
- Worker 目录路径规范、短暂明文下载清理、90 天到期/人工轮换已纳入运行手册；V1 接受手动启动，不安装调度器。
- 当前 [生产 Pages](https://flyinlemon-h.github.io/investment-workbench-mobile/) manifest 为 `entry-decision-clarity-v1-20260920`，sourceCommit `23a7eb0979cd6c7e8e3115b71d2153148c68f170`。技术页/Discussion JS 均没有共享 evaluateTechnicalFreshness 引用，shared 模块返回 404。因此未执行任何真实用户数据场景也能确认统一实现尚未交付；不能据此声称现场复现了某真实用户 stale/ready 冲突。
- 待发布源码：technical-view-ux 与 discussion-data-readiness 共同调用 TechnicalFreshness，state 不再用 current 标签强制 fresh；版本字段一路传递。回归覆盖 stale/ready 冲突，未来发布后仍需核对实际加载 bundle/cache。长假工作日宽限不是完整交易所日历，可能保守 stale。
- 默认 ON-DEMAND ONLY：只有更新按钮调用 create；五秒轮询读取已有任务（并处理过期租期），不自动创建任务/遍历股票，不启动 Discussion、Plan、交易或 batch scheduler。
- 旧 PC 手动日K、batch、quote、technical review、static bridge 代码路径保留；RPC 服务故障只影响新任务入口。Worker seed bridge 只读；不会替换旧手动发布器。
- 无全局版本自动清理或无限并发 scheduler。今后容量、长时间历史保留与 Worker FK 索引可专项评估，本轮不扩展。

## 20. Tests / Final recommendation

本轮重新验证：npm test **1106/1106**；离线评审测试 **7/7**，合计 **1113** 个不同 JS/SQL 测试；Python **27/27**；1280×900、390×844、360×800 三视口全部通过。定向 registry/orchestrator/freshness/review 合跑 **19/19**，已包含前述套件，不重复计数。

离线测试覆盖预期对象/ACL、M1/M2 中途失败回滚、M1 重跑安全失败、M2 重跑定义/ACL不变、只读基线查询语法、实际生产应用 catalog 重建及既有定义/权限保留、整个发布事务连同 ledger 回滚。运行命令：`node --test tests/market_production_review.cjs`，只创建内存 PGlite，绝不连接生产。原有 55 项远端验收仅作为此前测试项目证据引用，不冒充生产验收。

完整 Pages artifactPlan 校验通过，共 90 个交付文件；本轮 7 个交付文件的凭据标记扫描和 git diff --check 通过。生产事务文件 LF 规范化 SHA-256：`a2bf856a1074df9282ce4b646b3b1b842244174aac729e5a08f9045037460387`，生成后未远端执行。

产品代码和原始 M1/M2 migration 均未修改。本轮修改报告/评审测试，新增生产只读证据、仅文件生成器、本地生产 catalog fixture 和待授权的事务 SQL 文件。既有两个未提交行情 bridge 文件保留，不纳入评审提交；没有 Git push、Pages deploy、生产 Worker 启动或生产写入。最后再次只读查询确认 ledger 仍只有原两条，market schema/RPC 仍不存在，见 resumed evidence。

生产数据库实态证据已补齐，相关安全设计和本地事务演练结果保留；但后续部署前检查证明指定前端遗漏生产已上线功能，原完整发布结论撤回。必须先保留生产现有能力整合 Orchestrator、重新生成资产清单并完整回归。后续部署任务已在任何生产写入之前停止。

**PRODUCTION_REVIEW_NEEDS_FIX**
