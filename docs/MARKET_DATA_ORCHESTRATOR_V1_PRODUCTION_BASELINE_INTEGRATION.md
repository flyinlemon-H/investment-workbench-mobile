# MARKET_DATA_ORCHESTRATOR_V1_PRODUCTION_BASELINE_INTEGRATION

## 1. Executive Summary

结论：**READY_FOR_PRODUCTION_REVIEW**。从当前 production main 新建隔离分支，仅移入 Orchestrator 开发基线之后的有效增量，保留生产的 Entry Decision Clarity、后续条件连续性修正及 Discussion/Plan/Runtime。没有 merge 旧功能分支，没有以旧 renderer 覆盖生产。当前是本地 Production Candidate 构建；不部署数据库、Pages，不创建生产身份、凭据或任务。

## 2. Production Main 基线

- main：`27731979dc4b63b57d7a6ed262478261140484a4`，2026-10-02 日行情更新。
- 线上 manifest：`entry-decision-clarity-v1-20260920`，sourceCommit `23a7eb0979cd6c7e8e3115b71d2153148c68f170`，deploymentCommit 与 main 相同。本轮只读 GET 再次确认。
- Entry Decision User Language 不在当前 main；没有引入用户举例中的新映射。
- 两份行情 bridge 使用 production main 已提交版本。原工作树两份未提交文件没有复制、覆盖或加入清单。

## 3. Orchestrator Branch 基线

历史分支 `codex/market-data-orchestrator-v1` 保留，源提交 `af84cd0ec7bc27b4128b1e4662549d023a3f3650`。功能增量提取基线是 `ba20244`，即 Orchestrator 开发之前；产品实现终点为 `4818a0f`，评审资料取后续提交。旧清单 `0b18c7e` 不作为候选发布清单。

新分支：`codex/market-data-orchestrator-v1-production-integration`。隔离工作树位于原仓库的 `test-results/market-production-integration`，原工作树保持不动。

## 4. Common Ancestor

`8e529b727b9492a7a0195ef2dc446558423e1eb6`。整合前 main 独有 22 个提交，Orchestrator 历史分支独有 9 个提交。新分支以 main 为直接祖先，而不是改写 main 或强推历史。

## 5. Commit Graph

```text
8e529b7  Entry Decision Path 发布共同祖先（实现 ed0544b）
├─ production: 8e9d947 → 34b08df → 21a7637 → 5104931
│              → 4736c7d → 23a7eb0 → d6c644c
│              → 多次日行情更新 → 2773197
│                                  └─ 新 integration candidate
└─ historical: ba20244 → 3e27b79 → 74d15fa → f4e2f44
               → 4818a0f → 0b18c7e → 3e61931 → d9766de → af84cd0
```

生产增量：`34b08df` 保留 AI 条件承诺与连续性；`5104931` 区分持仓修复与确认条件移动；`23a7eb0` 引入 Clarity。分叉后没有独立的 Plan/Runtime 产品变更提交；共同祖先之前的 Plan V4 raw-state 等能力仍由 main 完整继承。User Language 未上线。

功能增量：`3e27b79` 增加日线编排、M1 与 freshness；`74d15fa` 保护导航后的交付；`4818a0f` 包含浏览器 read/create 竞态修正及 M2 owner 锁/凭据竞态修复、测试远端验收。后续提交是清单、只读评审和停止证据。

## 6. Integration Matrix

