# MARKET_DATA_ORCHESTRATOR_V1_PRODUCTION_DEPLOY_AND_ACCEPTANCE

日期：2026-10-02（Asia/Shanghai）。状态：**PRODUCTION_REVIEW_NEEDS_FIX**；停止阶段：部署前兼容性检查。没有执行生产写操作，没有进入数据库部署或生产闭环验收。

## 授权与停止依据

用户本轮明确授权生产项目 `investment-workbench / fntslvdxnupmdljnadec` 的 M1/M2 单事务部署、指定完整前端发布及隔离账户验收，同时要求“每一步完成后验证”“验证失败立即停止”“不在失败状态继续下一阶段”。

本轮在推送、数据库写入和前端发布之前发现：评审提交 `d9766de3f599a62e2b12d158003949ae4a1d2706` 所指向的前端缺少生产已上线的 Entry Decision Clarity 功能。用生产当前回归套件对待发布源码进行本地验证后，31 项中 17 项失败；相同套件在生产 main 对应源码上 31 项全部通过。按上述要求停止，没有尝试“先部署数据库再处理前端”。

这是上一轮评审遗漏的现有前端兼容性问题，不是生产 schema 发生了未预期变化。上一轮 READY 结论被本报告撤回；数据库评审证据仍保留，但不足以单独批准整项功能发布。

## 部署前生产基线

| 检查 | 实际结果 |
|---|---|
| 项目 | investment-workbench / fntslvdxnupmdljnadec |
| 区域、状态 | ap-southeast-1、ACTIVE_HEALTHY |
| 数据库版本 | 管理面 17.6.1.141；SQL catalog PostgreSQL 17.6 |
| 当前分支 / HEAD | codex/market-data-orchestrator-v1 / d9766de3f599a62e2b12d158003949ae4a1d2706 |
| production main | 27731979dc4b63b57d7a6ed262478261140484a4 |
| 当前 Pages | entry-decision-clarity-v1-20260920；sourceCommit 23a7eb0979cd6c7e8e3115b71d2153148c68f170；deploymentCommit 与 production main 相同 |
| migration ledger | 仅 20260903132654_stock_universe_auto_add_v1a、20260903132704_stock_universe_private_rpc_boundary |
| 旧 ledger 内容 | statements MD5 分别 ea140f2862d4aa615e3429defb5a19be、387b5e4eed8246aa197cdeefba5caded，与评审一致 |
| M1 / M2 | 均未部署 |
| market_private / public RPC | schema 不存在；两个 public RPC 的同名重载数量为 0，因此没有本任务的表、索引、函数、policy 冲突 |
| 应用 catalog | 2026-10-02 10:48:06 UTC 重新读取，schema/列/约束/索引/函数完整定义/trigger/policy/grants/default privileges/roles/extensions 与评审基线逐字段比较，差异为空 |
| Auth 有效公开配置 | 与评审记录完全一致：邮箱注册开放、邮箱确认开启、匿名登录关闭；未修改任何设置 |
| 工作树 | 仅原有两份行情 bridge 文件未提交；本轮未将其纳入任何发布 |

业务行未输出；仅记录 4 张既有应用表的 count/内容摘要作为部署前基线：analysis_sync_modules=0、input_queue=2、stock_universe_entries=23、reader_credentials=2。未创建生产验收账户，也未读取或操作真实用户浏览器存储。

## 阻塞：待发布完整前端会撤回已上线能力

更新远端引用后，生产 main 与评审分支分叉：main 独有 22 个提交，评审分支独有 8 个提交；共同祖先为 `8e529b727b9492a7a0195ef2dc446558423e1eb6`。生产独有提交包括 `23a7eb0` 的 Entry Decision Clarity，以及相关修正；不能通过强推或直接部署旧分支覆盖。

具体差异位于：

