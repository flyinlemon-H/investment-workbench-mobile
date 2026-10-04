# 2899_UNIT_AND_VOLUME_VALIDATION_AUDIT_V1

审计日期：2026-10-04（Asia/Shanghai）。范围：2899.HK，只读产品代码、正式数据、冻结候选和公开市场资料。只新增本文与 `.rebase/unit-volume-audit/` 临时证据；无 Approve、Apply、push、deploy。

## 1. Executive Summary

**最终状态：UNIT_VOLUME_AUDIT_INCOMPLETE_NEEDS_EVIDENCE。当前候选继续 APPLY_BLOCKED。**

本轮取得两项新的直接证据：

1. HKEX 2026-10-02 官方 Daily Quotations 中，2899 的 `SHARES TRADED` 为 **26,147,630 股**，`TURNOVER ($)` 为 **HKD 821,836,431**。候选与当前 Yahoo 历史日 K 的成交量均与该官方值完全一致。
2. 同一份新 Yahoo chart 响应同时含 `meta.regularMarketVolume=26155630` 和当天 `indicators.quote[0].volume=26147630`。前者等于旧存档，后者等于候选。此前审计 raw 也含相同分歧，说明不应简单描述为“Yahoo 当前上游只有一个统一新值”。

[HKEX 当日日报](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261002e.htm)已实际下载成功；web 文本工具因文件超过 4 MB 无法解析，改用只读 HTTP 获取，未将工具解析失败误报为资料不存在。

旧、新 parser 对同一新 raw 离线回放 426 根 OHLCV 全部一致，未发现 ×100、÷100、board-lot 转换或 volume 价格复权。旧 bar 抓取于 10 月 2 日 16:30:22 香港时间，已经收盘。

但是，旧原始 HTTP 响应未保存/未找到，Yahoo 两个字段的统计口径、修订时刻和差异原因没有明确契约或 correction 记录。**官方值验证了候选当天数值，不等于证明多出的 8,000 具体源自哪笔交易、哪次修订或何种统计口径。**

主分类 **I / INSUFFICIENT_EVIDENCE**。次级线索 **UPSTREAM_REVISION_PLAUSIBLE**，以及已实测的 Yahoo quote/meta 与 historical-series 字段不一致。两项 Apply blocker 均保持 **KEEP_BLOCKED**。

## 2. Current Blockers

| Blocker | 本轮结论 | 原因 |
| --- | --- | --- |
| UNIT_CONTRACT_INCOMPLETE | KEEP_BLOCKED | shares 与 HKD 的强交叉证据增加，但缺 Yahoo chart / Eastmoney f56、f57 的明确字段契约；旧 Eastmoney 与新 Yahoo 都需达到既有 confirmed 门槛 |
| VOLUME_DIFFERENCE_UNEXPLAINED | KEEP_BLOCKED | 候选获得 HKEX 官方数值支持；8,000 的具体成因及旧 raw 仍未知 |

不修改候选已有 `unitStatuses`、`confirmed`、`sourceContract` 或 `applyAllowed`。另外的 writer deployment / review 条件也没有由本轮关闭。

## 3. Data Sets

所有副本均在 `.rebase/unit-volume-audit/`，仅用于审计。

| 集合 | 文件/来源 | 数量与范围 |
| --- | --- | --- |
| A | `A-old-yahoo.json`；正式 workspace `data/market_data_bridge.js` 中 2899 的 Yahoo rows | 374；2025-01-09—2026-10-02，后段部分日期原 provider 为 Eastmoney |
| B | `B-frozen-candidate.json`；既有 final candidate 的 priceHistory | 426；2025-01-09—2026-10-02 |
| C | `C-historical-eastmoney.json`；同一正式 bridge 的 Eastmoney rows | 52；2026-07-03—2026-09-22，离散日期 |
| D-Yahoo | `yahoo-raw.json`、`yahoo-request.json` | 本轮一次只读请求，426 根；2026-10-04 14:46:16 UTC 接收完成 |
| D-Eastmoney | `eastmoney-request.json` | 一次连接失败，无 raw 数据；NOT_AVAILABLE |
| E-HKEX | `hkex-20261002.html`、请求 metadata、`hkex-2899-excerpt.txt` | 官方当日日报，仅抽取 2899 和必要表头/说明 |

