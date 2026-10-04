# PROVIDER_REVISION_ENGINE_V1

状态：`PILOT_REVISION_READY_FOR_USER_REVIEW`。此状态仅指隔离实现和离线候选可以评审，**不是生产发布或真实 Apply 授权**。

实现位于 `codex/provider-continuity-rebase-v1` 隔离工作树，基线 HEAD 为 `4d0cdbee7fa730a79cde533adc69dba168fa8e4e`。沿用尚未提交的 Rebase 实现，没有覆盖原工作目录的本地改动。没有新 commit、push、部署、远端迁移或 Auth 操作。

收到的任务附件结束于第 49 节的 `UPDATE_DAILY`，本文覆盖已收到的完整要求，没有假定缺失内容。

## 实现与边界

- `scripts/provider_rebase/revision.py`：来源契约、provider registry、完整窗口比较、分类、双哈希、比例序列、单位门禁、schema 2 候选与技术差异。
- `scripts/provider_rebase/integration.py`：Worker / 手动 / 批量统一探测入口；每个标的独立克隆，校验完成后只发布四个行情事实字段。网络失败、修订、来源冲突、并发基线变化均保留原数据。
- `scripts/provider_rebase/store.py`：沿用原 SQLite objects / events / approvals / active；复用 approve、apply、rollback、generation CAS 和原子事务。schema 1 构造算法保持兼容；schema 2 重建审批包验证。
- `scripts/market_data_worker.py`：调用统一入口，保留固定安全错误码；不把 URL、异常原文或凭据写入远端错误。默认候选库存于操作员配置的私有 Worker 目录 `revision-candidates.sqlite`。
- 保持现有 M1/M2 RPC 的 stock 四键白名单：远端技术快照放在 `technicalIndicators.technicalSnapshot`，浏览器解包为本地 technicalData，不新增根级字段、不修改 migration。
- `scripts/provider_rebase/pc_patch.py`：生成独立 PC companion 包，包含相同 core / revision / integration / store / fetch 源码；没有第二套差异规则。**仅生成、测试补丁，未安装到现用 PC 程序。**
- 前端复用 `state.js::assertMarketHistoryContinuity`；手机任务结果、静态 bridge、JSON 导入、CSV 均经过它。普通导入没有隐式迁移模式。
- `scripts/market_history_projection_guard.js`：旧 bridge 发布器写目标文件前的统一投影检查，拒绝无探测证明、历史覆盖、日期丢失、版本冲突。不能把带着新时间戳的旧文件当成稳定更新。

不创建第二套迁移数据库模型；隔离 pilot 使用另一数据库文件只是为了不触碰已冻结真实候选库。

## 契约、探测和分类

契约包含 symbol、canonicalProvider、rawProviderId、providerVersion、adjustment、priceBasis、market、interval、historyWindow、normalizationVersion 和 units。运行时 providerVersion 绑定现有 PC provider 源码及严格 Yahoo parser 的摘要；适配器变化不能冒充同一契约。

registry 包含 mutableHistory、revisionProbeSupport、revisionProbeMode、normalizationVersion、eventEvidenceSupport、aliases。当前没有默认 alias；只有显式登记的别名才解析到 canonical provider，Yahoo 与 Eastmoney 始终不同。未知来源安全停止。

现有 PC 默认首次请求约 550 个日历日，增量请求最近 7 天，merge 不截断已保留历史。新入口在有历史时覆盖这个 7 天起点，改用**现有正式历史的最早日期至本次 end**；保留原 3000 条合法性上限，超限拒绝，不静默截断。已用 900 条 fixture 验证没有写死 426 / 550 条窗口。

每次显式 daily update 都执行完整窗口探测。不加 scheduler、后台定时任务或额外 corporate-action API。Yahoo 严格解析器拒绝缺失 adjclose 因子的响应，不能按 1.0 因子继续；现有完整日 K 判定仍负责剔除未收盘日。