| 功能 / 文件 | Production Main | Orchestrator 来源 | 最终保留与策略 | 回归 |
|---|---|---|---|---|
| Discussion renderer / ui-render | 最新 Clarity、Plan 分层 | 旧 renderer 上技术入口 | 保留 main，仅 technicalWorkspacePanel 两处增量 | Clarity、Entry、Plan 三视口 |
| Entry renderer / entry-decision | 最新文案与连续性诊断 | 较旧实现 | main 文件逐字保留 | 31 项 + Entry suite |
| Entry Clarity | 已上线 | 缺失 | main CSS、renderer、用例全部保留 | 31 项及 24 组浏览器案例 |
| User Language | 未上线 | 未包含 | 不新增 | main 代码/提交核对 |
| userDecision / actionAssessment | 最新原文、诊断、预览 | 没有必要增量 | discussion-state-contract 原样保留 | Clarity/Discussion |
| Plan UI / Runtime | 当前定义与运行态分离 | 非本任务范围 | Plan、Runtime、Plan V4 源码原样保留 | 全量、Runtime/Plan 浏览器 |
| 首页 | 当前 action signal / screening | 非本任务范围 | homepage 模块原样保留 | homepage 全量/浏览器 |
| technical workspace | 旧 freshness 展示 | task panel + 同一 freshness | main renderer 加最小入口，导入既有 evaluator | 行情三视口 |
| dataReadiness | 旧日期判定 | shared evaluator | 仅 technical 判定替换，保留其余 readiness | readiness + stale/current |
| freshness | 分散日期判定 | technical-freshness.js | 来源内容不变 | 统一日期、异常、盘中、stale |
| Discussion context builder | 最新 Entry 连续性规则 | technical status/version 增量 | 保留 main，叠加两处 context 增量 | Discussion/Entry/market |
| market data bridge | main 静态 fallback | 失败/旧版本覆盖保护 | 仅增加两行保护 | bridge + failed preservation |
| task client / UI | 不存在 | 已验收实现 | 原样新增，owner/session 边界不变 | lifecycle/dedupe/race |
| PC Worker / capability | 不存在 | 已验收 Worker | 原样新增，手动运行契约不变 | 27 Python、SQL security |
| ProviderChain / daily merge | 既有 PC 项目 | 调用既有 updater | PC 源码与手动脚本不改 | Worker/mock pipeline 与 wrapper preflight |
| technical result | 既有 technical facts | versioned result | 按允许字段落地、失败保留 | 成功版本/失败不覆盖 |
| IndexedDB / localStorage | main 存储引擎 | 复用 critical persistence | storage 模块原样保留，仅 state freshness 调用增量 | 全量 persistence/多标签 |
| release manifest | main 当前资产 | 旧分支过时清单 | main 清单为路径基底，从新源码提交重新生成 | artifactPlan/cache versions |
| M1 / M2 | 未部署 | 已审查 SQL | 原样移入，仅验证 hash | 7 review + registry |
| tests | main 1144 项 | Orchestrator 新增用例/依赖注入 | 保留 production 全套，叠加必要 fixture/import | 全量 1159 |
| 发布流程 | 资产校验后上传 | 缺生产兼容性门禁 | 加 production baseline gate，运行现有关键套件 | 207 项 gate |

## 7. 保留的 production 功能

Entry 决策第一层、状态/路径、completed/pending、“满足后 → 建仓条件成立”、ready/extended/failed、旧 V3 fallback、非零持仓隐藏、原始 AI 表述折叠、risk/diagnostics、Plan 独立参考区全部保留。不会自动生成 Discussion、Plan 或交易。生产现有 source/asset 集合没有删除项。

## 8. Orchestrator 有效增量

A：Browser task client/UI、technical workspace 入口；B：统一 freshness、readiness/context 版本与日期；C：固定任务类型 Worker、ProviderChain 复用与 versioned result；D：原 M1/M2；E：生命周期、安全、Python、浏览器和内存 SQL 测试。请求 read/create 竞态修正和失败版本保护保持来源实现。

## 9. 排除的旧基线

不复制旧分支完整 index、Entry renderer、Discussion contract 或旧 manifest；不移入旧分支相对 main 的删除/降级差异。index 以 main 为底保留全部 CSS，仅添加三个脚本依赖并统一 cache tag。两份用户本地行情文件既不进入 commit，也不作为 manifest 输入；清单生成器只读取新 HEAD 的已提交文件。

