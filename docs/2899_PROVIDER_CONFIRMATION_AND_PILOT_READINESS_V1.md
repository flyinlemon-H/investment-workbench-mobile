# 2899_PROVIDER_CONFIRMATION_AND_PILOT_READINESS_V1

日期：2026-10-05（北京时间）。仅本地实现、PC 守卫代码安装、候选及隔离验收。未 push / deploy，未审批或 Apply 真实 2899。

## 1. Executive Summary

**最终状态：PILOT_BLOCKED_UNSAFE_WRITE_PATH。发布准备阶段：READY_FOR_PILOT_REVIEW_DEPLOY。**

Yahoo 已由用户确认并固化。新的 426-bar 全窗口单源候选、单位/成交量规则、技术及量能预览、双 hash、原子 Apply/rollback 模拟均完成。Revision Engine 已正式本地提交；PC companion 已安装并验证。当前唯一候选硬阻塞：`writer_deployment_not_confirmed`。

公开生产前端只读核验：JSON 导入、CSV 导入、行情桥接读入、远端结果读入 **4 条路径尚未交付 guard**。对应本地实现与发布包已通过测试，但用户第50节明确禁止本任务直接生产部署。因此不能声明 `PILOT_READY_FOR_APPROVAL`，也不请求批准当前 Candidate Apply。外部单位/volume 证据不再阻塞。

## 2. Provider Confirmation

用户附件明确选择 Yahoo，确认范围是目标来源，不是批准 Candidate / Apply。本轮没有再次询问选源，没有继续 Eastmoney 网络调查或发起 Eastmoney 抓取。旧 Yahoo 374 + Eastmoney 52 根，仅作基线比较。

## 3. Source Contract

| 字段 | 本次冻结值 |
|---|---|
| symbol / market | 2899.HK / HK |
| canonicalProviderId / rawProviderId | yahoo / yahoo（当前 strict chart adapter） |
| providerVersion | `provider-source-sha256:e7c77309d615a69a2c8295fdd56483d1a82404b2b5928519fb836601ab26afea` |
| adjustment / priceBasis / interval | qfq / adjusted / daily |
| priceCurrency / priceUnit | HKD / HKD/share |
| volumeUnit / scale | shares / 1；board lot 2000 不用于转换 |
| amount | NOT_AVAILABLE；非必需，不补造 |
| historyWindow | 2025-01-09 → 2026-10-02，完整 retained history |
| normalizationVersion | python-round-6-v1 |
| source contract storage | candidate.json → sourceContract |

版本 hash 将源码换行规范化，修复 Windows CRLF 与 companion LF 导致相同实现版本不一致的问题；已加回归，安装实例与本地实现一致。

## 4. Unit Evidence

通用 policy：`empirical-exchange-v1`，实现 `scripts/provider_rebase/evidence.py`；规范见 `docs/PROVIDER_EVIDENCE_CONTRACT_V1.md`。四级：CONFIRMED_CONTRACT / EMPIRICALLY_VALIDATED / STRONG_EVIDENCE / UNKNOWN。

Yahoo 与旧 Eastmoney 的 price、volume 采用 **EMPIRICALLY_VALIDATED**，保留 `confirmed=false`，不宣称取得 provider 官方单位合同。证据绑定 symbol/provider/market/field/实现版本/规范版本、raw/archive hash、parser replay hash、多个不同日期及官方交易所 URL/hash。

HKEX 对照 Yahoo 4 日、旧 Eastmoney 3 日。HKD 股价报价与 shares 成交量列、Yahoo currency=HKD、历史字段解析回放共同支撑本次单位约定。Eastmoney rawEvidenceKind 为历史归档，不冒充新抓取响应。amount 非必需时 NOT_COMPARABLE；不得假造成交额。

**UNIT_CONTRACT_INCOMPLETE 已解除**；STRONG_EVIDENCE/UNKNOWN 对必需字段仍阻塞，错误字段/symbol/scale/version/官方域/样本日期被拒绝。通用 fixture 使用 1810、1357、2513，未硬编码 2899 或 8000。

## 5. Volume Evidence

| 日期 | Yahoo historical K | HKEX shares | 结论 |
|---|---:|---:|---|
| 2026-09-18 | 32,589,835 | 32,589,835 | exact match |
| 2026-09-21 | 25,275,000 | 25,275,000 | exact match |
| 2026-09-22 | 37,165,464 | 37,165,464 | exact match |
| 2026-10-02 | 26,147,630 | 26,147,630 | exact match |

