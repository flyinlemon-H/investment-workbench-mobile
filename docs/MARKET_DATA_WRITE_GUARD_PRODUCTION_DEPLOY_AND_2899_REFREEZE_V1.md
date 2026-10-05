# MARKET_DATA_WRITE_GUARD_PRODUCTION_DEPLOY_AND_2899_REFREEZE_V1

最终状态：**PILOT_READY_FOR_APPROVAL**。真实 2899 Approve=0，Apply=0，active=0。

本报告记录实际生产发布、下载代码验收和新的完整 Yahoo 抓取。没有修改正式历史、正式技术结果、正式 freshness、持仓、Plan 或 Discussion；没有调用 AI。**NO DATABASE MIGRATION**，未访问或修改 Supabase Auth、RLS、权限、凭据。

## 1. Production baseline / integration / release

- 部署前两次 fetch/祖先检查：production main `156d97b42c5bbaffd88d1c361979665d6707313a`，没有新的上游提交需要整合。
- 旧 Pages workflow：37140317555，success，旧 assetVersion `auth-login-feedback-v1-20261004`，92 个资源。
- 在包含完整生产基线的 `b03ad2411f7dfcc450e89e4d1ea999e5c0b8b962` 上整合必要守卫、既有 Rebase/Revision 工具和只读审阅页。
- 源码提交：`77e9a398c8df2866038bc83311e29b6bd7279506`。
- 最终 release/manifest 提交：`d3f578d764e3bed111e850cf3c419013575b8241`。
- 分支：`codex/market-write-guard-production-refreeze-v1`。已 non-force push integration branch 和 main；没有 force push。
- [Pages workflow 37315264781](https://github.com/flyinlemon-H/investment-workbench-mobile/actions/runs/37315264781)：**success**。
- 在线 deploymentCommit：`d3f578d764e3bed111e850cf3c419013575b8241`；manifest sourceCommit：`77e9a398c8df2866038bc83311e29b6bd7279506`。
- assetVersion：`market-write-guard-v1-20261005`。
- 94/94 静态资源重新下载 SHA-256 匹配；artifact 共 95 个文件（包括 manifest）。七个 data 资源的 hash 与旧生产版本逐一相同。
- 没有提交 `.rebase`、临时行情、Worker state、凭据或两份本地行情修改。
- 最终报告提交与 release 分离，仅保存审计；不会为了报告触发第二次生产发布或改变候选的部署绑定。

## 2. 四条 Web 路径与最终写入点

统一语义入口：`src/state.js:1042 assertMarketHistoryContinuity`。四条调用方没有各自复制一套判定逻辑。

| 路径 | 调用链 | 最终写入点 |
|---|---|---|
| JSON | handleImport → createValidatedCandidateSnapshot → persistCandidateSnapshot → assertMarketHistoryContinuity | `src/import-export.js:74`，验证后 StorageManager.saveState，再采用 candidate |
| CSV | handlePriceHistoryCsvImport → parseGuardedMarketHistoryCsv → applyPriceHistoryCsvText → shared guard | `src/ui-render.js:5993`，bars/technical/freshness 一起更新，saveState 失败完整恢复 |
| Bridge | app.activateLoadedApplication → applyMarketDataBridge → 每个匹配 stock 的 shared guard | `src/market-data-bridge.js:22`，整批预检后写入，持久化失败恢复旧事实 |
| Remote Result | authenticated client.sync → validateResult → task UI apply callback → shared guard | `src/market-data-task-ui.js:13` 预检、`:22` 写入；保留 owner/task/result identity 校验和失败保护 |

普通写入要求：单一同源、qfq/adjusted、匹配 symbol/market/daily、providerVersion/normalization/单位语义一致，所有 retained 历史日期及 OHLCV/amount 不被改写，完整日 K、有序有效 OHLC，`revisionStatus=revision_stable`，STABLE receipt/content version 一致，technical versions 与最新完整日一致，无倒退 generation/日期或显式 base-version 冲突。

metadata 的单位键顺序不影响语义；缺失 amount 保持缺失，不将 Yahoo 不可用 amount 变成 0。相同 bars 但技术版本被替换不能绕过守卫。

JSON 中完全相同的四项市场快照作为未修改备份允许通过；非市场字段操作不被误拦截。新增/变更的 canonical 历史必须通过完整守卫。旧格式可读取，但缺来源契约的覆盖被拒绝。

CSV 写入需首行 `# market-data-snapshot: <JSON>` 携带 marketDataFreshness、technicalIndicators、technicalData，并保留完整来源与完整 K 字段；旧简式 CSV 不再被推定为可信行情。没有自动迁移开关。显式 migration/Apply 保留在独立审批绑定的 operator CLI，不允许 ordinary JSON/CSV 通过自报 flag 绕过。

## 3. 错误与失败保护

分别显示 PROVIDER_SWITCH_REQUIRED、HISTORICAL_REVISION_REVIEW_REQUIRED、SOURCE_CONTRACT_MISMATCH、MIXED_HISTORY_REBASE_REQUIRED、VERSION_CONFLICT、UNSAFE_IMPORT_BLOCKED 的中文原因。

Bridge 启动拒绝时显示具体原因并继续打开工作台；不会把守卫拒绝变成整页无法启动。导入和远端回读保留具体拒绝原因。

四条路径分别验证 stable allow / provider switch / historical revision / mixed / missing contract / technical version conflict / non-stable revision state。每个 reject 均断言整份隔离 state 不变、写入计数=0，包括 bars、technical、freshness、Discussion、Plan/持仓字段。另验证 CSV 保存失败恢复、单位键序不产生误拒绝、空 amount 不伪造。

## 4. 八条路径交付与 scope

`unsafeWritePathCount=0`，范围为已检查的产品写入路径及既有 PC 安装，不是对任意外部程序的安全保证。

| 路径 | 交付与证据 |
|---|---|
| Worker | release 包含 market_data_worker + full-window integration；实际 PC updater 已安装共同守卫 |
| Manual | update_market_universe/load_source_updater 与 PC guarded updater；原入口保留 |
| Batch | 同一 full-window adapter，逐标的验证；混源失败不污染其它标的 |
| Legacy/direct PC | 已安装 continuity_guard、provider_rebase package、patched updater，新进程验证 |
| JSON | 生产 downloaded import-export + state shared guard，矩阵通过 |
| CSV | 生产 downloaded ui-render + state shared guard，矩阵通过 |
| Bridge | 生产 downloaded market-data-bridge + state shared guard，矩阵通过；projection publisher guard 保留 |
| Remote Result | 生产 downloaded task-ui/orchestrator + state shared guard，矩阵通过 |

PC 实际安装清单见 `pc-install-receipt.json`；新进程 guard hash 与本地一致，mixed reject、具有显式有效单位契约的 stable 连续两次更新通过，networkCalls=0、realDataWrites=0。没有启动真实 Worker 或创建远端任务。

Python 全量使用留存的未打补丁 PC 基线目录测试安装器和集成逻辑；实际已安装 PC 另外由 fresh-process 检验。安装器基线测试不能对已安装文件重复打补丁。无单位契约的合成 seed 在 PC 第二次更新被拒绝属于契约不足，不将其当作有效单位证据；有效契约的连续更新已单独确认。

## 5. Release / regression evidence

| 检查 | 结果 |
|---|---|
| JS/SQL 全量 | 1262/1262 PASS，0 skipped |
| Python 全量 | 112/112 PASS，0 skipped |
| Production Release Gate | 部署前 207/207；部署后 207/207 |
| Entry Decision Clarity | 原测试 hash 未变化，31/31，在 full 与 Release Gate 内通过 |
| Auth Login / Password Recovery | full suite 通过；未触发邮件、登录或 Auth 设置变更 |
| Orchestrator / freshness / Discussion / Plan / Runtime | full + release gate 通过；对应线上文件逐 hash 一致 |
| actual production four-path harness | 34/34 PASS，执行重新下载的生产资源，隔离内存 state，无真实 RPC |
| 360 / 390 / 1280 | preview 空隔离工作台导航正常无横溢；实际 production review 加载最终 427 根候选无横溢、无 console error |
| asset integrity | 94/94 PASS |

浏览器验收使用 CUA；生产真实账户、手机 storage/session 未读取。不是一次真实用户交易/任务验收。当前任务授权的是 safe harness；上述范围明确区分了自动回归和浏览器可见验收。

## 6. 新抓取、来源和覆盖

- 新抓取时间：`2026-10-05T13:17:49.725840+00:00`；原始响应 SHA-256：`2fa92fac0199927cdb6726497618dfb8a9f5a375b6fec1c0744310e517c911c6`。
- 独立 Yahoo full retained-window fetch，非旧 candidate 改 hash；原始响应另存且独立 replay 与所有规范化 rows 完全一致。
- 当前：Yahoo 374 + Eastmoney 52；目标：Yahoo 单一源 427 根。
- 范围：**2025-01-09 → 2026-10-05**；最新完整日 **2026-10-05**。
- oldOnly=0；newOnly=[2026-10-05]；common=426。
- dateGapIntervals=100：间隔包含周末/假期，不能等同于缺失交易日；calendar_coverage_unconfirmed 仍是人工 review item，未假造官方完整日历证明。
- 合约：2899.HK / HK / daily / Yahoo / qfq / adjusted / HKD / HKD/share / volume shares / amount NOT_AVAILABLE。
- providerVersion：`provider-source-sha256:e7c77309d615a69a2c8295fdd56483d1a82404b2b5928519fb836601ab26afea`。
- baseline 来自本次线上下载的 data/market_data_bridge.js，baseHash：`041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70`。未来 Apply 必须以完全匹配的基线重验；不能把另一份文件的表示差异或新事实当作同一 hash。

## 7. Price / volume / unit evidence

2026-07-23 cash dividend 0.4839736 HKD、前收 33.42。重新计算 expected factor=0.9855184440454817，observed factor=0.9855184460636018，差=2.018120115465649e-09。仍支持历史复权修订；不是对所有历史差异的绝对归因。

已有 HKEX 9/18、9/21、9/22、10/2 官方原始文件 hash 和摘录复核。10/2 historical-K volume **26,147,630 shares** 与 HKEX 一致。共同时段成交量变化只涉及 10/2；unvalidated changed volume dates=0。

旧 10/2 `meta.regularMarketVolume=26,155,630` 与 historical-K 相差 8,000 的证据保留在 `historicalMetadataWarning`，状态 KNOWN_PROVIDER_INCONSISTENCY；该字段不进入 canonical bars/技术/契约。本次最新 10/5 historical-K 与 meta 均为 **23,264,863**。10/5 新日成交量没有冒充已取得 HKEX 当日独立证明。

Yahoo/Eastmoney 的 price、volume 单位证据等级均 **EMPIRICALLY_VALIDATED**，不是官方 provider contract 已确认；amount UNKNOWN / NOT_AVAILABLE，计算不使用。独立 parser replay、providerVersion、normalization、原始响应 hash、多日交易所样本绑定在审批包中。

## 8. Deterministic technical preview

下列为旧 426 根基线重算至 10/2 与新 427 根重算至 10/5。变化同时包含历史复权修订和新增完整交易日，不能全部归因于 provider 迁移。旧正式 technicalData 若未存该项，不冒充旧页面已持久化值。

| 技术事实 | 旧基线重算 | 新候选 |
|---|---|---|
| MA5 | 32.004001 | 31.936001 |
| MA10 | 32.870001 | 32.672001 |
| MA20 | 34.207 | 33.985 |
| MA60 | 34.227576 | 34.251737 |
| MA120 | 33.828169 | 33.548156 |
| MACD | {"dif": -0.977766, "dea": -0.65645, "histogram": -0.642632} | {"dif": -0.967706, "dea": -0.712522, "histogram": -0.510368} |
| 最新日成交量 | 26155630 | 23264863 |
| 20日均量 | 37093219.4 | 35131102.75 |
| 程序 volumeChangePct | -7.54 | 3.22 |
| 支撑 | 28.9545 | 28.9545 |
| 阻力 | 38.56 | 38.56 |
| 风险事实 | ["price_below_ma20", "ma5_below_ma20", "macd_below_signal"] | ["price_below_ma20", "ma5_below_ma20", "macd_below_signal"] |

完整 technicalPreview/indicators 已随候选冻结。五日均量等已实现指标见完整 indicators；不把 technicalData 缺失 key 的 null 当成 0。风险事实集合未变化。

未实现：price_action_classifier、volume_spike_classifier、price_volume_relationship_classifier、amount_facts，明确 unavailable。AI 保持 needs_review，没有调用模型或生成 Discussion。候选 asOf 前移，不使正式 freshness 前移。

## 9. Final immutable approval package

- candidateHash：`070b3c14465c91f1ca7ae91eed47e1bbdc07b9179d2912dd5055c2f9f6909b86`
- contentHash：`3504c6fe5941eb5df494bc3c04580a1202125c0f82c43794138b475e8ae3cc12`
- approvalPackageHash：`e54cc2f4ce6e7736492bda99a70c0ad08385f2871d18853957f9247e119561fe`
- guardImplementationHash：`a2248e083dfdda567309870692fbe971e3271807944eb2c3dc5df103d42a1c8f`
- objectId：`5a2d31f9aba27b1f7e47eb47a8e99f205a8dc42d9d5aacde370472e3879dc6b0`
- requestObject：`f9b22c924db48f02d65fe5045eadad2a811eece059653918775184ceb03e35e6`

包绑定 source contract、427 根 bars、contentHash、Python guard implementation、production deploymentCommit/assetVersion/八个关键 Web 文件 hash、unit/revision/volume evidence、technical preview、warnings 和完整旧事实原子回滚机制。`final-package-simulation.json` 为该确切 candidate/package 的隔离复验凭证，不倒写修改已冻结包。

旧三 hash 保留并在独立 `supersession.json` 标记 **SUPERSEDED_PRE_DEPLOY_FREEZE**：

- `2f8f02f90f912fd7f5800af40506a71a9febfe83df653821edacbe7754805c01`
- `2886ac1441ec41def5337d852ad6aa0c00872b38760ce108d43f2e7e76340b94`
- `43439e3820828c9caf79621aa8a7dfee117bd4f5b581531fceb6f8e5a4bc6013`

旧候选文件、旧 store、旧审批材料全部原样保留；本次使用新的 pilot.sqlite。所有四个审计 store 的 approvals=0、active=0。新库 objects=2/events=5；没有真实批准记录。

## 10. Future Apply and isolated rollback

CLI Apply 在用户批准后仍须重建候选、exact candidateHash/approvalPackageHash、有效 approval、current base hash、generation、no blockers、当前 guard implementation，并只读验证固定生产 manifest 的 commit/assetVersion/guard hash 一致。部署发生变化时 fail closed，不能直接复用本包。

最终包的临时隔离 store 验证：11 项均 PASS，包括无审批拒绝、错误 hash 短语拒绝、缺生产 attestation 拒绝、base/generation 冲突拒绝、指针切换前后注入失败均原子回滚、Approve→Apply、多对象版本一致、幂等、完整旧 bars/technical/freshness 恢复。

上述 Approve/Apply 仅发生在自动清理的临时 fixture store。正式库未写 approval，未建立 active pointer，未运行 deliver/project。

显式 operator migration 与普通浏览器导入是不同通路。本任务未执行真实 migration delivery；未来若授权真实 Apply，必须另外确认目标正式副本与客户端接收方式，不能拿普通 JSON/CSV、Bridge 或 Remote 路径去绕过 mixed/revision reject。审阅页不保存审批，不执行 Apply。

## 11. Review entry

[生产只读审阅页](https://flyinlemon-h.github.io/investment-workbench-mobile/provider-rebase-review.html)。个股行情任务区域提供“审阅行情迁移候选”链接；页面也可直达。

选择本地 `.rebase/production-refreeze/candidate.json`，可见当前混源、Yahoo 目标、427 根范围、最新完整日、分红因子、HKEX volume、technical table、风险、限制、rollback 和三个 hash。文件只在页面本地解析；没有上传或 Supabase 调用。

Approve 按钮只显示审批短语；本任务没有点击。它不等于实际批准。即使用户改变本地文件或页面显示，执行端仍重新验证包与审批。

## 12. Protection / limitations / final decision

- 30 个本地保护文件逐字节 hash 未变；7 个线上 data 资源未变。包括原正式行情桥、universe、PC latest_export、以前候选和 SQLite。
- 真实持仓/Plan/Discussion 等不在本任务写入范围；对应受保护快照未变化；隔离矩阵明确证明拒绝时这些字段不变。没有读取手机设备的私有存储，不能将此报告描述为对每台客户端的全量取证。
- 日历覆盖、price/volume differences、dividend support、technical differences 等保留为用户 reviewItems，blockers=0 不等于自动批准。
- 单位为实证确认，非 provider 官方单位契约；Yahoo amount 不可用；10/5 独立交易所量未新增验证。
- 无新数据库、Auth、权限、scheduler、云 Worker、多 Worker、交易功能修改；旧安全 follow-up 保持独立。
- 旧 input_queue：SEPARATE_SECURITY_FOLLOWUP；leaked password protection：NON_BLOCKING_SECURITY_IMPROVEMENT，未操作。

**PILOT_READY_FOR_APPROVAL**。等待用户针对本次 exact hash 独立决定是否 Approve/Apply；本次任务到此停止，不执行真实批准或迁移。
