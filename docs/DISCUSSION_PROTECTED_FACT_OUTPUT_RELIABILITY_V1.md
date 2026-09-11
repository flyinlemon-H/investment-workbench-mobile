# Discussion Protected-Fact Output Reliability V1

## Root cause / product problem

本任务针对已报告的真实失败类型：JSON 可以解析，输出基本符合 schema，但 AI 在 `userDecision` 中复述或发明精确事实，被 strict validator 拒绝。用户的真实投资资料没有写入 fixture。

原 Discussion prompt 强调事实不能重算或改写；archive 字段规则写的是“不得包含任何自行给出的精确价格”。这可能让模型误以为可以重复程序上下文中已有的正确数值。根因属于 prompt/output contract reliability，不是 parser 故障或 validator 过严。

## Existing validator behavior and field coverage

`src/discussion-state-contract.js` 与 `src/strict-ai-json.js` 均保持原文件内容，没有修改、放宽、清洗或 fallback。

|字段|原校验边界与本次提示约束|
|---|---|
|`userDecision.headline`|原数字/中文数值规则保持；明确只写定性判断、不用数字编号|
|`userDecision.holding.summary`、`positionDirection.summary`、`addAssessment.summary`|同一原严格规则；禁止持仓量、仓位比例、买卖数量及价格回显|
|`userDecision.warning.summary/items`、`takeProfit.summary`、`stopLoss.summary`|同一原严格规则；逐字段测试价格、比例、股数、数量、日期拒绝|
|`summary`、`risks`、`watchPoints`、`keyChanges`、`focusPoints`、`stage`|明确禁止精确事实回显；保留原通用自然语言语义校验|
|`actionAssessment` 全部正文、趋势 `explanation`、结构 `shortReason`|同一全局/输出约束；不更改其实际 schema 或校验方式|
|`planRelation.summary`|只写定性计划关系；不重复计划价格、数量、ID、revision、精确触发值|
|枚举、`symbol`、`sourceDiscussionVersion`|枚举保持固定值；两个程序绑定字段必须原样返回|
|结构项 `timeframe/source/sourceAsOf`|保留既有 schema 和证据规则；它们不是 judgment 正文，未删除必填字段或改变来源日期规则|

当前 validator 对 `userDecision` 的原规则比“精确事实”更保守：任何阿拉伯数字均会拒绝。其他自然语言字段没有相同的全面数字正则，它们保留原来的交易指令、仓位数值、内部词及持仓等语义规则。本任务没有声称为其他字段新增同等级数字校验，也没有重新设计数字语义。`首先观察关键结构` 继续 PASS，`userDecision` 中的 `第1项观察重点` 继续 BLOCK，普通 `summary` 的 `分2步复核结构` 继续保持原 PASS 边界。

## Prompt changes

沿用现有 `buildDiscussionRequest` / `buildArchiveRequest`，新增一条共享全局规则：PROGRAM OWNS FACTS / AI OWNS JUDGMENTS；即使精确值来自 program context，也不能在判断中回显，必须使用 qualitative wording。

archive 在 `userDecision` 字段规则旁再次明确禁止；在实际 JSON example 之前覆盖所有 judgment strings，单独说明 Plan relation 边界、错误与定性版本示例，并提醒保护字段由程序补齐。没有新增 Prompt engine 或 AI 输出字段。

为保留已有 held/four-state freshness fixture 的 `<7000` 字符断言，压缩新增重复说明，将末尾 JSON example 从缩进序列化改为紧凑序列化；示例对象、字段及值未变。没有压缩、修改、修复用户输入或 AI 结果。合成 held archive 为 6922 字符；零持仓保留原有额外持仓规则，archive 为 7580 字符。原长度断言未放宽。

## Before / after examples

|禁止的合成输出|合规定性表达|
|---|---|
|若跌破 50 元则重新复核风险|若关键防守结构进一步失守，则重新复核风险|
|建议减仓 20%|当前可进入减仓复核|
|当前持有 100 股|持仓可以继续观察|
|2026-09-09 技术结构恶化|最新结构恶化|
|在 50 元建仓|待低风险结构出现后复核建仓条件|

零持仓继续使用原 not_applicable / 建仓视角规则；持有、减仓、已有利润保护、持仓止盈止损措辞仍受原校验限制。持仓示例不适用于零持仓。

## UX

仅在既有 protected-fact rejection 上附加操作指引，保留原 validator 诊断：返回讨论，让 AI 只保留定性判断，即使来自上下文也不回显精确事实，重新输出完整严格 JSON 后预览。

复用原“返回讨论”、输入保留、错误可见性、禁用 Confirm 和保存时复核。没有自动编辑文本、仍然保存按钮、自动 retry 或付费模型调用。

## Deterministic tests and browser evidence

新增 `tests/fixtures/discussion-protected-facts.js`，复用原合成持仓和独立合法 judgment fixture；不从业务 prompt 生成回归答案，不调用真实模型。新增 `tests/discussion_protected_facts.test.js` 共 46 项：双提示约束、八个正文位置 × 五类非法事实、合法零仓/持仓 V3 保存、数字边界和错误指导。

