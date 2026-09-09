**PLAN_V4_DRAFT_RAW_STATE_FIX_COMPLETE**

发布准备状态：**READY_FOR_PUSH**。仅本地提交，未 push / Pages / production re-smoke。

基线：`47925c974a228de506af46b37f035ed2efd2ffdf`。本次修复 V4 candidate textarea 在后台资料完成后的整页重绘中丢失输入，以及编辑后仍保留旧 Preview/Confirm 的问题。

业务修改只涉及 `src/plan-discussion-v4-ui.js`。沿用原 `drafts` Map 和 `prepared.draftSessionId`；没有第二套草稿存储、schema 变更或 whole-page renderer 改造。

**修复行为与边界**

- 候选 textarea 的委托 input 事件立即更新对应 item.raw。重绘始终从该内存字段恢复最新输入。
- textarea、Preview、Confirm 携带 stockId 和既有 draftSessionId。事件还核对当前详情 stock、原决定/Discussion、确切 target Plan 和 operation。
- 编辑时清除 item.preview，并移除旧 diff/Confirm；不在 input 事件中重建正在编辑的 textarea。Confirm 同时检查当前输入和有效 preview，拒绝重新插入的旧按钮。
- 原 prepared/contextHash 保持不可变；它们仍由既有工作流严格检查。被编辑内容对应的旧 preview/candidate 不再可由 UI 提交，不添加宽松解析或绕过规则。
- 同一合法会话重绘时恢复其 target/operation 选择，防止 update 等操作在重绘后显示默认 create。实际切换 target/operation 则丢弃该任务，必须重新整理。
- 切换 stock 使用原按 stock 保存的 Map；返回 A 可恢复仍合法的 A，会话 B 不接收 A 的输入。重新 prepare、新确认的 Discussion/decision 会清除旧任务；脱离页面或旧 session 的事件不能污染新任务。
- 未 Confirm 的 raw 只在本页内存中保存，刷新页面不恢复未确认草稿。Confirm 后正式 Plan、revision、source、receipt 仍通过既有原子保存与校验持久化。

StrictAiJson、Plan V4 Definition/Real User Decision schema、definition hash、binding/freshness/applicability、PlanReview、Runtime、Homepage、技术触发、AI API、Manual Analysis Sync、Supabase、managementCategory lifecycle 均未修改。后台 app/render 函数也没有改动。

**修复前后证据**

先新增 `tests/plan_discussion_v4_raw_state.test.js` 并在原业务代码运行：13 项中 11 项失败，空输入/错误 JSON 的 2 项严格拒绝测试已通过。应用修复后 13 项全部通过，包含六种操作、编辑使候选失效、拒绝 stale Confirm、新任务/stock/Discussion/target/operation 隔离。

从 Git `47925c9` 导出独立完整旧版，本地端口 8771，使用相同浏览器回归脚本的 `--expect-old-failure` 模式：1280×900、390×844、360×800 均稳定复现后台响应完成后输入为空、Preview 格式异常、零 Plan 写入。未访问或修改生产环境；上轮线上调查现场保持原样。

修复版浏览器脚本：`tests/plan_discussion_v4_raw_state_browser_acceptance.cjs`。它在独立上下文使用合成股票，只允许本站 GET/HEAD；取得原始 social 响应后只控制交付时机，未直接调用渲染函数来伪造原故障路径。

|后台时机|1280×900|390×844|360×800|
|---|---|---|---|
|输入前完成|PASS|PASS|PASS|
|输入后、Preview 前完成|PASS|PASS|PASS|
|编辑中完成，随后继续输入|PASS|PASS|PASS|
|编辑流程中不发生后台重绘|PASS|PASS|PASS|

所有 12 个用例验证原 zero-position → Homepage Discussion → consider_entry → create → 完整输入保留 → Preview → 编辑 B 使 A 失效 → 重新 Preview B → Confirm → 刷新持久化。

每种视口的 after 用例还覆盖：

