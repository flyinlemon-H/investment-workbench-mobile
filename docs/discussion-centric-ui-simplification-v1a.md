# Discussion-Centric UI Simplification V1A

日期：2026-09-06。范围：界面层级和入口调整。V1B 删除工作不在本次范围内。

主路径：今日风险 → 标的当前判断（Discussion）→ 按需研究 → Plan / Runtime → 后续复核。

## UI inventory 与最终归属

| 现有能力 / 入口 | 分类 | V1A 归属与处理 |
| --- | --- | --- |
| 首页风险、风险计数与原 CTA | keep_primary | 今日；保持 HomepageAttention 计算与 CTA 语义 |
| 个股 / ETF / 观察一级标签 | keep_secondary | 标的下的持仓、ETF、观察筛选；原 tab key 仍可接收 |
| 零仓标的 | keep_secondary | 标的 → 零仓候选筛选；不创建新持仓分类 |
| 标的发现与搜索 | keep_primary | 标的；全部、持仓、观察、ETF、零仓是可重叠筛选维度 |
| 新增标的 | keep_secondary | 标的列表；复用原编辑弹窗 |
| 单股 Discussion / Current State | keep_primary | 当前判断默认页；新进入任意标的不沿用上次工作区 |
| 当前结论、仓位方向、加仓考虑、风险、止盈止损 | keep_primary | 当前判断首段；兼容旧结论展示 |
| 开始讨论 / 整理结论 | keep_primary | 当前判断内主要操作 |
| 导入结论 | keep_secondary | 当前判断下方；保留预览、绑定检查与确认保存 |
| 当前 Plan | keep_primary | 当前判断 → 计划 → 计划中心 |
| 全部标的的计划入口 | keep_primary | 一级计划；选择股票后查看当前计划与 Runtime |
| State-Watch / Runtime / PlanReview | keep_primary | 单股计划、计划中心；批量复核也可从一级计划进入 |
| 技术面 | keep_secondary | 研究资料 → 技术面；原行情问题 CTA 可直接打开 |
| 新闻催化 | keep_secondary | 研究资料 → 新闻；Discussion 提示仍可直达 |
| 基本面（含 ETF 原有研究） | keep_secondary | 研究资料 → 基本面 |
| 估值 / 配置 | keep_secondary | 研究资料 → 估值 / 配置 |
| 长期逻辑 | keep_secondary | 研究资料 → 长期逻辑 |
| Data Readiness / 返回讨论 | keep_secondary | 原规则与上下文保护保持；研究总入口也保留同股返回路径 |
| 判断依据 | keep_secondary | 当前判断内折叠 |
| 历史 Discussion / Current State | keep_secondary | 单股历史；只展示已有保存的历史 |
| 已结束计划、已有 AI 处理历史 | keep_secondary | 单股历史；计划中心仍保留既有计划历史能力 |
| 用户操作记录 | keep_secondary | 一级记录复用原执行记录页；单股历史显示对应已有记录 |
| 实际操作结果录入 | keep_secondary | 计划内入口 / 单股历史内折叠；不冒充历史数据 |
| 持仓与行情完整摘要 | keep_secondary | 单股底部折叠；顶部只显示名称、代码、现价和持仓 |
| 分析总览 | keep_secondary | 更多 → 分析总览；默认搜索、风险及六列比较 |
| 原 14 个筛选、18 列、旧评分 | hide | 更多筛选与列；展开后才调用原 renderer，保留原筛选处理 |
| 组合比较 / 今日组合 | keep_secondary | 更多 → 组合比较；复用现有组合复核弹窗 |
| 批量技术、行情刷新、汇率、社媒导入 | hide | 工具 → 行情与数据 |
| 正常同步、cloud revision、Manual Sync 细节 | hide | 工具 → 同步；长期逻辑中的同步与版本折叠 |
| PC Bridge、本地状态、社媒数据状态 | hide | 工具 → 高级维护 → 系统连接状态 |
| 备份、JSON 恢复 | hide | 更多 → 备份与恢复；直接展开工具内对应区 |
| 账户和同步设置 | hide | 工具 → 账户；原设置弹窗及授权逻辑保持 |
| 存储诊断、恢复、迁移和验证副本能力 | hide | 工具 → 高级维护；异常恢复阻断仍按原规则出现 |
| 版本信息 | hide | 工具 → 高级维护 → 关于 |
| 清空本地数据 | hide | 工具最末尾危险操作；原确认处理保持 |
| 标的基础信息与策略编辑 | hide | 更多 → 标的维护；原页面仍可达 |