扩展既有 `tests/discussion_reliability_browser_acceptance.cjs`：五类事实 × 零仓/持仓 × 三个视口，共 30 个非法导入场景。检查 JSON parse 成功、strict BLOCK、Confirm 禁用、空预览、原文不变、返回后保留输入、强行启用按钮仍零写入、整个 canonical state 不变；合规定性结果经显式 Confirm 保存及刷新后仍存在，Real User Decision 创建数为零，自动 AI 请求为零。

|验证|结果|
|---|---|
|Focused Discussion / State Contract / Plan Discussion V4 / Plan Context|281 PASS|
|完整 JS `node --test tests/*.test.js`|1024 PASS，0 failed，0 skipped|
|Python `python -m unittest discover -s tests -p 'test_*.py'`|21 PASS|
|增强 Discussion reliability browser|360×800、390×844、1280×900 PASS|
|Plan Discussion V4 core loop browser|三个视口 PASS|
|Plan V4 raw-state browser|三个视口 × 四种后台时机，共 12 场景 PASS|
|Homepage screening / attention browser|三个视口 PASS|
|Holding Context Reconciliation browser|三个视口 PASS|
|Discussion technical anchor browser|390×844、1280×900 PASS|
|Discussion data readiness browser|PASS|
|UI simplification browser|PASS|
|发布边界 / 严格资源版本测试|10 PASS|

证据保存在本地忽略目录 `test-results/protected-facts/`，包含 focused.txt、full-js.txt、python.txt、browser/results.json、截图及各已有浏览器脚本日志。已有脚本也保留它们原来的结果目录。已检查手机错误截图，完整指引、返回入口和禁用 Confirm 均可见。

测试开发中修正两处测试假设：合法 V3 保存会记录既有 V4 AI discussion evidence，但 `decisions` 必须为空；浏览器 fixture 应在后台初始读取及打开导入准备完成后取 state 基线。没有为了通过测试修改这些既有产品行为。提示词长度测试曾失败，之后压缩新增文字和示例空白恢复原阈值。

## Safety boundary / compatibility

- 无效输出持续 fail closed；保存函数未调用，整个 state 不变，包括 holdings/shares、cost、trades、orders、managementCategory、Plan、Real User Decision。
- 合法 V3 仅写既有 Discussion 状态和 V4 AI evidence；测试比较其余所有状态相等，`discussionDecisionsV4.decisions` 为空。AI `userDecision` 仍是判断，不是用户授权。
- CurrentState V1–V3 readers、source context、zero-position、holding reconciliation、technical anchor、Discussion → Plan Draft、Plan V4 Core Loop 由原 focused/browser regressions 覆盖。
- 没有改 API/allowlist、自动 AI、parser、validator、Plan、Runtime/Trigger、Sync、Supabase、Category Lifecycle、Homepage 业务实现。
- 全部浏览器使用本地站点和隔离的合成数据，没有 push、deploy 或 production smoke。

## Known limitations / recommended next task

确定性测试证明提示合同、合法/非法导入和兼容边界；不能证明真实模型违规率已经降低，也不保证今后不再发生拒绝。其他 judgment 字段的原校验覆盖差异继续存在。旧 user-decision 五按钮浏览器脚本的既有过时预期已在前一版本文档记录，本次由现行 reliability、V4 和 UI 验收覆盖，不改旧脚本断言。

建议下一任务：在另行授权的真实手动 Discussion 试用中，仅记录去敏后的失败类型和字段分布，评估提示词效果；不要引入自动修复或放宽校验。本任务不实施 Runtime/Trigger 或新的 API。

## Release discipline

本地实现、focused、全量回归和浏览器验收完成后创建源码提交，再更新 asset/version，生成绑定已提交源码的 manifest，验证发布文件哈希。未经明确授权不 push、不 deploy、不执行生产 smoke。

- 实现提交：`0003d6ef30ce3908da5b633a502ccf50110623fc`，继承本任务开始时的 `a15ab80`。
- 资源版本提交 / manifest sourceCommit：`4a33ee86747598f8edbb241cefbbdd38453f8824`。
- assetVersion：`discussion-protected-fact-output-reliability-v1-20260909`；index 所有脚本统一版本，严格版本测试同步更新。
- manifest 包含 85 个源文件，真实 `artifactPlan` 验证 86 个发布文件、入口依赖、统一 cache version、字节数与 SHA-256；包含 market bridge 在内全部 85 项另行逐一比对，不覆盖现有 `_site`。
- 资源版本更新后再次运行完整 JS：1024 PASS；增强导入浏览器三个视口再次 PASS，证据为 `final-full-js.txt`、`final-browser/results.json`。未修改业务代码或校验语义。
- 最后的准备提交仅更新 manifest 和本文。`test-results/protected-facts/verify-release.cjs --committed` 在最终 HEAD 读取提交 blob，核对 sourceCommit 祖先关系、全部哈希、受保护模块与原基线逐字相等以及 clean working tree；结果写入 `ready-for-push.json`。

完成状态：**DISCUSSION_PROTECTED_FACT_OUTPUT_RELIABILITY_V1_COMPLETE**。

最终停止点：**READY_FOR_PUSH**。没有 push、deploy 或 production smoke。
