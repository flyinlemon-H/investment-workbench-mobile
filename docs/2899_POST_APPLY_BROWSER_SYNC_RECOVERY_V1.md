# 2899_POST_APPLY_BROWSER_SYNC_RECOVERY_V1

日期：2026-10-16（Asia/Shanghai）。最终状态：**POST_APPLY_SYNC_DEPLOY_REVIEW_REQUIRED**。

已完成服务端只读复核、真实浏览器调查与备份、最小本地修复、回归、隔离三视口验收及发布 Candidate 准备。生产浏览器仍未接收新版本；不得标记 PILOT_APPLY_ACCEPTANCE_PASSED。没有重复 Stage / Approve / Apply，没有 Rollback，没有生产数据库、RPC、RLS、Auth 或正式行情写入，也没有发布或推送。

## 1. 服务端事实（本轮重新查询）

生产项目：investment-workbench / fntslvdxnupmdljnadec。线上 manifest 的 deploymentCommit 为 `bd52d7fec804434a529ba2f0102f05bb0d17f280`，资源版本 `market-data-canonical-hash-v1-20261008`。

| 项目 | 结果 |
|---|---|
| Migration ID | b804f5b6-7098-43c8-8d96-048a59c6c80c |
| Approval ID | f146c073-dfe3-43ae-8610-0f09b4e64493 |
| 状态 / generation | applied / 1 |
| Apply 时间 | 2026-10-10 15:27:40.154282 北京时间 |
| Apply 审计事件数量 | 1；本轮前后相同 |
| Current / candidateHash | 353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66 |
| contentHash | bf1f15679e686cae3f908bcada59ce073a2317a24c969bf06a3f855db66556bb |
| approvalPackageHash | 7a1b42288c4ccf0e4bc8beb6009122bd58a3da6578726ce105bcf2f2274faf96 |
| Previous / rollback pointer | 041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70 |
| Current 四字段 canonical facts hash | 5d3304239f4a4f7720fa4a8ede370a355368e6e26a1153d8613cb7b81d343427 |
| Previous canonical facts hash | 8b160e2c790c884fa69db04ea2cba51e7676372c63fa8c49b3f4b26411db4f7d |
| 技术版本 | cd60c0f0e662fd2a9e681c7b9e1ceafa9b797632264ec8e577295b3ff8a7a5fb |
| 历史 | 430 根完整日 K，2025-01-09 至 2026-10-08；与批准 Candidate 的 bars 精确相等 |
| Source contract | Yahoo / qfq / adjusted / HKD/share / volume=shares；amount 不可用 |
| Approval 消费 | 同一 Approval 绑定 applied 记录与唯一 Apply 事件；未重新审批 |
| Previous 完整性 | 不可变 previous bundle 与原 capsule.base 精确相等；指针可解析 |
| 活动迁移冲突 / 活动任务 | 0 / 0 |

原有 unit evidence 为 EMPIRICALLY_VALIDATED，不改称提供商正式承诺。没有发现服务端一致性异常。Rollback 只检查指针和完整 bundle，并以隔离测试验证既有回滚逻辑；未在生产调用 Rollback。

## 2. 真实浏览器调查及根因

实例：Codex 内置浏览器 ID 2、用户已有 tab 1；正式站点原 URL 带 `?acceptance=7df5f7b`。账户设置显示现有已登录状态及“退出此设备登录”；使用同一用户会话。没有读取 session storage 中的认证内容、token 或密码。

初次观察时 document 仍加载旧 `auth-password-recovery-v1-20261003` 资源，缺少 canonical / migration 模块；普通刷新后加载当前生产资源。URL 查询参数本身不固定历史部署。刷新后仍真实显示“迁移已保存在远端，本机尚未接收”，技术页仍截至 10-02，故缓存不是唯一原因。

提示来自 `src/market-data-task-ui.js` 的 errorText。poll 先调用迁移 sync，再调用普通任务读取；迁移 sync 在本地版本检查失败时阻断后续。真实提示与导出快照、已核验的远端 context 在原程序运行时回放结果吻合：`migration_local_version_conflict`，persist 调用次数为 0。已有浏览器 console 没有提供该错误细节，因此错误码证据来自真实输入的确定性运行时回放，不声称读取到了生产网络完整 payload。

`src/approved-market-migration.js` 将远端 raw baseBundle 与已经经过浏览器正常派生的四字段 facts 直接比较：

