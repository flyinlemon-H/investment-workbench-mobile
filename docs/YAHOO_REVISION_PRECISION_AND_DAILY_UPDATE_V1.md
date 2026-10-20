# YAHOO_REVISION_PRECISION_AND_DAILY_UPDATE_V1

2026-10-20；按用户最新 `DAILY_MARKET_UPDATE_USABILITY_FIRST` 决策执行。

## 用户现在能否正常更新日K

**2899.HK 生产日更尚未恢复。** 生产仍是 430 根、截至 2026-10-08。本轮没有发布、替换已安装 Worker、创建生产行情任务或写入正式历史。

已完成真实数据归因、三级规则的隔离分类原型、Worker 错误反馈修复、稳定追加的实际 Worker → 隔离 PostgreSQL → 浏览器闭环、回归和本地发布准备。**自动修订的生产提交/接收协议尚未实现和授权**；分类器通过不是自动修订端到端通过。反馈候选单独发布不能解决这次日更。

最新产品决策取代原任务中“所有真实微小修订必须逐次人工审批”的设计方向。停止扩展单次 Rebase 审批包和迁移流程；保留源数据审计，把下一步集中在受限自动修订的日常通路。现有生产规则没有因此获得自动写入授权。

| 层次 | 本轮实际结果 |
|---|---|
| 代码/隔离测试 | 通过，详见测试表 |
| 正常追加的 Worker 代码执行 | 通过；合成行情，完整旧窗口不变 |
| 正常追加的隔离远端协议/浏览器接收 | 通过；本机 PGlite PostgreSQL、实际 RPC SQL、临时身份 |
| 本次 Yahoo 微修订的分类 | A/B/C 实际数据通过限定规则；仍识别为真实修订，不当作相等 |
| 微修订自动发布/审计/恢复的生产协议 | 未实现、未授权，需配套服务端与浏览器接口 |
| 已安装 PC Worker 的真实生产更新 | 未执行，未替换程序 |
| 生产远端新结果 | 未生成 |
| 实体手机接收 | 未验收；视口模拟不能替代实体手机 |

当前状态：`DATA_CONTRACT_CHANGE_REVIEW_REQUIRED`。
独立成立的工程状态：`DAILY_UPDATE_STABLE_PATH_ISOLATED_PASSED`、`READY_FOR_REVISION_FIX_PRODUCTION_REVIEW`（后者仅指反馈修复候选，非自动修订部署就绪）。

## 已证明的根因与证据

三份均有真实原始响应字节，未用 parsed bars 重建 raw。证据保存在主工作区 `.rebase/precision-daily-v1/`，不进入 Git。

| 数据 | 抓取时间 UTC | 完整日K | 原始 SHA-256 |
|---|---|---|---|
| A：生成已 Apply 版本的原始响应 | 2026-10-09 02:57:18 | 430，至 10-08 | `17828a59327d0d260187a4d278d871d997dad84caeb6b4048c380736990b870d` |
| B：上一轮观察 | 2026-10-20 02:02:30 | 436，至 10-16 | `b7f83b638ae6dfa3a7e510beee0be7a29d910acbdb5daee4c873d64d446372d9` |
| C：本轮独立抓取 | 2026-10-20 02:42:27 | 436，至 10-16 | `a5de09a97052cc8d9b65cf3d7f8f604d615add322092175c1aecd15aa2b7a43d` |