10/2 旧正式 volume=26,155,630 → 新 historical K=26,147,630，是真实的 **VOLUME_HISTORY_REVISION**。最新响应 meta.regularMarketVolume=26,155,630，仅附带 metadata，不进入 canonical bars、technical 或 source contract。保留 `KNOWN_PROVIDER_INCONSISTENCY`，不再要求无限追查 meta 的 8000 差值成因。

`volumeValidation.status=EXCHANGE_VALIDATED_REVIEW_REQUIRED`，未验证变更日期=0，**VOLUME_DIFFERENCE_UNEXPLAINED 已解除**。每个变更日期必须绑定 old/new/exchange 数值、shares、scale=1、历史字段、原始 hash、官方 hash、scopeUnchanged；此规则不会让其他未经验证的 volume revision 自动通过。

## 6. Revision Evidence

主类型 **provider_rebase**；附 same-provider `corporate_action_readjustment` 证据，不是 revision-only。类别：MULTI_FIELD_REVISION、PRICE_HISTORY_REVISION、VOLUME_HISTORY_REVISION、PROVIDER_META_INCONSISTENCY。

旧 Yahoo 374 根中 361 根 OHLC 有变化，13 根不变。2026-07-23 分红 HKD 0.4839736；前收 33.42；expected factor=0.9855184440454817，observed median=0.9855184502656651，差 6.22e-9。ratio series / regimes / boundaries 与事件原始参考进入审批包。

这支持分红后历史前复权再调整；旧原始响应不存在，不能伪造 factorOld 或宣称完整证明旧抓取内部机制。旧 Eastmoney 与 Yahoo 不采用同一复权算法，因此以 Yahoo 全窗口替换候选，不拼接旧历史。

## 7. Write Paths

| 路径 | 实现/边界 | 实际交付 |
|---|---|---|
| Worker | market_data_worker → guarded updater → full-window ContinuityChain | PC 底层已安装，隔离验证 |
| Manual | update_market_universe / 原 PC 手动入口 → 同一 PC updater | 已安装；mixed 拒绝，不会静默拼接 |
| Batch | 每 symbol 独立 clone、probe、version check | 已安装；受影响 symbol 暂停，stable 继续 |
| PC direct | src/market_data/updater.py + continuity_guard.py + provider_rebase | 已安装， fresh process 验证 |
| Legacy JSON | src/import-export.js → assertMarketHistoryContinuity | 本地 PASS；生产待发布 |
| Legacy CSV | src/ui-render.js CSV 入口 → assertMarketHistoryContinuity | 本地 PASS；生产待发布 |
| Bridge projection/read | prepare_market_bridge / publish_market_bridges / src/market-data-bridge.js | 本地 PASS；生产浏览器待发布 |
| Browser remote result | src/market-data-task-ui.js → state continuity guard | 本地 PASS；生产待发布 |

普通增量要求同 provider/adjustment/priceBasis、完整 retained-window stable、版本无冲突。Legacy 来源切换不得作为普通 incremental；显式 Store approval/apply/projection 才是迁移通路。直接表面调用不能代替完整探测。

PC 安装时间 `2026-10-04T17:22:31.600707+00:00`；原 updater SHA-256 `3be6c46a2969131f84b39cb18bb6dfed5bea3233757c19836d1fce7b5c72b8bd`。备份：`E:\users\kaka\onedrive\文档\投资分析程序\src\market_data\.guard-backups\20261004T172231528344Z`。9 个代码文件已交付，未运行真实行情更新。安装前无活动 market writer；安装后新进程 synthetic mixed 拒绝、stable 继续、其它事实不变。双重 wrapper 不重复套用；旧实现 marker 不一致会拒绝。

**本地实现 guard 缺口=0；当前生产 browser delivery 缺口=4**。这些是发布阻塞，不是已经生效的保护。生产只读证据 `production-guard-status.json`：目标资源 HTTP200，但均无 guard 调用/定义。

## 8. Candidate Rebuild

本次仅一次 Yahoo 实际请求，抓取时间 `2026-10-04T17:14:24.401648+00:00`。原始 response SHA-256 `7a6f6db70b29b3716dcc4ef28d251c078e50630db575c567785c18e7eb7461f3`。独立 parser replay 对照全部 426 bars，OHLC/volume/amount 一致；所有复权因子存在，meta 不用于 bars。

Coverage：2025-01-09 → 2026-10-02；barCount=426；common=426；oldOnly=0；newOnly=0。99 个 calendar gap intervals 被列示（包含周末/节假日），没有把它们冒称 99 个缺失交易日。交易日历/停牌外部完整性仍是显式 review item；相对现有完整保留窗口无缺失日期。

