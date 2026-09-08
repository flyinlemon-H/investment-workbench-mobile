# Plan + Discussion V4 Core Loop

## 1. Executive Summary

实施基线：`122be6d1bfd7b88dc0f93b6d1f9eb640cfd34c41`。验收日期：2026-09-09（Asia/Shanghai）。权威仓库：investment-workbench-mobile。

本次建立了手动 Discussion → AI 当前判断 → 真实用户确认 → 可选计划草案 → 差异预览 → 用户确认 → Plan 修订／生命周期事件 → 变更回执的本地闭环。

正式边界：程序拥有事实、身份与保存机制；AI 只提出判断和候选；用户拥有长期计划与最终确认。没有交易执行、自动 AI、Runtime V4、技术触发引擎、API 或云同步扩展。HomepageAttention 的公式、动作映射、优先级与去重文件没有修改。

完成状态：`PLAN_DISCUSSION_V4_CORE_LOOP_COMPLETE`。本地版本和清单准备完成后停在 `READY_FOR_PUSH`；本任务不 push、不部署、不做生产 smoke。

## 2. Architecture Before / After

原链路保留 CurrentState V1–V3、plan.v2、PlanReview、plan-runtime.v1。原 `planSnapshotHash` 同时包含部分价格观察状态，又遗漏部分观察计划定义，不能证明完整长期定义一致。

新增的关系为：

```text
进入原因（历史快照） → 重新核对当前事实
                            ↓
                    Discussion / AI 判断
                            ↓ 用户显式选择
                    Real User Decision
                     ↓ keep        ↓ change
                    审计       discussion-plan-draft.v1 / V4 profile
                                    ↓ 严格校验与差异预览
                                    ↓ 用户确认 + 再验证
                   同一 canonical candidate：Plan + 来源 + Draft + Receipt
                                    ↓ critical save 成功
                               应用到当前状态
```

新增四个浏览器模块：

| 模块 | 责任 |
| --- | --- |
| `src/plan-context-contract.js` | 定义投影、SHA-256、精确引用、证据与适用性三轴、统一上下文 |
| `src/discussion-v4.js` | 进入原因、AI 判断快照、真实用户确认与会话保护 |
| `src/plan-v4.js` | 长期定义、修订、旧格式投影、历史来源和回执校验 |
| `src/plan-discussion-v4-ui.js` | 我的确认、计划候选预览／确认、来源和历史入口 |

草案业务仍位于已有 `src/discussion-plan-workflow.js`；没有另建独立草案引擎。V1 原路径与 V4 profile 共存。

## 3. Phase-by-phase implementation

每阶段通过 focused gate 后进入下一阶段。过程中发现的正常实现问题在本阶段修复，没有跳过失败继续发布。

| 阶段 | 实施内容 | 当时 gate |
| --- | --- | --- |
| 1 | Shared Context、完整 Definition 投影、版本化 SHA-256、精确 ID 绑定 | 150 tests PASS |
| 2 | Assessment 证据侧记录；Review 保存、Runtime prepare/preview/confirm 的 guard；三轴 UI | 154 tests PASS |
| 3 | 独立 User Decision、AI 快照、可选来源、事实重验和最小 UI | 148 tests PASS |
| 4 | reader-first V4 Definition、same-ID revision、旧投影与旧 hash 留存 | 188 tests PASS |
| 5 | 扩展现有草案引擎；六种处理、diff、会话绑定、原子回执 | 213 tests PASS |
| 6 | 补充 V4 完整意图／revision 绑定，存储、浏览器、全回归、文档与发布准备 | 见第 11 节 |

Phase 4 发现旧 `state_watch` 占位记录没有完整定义：只读适配返回 `legacy_unknown`，不合成缺失规则。Runtime 仍要求完整定义及可用事实。

## 4. Definition Binding Contract

统一入口：`PlanContextContract.definitionRefFor(state, plan)` 和 `binding(state, historicalRef, legacy)`。

| 定义来源 | hash contract | 精确引用 |
| --- | --- | --- |
| 有完整定义的 plan.v2 | `plan-definition.sha256.v1` | planId + definitionHash + contract |
| V4 修订 | `plan-v4-definition.sha256.v1` | planId + revisionId + definitionHash + contract |

V4 hash 覆盖 `{actionIntent, rules}`；因此即使规则文字不变，`hold_watch` 改为 `risk_review` 也不能继承旧复核。修订引用防止“改动后再改回”无声复用上一修订的判断。

价格定义包括动作、价格／方向、数量、所有条件文字、失效规则、配置约束、日期和说明。观察定义包括完整适用／进入／确认／失效条件、复核方向、参考价、配置和日期等既有字段。

不参与 Definition hash：价格触发缓存、triggeredAt、fullConditionStatus、条件确认缓存、Runtime phase、每日 AI 判断、创建／更新时间。ID 与修订由引用负责，正式 lifecycle 由独立适用性检查负责。

