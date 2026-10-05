# 2899.HK Yahoo Provider Rebase — Approval / Apply acceptance

最终状态：**PILOT_APPROVED_APPLY_BLOCKED**。

用户已真实批准指定冻结包，approval 已持久化并精确回读。真实 Apply **未执行**；真实 rollback **未执行**；手机正式数据未写入。未处理其他 22 个 mixed-provider 标的。

## 批准对象与记录

- symbol：2899.HK / 紫金矿业；target provider：Yahoo。
- candidateHash：`070b3c14465c91f1ca7ae91eed47e1bbdc07b9179d2912dd5055c2f9f6909b86`
- contentHash：`3504c6fe5941eb5df494bc3c04580a1202125c0f82c43794138b475e8ae3cc12`
- approvalPackageHash：`e54cc2f4ce6e7736492bda99a70c0ad08385f2871d18853957f9247e119561fe`
- coverage：2025-01-09 → 2026-10-05；427 根。
- approvedAt：`2026-10-05T14:15:51.502164+00:00`。
- approvalDigest：`69a1e74787e697a4522b33c952c8a4aa9a31877e9a73103959ad4855cb1969ba`。
- approval 精确绑定 candidate object、request object、baseHash、contentHash、approvalPackageHash 与 Yahoo provider。
- actor 为本聊天用户的显式批准；review resolutions 记录用户接受该精确冻结包内的既有 review items，不冒充新增数据证据。
- 真实 store：`.rebase/production-refreeze/pilot.sqlite`。
- 回读结果：objects=2，events=6，approvals=1，active=0。最后一条事件为 approved；没有 applied 或 rolled_back 事件。
- approval 前完整 SQLite 备份：`.rebase/2899-pilot-apply/pre-approval-store.sqlite`。

## 执行顺序结果

| 阶段 | 结果 |
|---|---|
| A 记录真实 approval | 完成，仅上述 2899 精确冻结对象 |
| B 回读 hash 绑定 | 完成，三个 hash、object、request、provider 全部一致 |
| C Apply 前最终检查 | 静态一致性通过；生产迁移接收能力检查失败，立即停止 |
| D 一次真实 Apply | 未执行 |
| E Apply 后生产验收 | 未进入；不能标记通过 |
| F 条件 rollback | 未执行；无真实 Apply 因而没有回滚需求 |

## 已通过的 Apply 前静态检查

重新读取当前生产 manifest 和 10 个所需生产文件，而不是复用旧下载目录。

- production commit：`d3f578d764e3bed111e850cf3c419013575b8241`，与冻结包一致。
- production guard module hashes / asset version：一致。
- Python guard implementation hash：一致。
- 实际已安装 PC 清单中 10 个文件 hash：一致。
- 生产 current 2899 baseHash：`041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70`，与冻结 request/candidate 一致，没有版本冲突。
- candidate blockers=0；冻结对象及三个 hash 未变。
- 已覆盖八条普通写入路径仍受控，unsafeWritePathCount=0。

unsafeWritePathCount=0 表示普通不安全写入不能越过守卫，**不表示已批准迁移版本具有可用的客户端接收通路**。

## 停止原因与复现证据

为避免只切换 SQLite 指针而手机无法接收，最终检查使用真实 approval/store 的临时 SQLite 副本生成 exact Apply payload，再把该 payload 交给**本次重新下载的生产 Bridge 代码**，当前基线为生产 2899 mixed snapshot。只运行隔离内存 state，无真实浏览器 storage、网络任务或数据写入。

结果：

```text
MIXED_HISTORY_REBASE_REQUIRED
writeCount = 0
oldFactsUnchanged = true
realApplyExecuted = false
```

生产代码证据：

1. `src/market-data-bridge.js:8` 在接收任何 matching stock payload 前调用 `assertMarketHistoryContinuity`。
2. `src/state.js` 中旧历史存在两个 provider 即抛出 `MIXED_HISTORY_REBASE_REQUIRED`。该入口没有校验真实 approval 后采用 migration version 的独立分支。
3. JSON Import (`src/import-export.js:85`)、Remote Result (`src/market-data-task-ui.js:13`) 同样走普通守卫；不能用自报 approved flag、替换 storage 或清空历史来强行通过。
4. `scripts/provider_rebase/store.py` 明确说明 active pointer 仅对已接入 reader 有效，不承诺 legacy JSON/Pages 已获得迁移。
5. `scripts/provider_rebase/projection.py` 的 operator deliver 只原子写一个本地 JSON target；本身没有实现手机批准迁移的接收流程。

因此即使 store 层 Apply 可成功，生产手机继续持有混源基线时仍拒绝新的单源历史。该问题在真实 Apply 前即可确定，按用户要求停止，不将其转变成一次可预见失败的生产 Apply。

临时 SQLite 副本的 Apply 不属于正式 Apply。复制连接导致 Windows 首次清理被文件锁阻止；进程退出后已对精确的临时目录完成清理，正式 store 再次只读确认 active=0。

## 保护和验收状态

- 除本次授权追加 approval 的 pilot.sqlite 外，原保护清单其余 **29 个文件 hash 均未变**。
- 正式 bars、technical、freshness、holding、Plan、orders、Discussion、其他 symbols 没有本任务写入。
- 没有调用 AI；没有修改投资判断；候选 needs_review 语义未变。
- 正式 current 尚未切换，故 427 根 Yahoo、技术版本切换、手机读取、迁移后的正常更新、正式 rollback pointer 等 Apply 后项目均标记 **NOT_RUN / BLOCKED**，不以之前 fixture 通过替代生产验收。
- 完整 previous baseline 和 rollback capability 仍保留在原冻结 request/审计包；因未 Apply，没有新正式 previous pointer，不能声称已经完成正式回滚验证。
- 无生产代码修改、无 push、无 Pages 发布、无生产 Supabase 数据库/权限/Auth 更改、无凭据读取。

## 最小后续修复方向

需要设计并验证独立的、审批绑定的迁移接收通路：精确绑定 symbol、旧 base/version、新 candidate/content/technical/approvalPackage、production guard 版本与显式用户授权；仅切换四项 market facts，保留 holdings/Plan/orders/Discussion；跨客户端拒绝陈旧或篡改的迁移；保留完整 previous version 与 rollback。

同时明确 PC/Worker active store、正式投递目标和手机接收方的绑定，避免只更新一个未被生产 reader 采用的本地指针。

**本任务没有实现或部署这些修复。** 用户规定任一 Apply 前检查失败即停止。修复若改变 production guard/deployment 或冻结审批包，应重新生成并提交新的 hash；本次 approval 只对已列出的旧精确对象有效，不能自动挪用。

此前 PILOT_READY_FOR_APPROVAL 表示候选可供审阅，store 级隔离 Apply/rollback 与普通守卫测试通过；本次揭示的生产迁移接收缺口意味着它尚不具备完整的手机端 Apply 闭环。

审计目录：`.rebase/2899-pilot-apply/`，含 approval receipt、preflight manifest/static receipt、actual production assets、isolated delivery result、final audit。真实 approval 保留，等待后续修复决策。