## remove_candidate 登记（未删除）

| 候选 | 本轮处理 | V1B 前必须验证 |
| --- | --- | --- |
| 原 8 个平级工作区布局 | 原实现改名为 `legacyStockWorkspaceTabs` 保留；新分组位于 `src/stock-research-ui.js` | 检查外部脚本、测试夹具和兼容调用，再决定删除 |
| 原工具页 `renderTools`，含远程控制预留说明 | 不再从导航调用；原 renderer 和说明代码保留 | 确认无恢复用途和直接调用后删除展示代码 |
| 多处 `renderTable` / `entryCard` 历史重复声明 | 本轮不删；原类型入口映射到统一标的页 | 分别追踪覆盖关系、兜底路径与旧调用 |
| 一级“今日分析”快速按钮及旧分类标签 | DOM / 原处理保留，正常导航隐藏；分析能力从更多 / 工具可达 | 确认没有兼容脚本依赖这些 DOM id |
| 上次单股工作区偏好 reader | 保留 reader 和 session key；新进入标的固定 ai | 确认旧会话恢复与复核返回用途后处理 |
| 原全局工具按钮排布 | 原 DOM 控件停放于隐藏容器，按需搬到工具区；不复制事件或写入处理 | 验证无模块依赖原父节点，再删除旧排布 |

本轮未删除 legacy readers、legacy_price Plan、业务 schema、旧恢复能力或历史数据。新增加的导航文件只负责展示与事件连接，不做 router 重写或模块体系迁移。

## 验收

自动化使用隔离浏览器存储、合成标的和本地 HTTP 服务，阻止外部请求。没有连接生产账户或触发付费 AI。

`tests/ui_simplification_browser_acceptance.cjs` 覆盖 390×844、360×800、1280×900：

- 风险卡 → 工业富联 → 当前判断；旧 session 偏好不能覆盖默认入口。
- 标的搜索 → 华勤技术 → 当前判断；五个标的筛选均验证数量。
- 四个工作区与五个研究子入口；同股返回讨论。
- 当前 Plan → 计划中心；一级计划 → 股票；State-Watch Runtime 控件可达。
- 单股历史只展示已有记录。
- 更多 → 分析总览；默认六列，原高级筛选可展开并工作。
- 更多 → 备份与恢复；实际 JSON 下载成功，危险操作保持折叠；反复导航后控件不丢失、不重复。
- 导航不调用保存，持仓、计划、Current State、Runtime、PlanReview 和操作记录保持一致；无页面错误、无横向溢出。

`tests/discussion_data_readiness_browser_acceptance.cjs` 保留真实新闻 JSON 更新、取消、返回同股、资料变化后阻止旧上下文归档及重新生成等检查，适配研究入口分组。

`tests/homepage_attention_browser_acceptance.cjs` 保留原风险排序、安静状态、新闻不制造任务、首屏风险 CTA 和直接技术问题跳转验收。

验收结果：上述三个浏览器脚本全部通过；另通过结论导入锚点、有效保存、历史、受保护字段、存储失败与旧会话的 390px / 1280px 回归。Node 全量 760 项中 759 项通过，剩余一项仅为旧发布版本断言；更新版本和新增资源断言后，所属发布测试 4/4 复验通过。发布清单 80 个文件的哈希、浏览器依赖、版本与行情包边界校验通过。

既有 Node 测试中的旧标签数量和首屏排列断言按 V1A 更新；业务断言保持。现有 renderer 会刷新内存中的派生分析缓存，因此验收同时检查“无持久化调用”和“受保护业务数据不变”，不将派生缓存变化误认为业务写入。

## 发布状态与后续

本次完成本地实现、验收和发布清单准备；尚未部署到线上。上线并实际使用一段时间后，再单独开展 UI Dead Path Cleanup V1B。不要据此清单直接删除候选项。
