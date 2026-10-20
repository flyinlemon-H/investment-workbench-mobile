# 2899_YAHOO_BOUNDED_AUTO_REVISION_END_TO_END_V1

日期：2026-10-20。范围：2899.HK / Yahoo 日K。最终状态：`READY_FOR_BOUNDED_AUTO_REVISION_PRODUCTION_DEPLOY`。

## 用户现在能否正常更新日K

**生产日更尚未恢复，本轮完成的是工程实现、隔离闭环、真实测试项目验收与发布准备。** 生产数据库、Pages、正式 PC Worker 均未部署本次改动，生产自动修订未启用，实体手机未验收。不能将以下通过结果视为生产已可用。

唯一推荐下一步：一次批准本文列明的数据库、Pages、PC Worker 配套发布，仅为当前 owner 的 2899.HK 启用策略，并完成首次真实 Yahoo 日更及实体手机接收验收。未来抓取仍须逐次满足全部规则；若超界，保留旧版本并明确报错，不能沿用旧 Provider Rebase approval 覆盖。

## 基线与保护边界

- 生产基线：`4b7585c41ccf67874f0882ea311c4ad08f00d6e9`；本分支包含该基线，继承上一轮 `61c36b46db0bc882919ba6b3c4e187d9153999f2`。
- 工作分支：`codex/2899-bounded-auto-revision-v1`，独立 worktree；未混入原用户工作目录的行情文件改动。
- 原 Approval：`f146c073-dfe3-43ae-8610-0f09b4e64493`；Migration：`b804f5b6-7098-43c8-8d96-048a59c6c80c`。
- 生产只读复核：current=`353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66`；previous/rollback=`041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70`；generation=1；migration count=1。
- 生产完整 bundle canonical hash=`5d3304239f4a4f7720fa4a8ede370a355368e6e26a1153d8613cb7b81d343427`，430 根，2025-01-09 至 2026-10-08；最终复核仍一致；新 daily schema 不存在。
- 本轮没有生产 Stage、Approve、Apply、Rollback、行情任务、Auth 修改或业务写入。没有新 AI 请求。
- 原 PC 两份行情快照、桥接文件、已安装 Worker/provider/updater/guard 共17个受保护文件校验未变；PC 正式旧快照仍保留。测试使用实际 PC 代码的隔离副本，并仅在副本替换 candidate integration.py。

## 实现及三级规则

`UPDATE_DAILY_MARKET_DATA` 继续作为唯一任务类型。2899 受信任 daily head 存在时，Worker 读取远端完整当前版本，不把 PC 的旧混源文件作为权威基线。其他标的或尚未配置的账户使用原路径。

| 分类 | 行为 |
| --- | --- |
| NORMAL_UPDATE | 原历史未变，只追加完整日K；使用同一普通日更任务，受管理的2899通过可信提交协议原子发布；不进入 Rebase 审批 |
| AUDITED_REVISION | 完整新历史一次性发布，保存实际差异、原始观察、previous、技术版本及审计收据 |
| REVIEW_REQUIRED | 旧正式版本不变，任务显示具体安全错误；保留隔离修订证据，不自动批准 |

规则 `yahoo-hk-adjclose-ulp-pilot-v1`：来源/Parser/Normalization/单位不变；日期不丢；quote OHLC/volume 不变；amount 语义不变；raw 与完整 bars 绑定；两次独立抓取完整观察一致；adjclose 精确 float32 ≤2 ULP；旧 OHLC 差≤0.000004 HKD；旧窗口≥430、修订≤140、比例≤140/430；离散关系/交叉/风险信号不变；MA上界 d+1e-6，MACD DIF/DEA 2d+1e-6、histogram 8d+1e-6，d=4e-6；CAS/owner/capability/审计全部满足。

没有全局比较容差、丢弃精度或伪造相同 hash。服务端独立解析 raw、复算全部 deterministic technical preview，并校验完整 bundle equality；SQL half-even round 与 Python binary64 舍入黄金案例一致。新增完整日可正常改变技术信号；修订影响比较使用相同旧日期窗口，避免新增日掩盖历史修订影响。

单位证据修复位于 `scripts/provider_rebase/integration.py:ContinuityChain.fetch_daily`：仅当既有 source contract 指定 `empirical-exchange-v1` 时传递该 profile，由既有 `evidence.units_gate` 校验；`confirmed=false` 保留，证据等级仍为 `EMPIRICALLY_VALIDATED`。普通 revision.py/continuity guard 仍拒绝未经专用协议处理的修订。针对该问题的回归确认返回 SAME_PROVIDER_REVISION 而非误报 UNIT_CONTRACT_INCOMPLETE。