新 store：`.rebase/pilot-readiness/pilot.sqlite`；objects=2，events=5，approvals=0，active=0。旧两个 store、旧冻结 candidate 均未修改。新 objectId：`d90a9aad923f4f95a75928699d0a2e9ff6fa6e44985905022431f2bb3431c33f`；requestObject：`69d0a0e705b1886e3e1fa2cb16e8a1f4f93e9ca6368c1912a3469e34b3ee85fa`。

## 9. Technical Preview

从完整新历史确定性重算 MA5/10/20/60/120、MACD、支撑/阻力、price/MA 关系、历史 crossover、volume averages/change、trend inputs、risk flags、technicalAsOf/latestCompleteBar。`technicalValidation.complete=true`（现有 engine 实际支持范围）。dataQuality=candidate_only，AI=needs_review；不推进真实 current technical/freshness。

price-action classifier、volume-spike classifier、price-volume relationship classifier、amount facts：**NOT_AVAILABLE**。这些未实现指标不编造，也不隐藏。

## 10. Technical Diff

旧正式桥接持有 technicalIndicators，MA5/10/20/60/MACD 与下表旧基线重算一致；其 technicalData 为空。MA120、20日均量、风险 facts、支撑/阻力等旧栏是从旧 bars 重算的审阅比较，不冒称旧持久化字段。完整三方对照：`technical-current-comparison.json`。

| 指标 | OLD baseline recomputed | NEW candidate |
|---|---:|---:|
| ma5 | 32.004001 | 32.004001 |
| ma10 | 32.870001 | 32.870001 |
| ma20 | 34.207 | 34.207 |
| ma60 | 34.227576 | 34.208496 |
| ma120 | 33.828169 | 33.576579 |
| volume | 26155630 | 26147630 |
| volumeAvg20 | 37093219.4 | 37092819.4 |
| volumeChangePct | -7.54 | -7.54 |
| supportPrice | 28.9545 | 28.9545 |
| resistancePrice | 38.56 | 38.56 |
| technicalAsOf | 2026-10-02 | 2026-10-02 |
| latestCompleteBar | 2026-10-02 | 2026-10-02 |

MACD DIF：-0.977766 → -0.972472；DEA：-0.65645 → -0.648726；histogram：-0.642632 → -0.647492。

volume recent 5d mean：30,324,267.6 → 30,322,667.6（-1600）；20d mean：37,093,219.4 → 37,092,819.4（-400）；previous5d mean 不变；change_pct 按现有精度仍 -7.54%。本轮8000股变化不改变该量能趋势事实；spike 和量价分类没有 engine，结论 NOT_AVAILABLE。

当前 priceVsMA20、MA5vsMA20、MACDvsSignal 均保持负；风险 flags 同为 price_below_ma20、ma5_below_ma20、macd_below_signal。支撑/阻力不变。历史 crossovers 103→101：移除 2026-07-15 / 07-16 的 priceVsMA20 两次交叉，无新增。量变化没有改变当前风险 flags。

## 11. Hashes

- candidateId：`rebase_2f8f02f90f912fd7f5800af40506a71a9febfe83df653821edacbe7754805c01`
- candidateHash：`2f8f02f90f912fd7f5800af40506a71a9febfe83df653821edacbe7754805c01`
- contentHash：`2886ac1441ec41def5337d852ad6aa0c00872b38760ce108d43f2e7e76340b94`
- approvalPackageHash：`43439e3820828c9caf79621aa8a7dfee117bd4f5b581531fceb6f8e5a4bc6013`
- guardImplementationHash：`0ef3d6555ecbf71fd76b554be87d7bb2c66e2f891c2a9c4cd8ad5cea46949734`

content 绑定 canonical bars/source contract/单位语义/规范版本/provider/adjustment/basis。审批包额外绑定证据、technical preview、warnings、blockers、guard 实现及交付状态。重复构建确定性 hash 一致；仅改证据保持 contentHash 但改变 approvalPackageHash。交付状态改变后必须重新冻结并重新审批，不能沿用此包直接 Apply。

## 12. Approval Package

`.rebase/pilot-readiness/review/index.html` 和 `approval-summary.json` 提供短摘要；完整 candidate/evidence/parser replay/官方 HTML references/差异/测试回执位于同目录父级审计包。当前 **Apply=false**、pending_user_review、approvalReadiness=BLOCKED，唯一硬阻塞是生产 writer delivery。页面没有联网或 mutation API；Approve 仅展示短语且本包禁用，未点击 Approve。

## 13. Apply Guards

