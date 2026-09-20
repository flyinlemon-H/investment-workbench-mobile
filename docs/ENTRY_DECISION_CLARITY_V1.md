# ENTRY_DECISION_CLARITY_V1

状态：READY_FOR_PUSH。本地实现与验收完成；本任务不 push、不部署。

基线：`4736c7d76fbcf7b25e8edea65aa2dfd7eba15891`。工作分支：`codex/entry-decision-clarity-v1`。缓存资源版本：`entry-decision-clarity-v1-20260920`。

## 调查及修改

原 `discussionStateCard` 同时展示 Entry Decision 小卡和更醒目的旧 userDecision headline/仓位/建仓摘要，导入预览也重复相同层级。旧摘要的“继续观察”“再评估”可与 entry_ready 冲突。Entry schema 没有额外的 final/intermediate 标志，已有 `actionAssessment.upgradeConditions` 承载 AI 声明的升级承诺。

本次只改变展示优先级和相关文案诊断：

- canonical shares=0 且存在有效 entryDecision 时，首层使用“建仓决策”：固定状态文案、主要路径、已完成、待满足，以及条件完成后的结果。
- setup_forming 已有 upgradeConditions 且未明确限定为中间/阶段性条件时，显示“满足后 → 建仓条件成立”，并标注其对应 AI 已定义的完整升级条件。原条件可展开查看；不会把每条零散 pending 当成独立充分条件，也不把并行路径改为必须全部满足。
- AI 明确写明中间条件、阶段性条件、并非最终条件或只是观察信号时，不显示最终结果承诺。缺 upgradeConditions 时不生成承诺。此处仅解读 AI 对条件角色的明示措辞，不计算价格、均线、趋势或技术确认。
- 五状态文案分别为：尚未形成建仓条件／建仓条件正在形成／建仓条件已成立／建仓逻辑仍成立，但当前位置已明显延伸／本轮建仓结构已失效。
- 四路径文案分别为：回踩确认／突破确认／平台后二次突破／暂无明确建仓路径。
- 未提供的 completed/pending 不补造，显示 AI 未列出；ready 且 pending 为空时显示“无待满足条件”。失效原因只使用原 negativeEvidence，缺失时回退到原 reasons。
- 旧 headline、positionDirection.summary、addAssessment.summary 及其他原始区块保存在“原始 AI 表述”折叠区，原文可展开阅读，保存数据不改变。warning 及其条目仍直接展示，risks/downgradeConditions 仍在判断依据内。
- Plan 在独立虚线区域显示。needs_review 增加“既有计划待复核，不作为当前建仓路径的唯一条件”，不改动 Plan 定义、有效性或触发逻辑。
- preview 与正式详情使用同一个 Entry renderer；preview 仍不显示 post-import diagnostics。
- 仅扩充已有 entry_ready_wording_conflict 的文字冲突覆盖（暂不建仓、继续空仓观察等及旧仓位方向摘要）。entry_mapping_conflict 保持原行为；没有增加内容导入门槛，没有自动修正 AI 数据。

全仓相关用语调查后，Plan 观察条件、“进一步确认”等其他模块文案保持原样；没有机械替换原始 AI 文本或旧 V3 fallback。

## 边界核对

通过与基线源码比较确认：Entry validate/example/rules 函数保持原样；evaluate 除一条文字冲突提示覆盖外保持原样。状态/路径枚举键、升级/降级/迁移规则、schema、parser、JSON normalization、事实保护及保存路径没有改变。

不修改 technical review、行情同步、news/fundamental/valuation/longTermLogic、Plan trigger/validity、Runtime、持仓、订单。所有浏览器写入只在本机全新隔离测试上下文中；未访问或修改真实用户浏览器数据。原工作区两份行情文件修改继续未提交。

## 验证

| 检查 | 结果 |
| --- | --- |
| 全量 JavaScript | 1144 PASS，0 fail / skipped；基线1113，新增31项 |
| Clarity 三视口 | 360×800、390×844、1280×900，共36组通过 |
| 合成案例 | A回踩形成、B突破形成、C ready与旧摘要冲突、D extended、E failed、F旧V3、G中间条件、H wait_setup |
| 既有真实 AI 样本 | forming/ready/extended/failed 四种，每个视口回放；导入后记录逐字段一致，没有重新调用或重写 AI |
| 原 Entry browser | 三视口通过，含路径迁移、刷新、diagnostics及非零持仓隐藏 |
| permissive import browser | 三视口通过，持仓冲突可保存后提示，原始文本及受保护事实保持 |
| diff --check | 通过 |

截图已记录每个合成状态和真实 AI 样本，并检查手机窄屏下的状态、路径、条件及结果层级，无横向溢出，无 pageerror。冲突案例中旧摘要默认隐藏但可展开，diagnostics 保留；ready 首层不出现“暂不建仓／再评估”。

本次真实样本为上一轮留存的原样保存记录，来自明确标注的合成验收上下文，保存在忽略目录；没有将用户私人上下文加入 Git。浏览器脚本通过 `CLARITY_REAL_AI_SAMPLES` 指定本地样本目录，证据文件不进入生产包。

本机证据目录（相对原工作区）：`test-results/entry-clarity/`。完整日志另在 `test-results/entry-production/clarity-*.log`。新增浏览器脚本：`tests/entry_decision_clarity_browser_acceptance.cjs`。

## 保留限制

现有 schema 用自然语言说明条件角色，未明示的条件意图无法由 UI 证明。展示信任 AI 的 upgradeConditions 声明，并对明确中间限定采取保守回退；不增加 schema 或推断技术判断。

既有模型 JSON 偶发错误和 mapping 不一致不由本任务修复；仍沿用严格结构校验和现有诊断。READY_FOR_PUSH 仅表示本轮 Clarity 本地验收通过，不将上一轮真实模型稳定性状态改写为生产验收通过。