Worker 新增 `daily_protocol.py`；`market_data_worker.py` 复用 claim/running/outbox，网络不确定时重放同一提交，服务端完全相同提交幂等，改变提交拒绝；capability 撤销后连重放也拒绝。`market_worker_errors.py` 和浏览器均使用固定错误枚举，未知异常脱敏，不能输入远程 command/path/URL。

## 数据库、RPC 与权限

唯一新增 migration：`supabase/migrations/20261020033733_bounded_daily_revision_v1.sql`。

SHA-256：`795801012a15d8aec6aaed70833f9ba764264ce780c81f1bc26f5b1f29244d35`。

| 对象 | 作用与权限 |
| --- | --- |
| market_private.daily_versions | owner/symbol 范围、不可变完整事实、raw、receipt、previous；RLS enabled，无客户端 policy/grant |
| market_private.daily_heads | 当前 UUID、generation、enabled 默认 false；RLS enabled，无客户端读写/启用权限 |
| 4个索引 | 两张表主键、task_id 唯一约束索引、owner/symbol/created_at 索引 |
| daily_versions_immutable trigger | 禁止 UPDATE/DELETE，使用已有 immutable helper |
| daily_result_guard trigger | 仅受管理 owner/symbol 的 results 插入须匹配可信新版本；旧 Worker 不能绕过；其他22个标的原行为不变 |
| public.market_data_daily_worker(text,text,jsonb) | INVOKER，anon EXECUTE；必须再通过固定 capability、owner、task/worker/lease 校验 |
| public.market_data_daily_current(text) | INVOKER，authenticated EXECUTE；auth.uid 隔离；匿名 Auth 拒绝；移除原始观察 |
| private daily_worker/daily_account | SECURITY DEFINER，空 search_path，分别只开放给上述对应角色；无用户可写 schema 依赖 |
| private daily_bootstrap/daily_restore | operator-only INVOKER；anon/authenticated/service_role 均不能执行；不是客户端自授权入口 |
| 其他私有 helper | daily_round/check/view/bars/identity/raw/technical/result_guard；全部默认撤权；合计14个新函数（12 private +2 public） |

没有修改旧任务 RPC、迁移 RPC、原 ledger 或 Auth 配置。新增结果 trigger 是 scoped 防绕过门禁，并未改写旧 RPC function body。提交使用 owner advisory lock、当前版本/generation/hash CAS 和单事务：immutable version → result → head → succeeded，失败整体回滚。

恢复不会删除新版本：仅允许 CAS 匹配的当前 immediate previous，完整事实恢复为另一个 immutable version，generation递增并禁用 enabled；原 Rebase rollback pointer 始终保留。正常成功不恢复。

## 浏览器、技术事实与业务保护

新增 `src/market-data-daily-receiver.js`，由 `market-data-task-ui.js` 轮询和任务结果接收调用，优先读取可信 daily current。缺少新 RPC 时兼容原版本；已有 daily head 时不让旧 Rebase bundle 覆盖新日更。

接收校验登录 owner、symbol、generation、canonical bundle hash、identity、完整 source/technical/content 一致性；本地事实必须匹配服务端祖先版本。保留 previousLocalSnapshot/hash，按原 StorageManager critical save 和多标签 CAS 先持久化再 adopt，更新仅四个行情/技术字段及派生接收状态。未同步业务改动不覆盖；事实冲突、并发业务改动或保存失败则停止接收并保留旧状态。

`state.js` 增加已接收一致事实的规范化保留逻辑，避免重载时丢弃 aiJudgmentStatus 等字段；这不是普通 JSON/CSV/Bridge 写入授权。普通导入守卫保持严格。

成功后 bars/content/technical/latestCompleteBar 在技术页、Freshness、dataReadiness、Discussion Context 一致。旧 AI 判断为 needs_review，历史 Discussion 正文/history、Holding、Plan、Orders 保持不变。浏览器没有自动调用 AI。

UI 默认显示日期、等待执行端/正在更新/成功/明确失败。内部 hash/receipt 保存在诊断和审计中。过时日期依旧按现有 freshness 规则变 stale；测试用未来参考日期验证 Discussion 不会假装 ready。

## 真实证据与端到端结果

归档真实 A→B/C：A 为生产430根；B/C是两次独立 Yahoo 响应，436根截至2026-10-16，新增6根；140个旧日期有受限adjclose修订，旧 quote/volume 不变，最大归一化OHLC差4e-6。盘中2026-10-20不被采纳。

Raw A SHA-256：`17828a59327d0d260187a4d278d871d997dad84caeb6b4048c380736990b870d`。
Raw B：`b7f83b638ae6dfa3a7e510beee0be7a29d910acbdb5daee4c873d64d446372d9`。
Raw C：`a5de09a97052cc8d9b65cf3d7f8f604d615add322092175c1aecd15aa2b7a43d`。