## 10. 冲突与处理

没有使用 ours/theirs。产品 hook 的 feature-only patch 能干净叠加到 main；发布版本断言因 main 已由 Path 升到 Clarity 发生上下文差异，保留 main 的用例与新资产列表，改为新的 integration 版本号。generator 保留 main 的资产描述并新增三项模块。

Runtime/Plan 浏览器旧 fixture 分别固定在 2026-09-03/09-08，却使用系统当前日期；统一 freshness 正确拒绝过期证据。测试现在将隔离浏览器时钟偏移至其场景日期 2026-09-04/09-09，并保留时钟正常走动；Runtime 扩展 360 视口。初次冻结时钟导致 Plan session ID 冲突，已改为时间偏移并通过全套浏览器重验。不放宽产品 freshness 或 Runtime 权限。旧手动流程测试依赖相邻 PC 目录：本地只为隔离目录补只读用途的目录联接，未修改 wrapper 或注册定时器。

## 11. Entry Decision 回归

原 production 的 `tests/entry_decision_clarity.test.js` 内容 SHA-256 固定为 `f830348ade410370f5ba56e82e6603b7c3d84b5655ab1ea046e0ac6795b5e9a6`，保持原样，**31/31 PASS**。此前旧候选的 17 项失败全部消失。Clarity 三视口覆盖 8 个合成场景，共 24 组通过；Entry 原浏览器流程覆盖 fallback、路径迁移、reload、诊断及非零持仓隐藏。

## 12. Unified Freshness 回归

统一 evaluator 内容与已审查来源相同。旧 snapshot 即使标记 current，过期时页面 stale 且 Discussion not ready；新结果的 latestCompleteBar、technicalAsOf、resultVersion 一致，页面和 Discussion 均 ready。失败保留上一份有效版本；成功状态本身不强制 freshness。未改 complete-bar 或交易日宽限语义。

## 13. Orchestrator 回归

内存 PGlite 执行原 SQL，覆盖未授权/outsider、非法 symbol/taskType/字段、capability、撤销、lease、dedupe、版本不可覆盖及事务失败回滚。浏览器三视口覆盖 queued/等待执行端、running、succeeded、failed、导航后回读、版本/freshness 一致性、无持仓/Plan/order 变更。

本轮没有连接测试/生产 registry 执行任务，也没有重新运行远端 ProviderChain 闭环；此前 55 项测试项目远端验收作为历史证据保留，不冒充本轮验收。

## 14. 全量测试

| 套件 | 数量 | 失败 | 跳过 |
|---|---:|---:|---:|
| Production main npm test（目录条件补齐后完整重跑） | 1144 | 0 | 0 |
| Integration candidate npm test（含 SQL review） | 1159 | 0 | 0 |
| Python unittest discover | 27 | 0 | 0 |
| PRODUCTION_BASELINE_REGRESSION（前述测试子集） | 207 | 0 | 0 |

相对 main 增加 15 个 JS/SQL 用例：Orchestrator/registry 8 项及原评审 7 项；没有删除生产用例。正式 gate 复用现有用例，不重复算作新增测试。最初基线 1 项失败源于隔离工作树相邻目录条件；补齐后上述完整基线为准。浏览器初次使用的 Playwright 默认 executable 版本未安装，最终显式使用本机已安装 Chromium，未安装新浏览器。

## 15. 三视口

1280×900、390×844、360×800 三个视口全部通过：

| 浏览器套件 | 通过结果 |
|---|---|
| Entry Decision Clarity | 8 场景 × 3 视口，24 组 |
| Entry Decision 全流程 | 3 视口，fallback/路径/诊断/reload/非零持仓 |
| Orchestrator | 3 视口，四种状态、freshness 一致、失败版本保护 |
| Runtime | 3 视口，预览/确认、过期标签拒绝、零执行 |
| Homepage | 3 视口，风险优先、四类 CTA、无自动 Discussion |
| Plan V4 raw-state | 4 种导入时序 × 3 视口，12 组 |