旧 `planSnapshotHash` 不改算法、不覆盖历史值。旧 hash 相同只证明旧快照兼容，不自动获得新定义绑定。旧判断缺少可证明元数据时显示 `legacy_unknown`／证据未知。相同 symbol、名称、动作、替代链均不能代替 exact Plan ID。全库重复 Plan ID 视为无法唯一定位并阻止正式变更。

旧 `reviewFreshness` 与 Runtime compatibility status 保留为生产上游的兼容接口；V4 Shared Context、当前 Discussion 请求的补充上下文、新 Review 请求／UI、Runtime 新评估与确认使用三轴结果。请求明确指出旧 references 的 freshness 仅为旧快照兼容，不能覆盖新三轴结论。

## 5. Freshness / Applicability Model

三个独立的派生结果不写回历史判断：

| 轴 | 问题 | 主要状态 |
| --- | --- | --- |
| bindingStatus | 是否仍为同一精确长期定义／修订？ | current / changed / missing / legacy_unknown |
| evidenceFreshness | 当时依据与当前技术、研究、持仓状态是否仍一致？ | current / stale / unknown |
| applicability | 现在的客观事实是否允许这一规划？ | applicable / blocked / unknown |

证据包含技术锚点与技术复核 hash、长期逻辑和研究模块引用、持仓成本与有无持仓。新完整日 K、同日期锚点修正、研究改变、成本改变、cross-zero、技术过期／异常／缺失、日期不一致均会失去有效状态。技术 freshness 状态未知不能声称 current。

数量独立变化不必使判断过期，但具体减持数量超出持仓时不可确认。V4 entry 只适用于零持仓；increase / reduce 要求有持仓；同时检查生命周期、期限和既有配置上限。不会从持仓变化推导执行、完成或管理分类变化。

证据侧存储：`planAssessmentBindings` / `plan-assessment-bindings.v1`。Review 按 reviewId 保存；Runtime 按 planId + runtimeRevision 保存。它与原评估记录进入同一 candidate。旧记录不补造历史证据；新 Review 保存保留请求时证据，不用保存时数据伪造“新鲜”。

Runtime 在 prepare、preview、confirm 重验；新的 AI 候选不能直接推进 Runtime 或正式 Plan。Runtime 的 confirmed / invalidated / resolved 保持 accepted AI assessment 语义。

## 6. Real User Decision Contract

顶层 `discussionDecisionsV4`，schema `discussion-decisions.v4`，包含 discussions 与 decisions。

User Decision 字段：decisionId、discussionId、symbol、confirmedAt、outcome、note、consideredJudgmentRef、planDisposition、当次 context。ID 和确认时间由程序生成。只允许 `confirmed: true` 的用户提交路径；会话以私有 WeakMap 校验，克隆／篡改会话不可确认。

支持：keep_current_plan、continue_waiting、consider_entry、consider_increase、consider_reduce、decline_current_suggestion、review_plan_change。它们不是 order、executed、bought 或 sold。

旧 CurrentState V3 的 `userDecision` 继续属于 AI judgment。AI 结论导入只新增 AI 快照，不自动新增 Real User Decision。每次用户确认保存独立 Discussion 快照，包含当时 AI 判断（可为空）和进入原因。没有 CurrentState 时也可明确记录用户自己的选择。

keep 不要求写任何 Plan；取消／不接受当前建议也不会修改 Plan。保存失败时内存仍为原状态。

## 7. Plan V4 Definition / Revision

顶层 `planDefinitionsV4`，schema `plan-definitions.v4`，包含 byId 与 receipts。Plan 条目包含 planId、symbol、lifecycle、supersededByPlanId、legacyOrigin 与不可变 revisions。

每个 revision 包含 revisionId、revisionNumber、definition、definitionHash、hashContractVersion、confirmedAt、source。Definition actionIntent 为 entry / increase / reduce / hold_watch / risk_review。rules 复用已有 legacy_price 或完整 state_watch 语义；参考价仍不是状态观察计划的可执行触发器。

本任务不把止盈／止损另设为动作：需要减少持仓时使用明确的 reduce，关注风险使用 risk_review；不从旧 note 猜测原意。

同一长期规划修改保留 ID 并新增 revision。若内容没有变化，不新增定义修订。supersede 创建新 ID，并保存旧／新引用、旧 lifecycle 与显式替代链。正式 lifecycle 为 active / cancelled / completed / superseded；旧投影以 replaced 表达 superseded。

正式更新旧计划时，由用户通过完整候选明确意图和规则。legacy buy 不自动推断为 entry 或 increase。缺乏长期定义的旧数据保持可读并待复核。

## 8. Discussion → Plan Change Loop

