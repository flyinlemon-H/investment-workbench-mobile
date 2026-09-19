# ENTRY_DECISION_PATH_ENGINE_V1

## 调查与最小方案

- `src/discussion-workbench.js`：Discussion / archive prompt、V3 状态规范、normalization、当前判断和历史的连续上下文。
- `src/discussion-state-contract.js`：userDecision / actionAssessment structural validator、permissive import、原子候选保存、保存后诊断。
- `src/ui-render.js`：headline、addAssessment、warning、既有 Plan 价格展示、历史卡片及导入预览。
- 原有 `structureAssessment` 的 forming/confirmed/broken、actionAssessment 的 entry_review/wait_confirmation、upgradeConditions 不能稳定表达首次建仓路径、位置延伸及旧条件完成情况。
- 因此保留 `stock-discussion.state.v3` 与 currentState 顶层字段，在 `actionAssessment` 下增加 **optional `entryDecision`**。不升级 schema version，不重构 Rule Engine。

## 最终设计

`src/entry-decision.js` 提供独立的结构检查、prompt 规则、判断一致性评估及共用状态展示。仅 canonical shares 严格等于数值 0 才适用。已保存记录的诊断依据保存时的 holding snapshot；实时持仓变为非零后，详情不展示当前建仓卡片。

扩展对象存在时，内部使用固定完整形状：

| 字段 | 意义 |
| --- | --- |
| state / path | 当前 AI 建仓状态与主要路径 |
| directionConfirmed / confirmationSatisfied | AI 对方向及路径核心确认事件的布尔判断 |
| position | acceptable / extended / unclear |
| completedConditions / pendingConditions | 已完成及尚待确认条件，各最多 5 条 |
| negativeEvidence | type、detail、isNew，最多 5 项 |
| previousConditions | 上一轮条件原文 condition、status、evidence，最多 3 项 |
| transitionReason | 路径迁移的新增事实及理由，可为空 |

negativeEvidence 区分 structure_weakening、breakout_failure、support_failure、short_term_weakening、momentum_exhaustion、structure_invalidated、other。previousConditions.status 使用 satisfied、pending、invalidated、unknown。各正文最多 200 字；除 transitionReason 外不得为空。字段类型及枚举属于 structural schema；内容判断不属于导入门槛。

## Entry State

| 状态 | 定义 | actionAssessment.category | positionDirection |
| --- | --- | --- | --- |
| wait_setup | 尚未形成有效建仓结构 | no_action / wait_confirmation | not_applicable / add_watch |
| setup_forming | 条件正在形成 | wait_confirmation | add_review |
| entry_ready | 预定义条件已满足，可以首次建仓复核 | entry_review | add_review |
| entry_extended | 逻辑仍成立，但位置明显延伸、优势下降 | wait_confirmation / entry_review | add_watch / add_review |
| setup_failed | 本轮结构被明确破坏 | no_action | not_applicable / add_watch |

entry_ready 同时要求 addAssessment.status=add_review，headline/summary 明确条件已满足。零持仓的 holding、takeProfit、stopLoss 保持 not_applicable 及约定的三条固定 summary。内容不一致仍保存原文并提示。

## Entry Path 与迁移

- pullback_confirmation：回落 → 稳定承接 → 不再恶化 → 再次转强。
- breakout_confirmation：突破关键压力 → 稳定保持 → 未迅速跌回且短周期强势。
- platform_breakout：首次上涨后平台波动收敛、承接及结构修复 → 再次突破。
- none：暂无明确路径。

三条路径并行，不要求全部满足。支持回踩等待转直接突破、首次突破延伸后转平台突破，也允许新证据支持的其他迁移。迁移要提供 transitionReason，路径不永久绑定。

方向成立 + 核心事件发生 + 位置可接受 + 无否决证据，应升级 entry_ready。价格延伸而逻辑未破坏，用 entry_extended；明确结构破坏才用 setup_failed。entry_ready 降级需要新增实质负面证据，价格上涨较多不能单独否决。

## 不移动门槛

讨论及存档 prompt 同时载入上一轮 upgradeConditions 和 entryDecision，明确声明 “Previous upgrade conditions are commitments for evaluation”。历史持仓快照标识仅作为输入上下文，避免将先前已有持仓的减仓条件当作首次建仓承诺。

AI 必须逐项引用上一轮条件原文并给出完成状态及依据；满足一条完整路径就先承认成立。增加条件或否定原条件必须给出新增负面证据或结构变化。

保存后 evaluator 使用真实已保存的相邻历史记录比对，检查：遗漏旧条件、承认满足却继续等待、继续追加条件、无新增证据降级、无理由路径迁移、延伸与失败混淆、ready 与负面证据/待确认项冲突、状态映射冲突、零持仓固定区块冲突。上一轮已有路径、本轮省略扩展时也只提醒，不阻断。

**程序只评估 AI 声明的一致性，不从行情推断建仓判断，不自动重写 AI 原文。** `expectedState` 是基于 AI 已声明条件的核对结果，只用于提示，不会落成自动状态迁移或订单。

## 兼容、UI 与事实边界

