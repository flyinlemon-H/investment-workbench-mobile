# 2899_YAHOO_HISTORICAL_REVISION_AUDIT_V1

审计日期：2026-10-04。只读审计；既有 Pilot 保持 **APPLY_BLOCKED**。

## 1. Executive Summary

**Primary classification：B / CORPORATE_ACTION_READJUSTMENT。** 高可信的归因是 2026-07-23 现金分红产生新的向前历史调整因子。361 根价格约乘以 0.98551845，和每股 HKD 0.4839736、除息前收盘价 HKD 33.42 所解释的因子一致。不是仅凭分红日期接近作出结论。

必须纠正分母：**361 / 374 个 old Yahoo common bars 变化，13 / 374 不变**。426 是完整 Yahoo 候选条数；另外 52 个日期在正式旧历史中是 Eastmoney，未混入 Yahoo-to-Yahoo 主分析。

361 根全部保留着除息前的同一次抓取时间：`2026-07-12T16:28:57.414338+00:00`（北京时间 7 月 13 日 00:28:57）。13 根不变 bars 是除息后陆续抓取的。旧增量更新只覆盖最近 7 个自然日，造成较早历史没有被刷新到新的复权状态。

旧、新 parser 用同一份当前 raw response 离线回放，426 根 OHLC、volume、amount 结果全部相同，未发现产生 1.448% 差异的 parser / adjustment 算法变更。旧 raw HTTP 响应未找到，因此不能宣称已经直接完成旧新 upstream raw payload 的对照证明。

候选价格判断：**A / likely valid**，不是批准；候选 validation 仍为 invalid，现有 blocker 不变。旧 Yahoo 历史判断：**B / stale due to historical revision**；361 根在原抓取时的复权状态下 likely valid，目前与后续 bars 不在同一调整状态。

## 2. Dataset Definition

| 集合 | 内容 | 用途 |
| --- | --- | --- |
| A | 当前正式 bridge 中 `provider == yahoo` 的 374 根 | 唯一 old Yahoo 主样本 |
| B | 已冻结 2899.HK Yahoo candidate 的 426 根 | 不重建、不替换、不修改 |
| C | 本次一次只读 Yahoo chart 请求得到的 426 根 quote/adjclose 及 dividends | 临时 raw 审计与 parser replay |
| D | PC market-update 备份中抽取的 Yahoo bars | 补充除息前后相同日期的观察证据；不改变 A 的分母 |

A 来源：`E:/users/kaka/onedrive/文档/investment-workbench-mobile/data/market_data_bridge.js`。

B 来源：本 worktree `.rebase/pilot-2899.sqlite`，用 SQLite `mode=ro` 查询对象；未调用 Store 的 approve/apply/rollback/save。C 保存为 `.rebase/revision-yahoo-raw.json`，请求及 SHA 在 `.rebase/revision-yahoo-request.json`；没有写入 candidate storage。

本次没有请求 Eastmoney，没有抓取其他 22 个标的，没有查询生产数据库或创建任务。

## 3. Exact Counts

| 指标 | 数值 |
| --- | ---: |
| oldYahooCount | 374 |
| candidateCount | 426 |
| commonDateCount（A ∩ B） | 374 |
| changedPriceCount（任一 OHLC 变化） | 361 |
| unchangedPriceCount（四个 OHLC 全相同） | 13 |
| oldOnlyDateCount（A − B） | 0 |
| candidateOnlyDateCount（B − A） | 52 |

这里 52 不是新增交易日：它们已经存在于完整正式历史，但旧 provider 为 Eastmoney。若拿完整 mixed history 与 B 比日期，才是 common=426 / oldOnly=0 / candidateOnly=0；两种统计不能混写。

## 4. Field Differences

相对差异定义 `abs(new-old)/abs(old)`；下表 median 在全部 374 个有效 common 样本上计算，含 13 个零差异。volume 比较的是同一字段的原始数值编码，不据此宣称单位校准完成。

