# 2899_POST_APPLY_SYNC_PRODUCTION_RELEASE_V1

日期：2026-10-16（Asia/Shanghai）。最终状态：**PILOT_APPLY_ACCEPTANCE_PASSED**。

本次发布了已批准的前端 Candidate，并在用户原来已登录的 Codex 内置浏览器中完成真实接收、页面/Discussion核验、刷新持久化和业务数据保护验收。没有重新执行 Provider Rebase，没有创建新行情任务，没有修改数据库、RPC、RLS、Auth、Worker或正式行情。

## 1. 生产发布

| 项目 | 结果 |
|---|---|
| 发布前 origin/main / 线上部署 | bd52d7fec804434a529ba2f0102f05bb0d17f280 |
| 批准 Candidate / 实际发布 / 最新 production main | 4b7585c41ccf67874f0882ea311c4ad08f00d6e9 |
| 产品修复 sourceCommit | c8f5d903a6d728d2a94407608cfaa10524049cac |
| 资源版本 | post-apply-browser-sync-v1-20261016 |
| Push | 普通 fast-forward push 成功；没有 force push，没有覆盖他人提交 |
| Pages Workflow | 38871919339；build、deploy 均 success |
| 在线 manifest | deploymentCommit、sourceCommit、assetVersion 精确匹配 |
| 线上资源完整性 | 97/97文件hash及bytes一致，0失败；含manifest共98个发布文件 |
| 浏览器实际资源 | meta及approved-market-migration.js查询版本均为新资源版本 |

Workflow：https://github.com/flyinlemon-H/investment-workbench-mobile/actions/runs/38871919339

发布前 fetch 最新 main，未发现新的生产提交；无需整合或修改批准 Candidate。差异为已审查的接收修复、配套测试/资源版本/manifest及既有审批报告，不包含私有备份、凭据或本机未提交的行情文件。Pages allowlist打包、凭据扫描、行情bridge校验通过。本轮没有新增产品代码修复，没有升级数据库RPC；旧客户端仍保守拒绝派生表示差异，新客户端只通过现有current读取接收同一个已Apply版本。

## 2. 远端事实与原审批（执行前后真实只读查询）

项目：investment-workbench / fntslvdxnupmdljnadec。标的：2899.HK / 紫金矿业。

| 对象 | 值 |
|---|---|
| Approval ID | f146c073-dfe3-43ae-8610-0f09b4e64493 |
| Migration ID | b804f5b6-7098-43c8-8d96-048a59c6c80c |
| 状态 / generation | applied / 1 |
| 原Apply时间 | 2026-10-10 15:27:40.154282 北京时间 |
| Current / candidateHash | 353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66 |
| contentHash | bf1f15679e686cae3f908bcada59ce073a2317a24c969bf06a3f855db66556bb |
| approvalPackageHash | 7a1b42288c4ccf0e4bc8beb6009122bd58a3da6578726ce105bcf2f2274faf96 |
| Technical Version | cd60c0f0e662fd2a9e681c7b9e1ceafa9b797632264ec8e577295b3ff8a7a5fb |
| Previous / Rollback Pointer | 041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70 |
| Previous canonical facts hash | 8b160e2c790c884fa69db04ea2cba51e7676372c63fa8c49b3f4b26411db4f7d |
| 历史 | 430根完整日K，2025-01-09至2026-10-08 |
| Source Contract | Yahoo / qfq / adjusted / HKD/share / volume=shares；amount不可用 |
| 旧AI判断 | needs_review |

Approval已由原applied记录消费，并继续与同一审批包、唯一Apply事件绑定。Previous bundle与capsule.base精确相等、指针可解析。当前行情、technical及freshness的content/technical版本一致。前后均无活动任务、无staged/approved迁移冲突。

以下远端对象的行数和全行摘要在发布前后完全相同：migration_records=1、migration_heads=1、migration_versions=2、migration_events=3、tasks=2、results=0。Apply事件始终只有1条。没有Stage、Approve、Apply、Rollback或其他迁移写入；未创建行情更新任务。

## 3. 真实浏览器接收