B 原数据抓取时间是 2026-10-04T11:17:17.406770+00:00；final revision candidate 的 generatedAt 是 13:51:21.658233 UTC，后者是包装/评审对象时间，不是行情重抓时间。原 `.rebase/pilot-2899.sqlite` 及新的 revision store 均用 `mode=ro` 查询。

## 4. Yahoo Volume Semantics

端点：`https://query1.finance.yahoo.com/v8/finance/chart/2899.HK`。字段：`chart.result[0].indicators.quote[0].volume[i]`；日期索引对应 `timestamp[i]`。

| 项目 | 证据与结论 |
| --- | --- |
| 10/2 raw numeric value | 26147630，JSON integer |
| 旧 parser | `quote.volume → _number → float → DailyBar.volume` |
| 新 parser | `quote.volume → vals['volume'] → row.volume`，保留 integer |
| 保存字段 | `stock.priceHistory[].volume`，不从 `meta.regularMarketVolume` 取值 |
| 单位 | **shares / 股，STRONG_EVIDENCE**；10/2 数值与 HKEX 明确股数相等；52 个 EM 日期也完全相等 |
| 正式 API 契约 | **CONTRACT_NOT_EXPLICIT**：响应未携带 volumeUnit / boardLot / adjustment-unit 定义，未找到对应端点的明确官方契约 |
| 本地 adjusted | **NO_CONVERSION**；不乘 AdjClose/Close，不做 dividend/split volume 调整 |
| 上游 split-adjusted | 本窗口未返回 split 事件，不能用本样本验证 Yahoo 跨拆股规则；**UNKNOWN**，不能把价格的 split legend 套到 volume |
| dividend | 361 根价格修订而 volume 全部不变；本地算法不调整 volume，独立 cash-dividend 原理也不要求缩放成交股数 |
| timezone | 旧 Asia/Shanghai，新 HK 用 Asia/Hong_Kong，本样本同为 UTC+8；只决定日期键，不改变成交量 |

