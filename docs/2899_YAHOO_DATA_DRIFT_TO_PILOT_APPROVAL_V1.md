# 2899_YAHOO_DATA_DRIFT_TO_PILOT_APPROVAL_V1

最终状态：**PILOT_READY_FOR_REAPPROVAL**。审计日期：2026-10-09（Asia/Shanghai）。

仅冻结 2899.HK / 紫金矿业 / Yahoo 的新审批包。未执行真实 stage、approve、apply、rollback；未修改生产数据库、Auth、正式行情或产品代码。无需新增生产部署。旧审批没有转移到新包。

## 1. 生产、当前版本和冻结对象

- Production main / Pages commit: `bd52d7fec804434a529ba2f0102f05bb0d17f280`

- RPC: `approved-provider-migration-v1`

- Guard implementation SHA-256: `2b95be757867fe4b45e193d68368a68a46448a2314c0b02bdddf35ffed062ab3`

- Serialization: `MARKET_DATA_CANONICAL_SERIALIZATION_V1`

- 生产 Canonical migration ledger: `20261009012203 / market_data_canonical_serialization_v1`

- Release: `market-data-canonical-hash-v1-20261008`

- Canonical Base Hash: `8b160e2c790c884fa69db04ea2cba51e7676372c63fa8c49b3f4b26411db4f7d`

- Expected current version / legacy base hash: `041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70`

- Candidate ID: `rebase_353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66`

- Candidate Hash: `353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66`

- Content Hash: `bf1f15679e686cae3f908bcada59ce073a2317a24c969bf06a3f855db66556bb`

- Approval Package Hash: `7a1b42288c4ccf0e4bc8beb6009122bd58a3da6578726ce105bcf2f2274faf96`

生产 Supabase：investment-workbench / fntslvdxnupmdljnadec。main、Pages manifest 和 97 个实际发布资源核验一致。Manifest sourceCommit 为构建源码提交 9a4bb89，deploymentCommit 为 bd52d7f；二者用途不同。生产函数定义及 grants 的只读快照与部署后记录一致，普通任务/写入 RPC 未修改。

正式基线仍是 426 根 mixed-provider 日 K，2025-01-09 至 2026-10-02。PC、Bridge、Pages 正式事实的 canonical hash 一致；484 处整数/浮点文本表示差异没有实际数值变化。未用 canonical 一致替代 expected-current/source-contract 校验。

## 2. A / B / C 完整日期对齐

A = 当前正式历史；B = 原冻结 Yahoo 427 根；C = 本次固定原始响应重建 Yahoo 430 根。

| 对比 | old→new | 共同日期 | 新增日期 | 价格变化日期数 | 成交量变化日期数 | 来源元数据变化日期数 |
|---|---:|---:|---|---:|---:|---:|
| A_to_B | 426→427 | 426 | 2026-10-05 | 413 | 1 | 52 |
| B_to_C | 427→430 | 427 | 2026-10-06, 2026-10-07, 2026-10-08 | 138 | 1 | 0 |
| A_to_C | 426→430 | 426 | 2026-10-05, 2026-10-06, 2026-10-07, 2026-10-08 | 413 | 1 | 52 |

三组 oldOnlyDates 均为空。A→C 的 52 处 provider 元数据变化为原 mixed-source 历史转换到 Yahoo 的预期结果；B→C 来源契约没有实质变化。Amount 保持 unavailable；Complete、provider、adjustment、priceBasis 未发生 B→C 漂移。完整逐日字段值、delta、ratio、日期数组存于包内 complete-differences.json。

B→C 分类：新增 2026-10-06、07、08 为 NEW_COMPLETE_TRADING_DAY；138 日价格变化为 SAME_PROVIDER_PRICE_REVISION；10-05 成交量为 SAME_PROVIDER_VOLUME_REVISION；整体为 MULTI_FIELD_REVISION。不是 SOURCE_CONTRACT_CHANGE，也未把正常新增交易日计为质量异常。