| 字段 | exact | different | 最大绝对差异 | 最大相对差异 | 相对差异中位数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| open | 13 | 361 | 0.664071 | 1.4481785142% | 1.4481547939% |
| high | 13 | 361 | 0.670928 | 1.4481806598% | 1.4481542283% |
| low | 13 | 361 | 0.636653 | 1.4481766825% | 1.4481545638% |
| close | 13 | 361 | 0.658932 | 1.4481747326% | 1.4481546408% |
| volume | 373 | 1 | 8000 原始单位 | 0.0305861491% | 0% |
| amount | 0 | 0 | N/A | N/A | N/A |

amount 双方均缺失 374 根，状态 NOT_COMPARABLE，不能称为 374 个数值 exact。

前置报告的“约 1.448%”对应其 OHLC 最大相对差异的四舍五入，同时也接近变化组的共同缩放幅度；不是对全部 426 根计算的平均收益或平均误差。只看变化的 361 根，close ratio 中位数为 **0.9855184510399304**，即新价格低 **1.44815489600696%**。

## 5. OHLC Ratio Analysis

对每个 common date 计算 new/old，OHLC 旧值均非零，无除零样本。

| ratio（变化的 361 根） | min | median | max |
| --- | ---: | ---: | ---: |
| open | 0.985518214858 | 0.985518450535 | 0.985518625162 |
| high | 0.985518193402 | 0.985518455730 | 0.985518662353 |
| low | 0.985518233175 | 0.985518453316 | 0.985518676237 |
| close | 0.985518252674 | 0.985518451040 | 0.985518630456 |

同日四个 ratio 的最大 spread 为 `1.1764948682e-7`。数据支持 OHLC 共用同一调整因子模型，没有观察到方向随机、OHLC 各自独立变化的主要模式。ratio 并非逐位完全相等；原始浮点表示与六位小数舍入足以要求保留残差分析，不将它们强制归零。

没有自创“接近”的迁移通过阈值，也没有用聚类阈值自动批准。所有原始 ratio 均保存在 `.rebase/revision-ratios.csv`。

## 6. Ratio Regimes

按实际 exact/non-exact 样本分组，不用任意比例容差：

| A/B 观测组 | startDate | endDate | barCount | close ratio |
| --- | --- | --- | ---: | --- |
| 除息前抓取、尚未刷新 | 2025-01-09 | 2026-07-02 | 361 | 中位数 0.985518451040 |
| 除息后抓取 | 2026-07-17 | 2026-10-02 | 13 | 全部恰好 1 |

第一组覆盖该段全部正式日期；第二组是离散 13 根，不能画成 7 月 17 日起每日都有 Yahoo 旧样本的连续区间。其日期为：7/17、7/24、7/31、8/21、8/26、8/28、9/23、9/24、9/25、9/28、9/29、9/30、10/2。

![Ratio audit](C:/Users/kakal/.codex/worktrees/auth-password-recovery-v1/investment-workbench-mobile/.rebase/revision-ratio-audit.png)

## 7. Boundary Dates

**不能把 2026-07-02 → 2026-07-17 的 A/B 样本变化边界当成公司行动日期。** 7/3 至 7/16 当前旧 bars 来自 Eastmoney，缺少 old Yahoo 主样本；而 7/17 这根旧 Yahoo 是 7/27 才抓取，已经经历 7/23 除息。

真实公司行动边界是 **2026-07-23**。当前 C 的 `AdjClose / quoteClose` 在 7/22 为 0.985518417615，在 7/23 为 1。

备份中的 Yahoo-only 证据进一步消除日期歧义：