fixture 已覆盖：未批准拒绝、hash 改变拒绝、unit/technical blocker、generation conflict、错误 source contract、混源增量拒绝、stable 同源通过、官方证据作用域错误拒绝、guard 实现变化拒绝。Store approve/apply 都重新构建/验证绑定；没有以编辑 JSON 或绕过 guard 代替批准。

真实 2899 未尝试 Approve / Apply；上述执行性测试仅 synthetic fixture。

## 14. Atomic Apply Simulation

额外端到端 fixture 使用 **1810.HK 合成 bars**，独立临时 SQLite。Approve → Apply：bars、source contract、technical version、freshness/content version、active/audit 指针同事务切换 generation=1；after_pointer failpoint 会回滚并保持无 active。

证据：`atomic-rollback-simulation.json`；输入原对象不变，未使用真实 2899 candidate。

## 15. Rollback Simulation

fixture Rollback generation=2，恢复全部旧 facts bundle（bars/contract/technical/freshness），旧版本可用，新版本保留 audit。错误 generation 拒绝；数据库临时目录已清理。正式 2899 的 approvals=0、active=0。

## 16. Review UI

本地最小 HTML，CLI：`python -m scripts.provider_rebase --store <store> export-review --object <objectId> --output <review-dir>`。显示 Yahoo、旧 Yahoo374+Eastmoney52、新单源、覆盖、价格及 volume 证据、技术对比、限制、rollback、hash 和 Approve/Keep Current。

360/390/1280 视口实际 DOM+截图检查通过；document widths 345/375/1265，均无横向溢出。console error/warning=0。Approve disabled；临时 viewport override 已 reset。仅离线审阅 HTML，无新生产 route。CLI/本地足够审阅；需要生产发布是为了 guard 交付，绝非为了展示页面而额外部署。

## 17. Tests

| 门禁 | 结果 |
|---|---|
| JS/SQL full（最终 release 版本） | 1228/1228 PASS，0 skipped |
| Python full（最终代码） | 109/109 PASS，0 skipped |
| Production Baseline / Release Gate | 207/207 PASS |
| Entry Clarity | 31/31，保留原测试文件 hash |
| Orchestrator / freshness / Discussion import / Plan / Runtime / Auth | 已包含全量及关键回归，PASS |
| 新 empirical/unit/volume/approval/rollback policy | 21 tests PASS；多个 synthetic symbols |
| review/install/double wrapping/line endings | 5 tests PASS |
| 实际 PC 安装 fresh process | mixed reject + stable continue，PASS |
| 本地 Web release integrity | 92/92 resources PASS；93 staged files 含 manifest |
| review responsive | 360 / 390 / 1280 PASS |
| 正式/冻结数据保护 | 8/8 文件 SHA-256 完全一致 |

曾遇测试环境缺 npm lockfile 依赖和 MARKET_SOURCE_ROOT 未指定，已使用锁定依赖与 pristine PC fixture 修复。实际 PC 安装验证另发现 CRLF/LF 版本 hash 不一致，已修正并跑最终全量；没有把失败隐藏为通过。

日志在 `.rebase/pilot-readiness/`：js-published-candidate.log、python-release-final.log、release-gate-final.log、review-final.log。候选 hash 绑定的是冻结时对应代码的通过证据；最终全量补充验收日志不修改候选对象。

## 18. Production Baseline

两次只读 `git ls-remote`：最新 main **156d97b42c5bbaffd88d1c361979665d6707313a**，已为本地候选祖先。没有覆盖新 Auth、Entry Clarity、Discussion、Plan、Runtime 功能。

线上 manifest sourceCommit=d21c88cb66fb280347c68f31e9b8da8608424a0e，assetVersion=auth-login-feedback-v1-20261004，92 resources。此是线上 manifest 的 source commit，不与最新 main 混同。

新发布版本 `provider-pilot-readiness-v1-20261005`；source commit `8234b6df6e779983ab2d3c44781ed5ad328c56a3`；release candidate `70f4fcbfc4ab0cef99784e2c8d7ac9c01a2ae5dd`；92 文件完整性通过，缓存版本已同步更新。发布包 `.rebase/pilot-readiness/release-site/`。没有修改 DB/Auth/schema/network，没有 push/deploy。

本地提交：

- 2f0d8763fa5e6936917e581f15b9b7d4c79c5dfe：先前 Rebase/Revision/guard foundation 与相关审计正式收口。
- 8234b6df6e779983ab2d3c44781ed5ad328c56a3：本轮经验单位规则、volume review、PC交付/本地审阅及测试。
- 70f4fcbfc4ab0cef99784e2c8d7ac9c01a2ae5dd：新的发布资源清单。
- 本报告随后单独文档提交；完整 hash 在交付消息和 git log 中。