B→C 价格变化范围：2025-01-23 至 2026-06-03；全部变化（含成交量）最晚至 2026-10-05。此前任务的 131 日来自另一抓取响应，本次使用固定响应的 138 日，不混用统计。

### 价格变化的证据与边界

原始 unadjusted quote OHLC 完全未变；上游 adjclose 在 138 日发生变化。对 430 根逐条重放当前生产 parser：`round(quote OHLC * (adjclose / quote.close), 6)`，与 Candidate 全部一致。因此差异源于本次上游数据，而非 parser、canonical serialization 或本地混入。逐日比例见 parser-replay.json / complete-differences.json，未发现可将本次差异统解释为新固定股息比例的依据。

138 组原始 adjclose 的新旧值均恰为 float32 可表示值：-1 个 float32 步长 50 日、+1 步长 83 日、+2 步长 5 日。这只是可复核的数值模式，不证明 Yahoo 内部为何重新生成，也不是放行容差；所有六位归一化后的真实差异被保留并参与新 hash。

[紫金矿业 2026-07-22 官方股息公告](https://www.zijinmining.com/upload/file/2026/07/22/f1c55d0bc3694ba292f77119610ce771.pdf)确认 7 月 23 日除息、HKD 0.4839736/股。历史比例 `1 - 0.4839736 / 33.42 = 0.985518451...` 仅支持原有历史调整证据，不自动解释本次 138 日微小变动。Yahoo action 响应返回股息而未返回 split；它不等于穷尽所有公司行动的官方证明。其 0.483974 是响应舍入值，不替换公告精度。

### 全部成交量差异

| 对比/日期 | Old shares | New shares | Delta | 相对旧值 | HKEX |
|---|---:|---:|---:|---:|---:|
| A→B / A→C 2026-10-02 | 26,155,630 | 26,147,630 | -8,000 | -0.030586149% | 26,147,630 |
| B→C 2026-10-05 | 23,264,863 | 23,244,863 | -20,000 | -0.085966550% | 23,244,863 |

旧 B 抓取时间：`2026-10-05T13:17:49.725840+00:00`；本次 C：`2026-10-09T02:57:18.995588+00:00`（北京时间 2026-10-09 10:57:18）。正式 A 的逐行原始抓取信息保留于 A-formal-facts.json，不伪造统一时间。

新 Historical K 与官方成交量严格整数相等，单位证据为 EMPIRICALLY_VALIDATED（scale=1 shares）；不声称获得 Yahoo 官方单位合同。

| 日期 | Yahoo Historical K = HKEX shares | 官方日行情 |
|---|---:|---|
| 2026-10-02 | 26,147,630 | [HKEX](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261002e.htm) |
| 2026-10-05 | 23,244,863 | [HKEX](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261005e.htm) |
| 2026-10-06 | 17,404,982 | [HKEX](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261006e.htm) |
| 2026-10-07 | 11,748,096 | [HKEX](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261007e.htm) |
| 2026-10-08 | 41,040,919 | [HKEX](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261008e.htm) |

10 月 5 日官方行首星号仅按 `leadingAsterisk` 原样记录，未以未经验证的标记语义宣称官方修订。10 月 2 日旧 Meta 的 26,155,630 单独保留；当前 Meta 是 10 月 9 日盘中会话，最新完整 Historical K 是 10 月 8 日，两者不能直接同日比较。候选始终取 quote.volume，未使用 regularMarketVolume。

## 3. 完整日、来源及质量门禁

候选 retained history：**2025-01-09 至 2026-10-08，430 根完整日 K**。按抓取时刻与原 complete-bar 逻辑，未纳入 10 月 9 日盘中 K。日期唯一、有序、无缺日及异常交易日；半日市保留。

- [2025 HKEX 证券市场假期通告](https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2024/ce_SEHK_CT_063_2024.pdf)：已归档原 PDF 与 SHA-256。

- [2026 HKEX 证券市场假期通告](https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf)：已归档原 PDF 与 SHA-256。

Source contract：`2899.HK / Yahoo / daily / qfq / adjusted / HKD / HKD/share / volume=shares / amount=unavailable`。Endpoint/parser/adjustment 实现未改，provider source version `provider-source-sha256:e7c77309d615a69a2c8295fdd56483d1a82404b2b5928519fb836601ab26afea`。HKEX 多日未复权 high/low/close 与 Yahoo 原始 float32 编码逐项一致，volume 严格相等；这验证单位与原始价格，不把交易所未复权价直接当 adjusted 历史价。证据样本已刷新，但来源契约语义未改变。

Blockers = **0**；unsafeWritePathCount = **0**；无写入 guard 缺失。判断依据为已存在的 source/revision/evidence 门禁及完整上游重放，不新增 2899 特例或任意百分比容差。

## 4. 技术预览、Freshness 与 Discussion

“旧”是用当前正式 bars 重算的比较事实，不声称旧持久化技术字段都已保存这些数值。所有新技术事实基于同一 430 根候选。

| 字段 | 旧正式 bars 重算 | 新 Candidate |
|---|---:|---:|
| technicalAsOf | 2026-10-02 | 2026-10-08 |
| latestCompleteBar | 2026-10-02 | 2026-10-08 |
| price | 31.700001 | 31.280001 |
| ma5 | 32.004001 | 32.016001 |
| ma10 | 32.870001 | 32.112001 |
| ma20 | 34.207 | 33.272 |
| ma60 | 34.227576 | 34.373184 |
| ma120 | 33.828169 | 33.430752 |
| supportPrice | 28.9545 | 28.9545 |
| resistancePrice | 38.56 | 38.56 |
| volume | 26155630 | 41040919 |
| volumeAvg20 | 37093219.4 | 34041987.05 |
| volumeChangePct | -7.54 | -29.88 |
| MACD dif | -0.977766 | -0.940635 |
| MACD dea | -0.65645 | -0.812818 |
| MACD histogram | -0.642632 | -0.255634 |

Crossovers 已重算：旧 103 条、新 101 条；完整日期、indicator、before/after 在 candidate.json 的 technicalDiffSummary.crossovers。Price/MA relationship 与 MACD 风险事实：price_below_ma20、ma5_below_ma20、macd_below_signal。

VolumeChangePct 是最近 5 日均量相对之前 5 日均量变化，不是当日环比或相对 MA20。support/resistance 沿用现有 60 日收盘最小/最大值。MA/量/日期等独立复算 12 项通过。Price action、volume spike、量价分类器和 amount facts 未实现，明确 unavailable，不补造信号。

SQL 校验候选 technical/content binding 一致，technicalAsOf = latestCompleteBar = 2026-10-08；Freshness 输入来自同一候选快照。候选状态仍是 candidate_only，不能宣称正式页面已经 current。AI judgment 的迁移目标状态为 needs_review；未调用 AI、未改现有 AI 记录或 Discussion 正文。正式 Discussion readiness 仍由旧正式快照决定，真实切换后须再验收。

## 5. 隔离迁移安全与全量回归

| 检查 | 结果 |
|---|---|
| Python 全量 | 119/119 PASS |
| JS/SQL 全量 | 1333/1333 PASS，0 skip |
| Production Release Gate | 207/207 PASS，含 Entry Clarity 31 |
| Canonical golden fixtures | 34 fixture cases 纳入全量；跨 Python/JS/SQL |
| 隔离 migration acceptance | 29/29 PASS |
| 本次精确 2899 capsule SQL 验证 | PASS，仅 validate，无 stage/apply |
| 真实新包本地浏览器审阅 | 360 / 390 / 1280，3/3 PASS |
| Entry Clarity 三视口八场景 | 24/24 PASS |
| 线上发布资源 | 97/97 SHA-256 PASS |
| 实际 PC 安装 guard 独立导入验证 | mixed 拒绝、同源稳定继续、realDataWrites=0 |
| 受保护文件前后对照 | 30/30 未变化 |

本次 Apply/Rollback 在本地独立 PGlite PostgreSQL 引擎执行与生产相同 migration SQL，使用合成 9999.HK、随机隔离身份、事务回滚；不是声称本次在 Supabase 上新做远端写入验收。完整 SQL 测试另覆盖 9998.HK 隔离。真实 2899 只做候选验证及 UI 读取。生产仅 SELECT 目录/计数/定义。

以下验证全部通过：未审批拒绝；三个错误 hash 拒绝；来源契约不匹配拒绝；current version 冲突拒绝；普通 mixed-history 增量拒绝；专用批准迁移成功；重复 Apply 幂等；原子切换；在 pointer 写入后注入异常仍无部分提交；完整 rollback；previous version 不可变；其他 symbol 不变。另包含 anon/outsider、RLS/grants、伪造客户端 approval、旧 release/guard、active-task conflict、capability 撤销和已消费审批不可重放。未降低断言。

浏览器测试是隔离 Chromium 手机视口审阅，没有连接真实账户，也不声称是真机 Safari 生产 Apply 验收。原始日志、截图、确切 SQL 校验回执均在包内。

## 6. 数据保护、审批与回滚

本次旧正式 2899、其他 22 个标的、market_universe/Bridge/PC 导出、旧 Candidate/approval/migration stores 及受保护业务事实载体前后 SHA-256 完全一致。没有访问用户手机私有 localStorage；没有将未读取的手机状态表述为已逐项核验。没有创建任何远端行情任务、持仓/Plan/订单/Discussion 写入或 AI 调用。

生产只读快照：migration records=0、heads=0、versions=0、events=0、active tasks=0。新本地候选库 objects=2、events=5、approvals=0、active=0；仅保存 request/candidate 和审计状态。旧 approval 的审计及既有 superseded 状态保留，本次不删除、不复用、不新增真实 approval。

Rollback capability 已在隔离 SQL 中证明可恢复完整旧事实及 current pointer，immutable previous 和审计保留。因为本次没有真实 Apply，所以当前没有新的生产 rollback pointer；不能把机制通过说成生产 pointer 已生成。未来获批 Apply 前必须重新校验正式版本/冲突/guard/hash 并原子保存旧版本。

## 7. 新旧 hash 与需批准的对象

| Hash | 旧冻结包 | 新冻结包 |
|---|---|---|
| candidateHash | `1d8be707eb856d8894f850b0b31591c7acf56167aab11bccc0972e69dc8862c6` | `353933530d7f8dbec308c75c3dd9afbce254cce30a7762b50c7bc21d9d4bab66` |
| contentHash | `3504c6fe5941eb5df494bc3c04580a1202125c0f82c43794138b475e8ae3cc12` | `bf1f15679e686cae3f908bcada59ce073a2317a24c969bf06a3f855db66556bb` |
| approvalPackageHash | `5d4bc0e9de8c17837dcd95e86446e8ccd19165c9c7e7830146fc7690741715e7` | `7a1b42288c4ccf0e4bc8beb6009122bd58a3da6578726ce105bcf2f2274faf96` |

三个 hash 均改变。这次不仅是 release binding 变化：bars 新增三日、历史价格及 10-05 成交量修订，技术预览与证据更新；内容 hash 确实变化。旧审批对本包无效。

用户现在需要批准的精确对象：本报告第 1 节 Candidate ID 与三个 hash，2899.HK / Yahoo，430 根、2025-01-09 至 2026-10-08；绑定生产 bd52d7f、上述 RPC/guard 与 expected current version。当前状态 pending_user_review。任何审批相关事实或 hash 变化均须重新冻结并重新批准；不会自动跟进未来 Yahoo 响应。

已知限制：Yahoo 未解释内部 adjclose 重生成原因；本报告只证明上游字段差异、编码模式和重放一致。未实现的指标维持 unavailable；volume/price unit 为实证等级；amount unavailable。未来供应商响应可能继续修订，本包只绑定本次固定原始响应。

## 8. 可复核交付

审计根目录：`.rebase/drift-to-approval-v1/`。冻结对象：`refrozen-2899/`（candidate/request/evidence/remote-capsule/schema-validation/pilot.sqlite/review/freeze-summary）。完整归档：`2899-Yahoo-reapproval-20261009.zip`；压缩包 SHA-256 在同名 `.sha256` 文件。包内 checksums.json 逐个校验材料，包括原 Yahoo 响应、A/B 快照、HKEX HTML、官方 PDF、全部差异、技术与安全日志、三视口截图、生产只读回执。ZIP 本身的 hash 不等于语义 approvalPackageHash。

产品代码变更：无。生产部署：无。仅提交本报告；本地文档提交 hash 由最终答复及包内 doc-commit.txt 给出（避免报告自身 hash 的循环引用），不 push，不修改当前生产 release binding。

完整价格变化日期（B→C，138 日）：

2025-01-23, 2025-01-28, 2025-02-03, 2025-02-05, 2025-02-10, 2025-02-11, 2025-02-12, 2025-02-13, 2025-02-14, 2025-02-18, 2025-02-20, 2025-02-21, 2025-02-24, 2025-02-25, 2025-02-26, 2025-02-28, 2025-03-03, 2025-03-04, 2025-03-05, 2025-03-10, 2025-03-13, 2025-03-14, 2025-03-17, 2025-03-20, 2025-03-24, 2025-03-25, 2025-03-28, 2025-04-03, 2025-04-08, 2025-04-11, 2025-04-14, 2025-04-15, 2025-04-16, 2025-04-17, 2025-04-22, 2025-04-24, 2025-04-29, 2025-05-02, 2025-05-08, 2025-05-12, 2025-05-13, 2025-05-20, 2025-05-30, 2025-06-03, 2025-06-05, 2025-06-06, 2025-06-09, 2025-06-11, 2025-06-19, 2025-06-20, 2025-06-25, 2025-06-26, 2025-06-30, 2025-07-02, 2025-07-03, 2025-07-04, 2025-07-07, 2025-07-08, 2025-07-14, 2025-07-17, 2025-07-21, 2025-07-29, 2025-07-30, 2025-08-01, 2025-08-04, 2025-08-08, 2025-08-12, 2025-08-14, 2025-08-20, 2025-08-21, 2025-08-22, 2025-08-26, 2025-08-28, 2025-09-01, 2025-09-04, 2025-09-08, 2025-09-10, 2025-09-12, 2025-09-19, 2025-09-24, 2025-09-30, 2025-10-09, 2025-10-13, 2025-10-15, 2025-10-16, 2025-10-17, 2025-10-20, 2025-10-21, 2025-10-27, 2025-10-28, 2025-11-06, 2025-11-07, 2025-11-18, 2025-11-20, 2025-11-25, 2025-11-26, 2025-11-27, 2025-11-28, 2025-12-04, 2025-12-11, 2025-12-15, 2025-12-18, 2025-12-22, 2025-12-31, 2026-01-02, 2026-01-08, 2026-01-12, 2026-01-13, 2026-01-28, 2026-02-02, 2026-02-06, 2026-02-09, 2026-02-11, 2026-02-24, 2026-02-26, 2026-03-03, 2026-03-04, 2026-03-05, 2026-03-16, 2026-03-17, 2026-03-26, 2026-04-01, 2026-04-02, 2026-04-09, 2026-04-13, 2026-04-29, 2026-05-04, 2026-05-06, 2026-05-11, 2026-05-12, 2026-05-13, 2026-05-14, 2026-05-19, 2026-05-21, 2026-05-22, 2026-05-26, 2026-06-01, 2026-06-03。

**PILOT_READY_FOR_REAPPROVAL**。至此停止；未代表用户批准，未执行真实 2899 Apply。