现有草案引擎新增 `prepareV4 / processV4 / commitV4`。Transport 保持 `StrictAiJson`；新 profile 的 schemaVersion 仍是 discussion-plan-draft.v1，并以 definitionContract=plan-definitions.v4 区分完整定义。

草案绑定：draftSessionId、contextHash、symbol、operation、targetRef，以及程序保存的真实 decision 和 current facts。AI 只能提出 definition、reason、risks、unresolvedItems；其他回显必须严格一致。未知字段、额外包装、歧义 JSON、伪造会话、未解决项目都不能正式保存。没有额外宽松解析器或自动 API 调用。

| 处理 | 确认后的结果 |
| --- | --- |
| create | 新独立 Plan ID 和 revision 1 |
| update | same Plan ID，必要时新增定义 revision |
| no_change | 保留 User Decision，新增本次回执，零 Plan 写入 |
| cancel | 用户明确确认 cancelled；不修改定义 |
| supersede | 旧计划 replaced / superseded、新 Plan ID、显式链和回执 |
| complete | 用户明确确认 completed；AI candidate 自身零写入 |

预览显示字段级 before / after、变更原因、风险、未解决事项、来源用户确认与时间。confirm 重新检查会话、exact target、完整 V4 revision、原用户确认、研究／技术／成本／配置、持仓有无和具体数量。冲突必须重新准备，不自动合并。

纯生命周期操作可以结束仍保持 legacy 格式的旧计划，不凭空创造新 V4 Definition；历史引用、旧内容和来源保存在回执中。

计划页提供“讨论此计划”和来源记录入口；历史页连接进入原因、当时 AI 判断、我的确认、完整草案、确认后的 Plan 引用和 revision。不要求聊天全文。

## 9. Legacy Compatibility

不删除或批量迁移 plan.v2 legacy_price / state_watch、CurrentState V1–V3、Review、Runtime、旧 Draft、coreModel、tradePlan 或兼容 DOM。打开页面和读取 V4 store 不创建新记录。

旧 Plan ID、replacement chain、原 snapshot hash 和正式修改前的完整原 Plan 保存在 legacyOrigin／receipt。V4 当前规则同时投影到 stock.plans 的原 plan.v2 格式，现有价格观察和既有展示仍可消费。

当前基线 normalizer 的整体 JSON round-trip 保留新增顶层分支，测试覆盖替代链和不可变历史。V4 reader 检查其定义与旧投影一致；旧编辑器对已 V4 化计划的冲突修改会被保存校验拒绝，应使用 V4 预览确认入口。

**Rollback 限制：不能宣称任意旧客户端可安全写回 V4。** 基线客户端保留未知顶层分支，但其旧编辑器不维护 V4 修订；更老客户端、仅导入 stocks 数组或丢弃未知字段的外部工具不能保证完整往返。降级前必须导出完整状态，旧客户端只读；恢复时使用完整备份。已产生投影冲突时保留原始数据并拒绝静默修复，不能把“能加载”说成“写回安全”。

## 10. Storage / Atomicity

新 UI 复用 `createValidatedCandidateSnapshot` → `persistCandidateSnapshot` → MultiTabProtection → StorageManager critical save。它不会调用先修改全局 state 的旧普通 saveState 路径。

流程在独立 clone 中组合计划、原用户确认、原草案、回执及修订来源；原始 sidecar 在 normalize 前先验证，normalized candidate 再验证。persist 成功后才 adopt。失败、过期标签页、重复点击、篡改或失效预览不产生半成功 Plan／receipt。

localStorage 使用既有整体状态提交；IndexedDB 使用既有受保护事务机制。本次未改底层迁移／事务／备份代码。真实浏览器已执行 V4 数据的 localStorage 保存／刷新、shadow migration + cutover、IndexedDB 新确认／刷新，以及第二标签页写入后的拒绝覆盖。

备份包含完整 V4 顶层分支。导入／恢复校验拒绝错误 schema、hash、结构、来源关联或不一致投影，不先 normalize 掉坏数据。没有缩减历史或自动裁剪 User Decision／Receipt；配额失败会拒绝提交，用户可导出完整备份。

## 11. Tests

完整 JavaScript 回归：**965 passed，0 failed，0 skipped**。命令：`node --test --test-reporter=spec tests/*.test.js`。包含 68 个 JS 测试文件。

Python 回归：**21 passed**。命令：`python -m unittest discover -s tests -p 'test_*.py'`。Python 业务代码没有修改。

新增 focused 测试覆盖定义 hash、精确引用、旧 hash、所有观察字段、动态缓存排除、三轴独立性、旧证据未知、V4 意图变化、Review 精确修订、Runtime prepare/confirm freshness、真实确认与旧 AI 字段隔离、来源变化、same-ID 修订、替代、六种处理、数量变化、跨零、无授权／伪造／重复／失败保存和坏数据。