| 情况 | 处理 |
| --- | --- |
| 契约不合法或语义版本/单位语义冲突 | `SOURCE_CONTRACT_MISMATCH` |
| 历史混源 | `PROVIDER_REBASE_REQUIRED`，附加同源修订证据不能绕过选源 |
| 单一旧来源与本次来源不同 | `PROVIDER_SWITCH` |
| 同源保留历史所有字段相同，仅追加新日期 | `STABLE`，允许正常 merge |
| 同源 OHLC、volume、amount 或已存在时间范围内的日期改变 | `SAME_PROVIDER_REVISION`，生成候选并暂停该标的 |
| 缺少旧历史日期 | `REVISION_SUSPECTED`，完整性 blocker |
| 未知元数据 / 无法确认连续性 | `UNKNOWN_CONTINUITY_RISK` |
| 全窗口获取失败 | `REVISION_PROBE_FAILED`，保留原有效版本 |

旧历史规范与本次结果不一致时，不自动降级、不降低精度、不使用最近几个交易日替代完整校验。

## 确定性与审批包

OHLC 使用当前 Python `round(value, 6)` 规范；volume / amount 使用确定性的十进制表示。`1` 与 `1.0`、正负零等表示噪声不构成差异；归一化后的 `0.000004` 变化会被检测。没有新增百分比容差。

- `contentHash`：规范化 bars 和语义契约，排除 fetched_at、请求时间、生成时间及证据说明文本。
- `approvalPackageHash`：完整审批材料，包括分类、单位证据、rawEvidenceHash、技术预览、风险、警告和旧版本绑定。任何审批相关修改都需要新审核。
- `candidateHash`：继续兼容现有 Store 的对象审批与显式批准短语；绑定整个 schema 2 包和上述两个哈希。

schema 2 同时含 previousVersion、candidateVersion、revisionType、triggerEvidence、changedDates、fieldDiffSummary、ratioSummary、corporateActionEvidence、unitEvidence、technicalDiffSummary、approvalStatus 和 sourceContractVersion。`approvalMode=USER_REVIEW`，生成时 `applyAllowed=false`。CLI 新生成也使用 schema 2；旧 schema 1 可读取和重建，但审批 / Apply 同样执行新单位与成交量门禁，不能从旧入口绕过。

OHLC ratio series、summary、regimes、boundaries 是描述性证据；比例按六位表示分组不参与“忽略价格变化”的判断。有事件材料时计算 observedFactor、expectedFactor、difference，但不据此自动认定因果或 Apply。完美因子匹配也不能自动批准。

## 单位、技术与 freshness

单位状态为 confirmed / strong_evidence / unknown / not_applicable。记录 currency、priceUnit、volumeUnit、amountUnit 和 raw-to-shares scale。必需单位必须有 confirmed 状态、合法 scale 与证据；strong_evidence 不清除 `UNIT_CONTRACT_INCOMPLETE`。

发生 volume 差异时，V1 没有已评审的自动放行规则，因此 `VOLUME_DIFFERENCE_UNEXPLAINED` 始终阻止 Apply。把自由文本说明写成 confirmed 也不能清除它。双方 amount 缺失为 NOT_COMPARABLE；只有契约明确要求 amount 时才成为必需单位门禁。

技术预览重新计算 MA5/10/20/60/120、MACD、可比较成交量事实、60 日支撑/阻力、price/MA20 和 MA5/MA20 关系、MACD 关系及交叉事件、完整日日期、确定性风险事实。短样本返回 null / unavailable，不补造数值。

尚无可供该 Python 包调用的已版本化 price-action classifier，明确标记 unavailable。旧 mixed baseline 的预览仍是混源基线比较材料，不能因为重新计算而获得来源认证。旧 raw Yahoo 不存在时，不编造 factorOld。

技术结果绑定 dataContentVersion、technicalVersion、latestCompleteBar；页面、dataReadiness、Discussion Context 透传并核对相同版本。候选生成不推进当前 freshness。手机读到修订失败后，只增加独立的待复核标记，保留原 bars / 指标 / freshness；技术 readiness 变为非 ready。之后成功的完整稳定探测才解除该标记。