- 旧 V1/V2/V3 继续导入、历史显示及序列化；缺少 entryDecision 时不合成虚假的状态。
- 可选对象存在但结构损坏时按既有 schema failure 处理；判断矛盾仍 permissive import。诊断只在保存后出现，预览不新增语义 gate。
- 详情和预览显示状态、路径、已完成/尚待确认。ready 文案明确已满足；有矛盾的 AI 原文保留，另外显示核对提示。
- 当前路径注明 AI 判断；现有价格 Plan 标明“既有 Plan · 程序事实（独立于当前建仓判断）”及 validityStatus。
- 保存仍走原有 program-owned anchor/references、canonical holding reconciliation、protected snapshot、atomic candidate commit 与 V4 AI evidence 通道。
- 不修改 Plan、Plan Runtime、持仓、订单、交易、目标仓位；不创建真实 User Decision；不改 news/fundamental/valuation/homepage/technical 的业务逻辑。

## 修改文件

- `src/entry-decision.js`：新可选合同、规则、诊断、状态展示。
- `src/discussion-workbench.js`：规范、连续上下文、两阶段 prompt。
- `src/discussion-state-contract.js`：可选结构解析及保存后诊断、预览。
- `src/ui-render.js`：状态卡、相邻历史比对、Plan 分层。
- `index.html`、`scripts/generate_publish_manifest.js`、`publish-manifest.json`：依赖与发布缓存版本。
- `tests/entry_decision.test.js`、`tests/entry_decision_browser_acceptance.cjs`：新增回归与三个视口验收。
- 两份 discussion HTML fixture：补齐模块依赖。
- `tests/workbench_market_bridge_release.test.js`：发布版本与新模块依赖检查。
- 本文档。

## 验证与已知限制

新增单元回归包含 A–F、三个合法路径、旧条件承诺、非零/未知持仓不适用、旧 V3、扩展缺失、typed schema、permissive import、原文保留、候选原子性、Plan/holding 全量不变、零持仓文案、预览及 HTML 转义。

浏览器在隔离上下文内使用合成标的及 Plan，阻止所有外部请求。目标视口：360×800、390×844、1280×900。验证真实导入/确认、刷新恢复、状态和路径迁移、保存后警告、Plan 分层、无横向溢出及无页面错误。结果位于 `test-results/entry/` 和 `test-results/entry-*.log`，不进入生产资源。

最终验证结果：

| 检查 | 结果 |
| --- | --- |
| `npm test` 全量 JavaScript | 1098 PASS，0 fail / skipped，包含新增 28 项 |
| Entry Decision browser | 三视口 PASS |
| Discussion permissive import browser | 三视口 PASS |
| Discussion holding reconciliation browser | 三视口 PASS |
| Discussion reliability browser | 三视口 PASS |
| UI simplification browser | 三视口 PASS |
| 旧 User Decision browser | 旧入口断言失败；原始 HEAD 同样失败，见下文 |
| `git diff --check` | PASS |

限制：没有调用真实 AI，不能保证任意外部模型遵从 prompt；程序不会凭自然语言自行证明真实行情已经满足条件。旧文本没有结构化判断时不会自动补造状态。历史诊断受既有 30 条历史保留窗口约束；最早记录失去相邻前序后不能做跨轮对比，但自身一致性诊断仍有效。

既有 `discussion_user_decision_browser_acceptance.cjs` 仍期待旧版五按钮入口，而当前产品已经简化为两个主按钮。此次运行在未修改的 HEAD 资源上复现同一断言失败；保留该旧测试，不为其改回产品 UI。当前 UI 使用新版 reliability、simplification 及新增 entry 浏览器套件验收。

发布停点：READY_FOR_PUSH。不 push、不部署、不修改真实用户数据。原有两份行情桥接工作区修改保留且不提交。

实现提交：`ed0544b5a1eb81c87f2b496d85a1bd56c1e6daea`。发布缓存版本：`entry-decision-path-engine-v1-20260919`。清单从已提交 Git blobs 生成并逐一验证：86 个源文件、87 个最终资源（含清单），SHA-256、字节数、脚本依赖及缓存版本全部通过；两份行情文件使用已提交内容，不混入原有本地修改，现有 `_site` 未改动。最终提交另外记录清单和本文档，commit hash 由任务最终回复给出。


## 2026-09-20 生产真实 AI 验收修正

以上 READY_FOR_PUSH 和未调用 AI 为首次实现时的历史记录。目标提交已随发布合并提交 `8e9d947d4bf0cf15c31c0f3cc0d53162afea5b99` 上线，保留远端后续行情提交并排除本地两份未提交行情修改。

真实 DeepSeek 连续讨论暴露的局部问题及修正：

- 存档示例按原顺序复制前一轮完整升级条件，明确禁止拆分复合条件或缩写原文，避免错误地判定漏核对。
- 已完成的平行路径可以替代旧未触发路径。诊断仅在新路径已确认、位置可接受、无否决证据、无额外等待条件、有满足的原条件且说明迁移时接受这种替代；其他无据否定仍提示。
- 已发生的实质否决证据与一般高位风险、未来假设风险分开，后者进入 warning / risks。
- 固定零持仓三个区块的原文要求；明确 actionAssessment 与后续字段的同级关系及 JSON 括号闭合。

没有增加 state/path 枚举，不改 parser 宽容度、canonical facts、Plan 或行情同步。真实模型原始响应保持不变，解析失败仍拒绝导入。手工存档使用 JSON 代码块；验收调用的既有 PC Bridge 使用 JSON object 模式，因此测试传输提示明确去除 Markdown 包装要求，不改变业务规则。所有测试保存均在全新隔离浏览器中进行。

新增 10 项回归覆盖真实 AI 出现的问题和路径迁移例外的限制。最终生产复验结果、部署 hash 和模型原始响应另由验收报告记录；本段不预先声称真实 AI 全部通过。实际用户上下文与响应留在忽略目录，不纳入 Git 或发布资源。