- 旧浏览器把 374 根 Yahoo 日 K 的 `amount: null` 转成了 0。
- `src/state.js` 正常生成 technicalData 默认字段、MA/成交量等派生表示及 volume_change 元数据。
- 既有 technicalReview 在 technicalData 中形成展示镜像及旧 lastUpdated。
- 实际 diff：OHLCV 数值、日期、source contract 和 barCount 差异均为 0；41 个新增展示字段，374 个 amount 表示差异。
- 从可信远端旧 baseBundle 重新执行既有派生，再带入本地原有 technicalReview，得到的四字段与真实备份**精确相等**。
- 另一个缺陷是接收后普通 normalize 路径会再次删除 null、重建 technicalData、覆盖旧 review 镜像，破坏已接收 immutable facts 的精确表示。

这不是新 Provider Migration，也不是需要覆盖真实用户行情编辑的冲突。普通 canonical null/0 差异仍严格有别；没有更改全局 canonical 算法或行情 guard。

## 3. 备份、数据保护与未同步修改

通过产品“更多 → 备份与恢复 → 导出备份”取得两份实际浏览器备份。没有直接编辑 localStorage 或 IndexedDB；没有导入替换文件。高级存储信息显示当前数据源是 localStorage，没有启动 Shadow Migration / IndexedDB cutover。

第一份实际备份 SHA-256：`60edc4e6503d63bbbf0ace4ddafd48c9c23cbb657eabf54f430d9597eb0a5345`。

本地 2899：426 根，截至 2026-10-02，无 marketMigration generation；四字段 canonical hash：`06e93027090bd678b2d37e6370a748a6afe16fe5eab48dc5334a1857926eb6fc`。

第二份备份 SHA-256：`442116bb88979f7bc263abf883f9ecb91bd19d73b82742b6b2fc7e2c6204f613`。两份 diff 只有 lastBackupAt、updatedAt 和 12 个自动生成的 coreModel.priceSnapshot.id。行情、持仓、Plan、订单、历史 Discussion、人工 technicalReview 内容不变。导出功能本身会保存备份时间；没有把这些元数据差异隐去。

未观察到未保存的表单编辑；现有工具没有提供全部业务队列的可信 pending=0 证明，因此不声称“所有业务均已云端同步”。所有本地业务字段都视为受保护数据，接收不使用远端业务对象覆盖它们。

真实浏览器仅有 12 个标的，能逐字段核对的是 2899 及其他 11 个；不能把它冒称为手机/全部23标的的本地验收。另对当前 PC bridge 与未改动的生产源码 bridge 比较，23/23 标的四类行情事实一致，包括另外22个标的。前次 Apply 的30个保护文件中28个整文件hash仍相同；bridge文件与market_universe.json的整文件hash已有变化，不能声称自10月10日起全部文件都没变化。bridge的23标的行情事实已单独证实未变；本任务没有改动这些文件。

## 4. 最小修复

产品行为修改仅在三个文件：

1. `src/approved-market-migration.js`：远端 canonical transport / baseline binding 校验保持强制。仅 schema4、首次接收、applied、无本地迁移/内容版本时，允许通过受控 projectBaseline 精确匹配旧浏览器派生表示。真实字段差异仍拒绝。最后一次异步检查后比较完整原 state，阻止并发业务编辑。原 previousSnapshot 保留，并新增 previousLocalSnapshot / previousTechnicalReview，记录本机实际接收前恢复点。
2. `src/state.js`：只从可信 expected bundle 重建正常表示和已知旧 null amount→0 表示，输入本地 review 仅用于展示镜像，且原 review 不变。已接收迁移的 generation、指针、内容/技术版本及日期一致时，展示/normalize 不再重写其 immutable facts。Freshness 继续由当前日期计算。
3. `src/market-data-task-ui.js`：接入投影函数；在最终持久化前的账户 await 之后，再核对完整 state，保留原关键保存/多标签保护流程。

其余差异为测试、页面资源版本和 manifest。普通行情 RPC、continuity/revision guard、canonical 算法、数据库对象均未改动。新资源版本：`post-apply-browser-sync-v1-20261016`，用于避免旧脚本缓存继续驻留。

产品修复提交：`c8f5d903a6d728d2a94407608cfaa10524049cac`。本地分支：`codex/2899-post-apply-sync-recovery-v1`。发布 manifest 的 sourceCommit 绑定此提交；包含97个浏览器资源，文件完整性97/97通过。manifest SHA-256：`b87146917eda0bc2bafd966f79cbb67b595529a71d44332f85a9c00e2244909d`。最终交付提交包含本报告和 manifest，尚未 push。