未纳入本地行情修改、临时 CSV、raw JSON、SQLite 或 credential。基础提交保留原相关历史审计，不代表本轮重新调查 Eastmoney。

## 19. Known Limitations

1. 生产 Web 4 路 guard 未交付是硬阻塞，必须授权发布后线上验收；旧缓存客户端也必须加载新 asset version，不能仅凭本地代码解除。
2. Yahoo 官方单位合同仍缺失；V1 使用通用 empirical exchange evidence，不等于 CONTRACT_CONFIRMED。
3. 未使用 meta 差值内部原因未知，作为 warning；旧 raw/factor 缺失，股息因果为强支持证据。
4. amount、价格行为/量价分类器不提供；不影响现有必需技术计算，但不可声称这些指标已完成。
5. 全量交易日历/停牌不作虚假背书；与 retained baseline 日期集合完全一致，99 calendar gaps 等待显式审阅。
6. 未做真实 Apply；未来仍需当前正式 base/version 未变化、hash 重新冻结、所有交付 gate 完成和用户明确批准。
7. PC 新守卫是保守拒绝策略：发生历史修订会生成 review candidate 并暂停该 symbol；本任务未启动生产 Worker 或批量更新。

## 20. Final Decision

**PILOT_BLOCKED_UNSAFE_WRITE_PATH**。

已达到 **READY_FOR_PILOT_REVIEW_DEPLOY** 的工程门禁。不能在用户禁止直接生产部署的边界内自行解除线上 4 条 unsafe paths，因此此处停下符合任务第23/50/56节。不是单位或 meta 无限调查阻塞，也不是计划把剩余实现拆到后续。

正式 canonical bars / technical current / freshness 文件未变，8项保护 hash 全匹配；没有写真实 holding/Plan/orders、没有调用 AI、没有重写 Discussion。新旧真实 stores 均无审批/active migration。

## 21. User Approval Needed

**现在只需确认是否授权发布并验收上述 guard release candidate；当前不能批准真实 2899 Apply。**

发布及线上 guard 验收通过后，交付证据和 approvalPackageHash 必须重算冻结，才可进入 `PILOT_READY_FOR_APPROVAL`。那时用户再决定是否批准具体 hash 的 2899 Candidate Apply；本次 source confirmation 不作替代。

## 22. 用户要求的32项交付索引

| # | 项目 | 结果 |
|---|---|---|
| 1 | Yahoo 固化 | YES，用户确认 |
| 2 | source contract | §3，HKD/share、shares、qfq、全 retained |
| 3 | UNIT blocker | 解除，EMPIRICALLY_VALIDATED |
| 4 | Volume blocker | 解除，每个变更日期官方验证 |
| 5 | 8000 meta | KNOWN_PROVIDER_INCONSISTENCY，未用 metadata |
| 6 | Engine | 统一 Rebase/Store，正式本地提交 |
| 7 | Guard覆盖 | 8类，本地全覆盖；PC已装 |
| 8 | Unsafe数量 | 当前生产 Web 4 |
| 9 | Candidate ID | §11完整值 |
| 10 | 覆盖 | 2025-01-09 → 2026-10-02 |
| 11 | bars | 426 |
| 12 | contentHash | §11 |
| 13 | approvalPackageHash | §11 |
| 14 | 价格revision | 股息再调整强支持，provider_rebase |
| 15 | volume | 26,147,630 与 HKEX 一致 |
| 16 | technical preview | 支持范围完整，unsupported 明示 |
| 17 | technical差异 | MA60/120、MACD、均量变化；当前flags不变 |
| 18 | AI | needs_review，无调用 |
| 19 | Discussion | 正文不变 |
| 20 | Apply guards | PASS，真实未调用 |
| 21 | atomic apply | synthetic PASS |
| 22 | rollback | synthetic PASS，旧bundle恢复新audit保留 |
| 23 | 全量测试 | 1228 JS/SQL、109 Python、207 Gate PASS |
| 24 | 三视口 | PASS |
| 25 | production baseline | 156d97b42c5bbaffd88d1c361979665d6707313a |
| 26 | commits | §18及交付消息 |
| 27 | push/deploy | NO |
| 28 | 正式数据变化 | NO；8 protected hashes unchanged |
| 29 | limitations | §19 |
| 30 | 文档 | docs/2899_PROVIDER_CONFIRMATION_AND_PILOT_READINESS_V1.md |
| 31 | final | PILOT_BLOCKED_UNSAFE_WRITE_PATH |
| 32 | 下一确认 | guard前端发布授权；不是Apply授权 |