所有测试只使用 loopback 页面、全新隔离 context 和合成数据，阻止外部请求，不调用 AI。页面错误及溢出断言通过，抽查了 360 视口截图。Plan 的六类操作、session isolation、strict rejection 在每个视口的 after 场景覆盖，其余时序中的对应 false 字段表示未运行该扩展场景。机器证据见同目录 `market-data-production-integration-evidence.json`。这不是实体手机验收。

## 16. Release Manifest / release gate

资产版本：`market-data-orchestrator-v1-integration-20261002`。从源码提交 `a9e044d05b6920007c8a1af101c56a56438e1ba2` 重新生成 `publish-manifest.json`，不复用 `0b18c7e` 的旧源码基线。清单 SHA-256：`a5482224eacf4df998d451427c30d314bea60f1bb9f625332548deda4d07dc98`。包含 89 项源码资产，加交付清单共 90 个产物；production main 原资产无缺失，路径、hash、cache tag 和秘密标记校验通过。Worker 文件不属于浏览器静态资源，不上传 Pages；它单独属于候选 Git 源码。清单、报告和机器证据由后续交付提交记录，sourceCommit 保持指向实际源码提交。

`production-baseline.json` 固定此次 main 与 31 项原测试 hash；`npm run test:production-baseline` 要求其为候选祖先、当前 origin/main 亦为祖先、测试未被静默改写，并执行 207 项关键回归。Pages workflow 在上传任何资产之前安装锁定依赖并运行该 gate。本轮未触发 workflow。

发布 checklist：fetch 最新 main → 核验线上版本 → 检查 ancestry 和全部差异 → 完整 npm/Python/三视口 → 生成新源码清单 → artifactPlan/secret scan → 明确授权后才允许发布。如果 main 又更新，先整合并重验，不跳过门禁。

## 17. Migration Integrity

原始 SQL LF 规范化 hash 完全一致：

- M1 `20261002020030_market_data_orchestrator_v1` 对应 `20261001155527_market_data_orchestrator_v1.sql`：`626f36d353c5490e5cdf68b747bbaf26584d68739d239510cedc4643570e2098`。
- M2 `20261002021340_market_data_worker_capability_lock` 对应 `20261002021235_market_data_worker_capability_lock.sql`：`ba6e5d809f052fffd6f5bfaf3af76cf104e87559eba6bfcdde773bc71eb3f30a`。

没有执行 migration，没有更改事务包或数据库安全模型。M2 来源文件末尾存在既有空行，diff whitespace 检查仅对此报提示；为保持原文件完整性不做无关格式修改，其余变更通过 whitespace 检查。

## 18. Production Review Delta

M1/M2、Worker contract、owner capability lock、Browser permission model、统一 freshness 模块均原样保留。变化集中在以 production main 为产品基底、叠加技术任务 UI/context 以及加强发布 gate。新候选保留生产 Clarity，31/31 与 Orchestrator 回归通过；需要基于新候选/清单进行后续生产复审，无需重复没有变化的全部数据库研究。

## 19. Known Limitations

本轮不是生产部署或真实手机硬件验收。日历仍采用既有工作日宽限，长假可能保守 stale。旧 input_queue 为 SEPARATE_SECURITY_FOLLOWUP，Auth 泄露密码检查为 NON_BLOCKING_SECURITY_IMPROVEMENT，均未修改。上轮记录的 CLI 未登录/受控事务执行通道与备份问题仍需在部署复审时确认；本轮没有获取秘密或修复生产配置。

## 20. Final Status

**READY_FOR_PRODUCTION_REVIEW**。生产关键行为与 Orchestrator 回归同时通过，M1/M2 未变，清单已按新源码重建。只交付本地候选；没有 push、生产 Pages、生产 Supabase、身份、Worker 或任务操作。后续生产复审与部署需要用户新的明确授权。