保留原 AI 判断与已存 Discussion，不调用 AI。未来 fixture Apply 的 sourceMigration 标记为 same_source_history_revision，新的 Discussion Context 显示“历史复权行情已修订，旧判断待复核”，不改写旧讨论。

## Canonical 写入路径清单

下表区分**本次候选源码保护**与**现用环境部署状态**，不存在未调查的 UNKNOWN WRITE PATH。

| 类型 / 路径 | 候选中的 guard 状态 |
| --- | --- |
| Worker `UPDATE_DAILY_MARKET_DATA` → `execute_task` → PC updater | `guarded_updater` 全保留窗口，分类后才 merge；固定错误码；候选写独立 Store |
| PC 手动 / 批量工作台脚本 → `update_market_universe.load_source_updater` | 同一 guard；每标的独立失败，其他 STABLE 标的继续；结果含 revisionClassification / revisionState / candidateObject |
| PC 直接 CLI / API → `src/market_data/updater.update_market_data` | companion 补丁将入口包装为相同 `guarded_updater`，merge helper 也检查连续性；补丁已在临时包独立测试，**现用 PC 尚未安装** |
| `apply_updated_facts` → formal JSON / registry marketFacts / bridge | 上游统一 guard 发布四字段 bundle；失败标的沿用旧快照；现有文件事务与锁保留 |
| 静态 bridge → `market-data-bridge.js` | 浏览器共享 guard；没有完整探测证明的旧 bridge 为 `UNSAFE_WRITE_PATH_BLOCKED` |
| 手机远端成功结果 → `market-data-task-ui.js` | 同一浏览器 guard、既有 owner 检查、完整 bundle 保存回滚；不得直接接受历史修订 |
| JSON 导入 / 本地候选恢复 → `persistCandidateSnapshot` | 允许相同历史恢复；改变 canonical bars 的普通导入为 `UNSAFE_WRITE_PATH_BLOCKED`，不能用伪装增量避开审核 |
| CSV 历史导入 → `ui-render.js` | 同一 guard；无可信完整探测/显式迁移通道，阻断覆盖 |
| `publish_market_bridges.js` 正式 bridge 发布器 | `assertProjection` 在复制、commit、push 前比较已发布完整历史和版本；无证明的旧源文件阻断 |
| `prepare_market_bridge.js` | 只剔除未完成尾部，不改已完成 bars；发布器和浏览器仍执行上述 guard，不因 prepare 而获得写入许可 |
| Rebase / Revision Store apply、rollback | 显式审批、哈希重建、单位 blocker、baseHash、generation CAS、SQLite 事务；没有任何自动调用 |
| `provider_rebase.projection.project` | 仅显式投影已生效 Store 版本；文件 hash / generation CAS；不是普通增量导入 |
| quote `price-refresh.js` | 更新实时报价字段，不生成或 append canonical daily bars；未改动此功能 |
| normalize / 本地 storage restore / analysis sync | 读取或规范化现有快照；新导入入口受上述 guard 控制；分析同步不新增 daily bars 写入通道 |

现用 PC 旧程序仍然存在，不能把“补丁测试通过”写成“所有生产写入端已部署”。在正式启用此版本或真实 Apply 前，必须安装已评审 companion 并确认旧运行入口不会并行覆盖；当前真实候选因此仍含 `writer_deployment_not_confirmed`。

## 2899 离线 pilot

没有重新请求行情，只使用之前冻结的 426 条候选及已保存 raw / archive / replay 审计材料。

- 主状态：`PROVIDER_REBASE_REQUIRED`。
- 同源重叠：374 日；361 日 OHLC 改变，1 日 volume 改变；修订相关日期并集为 362 日。
- volume：2026-10-02 减少 8000 raw units，保持独立 blocker。
- amount：Yahoo 双方缺失，不伪造比较值。
- corporate-action 材料：2026-07-23 派息证据与比例关系，仅用于支持人工评审。
- approvalMode：`USER_REVIEW`；approvalStatus：`pending_user_review`；applyAllowed：false。
- 原冻结 candidateHash 仍为 `f184badf402c860c987c3b4c507b7fa94a52d3ea57b8c175c981d061e3bdcec0`，原库没有修改。