本路径不使用 yfinance，版本为 N/A；不把第三方库解释当作正在执行的代码或 Yahoo 官方承诺。Yahoo 帮助说明的是 adjusted **close** 的分红/拆股乘数，不是 volume 端点契约。[Yahoo 帮助](https://in.help.yahoo.com/kb/adjusted-close-sln28256.html)

当前 meta.regularMarketTime 为 `2026-10-02T16:08:07+08:00`；日 K timestamp 是 `2026-10-02T09:30:00+08:00`。日 K 的开盘时间标签不是数据抓取时刻，更不能据此判为未收盘。

## 5. Eastmoney Volume Semantics

端点：`https://push2his.eastmoney.com/api/qt/stock/kline/get`。

| 参数/字段 | 2899 使用值 |
| --- | --- |
| secid | `116.02899` |
| klt / fqt | `101` / `1`，日 K / 请求前复权 |
| fields1 | `f1,f2,f3,f4,f5,f6` |
| fields2 | `f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` |
| response | `data.klines[]` 逗号分隔字符串 |
| date / open / close / high / low | parts[0] / [1] / [2] / [3] / [4] |
| volume | **f56 → parts[5] → volume** |
| amount | **f57 → parts[6] → amount** |

旧 `_number(parts[5])` 与新 `float(parts[5])` 都直接转数值：**NO_CONVERSION**，无 ×100、÷100、board lot、币种转换。证券映射见 PC `src/market_data/symbols.py:16`；provider 映射见 `provider.py:67`、`:85`；candidate 见 `scripts/provider_rebase/fetch.py:16`、`:41`。

[东方财富港股页](https://hk.eastmoney.com/)明确标成交量（股）、成交额（港元）；[2899 自身公告页的行情表头](https://data.eastmoney.com/notices/stock/02899.html)也使用此单位。结合 C/B **52/52 volume exact**，HK f56 使用股有 **STRONG_EVIDENCE**。这些页面不是 f56 历史 API 正式定义，因此仍 **CONTRACT_NOT_EXPLICIT**。

不能沿用 A 股手数口径。现行浏览器 `volumeScaleForProvider` 对 Eastmoney `.SS/.SZ` 乘 100、对 `.HK` 乘 1；这是程序假设，不能反过来作为 API 官方单位证明。该路径生成比较指标，不改已冻结 A/B 的原始 volume。

## 6. Board Lot

**2899 board lot = 2,000 shares**。HKEX 2003 上市通知直接列明；2026 年 6 月 HKEX factsheet 中 2899 的 contract size=2000 shares、number of board lots=1，进一步支持一手 2000 股（没有将其他牛熊证的 lot 或单独期权合约量误当股票 lot）。

来源：[HKEX 上市通知](https://www1.hkexnews.hk/listedco/listconews/sehk/2003/1219/ltn20031219014.htm)、[HKEX June 2026 factsheet，第 1 页 2899 行](https://www.hkex.com.hk/-/media/HKEX_Common/Market/Products/Listed-Derivatives/Single-Stock/Weekly-Stock-Options/HKEX_infosheet_WeeklyStockOptions_EN.pdf)。这些是注明日期的直接证据；不宣称已逐日穷尽全部历史 lot 变更。

当前两条 pipeline 都没有用 boardLotSize 运算。根据本次强 shares 证据，8,000 raw units 应解读为 **8,000 股**，等于 **4 个 board lots**；绝不是据此断言“因为四手成交被撤销”。是否撤单、排除交易或统计差异仍未知。

## 7. Amount Semantics

Yahoo 本次响应 `indicators.quote[0]` 仅有 open/high/low/close/volume，另有 adjclose；无 amount/turnover 日序列。旧、新 parser 都明确 amount=None；A 374/B 426 全为 null。因此准确状态是 **所用 chart 响应没有成交额字段，当前 parser 不支持 amount**。未发现本次 payload 中可直接使用却漏取的 amount；不外推为 Yahoo 所有产品/API 永远不存在成交额，也不以 close×volume 伪造它。

Eastmoney f57 确有历史保存值。单位 **HKD，scale=1，STRONG_EVIDENCE**，不是港元千元：52/52 的 amount/volume 均落在同日 Yahoo quote low/high 内。例如 2026-07-03：amount=4,139,802,832，volume=134,796,362，比值=30.71153235；quote low/high≈29.46/31.16。若额外乘/除 1000，将明显偏离该价格范围。这里比较的是 quote OHLC，而非再乘股息因子的 adjusted OHLC。

该检验与官方港股页面标签共同支持 HKD/股；单独的 amount/volume 比值无法排除两个字段同时缩放，故不单凭比值宣布契约闭合。本轮 EM API 不可达，未得到新的 f57 raw。

补充只读观察：浏览器 `normalizePriceHistory` 用 JavaScript Number 转值，null 可被转为 0。这属于浏览器展示/归一化行为，不改变已冻结 Yahoo source 中 amount=null，也不解释正整数 volume 差 8000；本任务未修此逻辑。

## 8. Currency

Yahoo `meta.currency=HKD` 与 HKEX 2899 `CUR=HKD` 为直接证据：**priceCurrency=HKD，CONFIRMED**。报价按每股港元理解有 STRONG_EVIDENCE；parser numeric scale=1 为 CONFIRMED。本地股息复权是价格调整，不是换汇。

Eastmoney 页面标价格/成交额港元，历史数值也匹配 HK 价格规模：币种 HKD 为 STRONG_EVIDENCE（特定 kline 响应契约仍未取得）。两条 provider parser、bridge 和当前 HK volume 比较路径均无汇率转换。

## 9. 2026-10-02 Exact Diff

| 来源 | volume | 备注 |
| --- | ---: | --- |
| A old Yahoo | 26,155,630 | 16:30:22 香港时间抓取，complete=true |
| B frozen Yahoo candidate | 26,147,630 | 10/4 19:17:17 香港时间抓取 |
| B−A | **−8,000** | absoluteDiff=8,000 |
| 相对差异 `(B−A)/A` | **−0.03058614913882785465%** | 不用阈值抹零 |
| C historical Eastmoney 同日 | NOT_AVAILABLE | C 最后日期 9/22 |
| D current Yahoo quote.volume | 26,147,630 | 与 B 完全相同 |
| D current Yahoo meta.regularMarketVolume | 26,155,630 | 与 A 完全相同；字段不同 |
| D current Eastmoney | NOT_AVAILABLE | 本次 ConnectionError |
| E official HKEX SHARES TRADED | **26,147,630 股** | 与 B、D history 相同 |
| E official HKEX TURNOVER | **HKD 821,836,431** | 交易所成交额，不是 Yahoo amount |

HKEX 文件 SHA256：`439972108d7229b5d82519d4916fbd72e8b95c15a80ad7094441b27353494f57`。表头位于保存 HTML 第 106—107 行，2899 数据位于 4111—4112 行。日报发布日期/交易日为 02 OCT 2026。当前 Yahoo raw SHA256：`4c93e2db6b0ece5825414260142cb8d204b9e11937ddd1dbc4572ed560321296`。

## 10. All Volume Differences

采用 Decimal(str(value)) 的精确数值比较，无容差。完整分母 A ∩ B = **374**，sameVolumeCount=**373**，differentVolumeCount=**1**。唯一记录：

| date | oldVolume | newVolume | signedDiff | absoluteDiff | relativeDiff |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-10-02 | 26155630 | 26147630 | -8000 | 8000 | -0.03058614913882785465% |

无其他更小的 A/B volume 差异。D 当前 raw 对 B 全 426 日 volume **426/426 相同**。C 与 B 的另 52 个日期也 **52/52 相同**，但它们不是 old-Yahoo 主比较样本。

边界说明：前置备份证据另有 2026-07-22 Yahoo volume 114253437→114247437（−6000；抓取分别为 7/22 与 7/27）。这是**历史备份间另一组观察**，不是本次 A/B 新增差异。它说明不能把“当前 common 只有一天”扩大成“该供应商历史上只发生过一次”；该旧 raw 同样缺失，不能确定其成因。

## 11. Corporate Action Relationship

361 个价格变化日期的 volume 均相同；唯一 volume 变化日期 10/2 的 OHLC 均相同。两类变化在 A/B 中没有日期交集，未观察到分红前后 volume 系统性乘除因子。

前置价格证据继续成立：7/23 每股 HKD 0.4839736 现金股息；close ratio 中位数 0.985518451040，与 `1−0.4839736/33.42=0.985518444045` 一致。[公司公告](https://www.zijinmining.com/upload/file/2026/07/22/f1c55d0bc3694ba292f77119610ce771.pdf)

[Xignite 自身 adjustment methodology，第 3 页](https://cdn.xignite.com/site/media/1776/corporate-actions-handling-in-xignite-globalhistorical-v3.pdf)区分改变股数的拆股/红股与不改变股数的现金股息：后者不要求 volume 调整。这是另一供应商对调整原理的直接说明，**不是 Yahoo 合同**。结合实际代码、361 根不变 volume 和 10/2 无价格修订，不能以现金分红解释 −8000。

## 12. Old Yahoo Pipeline

PC `src/market_data/provider.py:89`，git `040136d05ef9f64ba422c8c2452c3cb07d2764c8`。本次 git diff 确认旧提交与当前 provider.py 完全相同。

volume 来自 quote 数组，经过 `_number` 的 float cast（`:149`），无 rounding、整型截断、字符串手数解析、聚合、volume 复权、lot 或 currency 转换。26,155,630/26,147,630 均远低于 IEEE-754 精确整数上限，int↔float 不会损失 8000。

`updater.py:57` 的 merge_price_history 以日期覆盖，不汇总 volume；incoming incomplete 不覆盖 existing complete。Bridge 只筛 complete rows 后 JSON 序列化，不做成交量尺度转换。浏览器 HK 比较 scale=1。代码还原支持排除已见实现的换算错误，但没有当时进程二进制/源码 hash 和旧 raw，不能证明所有未知运行时状态。

## 13. New Yahoo Pipeline

`scripts/provider_rebase/fetch.py:47` 开始解析 Yahoo；`:61` 直接写 volume=vals['volume']。Revision 的数值规范化仅 round6 价格，volume/amount 不按价格精度舍入（`revision.py:38`）。

| 行为 | 旧 PC | 新 Candidate | 对 volume 数值影响 |
| --- | --- | --- | --- |
| endpoint / symbol | chart / 2899.HK | 相同 | 无 |
| interval / events | 1d / history | 相同 | 无本地转换 |
| 请求窗口 | 首次默认 550 日，增量 latest−7 日 | 全保留历史 | 上游返回在不同日期/窗口可不同；未证明机制 |
| volume 来源 | quote[0].volume[i] | 相同 | 无 meta 字段切换 |
| cast | float(raw) | 保留 raw int | 本样本精确相同 |
| volume rounding / aggregation | 无 / 无 | 无 / 无 | 无 |
| lot / ×100 / ÷100 / FX | 无 | 无 | NO_CONVERSION |
| OHLC adjustment | AdjClose/Close，round6 | 相同；缺 factor 增加 blocker | 仅作用 OHLC |
| timezone | Asia/Shanghai | HK: Asia/Hong_Kong | 本窗口日期同为 UTC+8 |
| complete | 标记；merge/下游消费 | fetch 后过滤 | 10/2 均完整 |
| provenance / 校验 | 普通 provider 标签 | raw/canonical id、契约、限长/hash | 不改 volume |
| amount | None | None | 同样缺失 |

完整实现文本 diff 已保存 `old-provider-vs-new-fetch.diff`（用于审计，不作为补丁）。真实函数离线回放：426 根，open/high/low/close/volume/amount 的 old-vs-new differentCount 均为 **0**；详见 `parser-replay.json`。没有调用 live ProviderChain，也没有重新生成 candidate。

## 14. Fetch Timing

| 观察 | UTC | 香港/北京时间 |
| --- | --- | --- |
| 旧任务开始，日志第 1 行 | 2026-10-02 08:30:02.1996056 | 10/2 16:30:02.1996056 |
| A 10/2 row.fetched_at | 2026-10-02 08:30:22.551346 | 10/2 16:30:22.551346 |
| 旧任务完成，日志第 47 行 | 2026-10-02 08:30:40.0532189 | 10/2 16:30:40.0532189 |
| B 原始抓取 | 2026-10-04 11:17:17.406770 | 10/4 19:17:17.406770 |
| 前置审计 raw | 2026-10-04 12:02:09.449468 | 10/4 20:02:09.449468 |
| 本轮 raw 接收完成 | 2026-10-04 14:46:16.625484 | 10/4 22:46:16.625484 |

原日志：PC `data/logs/market_data/market_update_20261002_163002.log`，第 27 行确认 2899 provider=yahoo、added=1、projected=2026-10-02。必要摘录和日志 SHA 已保存 `old-fetch-log-evidence.json`。

仅能证明观察时点不同。没有证据说明 Yahoo 在具体哪分钟 correction、是否晚到交易/结算、是否 feed 口径不同，**不得把 TIME_OF_FETCH_DIFFERENCE 当成已证实主因**。

## 15. Complete Bar Status

A 的 `is_complete_bar=true`。PC `provider.py:46` 的 HK 同日门槛为 16:10；以保存的 fetched_at 离线调用返回 true。HKEX closing auction 随机收市区间为 16:08—16:10；旧抓取在此后约 20 分钟。[HKEX Securities Market Operations](https://www.hkex.com.hk/Global/Exchange/FAQ/Securities-Market/Trading/Securities-Market-Operations?sc_lang=en)

因此在本次已见时间证据与现行规则内，**不是盘中未完成 K 被误标 complete**。但 complete 表示交易时段结束，不承诺供应商已完成全部修订，也不证明 26,155,630 必然最终正确。没有修改 complete-bar 规则。

## 16. HKEX Comparison

官方 `SHARES TRADED=26147630` 为 **CONFIRMED（该日报的该日记录）**，与 B/D history 相同；A 高 8000。官方 turnover/volume≈31.4306 HKD/股，与该日价格范围一致，不把这个均价当 Yahoo 新 amount。

日报 amendment 部分记录的是 **30/09/26** 的修订（净额 0），不是 10/2 的 2899 correction；不能拿它证明“10/2 没有修订”，也不能用它解释 −8000。没有找到能指认本次 8000 的官方 correction 记录。

Yahoo 搜索索引的历史页面还展示 26,155,630，与 meta 一致；该索引抓取时间不等于当前实时页面状态，权重低于本轮 raw 和 HKEX，不据此否定官方数值。[Yahoo 历史页面](https://ca.finance.yahoo.com/quote/2899.HK/history/)

## 17. Upstream Revision Assessment

| 分类 | 判定 |
| --- | --- |
| I INSUFFICIENT_EVIDENCE | **PRIMARY**：具体成因未闭合 |
| A UPSTREAM_VOLUME_REVISION | plausible；旧 raw 缺失，不能确认旧 quote 曾经就是 26155630 |
| B OLD_INCOMPLETE_BAR | 当前记录/时段证据不支持 |
| C PIPELINE_VOLUME_BUG | 旧新实际函数回放无差异；未找到产生 8000 的代码路径 |
| D UNIT_CONVERSION_ERROR | 未发现；无尺度操作；373 日相同也不支持整体换算错误 |
| E LOT_SEMANTICS_ERROR | 未发现；board lot 不参与计算 |
| F EXCHANGE_CORRECTION | 没有特定 correction 证据；HKEX 值匹配不能替代原因证据 |
| G TIME_OF_FETCH_DIFFERENCE | 时间确实不同；因果关系未知 |
| H OTHER | 同一 payload meta/history 差异已观察；统计口径或更新机制未知 |

次级标记：**UPSTREAM_REVISION_PLAUSIBLE**；描述性事实 `YAHOO_META_HISTORY_DISCREPANCY_OBSERVED`（审计文字，不新增 Engine 枚举）。

缺失证据：旧时点 quote 原响应或可验证归档；Yahoo 对 regularMarketVolume/history volume 的覆盖范围及修订机制定义；能够精确对应 8000 的 correction/交易分类明细。本次官方匹配提高候选可信度，但不证明旧值是何种错误。

## 18. Unit Contract

以下仅为**待审建议**，不写入任何 Candidate/source contract；evidenceLevel 按字段保留，不统一拔高。

| 建议字段 | Yahoo 2899.HK | Eastmoney 2899.HK |
| --- | --- | --- |
| priceCurrency | HKD，CONFIRMED | HKD，STRONG_EVIDENCE |
| priceUnit | HKD/share，STRONG_EVIDENCE；本地 scale=1 已确认 | HKD/share，STRONG_EVIDENCE；本地 scale=1 已确认 |
| volumeUnit | shares，STRONG_EVIDENCE，CONTRACT_NOT_EXPLICIT | shares，STRONG_EVIDENCE，CONTRACT_NOT_EXPLICIT |
| amountCurrency | null / not_applicable（此接口无 amount） | HKD，STRONG_EVIDENCE |
| amountUnit | null / unsupported_by_used_response | HKD，STRONG_EVIDENCE |
| boardLotSize | 2000 shares；与 volume scale 分离 | 同左 |
| volumeSemantics | daily historical quote volume；上游修订/拆股规则未闭合；不要混用 meta | HK daily f56；跨市场/历史修订规则未闭合 |
| evidenceSources | raw SHA、parser、HKEX 日报、Yahoo help | 官方 HK 页面、f56/f57 mapping、52 日交叉验证、单次 probe |

不能将这一建议表直接转为 `confirmed=true`，不能推导 boardLotSize=volumeScale。最终规范还应单独记 measurement date、provider field、comparison source、as-of 和 upstream adjustment status。

## 19. Evidence Levels

| 事实/主张 | 等级 |
| --- | --- |
| raw field→本地 volume，无算术转换 | CONFIRMED（代码与离线回放） |
| 本轮 Yahoo raw 两个 volume 字段相差 8000 | CONFIRMED |
| 10/2 candidate volume = HKEX shares traded | CONFIRMED（单日数值对照） |
| Yahoo chart volume 全面单位/修订契约已闭合 | UNKNOWN；CONTRACT_NOT_EXPLICIT |
| Yahoo volume=shares、scale=1 | STRONG_EVIDENCE |
| Eastmoney HK volume=shares、amount=HKD、scale=1 | STRONG_EVIDENCE |
| Yahoo 所用响应无 amount，parser 输出 None | CONFIRMED |
| Yahoo price currency=HKD | CONFIRMED |
| 2899 2000 股/手 | CONFIRMED（2003/2026 具日期 HKEX 资料） |
| old bar 已过收盘且 complete=true | CONFIRMED（保存记录、日志与代码范围内） |
| 8,000 因为 correction / 四手撤单 / 迟到交易 | UNKNOWN |
| upstream revision 作为具体成因 | WEAK_EVIDENCE（可行假设，有旧 raw 缺口） |

“单日股数吻合”与“所有日期/企业行动均有正式 provider 契约”是不同证明范围，不能互换。

## 20. Unit Blocker Decision

**UNIT_CONTRACT_INCOMPLETE → KEEP_BLOCKED。**

`revision.py:209` 的 unit_gate 要求正式历史涉及的 provider 与目标 provider 的 price、volume 均有 confirmed、非空 evidence/unit、合法 scale，price 币种匹配、volumeUnit=shares；strong_evidence 不满足。当前旧历史含 Eastmoney 与 Yahoo，不能只核对新 Yahoo。

Yahoo currency、amount 不适用状态、本地 scale 行为已清楚；仍缺足以将 HK f56/f57 与 Yahoo volume 契约确认的正式证据/经批准的可接受证据规则。本轮无权通过修改 policy 或 confirmed 标志消除此缺口。

## 21. Volume Blocker Decision

**VOLUME_DIFFERENCE_UNEXPLAINED → KEEP_BLOCKED。**

官方成交量与候选吻合，但未确认差异真实原因。当前 V1 对 changed volume 本来也没有已评审自动放行规则（`revision.py:227`）；自由文本说明即使写 confirmed 也不解除 guard。此次没有使用 ignoreVolumeDiff、allow8000 或 symbol exception。

## 22. Candidate Status

| Gate | 结论 |
| --- | --- |
| UNIT | **blocked** |
| VOLUME | **blocked**（当前值获 HKEX 支持，原因未闭合） |
| PRICE REVISION | **pass（价格修订解释层面）**，沿用现金分红强证据；不表示价格单位/整体 validation 自动通过 |
| OVERALL | **still apply blocked** |
| approval / apply | pending_user_review / false，未改变 |
| Canonical provider | **尚未最终批准**；候选内 yahoo 是该方案参数，不是已批准选源结果 |

## 23. Eastmoney Capability

本轮仅 **1** 次请求，2026-10-04T14:46:14.747418Z 开始，14:46:17.013977Z 结束，2.267 秒，结果 **ConnectionError**。没有 HTTP 状态/raw body，没有重试；准确地说本次不是 timeout（前置任务为 timeout）。

请求明确使用 daily klt101、fqt1，历史 C 支持曾有 volume/amount 数据，但本次无法实证当前 daily 可达性、qfq 回应和单位字段。availability、qfq 当前能力 = NOT_VERIFIED。不能把一次 Yahoo 成功、一次 EM 连接失败当 canonical provider 选择依据。

## 24. 22-Symbol Reuse Impact

其他 22 个 mixed 标的包括港股 **1357.HK、1810.HK、2513.HK** 及 **19 个 A 股**。

可复用：解析路径、HK 无本地 lot/FX 转换、官方港股页面单位标签、证据分层、raw/meta/history 不可混用、完整 bar 不等于不可修订。只能作为其他 HK 的待核证据，不能自动写 confirmed。

不可复用：2899 的 2000 股 board lot、10/2 HKEX 数值、8000 差异成因、具体公司行动/拆股状态。不得推广 HK shares 结论到 A 股 f56；不得批量迁移或批量选源。本轮未 fetch 其他 22 个标的。

## 25. Revision Engine Implications

建议未来区分 **PRICE_HISTORY_REVISION / VOLUME_HISTORY_REVISION / MULTI_FIELD_REVISION**，逐字段保留 before/after、field path、observation time、官方对照和 upstream evidence。

本例同时发生价格历史与 volume 差异，但日期不重合，应允许报告多个字段机制；价格公司行动证据不能清除 volume blocker。可以表达“exchange-value matched / cause unknown”，而不把它等同 Apply approved。meta 与历史日 K 的差别应保留字段来源，不能用 meta 覆盖 history。

以上均为建议。未修改 Engine、policy、source contract、parser、normalization 或 ProviderChain。

## 26. Recommended Next Task

只推荐：**EASTMONEY_HK_PROVIDER_CAPABILITY_AUDIT_V1**。

理由：本轮已取得 Yahoo 当日历史值的官方对照，但旧历史仍含 52 根 EM，当前 EM 可达性、历史接口单位与 qfq 行为尚不能验证。下一步应在单独任务中补齐 HK f56/f57 的 provider-side 证据及受控能力验证，报告实际样本/币种/尺度，继续保持现有候选冻结。该任务完成也不自动解决 volume 具体成因或批准 canonical provider。

## 27. Data Integrity

本轮开始固定 93 个保护文件 SHA，包括正式 bridge、PC export/provider/updater、market universe、冻结原 store、final candidate、新 revision store，以及现有 Engine/frontend 源码。末尾逐项复核；SQLite 仅 mode=ro，未调用 save/approve/apply。

| 对象 | SHA256 / 版本 | 结果 |
| --- | --- | --- |
| 正式 `data/market_data_bridge.js` 整文件 | `5ac635d1a9aad099b7738ad5555af1e3103a16aae6ffd76df869a37f192b0c76` | 未变化 |
| 正式 2899 bars（规范 JSON） | `2ed0c9b77506fe1eb190b47ca46138a7a2990cb2c43d50c083ab88c31055d906` | 未变化 |
| 当前 revision candidateHash | `f4f1f0a88eb42f0a124d747b4a3bf7eead6830e5dab9b7615cbf1b542eb834cb` | 未变化 |
| 当前候选 bars（规范 JSON） | `cae5a903d0a8a898448ed617e1695c2da587f1fe102e71c421a00bd4b8ded577` | 未变化 |
| 原 frozen rebase candidateHash | `f184badf402c860c987c3b4c507b7fa94a52d3ea57b8c175c981d061e3bdcec0` | store/对象未变化 |
| candidate technicalVersion | `846ba5d57b1fe8c677f357d5e17b4b20e4a91e52f475397b337d3fbf0646f06e` | 未变化 |
| 正式 technicalIndicators（规范 JSON） | `364df3e05a42001aa444e480f58e4d5a45e1e078ce90d28cf683a879504ec684` | 未变化 |
| PC latest_export.json | `e1a12254adb08ce1bde49508ec4d9e9087743692849823397eb7d16b658945d8` | 未变化 |

两份 store 均 **approval count=0，active migration count=0**，前后相同。原 store objects=3/events=2；revision store objects=4/events=15，也均相同。全文件基线/末次复核见 `integrity-before.json`、`integrity-after.json`。

产品代码/正式数据：**没有修改**。临时分析脚本仅在 `.rebase/`，未提交。新增 commit：**无**；既有 HEAD `4d0cdbee7fa730a79cde533adc69dba168fa8e4e`。未连接或修改生产数据库/账户，未改 technical snapshot、freshness、Discussion、holding、Plan、orders。此完整性结论覆盖上述本地证据，不冒称重新审计了未访问的远端生产状态。

主要本地代码证据（相对本 worktree，PC 路径单列）：

- `scripts/provider_rebase/fetch.py:16`、`:41`、`:47`、`:61`：参数和映射。
- `scripts/provider_rebase/revision.py:38`、`:209`、`:227`：数值规范化和 guard。
- `src/state.js:1061`、`:1131`：浏览器数据转换与 HK/CN volume scale。
- `E:/users/kaka/onedrive/文档/投资分析程序/src/market_data/provider.py:46`、`:67`、`:89`、`:121`、`:149`：完整日、EM/Yahoo、数值 cast。
- `E:/users/kaka/onedrive/文档/投资分析程序/src/market_data/updater.py:57`：按日期 merge。

最终状态：**UNIT_VOLUME_AUDIT_INCOMPLETE_NEEDS_EVIDENCE**；**APPLY_BLOCKED**。