- 实际改变视口尺寸并重建详情页，最新 raw 仍完全相等。
- create、update、no_change/keep、cancel、supersede、complete 共用输入组件，整页重绘后 raw/target/operation 保持；update 同 ID 新 revision，keep 零 Plan revision。
- Preview 后修改 raw，当前 textarea 节点不被 input handler 替换，旧 diff/Confirm 消失。将旧 Confirm 按钮重新插回 DOM，使点击确实到达真实 handler，仍拒绝且零写入。
- target/operation/new prepare/stock/new Discussion 切换隔离、旧 input 节点事件拒绝。
- empty/malformed JSON 继续 fail closed，Preview 无正式数据写入。

初版浏览器脚本调试中修正了两处测试错误：把静态 `src/api/ai-api.js` 误算作 AI 调用的 URL 匹配，以及切换测试选用了刚被 supersede 结束的旧 Plan。改为匹配实际 AI endpoint，并选择另一个仍 active 的确切 Plan。业务断言未删除或放宽；最终测试覆盖全部要求。

**验证结果**

|验证|结果|
|---|---|
|新增 focused JS|13 PASS|
|新增 focused + Plan/Discussion V4 JS|35 PASS|
|最终完整 JS 回归|978 PASS，0 failed，0 skipped|
|Python 回归|21 PASS|
|旧版独立浏览器稳定复现|3/3 复现原失败|
|修复版后台时机 × 视口|12/12 PASS|
|原 plan_discussion_v4_browser_acceptance|三个视口 PASS；原子失败、source/audit、localStorage/IndexedDB、刷新、旧标签页保护|
|ui_simplification_browser_acceptance|PASS；相邻 UI、唯一 ID、导航与备份等原有断言保持|
|发布边界与严格资源版本测试|10 PASS|

所有新浏览器用例比较显式 fixture setup 后的 shares/holdings、avgCost、trades、orders、executionLog、managementCategory：保持不变。自动 AI 请求 0，允许的非读取网络请求 0。未 Confirm/无效 Preview/stale Confirm 均不改 Plan/receipt；正式 Confirm 才保存授权的合成 Plan 变更。

本地证据目录为 `test-results/v4-raw-state-fix/`，按现有规则不入 Git：

- `focused-before.txt`、`focused-after.txt`、`plan-discussion-js.txt`、`final-full-js.txt`、`python.txt`。
- `old-browser/results.json` 和三份旧版 trace；`final-browser/results.json` 与 12 份最终 trace、截图、network 记录。
- `core-browser.txt`、`ui-browser.txt`；原验收脚本也在其既定输出目录保存结果。
- 原始调查证据仍位于 `test-results/v4-json-loss-investigation/` 和 `test-results/v4-production-47925c9/valid-fixture-run/`。

**发布准备**

资源版本：`plan-v4-draft-raw-state-fix-v1-20260909`。index 中统一 cache version、清单生成器和严格 release version 断言一并更新。

源码及资源版本提交：`28bbb0820b66e44f7048c6e3c21b69b0dcea2206`，直接继承生产基线 `47925c9`。manifest 的 sourceCommit 精确绑定该源码提交。后续发布准备提交仅包含生成后的 manifest 和本文，不再改变浏览器源资源。

已用 Git 提交 blob 执行真实 `artifactPlan`，校验入口依赖、85 个源资源的 bytes/SHA-256、sourceCommit 祖先关系和 86 个有效发布文件。已有 `_site` 未覆盖。最终 HEAD 的同等校验、完整资源哈希和 clean 工作树证明保存在 `test-results/v4-raw-state-fix/ready-for-push.json`；effective manifest 的 deploymentCommit 在实际发布时使用最终部署提交。

本任务不 push、不触发 Pages、不执行生产 re-smoke。发布准备完成后状态为 **READY_FOR_PUSH**。

获明确发布授权后，production re-smoke 仍须覆盖 390×844 原失败路径与 1280×900 对照，包括 background rerender → Preview → Confirm，并复核 create/update/keep、Homepage source、刷新持久化、zero-position、受保护数据不变、automatic AI = 0。不能把本地 PASS 视为生产已通过。

Management Category Lifecycle cross-zero blocker 保持独立 BLOCKED/deferred；旧五按钮浏览器脚本保持 pre-existing outdated expectation。本任务未修复、重跑或扩大调查这两项。