436根隔离结果 contentHash：`6d4cc069291c2120fb182957c460418e7fb03dabc7af932708de3a47ba280085`；technicalVersion：`defbe2a890a09c5d914ead45ba260eb212d219af20c872562e1dafc8f36ed497`。这些不是生产已发布版本或新的 Rebase approval。

正常追加对照使用“已修订B的前430根”作为合成稳定基线，再追加实际B/C后6根；这是明确的隔离控制组，不声称生产旧430从未修订。

隔离浏览器真实执行按钮 → queued/离线保持queued → 重复任务抑制 → Python Worker run_once → 固定Yahoo Parser读取真实归档响应 → SQL独立复核 → succeeded436 → 浏览器接收/持久化 →技术/Discussion → 刷新。两条路径×360/390/1280，共6组通过。最新一次使用实际已安装PC代码的隔离副本，带候选 integration.py，验证真实 guard装载兼容。

每组都保护22个其他symbol、非空旧Discussion历史、Plan、Holding等对象；失败任务保留成功结果；未来参考日期显示 stale、不允许 Discussion 用旧快照假装就绪。

## 真实测试 Supabase

项目：`investment-analysis-test-s01 / lblyapnsngqnjimgskkp`，ap-southeast-1。恢复测试项目后先记录原 ledger/schema/function hash，再单独 apply_migration。实际 ledger 为 `20261020040250_bounded_daily_revision_v1`（管理 API 生成时间戳），对应上述精确本地SQL。生产未来须记录它自己的真实ledger，不改写测试ledger时间。

真实远端 PostgreSQL：AUDITED_REVISION **25/25**，NORMAL_UPDATE **25/25**。两组以随机临时 Auth owner/outsider 和 capability 在事务中建立隔离场景，通过 public wrapper + anon/authenticated 实际角色/JWT claims 调用；不是实体浏览器的真实 Auth 登录验收。结束 ROLLBACK，用户数恢复原2，daily_heads=0、daily_versions=0，无测试账户/任务/capability残留。

覆盖默认关闭、离线queued、重复active抑制、owner/outsider、匿名读拒绝、Browser不能submit/restore/直改表、错误hash/技术事实、CAS、规则白名单、原子失败注入、成功回读436、幂等、previous、raw不外泄、immutable、恢复失败原子性、完整恢复、新generation、原Rebase不变、capability撤销。

部署后旧16个函数定义hash不变。新表RLS开启且无客户端读写grants。Security advisor只有预期私有表“RLS enabled no policy”INFO；已有 leaked-password protection disabled WARN保持原状，不修改Auth。

## 全量验收

| 门禁 | 结果 |
| --- | --- |
| JS/SQL全量 | 1381/1381 PASS |
| Python全量 | 159/159 PASS |
| Production Release Gate | 207/207 PASS |
| Entry Clarity | 31/31，包含在全量门禁；浏览器24/24 |
| Canonical浏览器 | 3/3，360/390/1280 |
| 新日更浏览器闭环 | 6/6，两种成功路径×三视口 |
| 测试项目真实SQL | 25/25修订 +25/25追加 |
| PC安装器 | 默认只读、精确双root/基线hash、tamper/path拒绝、第二目录安装失败恢复第一目录，通过 |
| Provider Continuity/Revision/Approved Migration/Auth/Discussion | 包含在1381 JS/SQL和159 Python；旧迁移fixture固定为真实旧guard synthetic capsule，不伪造新hash符合旧审批 |

反例包含>2ULP、价格超界、quote/volume变化、日期缺失/重复、141天超范围、来源/单位变化、技术信号跨界、观察不稳定、缺失raw/adjustment、假收据、hash错、并发CAS、owner越权、撤销、重复改提交、中途失败和恢复失败，全部拒绝自动覆盖。

本地完整证据：`test-results/bounded-daily/`（full-js-sql.log、full-python.log、release-gate.log、browser-results.json、remote-*-result.json、test-schema-before/after.json、security-advisors.json、production-final-readonly.json、pc-protection.json及三视口截图）。可复现源码/真实归档数据在 tests/bounded_*、tests/test_bounded_*、tests/fixtures/bounded_daily_archived.json.gz；原始凭据不在代码/日志/包中。

Python全量使用归档未安装PC companion的baseline，因为原安装器测试必须从未安装源码开始；新日更六组E2E则使用已安装PC源码的隔离副本+候选integration，验证实际新旧guard兼容。曾将已安装源码用于旧安装器基线测试，出现预期baseline_changed（及旧两根bar fixture不兼容）；恢复正确测试基线后159项全通过。浏览器截图曾碰到轮询重绘导致元素脱离DOM，改为页面截图，不修改产品轮询或降低验收断言。