实例为用户已有Codex内置浏览器ID 2、tab 1，原URL仍为正式站点 `?acceptance=7df5f7b`。普通刷新加载新资源，没有清除任何浏览器存储。原认证会话继续有效；发布后账户页面显示“已登录”和“退出此设备登录”。接收记录owner与原迁移owner一致；没有读取/输出密码、token或完整Auth payload。

实际操作：更多 → 分析总览 → 紫金矿业 → 查看行情 / 检查同步状态。由现有迁移current轮询自动完成接收，没有点击“更新行情”或任何审批/迁移按钮。

| 本地状态 | 接收前 | 接收后及完整刷新后 |
|---|---|---|
| Local Version | 无marketMigration pointer；旧426根截至10-02 | 353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66 |
| generation | 无 | 1 |
| canonical facts hash | 06e93027090bd678b2d37e6370a748a6afe16fe5eab48dc5334a1857926eb6fc | 5d3304239f4a4f7720fa4a8ede370a355368e6e26a1153d8613cb7b81d343427 |
| bars / 截止日 | 426 / 2026-10-02 | 430 / 2026-10-08 |
| 状态提示 | 本机尚未接收 | 该提示消失 |

接收后facts hash与远端完整bundle的canonical hash精确一致。contentHash是批准历史内容的hash，不与四字段facts hash混用。previousLocalSnapshot与本机接收前四字段facts hash一致，previousSnapshot与远端旧完整版本精确一致。

既有接收器在没有真实行情内容冲突、没有并发业务修改时完成关键保存。接收前备份与上次诊断备份的受保护内容相同。未把客户端hash作为服务器写入权限，也未伪造本地字段。

## 4. 行情、技术事实、Freshness与Discussion

实际技术页显示：雅虎财经、完整日K430条、技术数据截至2026-10-08。实际MA/MACD展示与导出/远端精确值一致：MA5=32.016001、MA10=32.112001、MA20=33.272、MA60=34.373184、MA120=33.430752；MACD DIF=-0.940635、DEA=-0.812818、柱值=-0.255634。页面按现有精度显示32.02、32.11、33.27、34.37、33.43及-0.941/-0.813/-0.256。

在真实页面点击“开始讨论”仅准备本机Prompt，展开“查看完整Prompt”读取用户可见上下文，没有点击“复制给AI”、没有调用AI或保存讨论结论。真实DOM上下文证明：

- symbol=2899.HK；technicalAsOf/latestCompleteBar=2026-10-08。
- resultVersion=current；dataContentVersion=批准contentHash；technicalVersion=远端技术版本。
- anchor为Yahoo/qfq/adjusted、2026-10-08、close=31.280001。
- Discussion按既有设计携带最近30根完整日K作为首次讨论上下文；不是把完整430根历史缩短成30根。
- snapshotSummary为“行情来源已迁移，旧AI判断待复核。”；存储中的AI judgment为needs_review。
- 当前验收日为2026-10-16，因此技术页、dataReadiness和Discussion均为stale，ready=false。历史bundle中的生成时fresh/current字段保持不可变，由日期规则推导今天的真实新鲜度，没有伪称更新到当天。

## 5. 保存、刷新和业务保护

通过产品现有导出功能建立三份真实备份；未直接读写隐藏浏览器存储、未导入覆盖文件。备份SHA-256：

- 发布前：a165955a86be780d4b271db7526d3e400b06ed141453c2344f5052520402351d
- 首次接收后：49d03da98458e81d71d05fc890e9cd4da09d7eb96b2c7acddffc229af352b927
- 完整刷新、重新进入后：4e0a6ce6198621d4140bb98cfac67fd999235e9bee0df66a659b24aadc881957

刷新后再次打开2899技术页，仍显示10-08；第二份接收后备份的四字段hash与首次接收和远端三者完全一致。两份接收后备份只有14个既有元数据差异：12个coreModel.priceSnapshot.id、updatedAt、lastBackupAt；0个非预期差异。导出功能自身会更新备份时间并生成展示ID，不能把这种元数据更新称为业务内容变更。