真实浏览器结果：

| 验收脚本 | 视口 | 结果 |
| --- | --- | --- |
| plan_discussion_v4_browser_acceptance.cjs | 1280×900 / 390×844 / 360×800 | 用户确认、create/update、失败保存零应用、来源、diff、审计、导入校验、两种存储、stale tab、无横溢出／自动 AI：PASS |
| homepage_screening_browser_acceptance.cjs | 同上 | 风险、价格触发、零持仓建仓、CurrentState 优先、过期回退、安静状态：PASS |
| ui_simplification_browser_acceptance.cjs | 同上 | 当前布局、研究返回、Plan/Runtime、历史、备份下载、键盘和唯一 ID：PASS |
| state_watch_browser_acceptance.cjs | 1280×900 / 390×844 | 旧观察计划创建／同 ID 编辑、AI 草案、持久化失败、多标签页、Review：PASS |
| plan_runtime_browser_acceptance.cjs | 1280×900 / 390×844 | 首次复核、no-change、定义过期、多标签页拒绝、明确 action_review、执行与持仓不变：PASS |

Runtime 老测试样本补齐了与历史 V1 判断一致的真实日 K、technicalData 和引用，并隔离生产行情桥对合成样本的覆盖。多标签页测试的“无关变动”从 notes 改成测试专用顶层字段，因为 notes 是现有长期逻辑的 fallback 证据，变化后本就应该使评估过期。保留原有业务断言，并增加 prepare guard 断言，未降低验证标准。

发现一项可证明的 pre-existing 浏览器脚本失败：`discussion_user_decision_browser_acceptance.cjs:26` 仍期待同一操作栏中五个按钮，而原基线 UI 已只保留“开始讨论／整理结论”。使用 `git archive 122be6d...` 的独立完整基线运行该原测试（只将本地 URL 从 8768 改到 8770）复现相同 actual=[开始讨论,整理结论]、expected=五按钮的失败。未删除或修改它的断言，未标 flaky。当前生产布局由 ui_simplification 与新闭环浏览器验收覆盖。

本地证据位于 `test-results/v4/`，包括 full-js.txt、python.txt、core-loop-browser/results.json、runtime-browser/plan-runtime-browser-results.json、state-watch-browser/phase1b-browser-results.json、baseline-legacy-browser.txt 和截图。该目录按既有规则不入 Git；基线复现方法和结果保存在本文。

发布准备还检查入口依赖顺序、每个入口静态资源的清单覆盖、提交 blob 的 SHA-256／bytes、统一 asset version、git diff --check。新模块必须随同 index 一起发布。

## 12. Known Limitations

1. 手动复制 AI 请求并导入完整 JSON，没有 Plan/Discussion API mode。
2. 草案会话留在当前页面内存；刷新后重新准备，不恢复未确认候选。已确认判断、决定、定义和回执持久化。
3. 旧快照兼容 API 保留给稳定上游；新流程使用三轴，不自动给旧判断补证据。
4. 对任意历史客户端的回滚写入不作安全保证，见第 9 节；已 V4 化 Plan 应从 V4 入口修改。
5. 当前明确版本的回执／决定不裁剪，数据量增大可能触及存储配额；失败保持原状态。
6. 旧五按钮浏览器脚本与基线布局不符，已有可复现证据；UI 旧测试整理作为独立 follow-up。

## 13. Deferred Runtime / Trigger Work

未实现 Objective Runtime V4、价格区间观察、机器事件、支撑企稳、突破回踩、缩量回调、技术 AND/OR 或 AI 自动监控。现有 Runtime 继续是 accepted AI assessment。

没有无 Plan 自动机会动作；没有 API allowlist、Manual Analysis Sync、Supabase、Plan/Discussion 云同步、Plan Group / Tranche / Sequence 修改。

Management Category Lifecycle 的 cross-zero option derivation 保持独立 **BLOCKED / deferred**，本次没有调查或修复，也不阻塞正常非 category 确认路径。旧 parser cleanup 仍是独立 follow-up。

## 14. Recommended Next Task

**已经具备进入 Plan Runtime & Trigger V4 设计与分阶段实施的安全基础**：长期定义完整、版本化且可精确引用；当前 AI 判断、用户决定、正式 lifecycle 分离；适用性和证据不再混用；正式改变有受保护确认和原子审计。

这不表示 Objective Runtime 已经存在。下一任务应先定义程序可证明的触发事实、价格／技术证据来源、交易日 freshness、episode 身份及失效规则，再设计 Runtime 与定义修订的绑定。无法证明的 AI phase 必须保留为判断，不能迁移成程序事件。若下一阶段需要新的机器规则，先版本化规则 contract；不要直接执行自然语言条件。

发布前本地状态为 READY_FOR_PUSH。推送、Pages 部署和生产 smoke 必须另获明确授权。