| bar 日期 | 抓取时间（UTC） | Yahoo adjusted close | 备份 |
| --- | --- | ---: | --- |
| 2026-07-17 | 2026-07-22 08:30:08 | 29.379999 | `latest_export_before_market_update_20260723_163006.json` |
| 2026-07-17 | 2026-07-27 08:30:08 | 28.954531 | `latest_export_before_market_update_20260728_163005.json` |
| 2026-07-22 | 2026-07-22 08:30:08 | 33.419998 | 同上前一份 |
| 2026-07-22 | 2026-07-27 08:30:08 | 32.936024 | 同上后一份 |
| 2026-07-23 | 2026-07-27 08:30:08 | 33.520000 | 同上后一份 |

7 月 13 日首次更新前的备份保留 367 根纯 Yahoo；当前 361 根变化样本是其中未被后续近端 merge 替换的较早部分。日志确认 7/13 更新使用 Eastmoney，7/22 与 7/27 使用 Yahoo。备份证据已单独保存 `.rebase/revision-archive-evidence.json`，不混进 A 的统计。

## 8. Corporate Actions

公司官方 2026-07-22 公告列明：每 10 股派 HKD 4.839736，除息日 2026-07-23，派付日 2026-08-21。[紫金矿业官方现金股息公告](https://www.zijinmining.com/upload/file/2026/07/22/f1c55d0bc3694ba292f77119610ce771.pdf)

本次 Yahoo C 返回 dividend `amount=0.483974`、date 对应 7/23；7/22 quote close 为 `33.41999816894531`。因此：

```text
按公告金额及展示收盘价：1 - 0.4839736 / 33.42 = 0.9855184440454817
按 Yahoo event 及 raw 浮点：1 - 0.483974 / 33.41999816894531 = 0.9855184312831674
实际 A/B 变化组 close ratio 中位数：0.9855184510399304
中位数与 Yahoo event 模型差：1.9756763e-8
该组 close ratio 对模型的最大残差：1.9917329e-7
```

事件、时间先后、比例幅度、同日 OHLC 比例、备份 before/after、parser replay 构成相互支持的证据。残差仅作事实报告，不是接受阈值。

当前 C 在窗口内还返回 2025-05-21、2025-09-10、2026-06-09 的 dividends；未返回 split 或 capitalGains 事件。不能由此证明 Yahoo 事件覆盖全市场所有类型行动，只能说明本次响应内容。

## 9. Old Yahoo Pipeline

证据代码：PC `src/market_data/provider.py:89`，git `040136d05ef9f64ba422c8c2452c3cb07d2764c8`。

1. endpoint：`https://query1.finance.yahoo.com/v8/finance/chart/2899.HK`。
2. params：interval=1d、period1/period2、events=history；requests 直接请求，不使用 yfinance。
3. 从 `timestamp`、`indicators.quote[0]` 读 OHLCV，从 `indicators.adjclose[0].adjclose` 读调整收盘价。
4. `factor = adjclose / quote.close`；将 quote 的 open/high/low/close 全乘 factor，round(..., 6)。缺 adjclose 时历史代码回退 factor=1，但仍打 qfq 标签；这是潜在缺失数据风险，不是已证实的此次根因。
5. volume 直接 `_number(rawVolume)`，不乘价格复权因子、不做 lot/share 转换；amount=None。
6. metadata 写 provider=yahoo、adjustment=qfq、price_basis=adjusted、fetched_at、is_complete_bar；未保存 raw OHLC、adjclose 或逐日 factor。
7. updater 以日期 merge，普通增量从 latest−7 天开始；无历史时默认 550 天。更新窗口之外的旧 qfq bars 被保留。

首次抓取时间比首次代码提交早约 11 小时，未找到该次进程的二进制/脚本 hash 或原 HTTP payload，因此运行时来源不能完全证明；同期代码、历史字段格式、后续备份及 replay 对该还原提供强支持。

## 10. New Yahoo Candidate Pipeline

证据代码：本 worktree `scripts/provider_rebase/fetch.py` 与 `core.py`，未修改。

| 项目 | 旧 PC | 新 Candidate |
| --- | --- | --- |
| Yahoo endpoint、quote/adjclose 来源 | 相同 | 相同 |
| OHLC 公式、6 位舍入 | AdjClose/Close × OHLC | 相同 |
| volume / amount | 原值 / None | 原值 / None |
| 时区 | Asia/Shanghai | HK 用 Asia/Hong_Kong；本数据日期两者均 UTC+8 |
| 请求窗口 | 首次 550 天，之后 latest−7 天 | 整个已保留区间 2025-01-09 至 2026-10-04 |
| 缺 adjclose | factor=1，仍 qfq | 记录 missingAdjustmentFactors，阻止 ready |
| 完整 bar | 标记后合并时处理 | candidate 前过滤不完整 bar |
| 安全与证据 | 普通超时及 HTTP 检查 | 有界响应、固定主机、response hash、实现 hash |
| provenance | provider | 增加 rawProviderId/canonicalProviderId/sourceContract |

请求/校验/存储行为有变化，但有效样本上的复权公式未改变。仓库的 `qfq` 是此实现标签，并不能证明 Yahoo 的乘法分红调整与其他 provider 所谓“前复权”在数学上完全等价。

Yahoo 页面说明普通 Close 已含拆股调整，Adjusted Close 另含股息/资本分配调整，因此本文的 raw/quoteClose 指返回字段，**不保证是完全未复权价格**。[Yahoo 2899.HK 历史页](https://hk.finance.yahoo.com/quote/2899.HK/history/)

## 11. Git History

- PC provider.py 全部可见 git history 仅有 `040136d05ef9f64ba422c8c2452c3cb07d2764c8`（2026-07-13，首次纳入日 K 自动化）。当前文件与该提交逐行相同。
- 检索 yahoo/yfinance/adjustment/qfq/dividend/market data；`8c713bbc83587bbbecdcc8f51418a6cbcfda8d31`（2026-08-14，selected refresh）没有修改上述 provider/adjustment 文件，不能作为算法变更证据。
- Mobile 行情桥最后一次可见数据提交为 `27731979dc4b63b57d7a6ed262478261140484a4`（2026-10-02）；此前为 daily market update 提交。它们是 normalized 数据交付，不是 Yahoo raw 存档。
- 新 Rebase 工具仍是前置任务隔离 worktree 中的未提交实现；本轮不修改它。
- 这条 Yahoo 路径未使用 yfinance，old/current yfinance version 为 **N/A**。requests 是 HTTP transport；未发现可归因的金融库版本升级。最初运行时精确 requests 版本没有保存，为 UNKNOWN。

## 12. Adjustment Factors

C 可直接观测 `factorNew=adjclose/quoteClose`。按实际 dividend 日期划分，而非人为聚类：

| 当前 factor 区间 | bars | factor 中位数 |
| --- | ---: | ---: |
| 2025-01-09—2025-05-20 | 86 | 0.947061946151 |
| 2025-05-21—2025-09-09 | 79 | 0.963762957301 |
| 2025-09-10—2026-06-08 | 180 | 0.971880614926 |
| 2026-06-09—2026-07-22 | 30 | 0.985518455682 |
| 2026-07-23—2026-10-02 | 51 | 1.000000000000 |

这些是 **当前 AdjClose/Close 的五段**；不要与 A/B 价格比值的两组混淆。

真正 factorOld 需要原时点 quoteClose/raw evidence，未保存，保持 UNKNOWN。可在假设 quoteClose 未改变时推算 `oldAdjustedClose / currentQuoteClose`，但这不是实测旧因子。完整 `.rebase/revision-factors.json` 明确将 factorOld 置 null，并单独标记 conditional inference。

在同一份 C 上回放 git 旧 parser 和现行新 parser：426 根各字段数值完全一致。C 与冻结 B 相比，OHLC 有 135—137 个字段样本差异，最大仅 0.000004；volume 全部相同。这说明不能称为当前 raw 精确重现 B 每一位小数；C/B 微小漂移与 1.448% 主要差异不同，可能涉及上游浮点/重算或请求行为，缺 B 原 raw 响应时不能进一步定位。没有据此修改 B。

## 13. Volume / Amount

同源 A/B volume 373 根数值相同；唯一差异在 2026-10-02：26,155,630 → 26,147,630，减少 8000（−0.0305861491%），旧 fetchedAt 为当日 08:30:22 UTC。不是对 361 根统一乘分红因子，不能将 volume 变化归为此次分红价格调整。

旧、新代码都不主动调整 volume。该差异是独立的同源数量修订线索，具体原因 UNKNOWN；没有旧 raw，所以不直接断言 upstream 错误或旧 parser 错误。

Yahoo amount 始终 None，没有成交额变化可测。未用 close×volume 伪造成交额。

## 14. HK Units

| 字段 | Yahoo | Eastmoney（已有证据，无新请求） |
| --- | --- | --- |
| 价格币种 | C meta.currency=HKD，历史页标 HKD | 官方港股页标港元 |
| 价格单位 | 报价每股港元，parser scale=1；调整后价格仍为该计价单位 | 页面为每股港元；kline parser 直接取 OHLC，无单位乘除 |
| volume | parser 原样保存；shares 语义有强交叉证据，但 chart 响应没有显式 unit/lot 字段 | 官方港股页标成交量（股）；kline f56→volume 原样保存 |
| amount | 不提供 / None | 官方页面标成交额（港元）；kline f57→amount 原样保存 |
| lot/share 与 scale | 未发现本程序转换；没有证据支持自行乘 100/1000 | 同左；不能把 A 股常见“手”单位套到 HK |

独立单位旁证（不计入 A/B 主比较）：现有 52 根 Eastmoney volume 与 B 同日期 Yahoo volume **52/52 完全相同**；52 根的 `amount / volume` 全部落在对应 C quote low/high 之间。结合东方财富官方页面“股 / 港元”标签，强支持此 HK 数据使用 shares 与 HKD turnover、scale=1，而不是 board lots。但页面展示标签不是特定历史 K 线 API 的完整字段契约，尚不能把所有市场/provider 的自动 normalization 标记已校准。[东方财富官方港股页](https://hk.eastmoney.com/)

本轮只报告单位证据强度，不修改 candidate 中 confirmed 标志，不解除旧 unit blocker。

## 15. Candidate Assessment

**A / likely valid（价格复权实现与历史覆盖层面）。** 候选调整比例得到公司事件和金额支持；旧新公式一致；当前 raw 离线 replay 的主要数值一致，仅存在 ≤0.000004 的 C/B 微小漂移。

这不等于 ready/approved：原 candidate.validationStatus=invalid、units/writer deployment/calendar/review blockers 不变。其 426 根结果没有替换、重新生成或改 hash。

## 16. Old History Assessment

主判断 **B / stale due to historical revision**。补充判断：361 根在旧抓取时的 adjustment state 下 likely valid，没有发现其曾经采用错误公式的证据。

真正的问题是同一 provider/adjustment 标签下面可隐藏不同 observation time 的调整状态。现有历史既混 provider，也混 adjustment vintage；前者不能通过修 metadata 解决，后者不能通过只拉新日期解决。

## 17. Technical Indicator Impact

调用现有 PC `calculate_indicators` 只在内存计算 MA5/10/20/60、MACD；MA120 与最近 60 根 close 极值按前置候选规则作补充。不调用 AI，不写 snapshot。完整数据在 `.rebase/revision-replay.json`。

第一组严格可比连续窗口：361 根 old Yahoo vs B 同日期，结束于 2026-07-02。

| 指标 | old | new |
| --- | ---: | ---: |
| MA5 | 27.752000 | 27.350108 |
| MA10 | 29.456000 | 29.029432 |
| MA20 | 30.628612 | 30.185063 |
| MA60 | 33.896157 | 33.405288 |
| MA120 | 36.643866 | 36.113206 |
| MACD DIF | -1.582199 | -1.559286 |
| DEA | -1.305353 | -1.286450 |
| histogram | -0.553691 | -0.545673 |
| support60(close min) | 27.4000 | 27.0032 |
| resistance60(close max) | 38.2828 | 37.7284 |

整个连续窗口近似统一正比例缩放，MA/MACD 也相应缩放。检查 MA5/10、MA10/20、MA20/60、close/MA20、DIF/DEA 符号与穿越日期，未发现变化；这个结论只覆盖这些确定性输入，不代表所有交易判断不变。

第二组受控敏感性实验：以 B 的完整 426 个 Yahoo 日期为底，两条序列中另外 52 个日期都固定为同一 B 值，仅把 374 个 common 日期替换为 A 或 B。**这是临时 counterfactual，既不是正式 mixed history，也不是新增候选；没有使用 Eastmoney 价格。** 用于隔离同源修订对跨区间指标的影响。

截至 2026-10-02：MA5/10/20/60 相同（最近 60 根已在变化窗口之后）；MA120 **33.800373 → 33.576579**；MACD DIF **−0.975475 → −0.972472**，DEA **−0.653125 → −0.648726**，histogram **−0.644701 → −0.647492**。最近 60 根支撑/阻力仍为 28.9545 / 38.56。

该实验的 2026-07-03、2026-07-15 `close vs MA20` 符号由低于变高于，穿越日期随之改变；所检 MA/MA 与 DIF/DEA 穿越没有变化。说明新旧 adjustment state 接缝能够改变程序事实，不能笼统说“1.448% 影响不大”。该实验不宣称真实用户当时的所有交易事件发生过变化。

直接用 A 的 374 个离散日期压缩计算也保存了结果，但后段缺 52 个交易日期，不能把这种计算当作当前真实 daily MA/MACD；不据此作投资判断。priceActionEvent 无已认证 deterministic classifier，本轮不重造 AI trend/structure/事件解释。

## 18. Rebase Policy Impact

建议在 policy 层分别表示：

- `PROVIDER_SWITCH`：canonical provider / adjustment method / price basis 改变，必须完整重建隔离候选。
- `SAME_PROVIDER_REVISION`：source identity 不变，但 raw、adjusted values 或 adjustment state 改变；记录字段、窗口、fetchedAt、event/factor 证据及影响。
- 后者再区分 `CORPORATE_ACTION_READJUSTMENT`、其他上游修订、数值精度漂移、单位变化、未知原因。未知原因不能自动接受。

Source contract 除 provider/算法版本，应记录 adjustment observation/effective state、事件集合 hash、raw response hash/可复核 payload、factor series hash、验证范围。canonical version 应是某一观察状态的完整一致快照，不能把同 provider 当作永远不变的历史。

不建议本轮放宽 OHLC guard 或引入任意百分比容差。允许历史修订的正确方式是另存版本、证明原因、重新计算指标并显式切换，而不是把已识别的真实修订当噪声放行。这里只提建议，不改 policy/产品代码。

Incremental 风险：旧 updater `latest−7 days` 窗口在事件日最多刷新附近历史，无法刷新数百根早期 adjusted bars；跨源 fallback 还会叠加 provider contamination。新 Worker guard 可以拒绝 overlap 中的修订，但没有覆盖到远端历史就不能证明全历史一致。

建议后续设计 corporate action detection + adjustment-factor sentinel + 周期性保留窗口复核；发现修订生成 revision candidate，原子替换全保留区间。保留 overlap 检查，但不能把 7 天 overlap 或“只拉新增 bars”当作复权状态充分验证。所有检查频率、容差与自动化权限均应另行评审，不在本轮实现。

## 19. 23-Symbol Impact

本次读取 composition，未对其余 22 个 symbol fetch。23 个都含 Yahoo+Eastmoney，全部 bars 标记 qfq/adjusted，均经过同一 provider/merge 路径，因此都具有 same-provider adjustment-state 修订的结构性风险；**不表示其他 22 个已实际发生本次同等比例修订**。

除 2899.HK 外，18 个保留 2026-07-13 初始抓取部分；另外 001359.SZ、300395.SZ、600487.SS、688825.SS 的最早保留 fetchedAt 为 2026-09-07。完整 providerCounts、日期范围与 fetchedAt 分组在 `.rebase/revision-statistics.json`。既有 23 个名单不变。

未来每个 rebase 应统一做 revision audit；不能写 `if symbol == 2899.HK` 特例。新股、ETF、不同市场的事件及单位证据分别验证，不能继承 2899 的股息因子。

## 20. Recommended Next Task

只推荐 **PROVIDER_REVISION_POLICY_V1**。

先明确 same-provider revision 与 provider switch 的判定、事件/因子证据、precision drift 处理、整段重建、审批及增量检查规则。当前证据不支持优先修 Yahoo 复权算法；也不应绕过 revision policy 直接 Apply 本候选。本轮不并行启动单位修复或 Eastmoney 重抓任务。

## 21. Data Integrity

审计前记录文件 SHA，结束复核原有文件字节不变，完整清单 `.rebase/revision-integrity-before.json`：

- candidateHash：`f184badf402c860c987c3b4c507b7fa94a52d3ea57b8c175c981d061e3bdcec0`，未变。
- candidate SQLite 文件、既有 `2899-review.json` 未变。
- approvals=0；active migrations=0；正式 technicalIndicators hash 未变。
- 正式 bridge SHA：`5ac635d1a9aad099b7738ad5555af1e3103a16aae6ffd76df869a37f192b0c76`。
- PC latest_export SHA：`e1a12254adb08ce1bde49508ec4d9e9087743692849823397eb7d16b658945d8`。
- market_universe SHA：`e0b5b9b288aa55dad73a9ab446f00e546664a96f96daf20cd6c07a9fa6f280ff`。
- PC provider/updater、Rebase Python 包和 worktree src JS 文件均按审计开始状态比对；本轮未修改既有代码。

仅新增本报告及 `.rebase` 临时审计脚本、raw/统计/图表。未修改正式 bars、metadata、candidate、technical snapshot、freshness、Discussion、holding、Plan、orders；未操作数据库、push、deploy、approve、apply 或 rollback。未生成新 commit。

## 22. Final Classification

| 项目 | 结论 |
| --- | --- |
| Primary | **B / CORPORATE_ACTION_READJUSTMENT**，高可信证据归因 |
| Secondary | 旧增量流程保留不同 adjustment observation states；独立 volume 修订与 C/B 微小漂移仍原因未知 |
| A / upstream historical revision 是否直接证明 | **旧 HTTP raw 不存在，不能直接证明**；normalized 备份、事件因子与不变 parser 强支持事件驱动回溯调整 |
| C / D / E / F 是否是主因 | 无证据支持旧/新调整 bug、价格算法变更或单位缩放导致 1.448% |
| Candidate assessment | A / likely valid（价格层面），仍非可批准候选 |
| Old assessment | B / stale due to historical revision；原观察状态下 likely valid |
| Pilot | **APPLY_BLOCKED**，保持不变 |
| 下一任务 | **PROVIDER_REVISION_POLICY_V1** |

复核产物：`revision-statistics.json`、`revision-ratios.csv`、`revision-replay.json`、`revision-factors.json`、`revision-archive-evidence.json`、`revision-yahoo-request.json`、`revision-yahoo-raw.json`、`revision-ratio-audit.png`，均位于同 worktree 的 `.rebase/`，与原 candidate 分开。