三份都用未改动的生产 Parser 和各自采集时间回放，输出精确一致。Parser SHA-256：`8237ca9ce729f94869a3d92dbfc7c3d4c9c0045c612344be3619b329600423fc`。A 的 10-09、B/C 的 10-20 盘中尾部被完整日规则排除；没有补造 10-19 日K。[HKEX 交易日历](https://www.hkex.com.hk/News/HKEX-Calendar?sc_lang=en)列明该日休市。

A→B 与 A→C：

- 430 个重叠日期，无丢失；新增 10-09、10-12、10-13、10-14、10-15、10-16 六日。
- 原始未复权 OHLC、volume 变化均为 0；原始 adjclose、派生因子变化均为 140 日。
- 规范化 Open/High/Low/Close 变更日数分别 140/140/139/140；日期并集 140、交集 139。
- 变更范围 2025-01-09 至 2026-06-03；559 个字段差异，负向 359、正向 200。
- 绝对差 min=0.000001、median=0.000002、P95=max=0.000004 HKD；不存在无法由源输入变化解释的输出差异。
- B/C 完整历史和历史原始输入相同；整个 raw 文件并不相同，元数据/盘中部分不能称为纯文本表示等价。

例：2025-01-09，原始 close 都是 `14.680000305175781`；adjclose 从 `13.902870178222656` 变成 `13.90286922454834`；因子从约 `0.9470619815532886` 变成 `0.9470619165890995`；六位 close 从 `13.902870` 变成 `13.902869`。

**已证明**：`PROVIDER_ADJUSTED_HISTORY_REVISION`。上游 adjclose 已变化，Parser 忠实传播了变化。不是本地同一输入的不确定运算，也不是 Canonical 表示差异。60 位 Decimal 和另一种乘除次序在实际重叠数据 round6 输出上差异均为 0。

**支持精度性质的观察**：两侧 adjclose 均可被 float32 精确表示，变化为 -1 ULP 80 次、+1 ULP 50 次、-2 ULP 10 次。

**尚不能证明**：Yahoo 内部为何重新计算；不能凭 ULP 模式断言其内部缺陷，也没有新增公司行动证据足以把本轮变化归因于分红。无需为日更继续追查未公开实现；自动处理依据应是可验证的影响范围。

逐行 Decimal/Fraction/float 中间值、相对差、按月分布、差异并交集保存在 `A-C-diff.json`、`A-B-diff.json`、`arithmetic-analysis.json`。诊断程序 `scripts/provider_rebase/precision_audit.py` 保留 JSON 数字文本，避免先转 float 再宣称十进制相等。

## 三级机制与已校准边界

隔离原型：`scripts/provider_rebase/daily_policy.py`；版本 `yahoo-hk-adjclose-ulp-pilot-v1`。没有从 Worker、RPC 或浏览器生产写入路径调用它，始终返回 `productionWriteAuthorized=false`。

| 档位 | 规则与动作 |
|---|---|
| `NORMAL_UPDATE` | 同源同契约，完整旧窗口事实相同，只追加完整新日；现有严格路径继续自动执行。Canonical 等值表示仍按原规范处理。无新增日期不能凭此宣称“已获取最新交易日”，还须交易日历证明。 |
| `AUDITED_REVISION` | 满足以下全部条件，进入拟议的自动全窗口修订；计算新版本、保留旧版与审计，不抹平差异。当前只验证资格，未赋予写权限。 |
| `REVIEW_REQUIRED` | 来源/单位变化、缺失历史、无法复现、范围超界、数量变化、技术信号变化、版本冲突等，停止并给出具体原因。来源切换保留原 Rebase 审批。 |

第二档初始试点仅限 **2899.HK / Yahoo / daily / qfq / adjusted / HKD/share / shares**：

1. 契约、Provider 实现版本、normalization、所有旧日期保持一致；全窗口读取，不截取最近 N 日。
2. 继承已验证的正式单位证据，使用现有 `evidence.units_gate` 检查 symbol/provider/market/字段映射/版本/成交量样本绑定；不把经验验证冒称供应商官方承诺。scale 必须为 1。
3. 原始 raw quote OHLC 与 volume 不变；amount 的缺失/数值语义不变。null 不等于 0。
4. 原始响应与解析后全部 bars 精确绑定；原始 meta.symbol 正确；两个独立观察的完整历史一致。本次 B/C 已满足；测试中相同 fixture 的重复只验证判定逻辑，不冒充独立抓取。
5. adjclose 两侧是精确 float32，变化最多 2 ULP；最终任何 OHLC 差最多 0.000004 HKD。这是本次已观察、回放和反例验证的试点上限，不是“低于此值一律相等”。
6. 旧窗口不少于 430 根；修订日期不超过 140，比例不超过 140/430。以后新增日K不因长度超过 430 自动失配，但超出经验范围仍需重新校准规则版本。
7. 比较相同旧日期上的全部 MA20 相对价格关系、MA5/20 关系、MACD 方向及交叉事件；任一离散信号变化就转第三档。新增六日造成的正常指标变化不计为历史修订影响。
8. 数值影响还有 MA/EMA 凸组合传播上界检查：MA≤d+q，DIF/DEA≤2d+q，histogram≤8d+q，d=4e-6、q=1e-6（两个 round6 输出差的量化界）。不作为内容相等容差，不覆盖其他未建模策略；AI 判断仍 needs_review。
9. 服务端 owner/capability、expected current CAS、完整旧版保存、服务端审计收据、浏览器本地 CAS 是**写入前必需的独立条件**，分类器自身不证明这些已满足。

校准不应扩展到其他价格区间、标的、来源、任意公司行动或数量修订。试点边界允许先恢复这个已观察类别的日常可用性，后续只能凭新样本和反例测试版本化扩展。

## 技术影响

本次 A→C 旧 430 日重叠窗口：全历史离散关系/交叉未变；最终 MA5/10/20/60/120、DIF/DEA/histogram 在正式六位契约下均未变。新增六日后的变化是正常新行情影响：

| 指标 | 原 430 根 / 修订后同一 430 日 | 全部 436 根 |
|---|---:|---:|
| 技术日期 | 2026-10-08 | 2026-10-16 |
| MA5 | 32.016001 | 32.152001 |
| MA20 | 33.272000 | 32.539001 |
| MA60 | 34.373184 | 34.492000 |
| MA120 | 33.430752 | 33.234953 |
| DIF | -0.940635 | -0.717519 |
| DEA | -0.812818 | -0.753174 |
| histogram | -0.255634 | 0.071311 |

隔离观测内容 hash（现有 Revision 定义，不是生产 Rebase contentHash、candidateHash 或 approvalPackageHash）：`0000234aaabddb82a2db640ae7008a306daafbff7fd3f010ddb11e61ba97cf61`。

`scripts/audit_yahoo_daily_policy.py` 可从私有证据目录重放，生成 `test-results/daily-policy-calibration.json`。没有生成新的待批准 Rebase package、真实 Approval ID 或 Apply。

## Worker 错误根因及修改

实际安装入口：桌面“投资分析 Worker”→ 主工作区 `scripts/start_market_worker.ps1` → `scripts/market_worker_launcher.py` → `scripts/market_data_worker.py`。实际 PC 行情源根目录 `E:\users\kaka\onedrive\文档\投资分析程序`。没有启动常驻 Worker。

已安装 Worker 的异常白名单落后，安全修订错误落入 `pipeline_failure`。生产 Git 源已有部分 SAFE_ERRORS 支持，但缺少现用快捷方式需要的 `main(argv, notify)` 接口。候选将二者对齐：

- 固定枚举 `market_worker_errors.py`，未知异常映射固定码；不传任意 URL、路径、异常堆栈或凭据。
- `PipelineFailure` 保留准确错误码及仅本地的 `candidateSaved`；后者只有 Store 返回保存对象才为 true。RPC 输入仍仅 taskId/result/error，没有新增自由文本通道。
- 保持 outbox 重试/幂等，追加安全 Console 回调和锁释放，保留快捷方式手动启动模式。
- 浏览器普通界面显示更新日期、状态和必要异常；版本、候选入口与详解移至“高级诊断”。远端未传保存收据时不假称候选已保存。

实际 A/C 行情经真实 PC Provider 模块和候选 Worker 回放，结果为 `UNIT_CONTRACT_INCOMPLETE`、candidateSaved=true、seedUnchanged=true，非 pipeline_failure，未发送远端请求。

进一步定位：`integration.ContinuityChain` 构造候选时没有选择经验验证 profile；`revision.unit_gate` 的旧分支只接受 confirmed=true，而原批准单位证据是 EMPIRICALLY_VALIDATED、confirmed=false。`evidence.units_gate` 能验证现存证据。新隔离分类器使用后者；**没有更改生产 integration/revision 或把 confirmed 字段改成 true**。这项规则兼容需要包含在下一轮受限日更通路中，不应逼用户重新审批 Provider Rebase。

## 测试和实际边界

最终产品代码对应 manifest source `197f9a1867ef0a5d41e6281a4f18edb2535d9c7e`；后续只补测试版本标识和报告。

| 验证 | 本轮结果 |
|---|---|
| JS/SQL 全量 | 1342/1342 PASS |
| Python 全量 | 139/139 PASS |
| 新增精度/政策/Worker 反馈 | 20 项，包含在 Python 总数内 |
| Production baseline/release gate | 207/207 PASS；未改受保护基线测试 |
| Entry Decision Clarity 单测 | 31/31，包含在全量/门禁内 |
| Entry Clarity 浏览器 | 24 case×viewport 组合通过；360/390/1280；保留旧 Discussion fallback 与 Plan 层次 |
| Canonical 浏览器 | 360/390/1280 通过，整数/小数等值、真实数字不同不等值 |
| 实际 Worker 代码的稳定追加浏览器闭环 | 三视口通过，合成 139→140 根，旧历史不变，真实 Python execute_task；PGlite 执行实际 RPC SQL |
| 普通任务生命周期 | queued、running、succeeded、失败保留旧 result；重复 active 返回同 task；刷新保留版本；技术日期、内容版本、Discussion 上下文一致 |
| 错误显示 | SAME_PROVIDER_REVISION、UNIT_CONTRACT_INCOMPLETE、REVISION_PROBE_FAILED、PROVIDER_SWITCH、worker_revoked、pipeline_failure；三视口无 JS 错误/横向溢出 |
| 新政策反例 | raw报价1e-6、volume+1、null/0、缺日、缺adjclose、未完成尾部、超2ULP、重抓不稳、版本冲突、技术关系改变均不进入自动档 |
| 原迁移/CAS/拒绝未批/错误hash/重复/失败注入/rollback | 现有 Python/SQL/客户端测试重新通过；不是新自动修订协议的验收 |
| 资源完整性 | 97/97 文件 bytes/SHA-256 PASS |

稳定追加 fixture 明确是合成数据，未删除实际 Yahoo 的 140 日差异来制造 PASS。浏览器使用合成行情的观测时钟 2026-10-01，实际生产时间/完整日规则未改。浏览器路由禁止全部外部请求，隔离身份不是生产用户；不声称完成 Supabase 测试项目远端或实体手机验收。

测试日志在 `test-results/precision-*.log`；真实数据隔离 Worker 回放摘要 `real-yahoo-worker-replay.json`；三视口结果与截图在 `test-results/market-data-orchestrator/`。检查过 360 成功和 390 修订状态实际截图。

测试产物边界补记：首次 Python 回归沿用了既有测试的默认本地 `market-revisions/candidates.sqlite` 候选/探测日志目录；该目录时间戳发生变化，不能声称所有测试产物从一开始都写入专用临时目录。最终全量回归已将 LOCALAPPDATA 重定向到 `test-results/isolated-appdata`。默认库只读复核 active=0、approvals=0，未执行批准或当前版本切换；没有为清理测试日志而删除既有记录。这一目录不属于上述17个正式文件保护摘要。

## 生产与数据保护复核

项目 `investment-workbench / fntslvdxnupmdljnadec`：ACTIVE_HEALTHY，ap-southeast-1。
生产 origin/main：`4b7585c41ccf67874f0882ea311c4ad08f00d6e9`；线上 manifest sourceCommit：`c8f5d903a6d728d2a94407608cfaa10524049cac`；assetVersion：`post-apply-browser-sync-v1-20261016`，97 文件。manifest 的源码提交与携带 manifest 的生产提交不同，不能误报为缓存错版。

再次读取完整 migration_view，与开始记录逐字段一致：

- Approval `f146c073-dfe3-43ae-8610-0f09b4e64493`。
- Migration `b804f5b6-7098-43c8-8d96-048a59c6c80c`，applied，generation=1。
- current `353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66`。
- content `bf1f15679e686cae3f908bcada59ce073a2317a24c969bf06a3f855db66556bb`。
- canonical `5d3304239f4a4f7720fa4a8ede370a355368e6e26a1153d8613cb7b81d343427`。
- previous/rollback `041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70`，旧 immutable 版本存在。
- current 430 根，2025-01-09..2026-10-08；dailyAdvanced=false；AI needs_review。
- 原审计仍仅 staged/approved/applied 三条事件；迁移记录1、活动迁移0；行情任务仍2条旧失败、active0、results0。
- `approved-provider-migration-v1`；实现 guard hash `2b95be757867fe4b45e193d68368a68a46448a2314c0b02bdddf35ffed062ab3` 未变。supabase migrations 及旧 guard 的九个实现文件与 origin/main 无差异。

17 个 PC/Bridge/代码保护文件 SHA-256 全部未变，包括包含全部 23 标的的 latest_export、market_universe 和两份 Bridge。旧 PC 426 根混源快照仍只留在原文件，没有用于覆盖远端正式 430 根。没有生产写操作，未改持仓、Plan、订单、Discussion，也未调用 AI。**没有打开或扫描实体手机独立本地存储，因此不宣称证明了用户其他设备在此期间没有独立修改。**

## 发布准备与待授权的完整配套方案

隔离分支：`codex/yahoo-revision-precision-daily-update-v1`。本轮代码提交：

- `a17e3fc807d6bb414fab36bed9bc7770d703aa5e`：反馈、诊断、隔离分类、测试。
- `197f9a1867ef0a5d41e6281a4f18edb2535d9c7e`：验证继承单位证据、准确文案。
- `6fee3d934b1f3f5b1678d6595f44cb1de89dad29`：97 文件 manifest；版本 `daily-update-feedback-v1-20261020`。

未 push、未发布、未安装。后续报告/测试提交不改变发布资源，最终 hash 见 Git 与交付消息。主工作区原有未提交改动完全保留。

**不建议仅发布反馈候选就结束任务。** 真正恢复日更需要一次配套工程，以下是明确待审范围，并不是已完成的功能：

1. **权限规则**：仅允许 2899.HK/Yahoo 按上述 policyVersion 自动处理有界微修订；其他标的维持原行为。复用现有 daily task/capability，不新增任意 command 或客户端自报批准权限。
2. **Worker**：从可信远端 current/latest result 取得基线与原始响应证据索引；分档；正常追加走原路径。第二档整体重算 full-window bars/技术事实，留存 old/new raw 摘要、diff、policyVersion 和 previous facts。继承现有单位证据验证档案。不得把第二档冒充 STABLE，也不得先追加六日后再修旧日。
3. **服务端**：在现有 daily result 发布协议增加严格受限的“经规则处理的修订”分支。服务端核对 Worker ownership、taskType、symbol、启用规则版本、旧 canonical/content/technical version 与完整结果绑定，锁定同 owner/symbol 并执行 CAS；在同一事务写入 immutable 新 result、完整 previous 指针和审计收据、最后 succeeded。客户端提交的 policyVersion/delta/permission 字段不能自行成为授权。超界、重复、错 hash、撤销、失败注入须回滚整笔。
4. **记录复用**：优先复用现有 results 与任务审计承载版本/收据，不新增 Provider Migration 审批工作流。需要新增 schema 的精确内容须作为该规则部署评审的一部分。原 migration_records/heads/events/Approval/Apply/rollback 均不改、不复用旧批准。
5. **浏览器接收**：必须从受权 RPC 读取服务端收据及对应 immutable result，验证 owner/symbol/base/new hash、内容与技术版本；仅对该 validated receipt 开辟微修订接收通路。其余普通导入/源切换 guard 原样保留。保存前备份并校验本地 CAS；仅替换目标行情和派生事实，不覆盖脏业务数据。刷新和下一次启动不能重新接收旧 migration bundle。
6. **失败与恢复**：提交前失败不动有效结果；提交后接收失败显示待同步，不重做任务。需要恢复时通过版本化恢复记录恢复整套事实并保留新旧审计，不能删除 result 或篡改旧 Rebase rollback pointer；恢复策略也需隔离事务/浏览器测试，当前尚未实现。
7. **验收和发布顺序**：先完整隔离测试新分支的 CAS/越权/重放/恢复/伪收据/浏览器冲突，再形成准确 SQL、PC、Pages Candidate 和 manifest，完成部署评审；获生产发布授权后协调服务端/Worker/浏览器版本，停止旧 Worker 后安装候选，首次只处理 2899 日常任务。全部兼容验证前不启用自动修订分支。
8. **最终真实验证**：用户启动 PC Worker；手机一次“更新行情”；检查真实新增数据/版本/服务端收据；用户确认实体手机日期与接收状态。届时若 Yahoo 又变化，重新运行版本化规则，不沿用本次观测结果直接写。

本轮停止依据是用户补充决策第9条：“涉及真实历史自动写入权限或生产规则变更时，准备完整方案并请求授权”，以及原任务明确未授权普通历史 guard 的生产语义改变。不是因为普通技术操作需要确认，也不是要求再批准这 436 根 Rebase。

**唯一推荐下一步：批准上述仅限 2899.HK/Yahoo 的有界自动修订权限规则及配套日更提交/接收契约，随后集中完成这条通路的实现、隔离验收和生产发布评审。** 新规则正式上线并完成 PC 与手机实际验收前，不能报告日更已恢复。