接收前后逐字段检查：Holding、Plan、Orders、历史Discussion、technicalReview及其他顶层业务对象不变。2899的coreModel是随新行情重建的派生展示，区别于持仓/计划/讨论正文；原始业务字段没有覆盖。当前浏览器12个标的，其中其他11个标的的行情和业务内容不变，仅展示ID按既有逻辑重建。

全部23标的共享行情载体也受保护：发布前后7个线上data资源hash一致；本机30个保护文件hash全部相同，包含PC行情文件、bridge及其他业务载体。此前已核对这份bridge覆盖23个标的，四类行情事实与生产源码一致，因此另外22个标的bars、technical、freshness未被本次发布或接收修改。远端迁移存储只存在2899记录且前后完全相同。没有声称浏览器里存在它实际没有的另外11个标的。

## 6. 回归结果

| 门禁 | 本轮结果 |
|---|---|
| JS/SQL全量 | 1342/1342 PASS，0 skip |
| Python全量 | 119/119 PASS，0 skip；使用项目既有隔离PC baseline |
| Production Release Gate | 207/207 PASS |
| Entry Clarity | 原有31项断言完整保留，包含于上述门禁 |
| Canonical golden、continuity、revision、migration apply/rollback、snapshot receive、local conflict、technical、freshness、Discussion、Auth | 完整套件全部通过；apply/rollback仅隔离测试 |
| 发布前隔离360/390/1280 | 接收、刷新、重入、hash及无横向溢出通过 |
| 真实生产360/390/1280 | 新日期、430条、无本机未接收提示、无横向溢出通过 |
| 真实生产Auth | 刷新后保持登录；原账户入口正常；无Auth修改 |
| 线上资源hash / bytes | 97/97 PASS |
| Pages CI | build与deploy成功 |
| 真实刷新/重入 | 不回退；canonical facts精确一致 |

本轮批准Candidate未变化，不需要重写修复或重新冻结审批包。没有用隔离测试替代真实2899验收；真实验收证据包括页面、三份实际导出、DOM Discussion上下文和前后远端查询。

## 7. 现存提示及跨设备边界

行情任务区域仍可能显示旧“更新失败 / provider_mismatch”。查询确认它来自北京时间2026-10-04 00:42:06结束的历史任务 `b8097955-c6fd-4df5-ac90-13ea61f33f08`，早于10月10日迁移；另有同日更早的一条失败任务。本轮任务总数仍为2且摘要不变。该历史任务提示不代表本次迁移接收失败，也没有新行情抓取失败；本次不改写历史任务状态或范围外UI。

启动时的“导入数据缺少必要来源契约，已阻止覆盖正式行情”也是发布前已有的静态bridge保护提示。守卫继续阻止旧载体覆盖正式行情；真实接收后及刷新后hash未受其影响。保留该已知提示，不为了消除提示放宽guard。

本次通过只证明此Codex内置浏览器实例。PC数据文件仍426根截至10-02；手机Safari、其他浏览器的本地存储独立，未自动覆盖。其他设备安全接收方式：先导出本机备份，刷新到新资源版本，以原授权账户进入2899技术页，由既有current读取接收；不需要再次审批/Apply，也不要为了接收而点击“更新行情”。真实本地冲突或保存失败应停止，不清空存储。PC文件不是浏览器存储，其接收需要单独验证，不能由本次结果推定完成。

## 8. 证据与最终结论

私有证据位于 `.rebase/post-apply-sync-production-release-v1/`：workflow/online manifest/97资源校验、全量测试日志、浏览器前后及刷新后备份、received/refreshed验证、reload-diff、actual-discussion、production-viewports、三视口截图、remote-final-verification、data-protection-final、30文件前后摘要。

这些备份和真实业务内容未入git、未发布到Pages。本轮报告单独保存在本地，不再次触发Pages发布。生产仍精确停留在批准的 `4b7585c41ccf67874f0882ea311c4ad08f00d6e9`。

**PILOT_APPLY_ACCEPTANCE_PASSED**：生产发布、此真实浏览器安全接收、430根/技术版本/Freshness/Discussion一致性、刷新持久化、其他标的及业务保护、previous/rollback pointer及无重复迁移均已验证。无剩余阻塞；历史提示和其他设备尚未接收的边界如上。