最终新候选：

```text
objectId: ce462705807db20ef7d0cb8292b35907264d4bdc21e9e6f3b7c3aa5cfe952386
candidateHash: f4f1f0a88eb42f0a124d747b4a3bf7eead6830e5dab9b7615cbf1b542eb834cb
contentHash: 2638d0a6d4d812ffc145334eafced99f07ded0f7c347373d18b5348ded6e4f80
approvalPackageHash: 6e56ba21452e597234ab15845e18143f69e59e1b5c70b43acafcd5d6e0f5c0dd
```

材料位于 `.rebase/revision-engine-2899-final-candidate.json`、`.rebase/revision-engine-final-report.json`、`.rebase/revision-engine-pilot.sqlite`。开发过程中产生的中间对象保留在 immutable store，不能复用其过期校验包审批；以上 objectId 是最终评审对象。

真实新旧 pilot Store 均为 **approvals=0、active=0**。审批/Apply/rollback 测试只发生在测试框架创建并清理的合成临时数据库。

7 个保护文件 SHA-256 均未改变：原工作目录正式 market bridge、PC latest_export、PC provider.py、PC updater.py、market_universe.json、原 pilot SQLite、原 2899-review.json。这也覆盖了正式导出中的 holding / Plan / order 未改动。

## 验证与评审操作

最终门禁：Python 67/67；JS/SQL fixture 1228/1228；RPC 嵌套快照兼容性专项通过；PC companion 临时独立包测试通过；`git apply --check` 通过；`git diff --check` 通过。日志为 `.rebase/revision-python-tests.log`、`.rebase/revision-js-tests.log`、`.rebase/revision-rpc-compatibility.log`。

测试覆盖：900 条完整窗口、追加稳定性、0.000004 微差、历史增删日、未知来源、真实 alias 解析、契约/单位版本漂移、完美因子不自动 Apply、成交量门禁、双哈希、审批证据失效、存储事务/rollback、逐标的 batch 保护、缺失复权因子、旧发布路径阻断、页面/readiness/Discussion 版本一致性。

只读评审命令（从该工作树运行）：

```powershell
python -B -m scripts.provider_rebase --store .rebase/revision-engine-pilot.sqlite pending --symbol 2899.HK
python -B -m scripts.provider_rebase --store .rebase/revision-engine-pilot.sqlite review --object ce462705807db20ef7d0cb8292b35907264d4bdc21e9e6f3b7c3aa5cfe952386
```

PC 补丁为 `.rebase/pc-revision-engine.patch`，只生成和只读检查，未安装。生成器使用当前文件 baseline SHA-256；本次补丁以 LF 保存，避免 Windows 换行使普通 `git apply --check` 失败。

## 尚不能放行的事项

1. 真实 2899 的单位证据和孤立成交量修订未完成解释，不能 Approve / Apply。
2. PC companion 和前端均未部署；不得宣称生产写入路径已经受到新 Engine 保护。
3. 旧无探测 bridge / CSV / 普通 JSON 覆盖会被新版本阻断，这是明确的安全行为变化，需要发布评审说明。
4. 运行时适配器摘要必须与未来生效契约一致；离线 Rebase fetch 的旧 providerVersion 不自动等同于 Worker 适配器版本。
5. 旧 raw Yahoo 缺失；事件因子是支持性证据，不是旧原始响应的替代品。
6. 可执行来源迁移的权威仍是本地 Store；浏览器普通导入不提供 Apply 后绕过 guard 的开关。后续真实切换与分发须遵守现有 Rebase 部署和显式交付门禁。

最终停止于 **PILOT_REVISION_READY_FOR_USER_REVIEW — REAL_APPLY_BLOCKED**。