## 5. 验证结果与实际限制

| 验证 | 结果 |
|---|---|
| 最终 JS/SQL 全量 | 1342/1342 PASS |
| Python 完整套件 | 119/119 PASS，无skip；使用既有隔离 PC baseline |
| Production Release Gate | 207/207 PASS，包含未修改的 Entry Clarity 31项 |
| 新增接收/竞争保护测试 | 9/9 PASS |
| Canonical / migration / rollback / provider / Discussion | 包含于上述完整套件；无生产 Apply/rollback |
| 三视口 | 360/390/1280 本机隔离页面 PASS；实际技术组件、无横向溢出 |
| 隔离浏览器刷新、重新进入、重复接收 | canonicalMatch=true；needs_review 保留；重复读取0次保存 |
| 真实导出+远端context离线回放 | 一次本地内存持久化、0远端写入；其他11标的和业务字段精确不变 |
| 真实生产浏览器接收 | **未通过；生产仍是旧代码，仍停留10-02** |

中间失败记录：第一次 JS 全量因工作树没有相邻 PC 源码而1项失败，配置已存在源码路径后通过；Python 未配置路径时4项skip，直接使用已安装 guard 的 PC 源码时4项失败（3项安装前基线不匹配，1项增量兼容测试）。按既有测试设计使用 pristine PC baseline 后119项全部通过。未修改真实 PC 源码来迎合测试，未将其与已安装 PC runtime 的验收混为一谈。

隔离视口使用合成9999.HK、140根历史，CSP只允许本机连接，无生产账户/凭据。它证明代码与真实技术组件兼容，不替代真实2899浏览器验收。真实430根数据的验证来自独立实际备份回放。

回放接收后的四字段 canonical hash：`5d3304239f4a4f7720fa4a8ede370a355368e6e26a1153d8613cb7b81d343427`，等于服务端。真实浏览器的 hash 尚未切换，仍是上述 `06e930...`。

回放技术事实：MA5=32.016001，MA20=33.272，MACD dif=-0.940635 / dea=-0.812818 / histogram=-0.255634；与服务端相同。430根历史、技术页、dataReadiness、Discussion Context 统一截至2026-10-08，content/technical/result版本一致。Discussion历史正文保持原样；上下文明确“行情来源已迁移，旧AI判断待复核”，AI状态needs_review，没有AI调用。

截至验收日2026-10-16，既有日期规则计算ageInBusinessDays=6，因此技术页面和Discussion均为stale、ready=false。这是正确的时间新鲜度，不能为了通过验收改成current。没有为了测试创建行情更新任务。

## 6. 跨设备与发布方案

本轮调查的是Codex内置浏览器正式站点tab1。它尚未被新代码恢复。PC `投资分析程序/data/latest_export.json`仍426根截至10-02且无migration marker；未修改。手机Safari拥有独立同源本地存储，未读取或验收，不能声称已同步。

获得发布授权后，只发布本分支的前端Candidate及97资源manifest，使用既有Pages workflow；不执行任何数据库部署，不重新Stage/Approve/Apply，不生成新Candidate或审批包。上线后核对deploymentCommit、资源hash和版本，再在同一已登录浏览器进入：更多 → 分析总览 → 紫金矿业 → 查看行情 / 检查同步状态。现有迁移current轮询应安全接收原generation=1；不需要点击“更新行情”，也不需要再开迁移审批页。

每台设备先导出本地备份，再加载新资源、使用原授权账户进入同一标的技术页；仅在严格基线匹配时接收。出现真实本地事实冲突或保存失败应保留原数据并停止，不清空存储。PC数据文件的接收是独立路径，本次不授权或声称完成它的更新。

发布后仍必须完成：真实浏览器430根/版本/MA/MACD/Freshness/Discussion核验、刷新及重新进入、前后业务导出比较、服务端唯一Apply及previous pointer复核。当前仅准备本地Candidate，不自动发布。

## 7. 证据

本地私有目录：`.rebase/post-apply-sync-recovery-v1/`，包含两份浏览器备份、字段差异、remote-before/after、原程序冲突回放、fixed-replay、完整测试日志、97资源完整性、三视口截图/receipt。备份及真实业务数据不入git、不进入Pages。

最终状态：**POST_APPLY_SYNC_DEPLOY_REVIEW_REQUIRED**。需要前端发布授权才能完成真实生产浏览器验收。不能将离线/隔离成功报告为PILOT_APPLY_ACCEPTANCE_PASSED。