## 部署顺序及版本过渡（尚未执行）

1. 用户批准精确候选后，重新只读确认生产commit、schema/ledger、原2899 current/rollback/hash、无active任务/迁移，以及账户owner。任何漂移停止；不重新冻结旧Rebase。
2. 仅部署上述SQL，检查对象/函数定义/grants/RLS及ledger；禁止全仓 db push。此时无daily_head、功能尚未启用，旧客户端保持现状。
3. 发布本文最终Pages candidate与manifest，验证所有资源hash、线上commit、Clarity和三视口。
4. 停止按需Worker，校验安装包与当前两目录代码hash。安装器默认check-only；显式授权apply时持有worker.lock，先备份代码，再替换workbench脚本及唯一PC integration.py。保留现有桌面快捷方式、config、DPAPI和行情文件，不自动启动。升级后验证providerVersion、guard hash及快捷方式链。
5. 全套版本就绪后，operator在事务中对原owner调用 `market_private.daily_bootstrap(owner, exact_original_current, archived_A_observation)`；该函数从原可信migration current复制430根并验证raw绑定，默认disabled，不创建新的Provider Migration。核验bundleHash和previous后，仅给该owner/2899设置enabled=true。Browser不能调用bootstrap或设置enabled。
6. 用户按需启动原“投资分析 Worker”快捷方式，在手机2899技术页点“更新行情”。实时抓取独立观察并重新验证规则，不强制写入归档436。核验queued→running→succeeded、远端新版本、手机接收/刷新、Technical/Freshness/Discussion，以及其他22个/业务数据不变。
7. 真实数据超界则failed+明确原因，不生产写入、不自动申请Rebase。实体手机步骤由用户本人完成。

过渡保护：已有daily_head后，旧Worker的普通result提交被scoped trigger拒绝；新Worker遇到disabled停止；新浏览器在新RPC尚未部署时只按精确PGRST202 missing-function回退。不可在旧浏览器/旧Worker仍承担验收时提前enable。

PC guard实现hash从 `2b95be757867fe4b45e193d68368a68a46448a2314c0b02bdddf35ffed062ab3` 切换为 `9c1aafe3d3850b58055eb0fba074144a8b92af2c04f2da38312725acd3fffadf`。旧Rebase RPC/历史capsule绑定不变，不将新实现伪装成旧guard。

Yahoo provider/parser contract仍为 `provider-source-sha256:e7c77309d615a69a2c8295fdd56483d1a82404b2b5928519fb836601ab26afea`；此次integration单位证据调整不改变Provider或Parser。

## 失败恢复与限制

- schema部署失败整体回滚；不触碰原业务对象。配套上线未完成时不创建/启用daily_head。
- 已启用后异常：先enabled=false、停Worker/必要时撤销capability；保留immutable audit。不能为了恢复旧Worker而drop daily表或移除防绕过trigger。
- 数据已提交但浏览器接收失败：保留远端成功版本与本地恢复点，修复接收，不重发更新、不再次Apply。
- 需要事实恢复时，检查无active任务，以operator-only daily_restore按expected UUID恢复完整immediate previous；保留所有新旧版本和审计，随后各设备接收新generation。没有授权就不自动恢复真实数据。
- 安装失败自动恢复已替换代码；成功安装后需要代码退回时，使用私有code-backups内的精确清单逐文件恢复（新增文件仅删清单中的文件），数据库禁用门禁保持，不能只退Worker后继续写。
- 浏览器最多返回当前+128个祖先；离线超过128次更新且找不到本地祖先时停止自动接收，需安全对账。不会静默覆盖。全部历史版本仍保留在服务端。
- 原始响应最多3001个时间点（包括可能未收盘的一根），达到边界须另行调整/验证。两次完整抓取需要Yahoo网络可用；没有保证未来所有微修订都符合当前校准范围。
- 真实性以受限Worker capability和固定HTTPS Yahoo抓取为信任边界；未声称provider提供加密签名。服务端独立算规则，不信任客户端policyAllowed声明。
- 每个手机/浏览器有独立本地存储；一个浏览器成功不代表所有设备同步。PC旧本地行情文件保留，本通路从远端权威基线运行。

工程准备没有已知硬阻塞。剩余真实步骤是批准配套生产发布、启动正式Worker、首次实时Yahoo规则检查及实体手机验收，完成前不能标记生产日更已恢复。

## 最终候选标识

精确代码提交、manifest、安装ZIP及完整性校验将在本报告的交付记录中列明；所有包只准备，不安装、不push、不发布。