- `src/entry-decision.js`：待发布版缺少已上线的明确状态文案、已完成/待满足条件分组、条件完成后的结果及失效依据展示。
- `src/ui-render.js`：缺少建仓决策优先展示、原始 AI 表述折叠和既有 Plan 独立说明。
- `src/discussion-state-contract.js`：缺少已上线的对应预览/文字诊断行为。
- `index.html`：缺少对应 Clarity 样式。
- 当前分支没有生产已有的 `tests/entry_decision_clarity.test.js` 与浏览器验收脚本。

这不仅是文字差异。失败用例包括 ready 状态与矛盾原文的展示优先级、预览与详情一致性、完成/待满足条件分离、升级结果、失效依据和 needs_review Plan 提示。直接发布原 90 文件清单会撤回这些已经存在的行为。

## 本轮验证

| 验证 | 结果 |
|---|---|
| Orchestrator / registry / freshness / migration review 定向测试 | 19/19 PASS |
| 生产现有 Clarity 套件，对生产 main 源码 | 31/31 PASS |
| 同一 Clarity 套件，对待发布分支源码 | 14 PASS / 17 FAIL |
| 生产最终只读检查 | 2026-10-02 10:54:41 UTC，旧两条 ledger 内容未变，market schema 不存在、RPC 数量 0 |

Clarity 对照是本地 Node 测试，不访问生产业务接口，不调用 AI。对照源码来自 `git archive origin/main src tests/fixtures tests/entry_decision_clarity.test.js`；候选源码来自当前分支。结果可在忽略目录 `test-results/market-production-main-control.log`、`test-results/market-production-existing-ui-gate.log` 查看；精简可复核证据见 [部署前停止证据](market-data-production-deploy-stopped-evidence.json)。

此前 1113 JS/SQL、27 Python、三视口属于上一轮评审结果，本轮没有把它们冒充为新的生产验收。本轮未进入手机视口、生产 Worker、真实 ProviderChain 或 freshness 远端验收。

## 执行通道的附加情况

Supabase MCP 只读查询可用。CLI 受控查询与备份命令帮助已核对，但本机 Supabase CLI 尚未登录；只读备份列表请求返回 Access token not provided。没有取得物理备份清单，没有创建备份，也没有尝试从应用内部提取凭据。本次尚未执行事务文件；重新准备部署时必须确认受控整文件事务通道和备份/恢复方案，不能改用会增加第三条 ledger 的 apply_migration 包装来绕过。

这不是自动审批拒绝；它是 CLI 缺少登录状态，与已证实的前端兼容性阻塞分别记录。

## 未执行与生产保护

- M1/M2、ledger、RLS、函数和 grants：没有任何部署或修改。
- Pages / Git：没有 push、workflow dispatch 或前端发布；线上仍为原版本。
- Auth：没有配置修改、账户创建、登录测试或禁用操作。
- Worker：没有生产 capability、凭据、进程或任务；不需要撤销或清理远端验收权限。
- 没有持仓、Plan、订单、行情结果或真实业务数据写入，因此不需要生产回滚。
- 未改 input_queue、analysis schema 或历史 ledger；未安装 scheduler 或提供任意远程命令执行能力。
- `input_queue` 匿名读写风险保持 **SEPARATE_SECURITY_FOLLOWUP**；泄露密码检查保持 **NON_BLOCKING_SECURITY_IMPROVEMENT**。二者没有被用于代替本次具体阻塞，也未顺手修复。

## 重新进入评审所需工作

1. 在保留当前 production main 已上线能力的基础上整合 Orchestrator；不得覆盖真实行情文件或强推旧分支。
2. 重新生成完整发布清单，记录实际整合后的源码/发布提交，重新审查所有资产差异。
3. 执行整合后的全部 JS/SQL、27 Python 和三视口，并保留生产既有 Entry Decision/Clarity 回归；不得以旧分支较少的测试数代替生产现有覆盖。
4. 确认实际受控事务执行通道、提交前权限检查及备份/恢复方案，再重新给出可部署结论。
5. 本轮按失败停止要求不继续上述产品整合，也不推进任何生产阶段。

产品代码和 migration 未修改；本轮交付仅为停止报告、精简证据和此前评审结论的更正。

**PRODUCTION_REVIEW_NEEDS_FIX**
