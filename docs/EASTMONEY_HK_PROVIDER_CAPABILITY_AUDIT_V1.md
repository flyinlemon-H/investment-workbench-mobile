# EASTMONEY_HK_PROVIDER_CAPABILITY_AUDIT_V1

日期：2026-10-04，Asia/Shanghai。只读审计；无正式 Candidate 生成，无 Approve / Apply / push / deploy。

## 1. Executive Summary

**Primary：E / UNAVAILABLE_THIS_RUN。最终状态：EASTMONEY_HK_AUDIT_INCOMPLETE_CONNECTIVITY_BLOCKED。**

Eastmoney 历史上确实能提供本项目港股日线，不能因本轮断连判为不支持港股。本轮有价值的新证据：

- 采用实际 Worker 配置的 `C:\Python314\python.exe`、同一 PC adapter、原 timeout/headers；2899 全窗口与 1810 短窗口相隔约 98 秒开始请求，均在约 2.32 秒后 ConnectionError。连续失败后停止；没有继续尝试其他标的、fqt、主机或代理。
- 第二次请求的 DNS、TCP、TLSv1.3 均成功，HTTP 状态/响应体尚未收到即 `RemoteDisconnected`。这是已连接后的断流；不是已证实的 DNS/TLS 错误、HTTP 403/429、空行情或 parser 错误。
- 现有 Eastmoney 2899 数据在 9/18、9/21、9/22 的 volume 与 HKEX **3/3 完全一致**；amount 差分别 **+8、+7、0 HKD**。股/港元、scale=1 得到更强支持，但完整端点单位契约仍未闭合。
- 五个已完成日的 Eastmoney OHLC 在 7/23 后统一减 **0.484**，volume/amount 不变。此组支持现金分红引起的历史回溯调整，且呈固定金额差；Yahoo 对应调整呈比例缩放。同为 qfq 标签不意味着数学等价。

目前不能证明完整 426 根覆盖、当前 raw/qfq 响应对照、可靠性或 full-history revision probe 能力；**不具备进入最终 provider 选择评审或生成正式 Eastmoney Candidate 的条件**。Canonical 保持 UNDECIDED，2899 继续 APPLY_BLOCKED。

## 2. Current Pilot Context

正式历史：426 根，Yahoo 374 / Eastmoney 52，标签 qfq/adjusted。Yahoo 冻结候选覆盖 2025-01-09—2026-10-02 共 426 根。价格现金分红修订有强解释；10/2 historical volume=26,147,630 与 HKEX 相同，但 Yahoo meta 与旧存档为26,155,630，差 8000 原因未明。

本轮复用前置只读数据集：`.rebase/unit-volume-audit/` 的 A/B/C、Yahoo raw、10/2 HKEX 日报。本轮新材料均在 `.rebase/eastmoney-hk-audit/`。未主动再抓 Yahoo，未读写生产账户或数据库，未启动 Worker / 手动更新命令。

## 3. Endpoint

| 项目 | 实际值 |
| --- | --- |
| scheme / host | HTTPS / `push2his.eastmoney.com` |
| path | `/api/qt/stock/kline/get` |
| 完整 endpoint | `https://push2his.eastmoney.com/api/qt/stock/kline/get` |
| secid | `116.02899` |
| klt / fqt | `101` / `1` |
| fields1 | `f1,f2,f3,f4,f5,f6` |
| fields2 | `f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` |
| beg / end | `20250109` / `20261002` |
| timeout | PC adapter 原默认 **15.0 秒**；未改 timeout/retry |
| Retry | Requests adapter `total=0, read=False`，无应用层重试 |
| User-Agent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36` |
| Accept | `application/json,text/plain,*/*` |
| Referer | `https://quote.eastmoney.com/` |
| Accept-Encoding / Connection | `gzip, deflate, zstd` / `keep-alive` |
| proxy | Session.trust_env=true；有效 proxy 配置为空、实际 send proxies 为空 |
| parser | PC `src/market_data/provider.py:61` EastMoneyDailyProvider.fetch_daily |
| runtime | Python 3.14.0，Requests 2.34.2，urllib3 2.7.0 |

只读 launcher.json 的 pythonExe/sourceRoot/environment 配置确认这是实际 Worker 配置；未读取 DPAPI credential 文件、token 或运行 Worker。源目录为 `E:/users/kaka/onedrive/文档/投资分析程序`。

ProviderChain 默认顺序是 EastMoneyDailyProvider → YahooDailyProvider（`provider.py:125`）。Worker 的 load_source_updater 导入同一 PC updater/provider；原手动 `scripts/update_daily_kline.py` 也调用这个 updater。两者 transport/adapter 共用，但 Worker 有额外来源一致性 guard，不能将手动 fallback 的成功等同为 Worker 可安全跨 provider 写入。

## 4. Symbol Mapping

`src/market_data/symbols.py:16`：HK market id=**116**，security code=**02899**，secid=**116.02899**。离线实际 normalize_symbol 验证：

| 输入 | canonical 输出 | Eastmoney secid |
| --- | --- | --- |
| `2899.HK` | `2899.HK` | `116.02899` |
| `2899.hk` / 带空格 | `2899.HK` | `116.02899` |
| `02899.HK` | `02899.HK` | `116.02899` |
| `1810.HK` | `1810.HK` | `116.01810` |
| `1357.HK` | `1357.HK` | `116.01357` |
| `2513.HK` | `2513.HK` | `116.02513` |

当前 2899 路径稳定，无 market-id/前导零错误证据。一个独立边界：zfill(4) 不会缩短已有五位字符串，所以 02899.HK 与 2899.HK 的 canonical 文本不同、secid 相同；本轮实际输入均为项目既有规范四位代码，不能把此 alias 风险说成本次断连根因。未修 normalization。

## 5. Connectivity

第二次真实请求通过临时观察包装记录原调用的 DNS/TCP/TLS 阶段，未改变原请求参数、重试、socket 配置或 adapter 文件。

| 阶段 | 本轮观察 |
| --- | --- |
| DNS | SUCCESS，解析结果含 1 个不同地址 |
| TCP | SUCCESS |
| TLS | SUCCESS，TLSv1.3 |
| HTTP status | NOT_RECEIVED |
| payload | NOT_RECEIVED |
| parser / bar validation | NOT_REACHED；不能称 parse failure |
| 异常链 | ConnectionError → ProtocolError → RemoteDisconnected |

同次运行环境中，东方财富 `quote.eastmoney.com` 公开行情 HTML 和两份静态 JS 可 HTTP200 读取。因此不是“所有 Eastmoney 域名均不可达”的证明；不同主机成功也不能证明 Kline 服务正常。

Requests 没有配置显式代理，不能据此排除透明代理、防火墙、路由中间设备。地区、出口 IP、UA限制、服务端策略和中间环节断流均未被证实；未外发 IP 查询、未改系统网络、未绕过网络或网站访问控制。provider 页面的一般海外 BMP 提示不能证明本机地区或该 endpoint 的失败原因。

结论：**本会话重复观察到同类失败，尚不能区分偶发故障、周期性问题、长期结构性不兼容。** 网络阶段已缩小，但可修复根因未确认。

## 6. Probe Attempts

时间为 UTC；香港/北京时间加8小时。各请求都使用原 PC adapter。

| attempt | 开始时间 | symbol / 窗口 | latency | 结果 |
| --- | --- | --- | ---: | --- |
| 1 | 2026-10-04 15:04:39.133987 | 2899.HK；2025-01-09—2026-10-02 | 2.320s | ConnectionError / RemoteDisconnected |
| 2 | 2026-10-04 15:06:17.387531 | 1810.HK；2026-09-01—2026-10-02 | 2.322s | 同上；DNS/TCP/TLS 成功 |

第1次完成至第2次开始间隔95.93秒；开始时间相隔98.25秒。**Kline请求共2次，成功0，失败2，HTTP错误0个已观测、Timeout0个本轮、parse错误0个已观测。** 后面三个“0”不等于已验证对应能力正常。

连续失败即停止此类 probe，没有为了获得成功样本追加第3次、切换 host、换请求头、请求 raw/hfq、改代理或扫全市场。3份 HKEX 日报、1份东方财富 HTML、2份公开静态 JS 是独立资料读取，不是新增 Kline probe。

## 7. Historical Coverage

当前请求结果：firstDate=**NOT_AVAILABLE**，lastDate=**NOT_AVAILABLE**，barCount=**NOT_AVAILABLE**（没有 payload，不能报告服务端返回0根）。完整 retained window 2025-01-09—2026-10-02 是否满足：**UNCONFIRMED**。

既有正式 Eastmoney 子集为52根、2026-07-03—2026-09-22；55份备份合计观察过64个不同 Eastmoney 日期。它们是增量保存/混源后残留，不是一次完整 history 响应。**不能把52当接口最大条数，也不能把426总历史误报为已取到426根EM。**

未取得成功但被截短的响应，因此不写 REBASE_NOT_SUPPORTED_FOR_REQUIRED_WINDOW；当前应写 REBASE_CAPABILITY_UNCONFIRMED。

## 8. Paging / Limits

本项目 PC adapter 与隔离 fetch 工具传 beg/end，均没有 lmt/smplmt、page/cursor 或分页循环。

本轮从[东方财富自身 chart JS](https://quote.eastmoney.com/newstatic/libs/quotekchart/1.0.6.old.js)查到 getKlineData 默认 begin=0、end=20500101、smplmt=1e6、lmt=1e6，发往同一个 HTTPS endpoint；lastcount 可改写 lmt 并移除 beg/smplmt。该资料来自其行情页实际引用，原文件与SHA已存档。

这证明其公开客户端存在 **lmt/smplmt/beg/end 参数用法**，不证明服务端最大可取100万条、默认条数、历史回溯期限或可靠分页。未发现本次已读客户端有 cursor/page 分页协议。与现有 adapter 参数存在差别，但未经受控成功对照，不能断定“不传lmt导致断连”或直接修参数。

## 9. QFQ

参数语义取得 provider自身代码证据：同一 JS 显式枚举 **Bfq=0、Qfq=1、Hfq=2、D=101**；[官方 fullscreen UI JS](https://quote.eastmoney.com/newstatic/build/fullscreen_full.js)中按钮前复权/后复权/不复权分别 data-fqtype=1/2/0，点击传 setFqType。其请求实际映射 fqt=e.cfq。

因此 **fqt 参数含义：CONFIRMED（公开客户端实现范围）**，不再仅依赖本项目注释。

但当前 raw fqt0 vs qfq fqt1 的同日 live 对照：**NOT_PERFORMED / CONNECTIVITY_BLOCKED**。没有第二种 fqt 请求，不能宣称本轮在线 QFQ 已验收。历史备份有真实数值变化证据，见下一节；它不是当前两种参数响应的替代品。

## 10. Corporate-action Behavior

55份 PC `latest_export_before_market_update_*.json` 中，2899 Eastmoney 有7个日期出现字段变化；必须区分其中**5个 complete→complete 历史修订**与2个 incomplete→complete 的正常交易日更新。

| 完整日 | 旧close | 7/23后close | 差值 | 新/旧 ratio |
| --- | ---: | ---: | ---: | ---: |
| 2026-07-15 | 30.200 | 29.716 | -0.484 | 0.983973510 |
| 2026-07-16 | 30.860 | 30.376 | -0.484 | 0.984316267 |
| 2026-07-17 | 29.380 | 28.896 | -0.484 | 0.983526208 |
| 2026-07-20 | 30.120 | 29.636 | -0.484 | 0.983930943 |
| 2026-07-21 | 31.520 | 31.036 | -0.484 | 0.984644670 |

五日的 **open/high/low/close 四字段均恰好减少0.484**；volume和amount都保持不变；旧/新bar的complete标记均true。新观察均在2026-07-23T08:30:04.876646Z；旧观察分别为7/15、7/19、7/20、7/22。

可复核备份示例：`latest_export_before_market_update_20260719_113548.json` 与 `latest_export_before_market_update_20260726_195224.json`；详情及SHA见 `archive-variants.json`。后者保留7/23抓取结果。PC provider自git `040136d05ef9f64ba422c8c2452c3cb07d2764c8` 至现状无diff，代码不在本地复权EM OHLC。

该固定差与[7/23现金股息HKD0.4839736/share公告](https://www.zijinmining.com/upload/file/2026/07/22/f1c55d0bc3694ba292f77119610ce771.pdf)取3位小数后的0.484一致，构成 **STRONG_EVIDENCE：EM前复权在这次事件中采用金额平移，历史可回溯变化**。保存值变化本身是CONFIRMED；旧raw/当前raw未取得，不能宣称已经复原EM所有公司行动算法。

另外7/22、8/26的比较起点为盘中incomplete，OHLCV/amount随交易变化，已从五日证据中排除。不能把它们当公司行动修订。

结论：**adjustedHistoryMutable=true（已见历史保存值；上游机制强证据）**，绝不能假设换成EM就不再需要revision guard。

## 11. Price Currency / Unit

价格币种 **HKD**，价格单位 **HKD/share**，证据等级均保持 **STRONG_EVIDENCE**。东方财富港股页明确港元；HKEX 2899 CUR=HKD；已保存值与对应HK价位匹配。

PC parser对parts[1..4]直接float，无÷1000、÷100、FX；数值scale=1为代码CONFIRMED。没有当前raw自述currency/priceUnit字段契约，因此不能把公共页面标签升级成整个历史端点的正式单位承诺。

[东方财富港股页面](https://hk.eastmoney.com/)；[2899页面行情表头](https://data.eastmoney.com/notices/stock/02899.html)。本轮quote静态页可达，但港股页的web解析存在超时，单位标签引用前置任务已读的一手页面证据。

## 12. Volume Field / Unit

字段路径：`data.klines[]` 按逗号分隔，第6列 **f56 → parts[5] → DailyBar.volume**。PC `_number`仅做float cast；候选工具同样直接float，均无手数/lot换算。

历史52根EM与冻结Yahoo同日volume **52/52完全一致**；本轮另用3个不同交易日的HKEX官方股数直接对照 **3/3完全一致**，无需×100、÷100、×2000。由此 **volumeUnit=shares、scale=1：STRONG_EVIDENCE**。

已读 provider客户端把t[5]标为成交量，但没有给出覆盖HK f56所有情形的明确单位/修订规则。当前raw缺失，保留 **CONTRACT_NOT_EXPLICIT**。确认几个样本的数值相等，不能替代所有日期/市场的正式契约。

## 13. Board Lot

2899为2000股/手，沿用前置[HKEX 2026年资料](https://www.hkex.com.hk/-/media/HKEX_Common/Market/Products/Listed-Derivatives/Single-Stock/Weekly-Stock-Options/HKEX_infosheet_WeeklyStockOptions_EN.pdf)及上市通知。

adapter不读取boardLot，也没有乘除2000。3日EM值直接等于HKEX股份成交量，支持API按股编码而非整手数。非2000整倍数并不排除合法碎股交易，不以整除性单独证明单位。**board lot 不参与当前 volume parser 运算**；其他港股的lot需逐股核验。

## 14. Amount Field / Unit

字段 **f57 → parts[6] → DailyBar.amount**。公开chart客户端t[6]显示为成交额。本地直接float，无千元/万元换算、无FX。单位 **HKD、scale=1：STRONG_EVIDENCE**；未提升为完整契约CONFIRMED。

3日对照中一个exact，另两个差7/8港元，约为总额的十亿分之7—8；不是1000或10000倍尺度差。这支持基本单位，却显示不能说amount全都逐位吻合。

未知微差来自上游精度、统计时点或修订；没有旧raw，不归因于某个原因。Python float64能精确表示本例十亿级整数，没有证据表明当前float cast直接造成7/8差异。未新增容差或舍入规则。

## 15. 2026-10-02 Comparison

| 字段 | 当前Eastmoney | 冻结Yahoo Candidate | HKEX当日报 |
| --- | --- | --- | --- |
| date | NOT_AVAILABLE | 2026-10-02 | 2026-10-02 |
| open | NOT_AVAILABLE | 31.719999 | 此日报quotation表该列是ASK，不误作open |
| high | NOT_AVAILABLE | 31.799999 | 31.80 |
| low | NOT_AVAILABLE | 30.920000 | 30.92 |
| close | NOT_AVAILABLE | 31.700001 | 31.70 |
| volume | **NOT_AVAILABLE** | **26,147,630** | **26,147,630 shares** |
| amount | **NOT_AVAILABLE** | None | **821,836,431 HKD** |

旧EM子集无10/2行；本轮请求未收到payload，不能用HKEX或Yahoo值填入EM字段。10/2官方材料复用前置raw及SHA `439972108d7229b5d82519d4916fbd72e8b95c15a80ad7094441b27353494f57`。[HKEX 10/2](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261002e.htm)

## 16. HKEX Comparison

此处明确是 **项目保存的历史EM** vs **本轮获取的HKEX官方日报**，不是当前EM raw。

| 日期 | EM volume | HKEX shares | 差 | EM amount | HKEX HKD turnover | EM−HKEX |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-18 | 32,589,835 | 32,589,835 | 0 | 1,112,504,768 | 1,112,504,760 | +8 |
| 2026-09-21 | 25,275,000 | 25,275,000 | 0 | 863,337,696 | 863,337,689 | +7 |
| 2026-09-22 | 37,165,464 | 37,165,464 | 0 | 1,266,902,464 | 1,266,902,464 | 0 |

EM观察时间分别9/28 08:30:15Z、9/29 08:30:25Z、10/1 15:10:43Z。HKEX在10/4 15:06—15:07Z读取；时间截面差异已保留。

官方来源：[9/18](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d260918e.htm)、[9/21](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d260921e.htm)、[9/22](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d260922e.htm)。各保存HTML quotation段2899在第4109—4110行，表头明确SHARES TRADED/TURNOVER；同文件后面另有options exercised行，未将其混入股票日成交量。具体SHA/URL/行号/差值在 `hkex-comparison.json`。

## 17. Price Comparison

52根现存EM与冻结Yahoo逐日OHLC对照保存 `eastmoney-yahoo-price-comparison.json`。这是不同观察时点的保存值，不宣称当前两家完整历史同步快照。

| 日期/证据 | Eastmoney close | Yahoo候选close | Yahoo/EM | 解释边界 |
| --- | ---: | ---: | ---: | --- |
| 7/3，EM在7/13抓取 | 30.720000 | 30.275126 | 0.985518424 | 旧EM尚未刷新7/23分红 |
| 7/15，EM在7/23抓取 | 29.716000 | 29.762657 | 1.001570097 | EM减0.484与Yahoo比例法不同 |
| 7/16，EM在7/26抓取 | 30.376000 | 30.413099 | 1.001221326 | 同上 |
| 7/22，EM在7/30抓取 | 32.936000 | 32.936024 | 1.000000729 | 除息前一天close可非常接近，不等于所有OHLC算法一致 |
| 9/22 | 34.020000 | 34.020000 | 1 | 无该分红前价格调整差；OHLC仍可能有浮点末位差 |

7/15 的EM OHLC为30.816/30.916/29.516/29.716，Yahoo为30.846726/30.945278/29.565553/29.762657。7/22的close接近，但high EM33.496 vs Yahoo33.487915。不能只用某一close吻合宣布两家adjustment等价。

分别判定：PRICE：历史QFQ有效果、当前完整窗口未验证；VOLUME：多日官方吻合，单位强证据；AMOUNT：有字段、单位强证据、存在小额差异。未据此裁定哪家价格“正确”。

## 18. Stability Evidence

读取54份market_update日志（2026-07-13—10-02）。其中29份混有UTF-16样式NUL交错；只在临时解析中消除ASCII字段间NUL，未修改日志。修正后统计全部可识别provider成功结果行：

| 范围 | Eastmoney被选为成功provider | Yahoo被选为成功provider |
| --- | ---: | ---: |
| 全项目可识别symbol结果行 | 790 | 243 |
| 4个HK合计 | 156 | 48 |
| 2899 / 1810 / 1357 / 2513，每个 | 39 | 12 |

这些是**每symbol最终成功结果行数**，不是独立网络尝试数或独立交易日数。ProviderChain吞入前一来源的异常并返回最终provider，主日志没有完整attempt ledger，因此不能从39/(39+12)宣称服务可靠成功率。

55份备份的marketDataFreshness.provider_errors中，按(symbol,fetched_at,error文本)去重观察到 **36条 Eastmoney connection_error**，分布在2899/1810/1357各12条；该备份结构未覆盖2513的完整registry历史。备份中还保留2026-07-12观察值，早于日志窗口。未观察到该集合明确timeout/parse记录，不代表从未发生。

前置证据另有Rebase完整窗口 **timeout**、上次单位审计 **ConnectionError**。本轮新增2个ConnectionError。不同集合可能覆盖同一次事件，不相加计算总失败率。

Yahoo只有已有证据：上表成功记录、426根候选、前置两次raw读取成功；无本轮新增Yahoo请求。没有完整Yahoo请求失败账本，不能报0失败或声称长期更稳定。

因此历史有反复成功和fallback，当前连续失败，长期稳定性 **UNCERTAIN**；无法证明只有2899问题，也未证明全HK/全球端点停服。

## 19. Rebase Capability

**REBASE_CAPABILITY_UNCONFIRMED**。当前没有完整426根EM响应，没有生成正式Eastmoney Candidate的条件。现有52/64日增量残留不是完整请求能力证明；官方客户端传很大lmt也不是服务端承诺。

需要未来取得同一明确as-of窗口下完整且无缺口的日线、校验首尾/日期集合/完整日/单位/adjustment，再讨论是否REBASE_CAPABLE。未获成功响应时不标NOT_REBASE_CAPABLE。

## 20. Revision Probe Capability

**UNCONFIRMED / 当前不宜启用**。full retained-history probe需要可靠完整历史、响应大小/延迟测量和同源快照证据。本轮2.32秒是失败延迟，不能当成功性能；没有payload，大小UNKNOWN。

历史mutable已经得到支持，故未来必须考虑revision检测，但“需要检测”不等于“这个接口已证明适合每次full probe”。未改Engine或执行频率。

## 21. Incremental Capability

**HISTORICALLY_SUPPORTED；CURRENT_OPERATION_UNCONFIRMED。** 多次成功日志、保存日线和HKEX对照证明原增量用途曾可用；本轮实际Worker环境不可用。不能保证下一次更新成功，也不能以fallback成功掩盖selected-provider失败。

ProviderChain历史EM优先具有可解释性：大量既有成功记录、含amount。但现有排序不是canonical批准；对于要求来源连续性的正式历史，不能仅凭自动fallback顺序选择另一提供商混写。Worker当前guard与未来受评审选源规则应分别处理；本轮不改变任何顺序、timeout、retry或guard。

手动同步与Worker共用PC adapter；手动主入口调用updater、默认ProviderChain，Worker另带validation/source guard。其共同网络失败风险存在，但任务执行/写入安全边界不同，未启动任一入口。

## 22. Provider Registry Recommendation

仅建议的能力记录；unknown不能强行转true，不写registry：

```json
{
  "providerId": "eastmoney",
  "marketSupport": ["HK"],
  "dailyHistorySupport": "historically_supported_current_unconfirmed",
  "qfqSupport": "parameter_confirmed_historical_effect_supported_live_pair_unverified",
  "priceBasisSupport": ["adjusted_historical_evidence", "raw_parameter_only_unverified"],
  "volumeUnit": {"value": "shares", "scale": 1, "evidenceLevel": "STRONG_EVIDENCE"},
  "amountSupport": {"historicallyAvailable": true, "currency": "HKD", "scale": 1, "evidenceLevel": "STRONG_EVIDENCE"},
  "adjustedHistoryMutable": {"value": true, "evidenceLevel": "STRONG_EVIDENCE", "scope": "2899 archived complete bars around 2026-07-23"},
  "revisionProbeSupported": "unconfirmed",
  "rebaseSupported": "unconfirmed",
  "incrementalSupported": "historically_supported_current_unconfirmed",
  "stabilityStatus": "UNAVAILABLE_THIS_RUN"
}
```

单位契约仍CONTRACT_NOT_EXPLICIT。港股能力记录不直接改变现有CN配置，不忽略金额微差或股票alias边界。

## 23. Yahoo Comparison

| 能力 | Yahoo 2899.HK | Eastmoney 2899.HK |
| --- | --- | --- |
| Historical coverage | 已冻结426根，2025-01-09—2026-10-02 | 当前完整窗口未验证；正式残留52根 |
| QFQ | 实现AdjClose/Close×OHLC；前置证据充分 | fqt=1官方客户端确认；历史效果强证据；本轮raw/qfq对照未完成 |
| Price unit | HKD确认，HKD/share强证据 | HKD/share强证据 |
| Volume unit | shares强证据，端点契约不明确 | shares强证据，3日HKEX exact，端点契约不明确 |
| Amount | 所用chart无日成交额，None | f57历史有值，HKD强证据，3日两项微差 |
| Corporate-action revision | 比例缩放有强解释，历史mutable | 本组5个完整日减0.484，历史mutable |
| HKEX volume agreement | 10/2 current history与官方exact | 9/18、9/21、9/22保存值与官方exact；10/2NA |
| Reliability | 既有成功及候选/raw证据；长期成功率未知 | 既有大量成功+失败记录；本轮2次断连 |
| Rebase support | 已有426根方案，但未批准Apply | REBASE_CAPABILITY_UNCONFIRMED |
| Revision probe support | 既有完整读取证据；长期可靠性未证明 | UNCONFIRMED |
| Incremental support | 既有成功，仍受revision/source guard约束 | 历史支持；当前不可用 |
| Known anomalies | meta/history差8000、amount缺失、单位契约/修订问题 | previous timeout/ConnectionError、当前RemoteDisconnected、amount微差、调整算法不同、alias文本差异 |

本轮没有删除Yahoo优势、也没有因为Eastmoney失败就自动选择Yahoo。

## 24. Canonical Suitability

Eastmoney：**有历史适用证据，当前无法完成候选适用性验收**。不是HK_CAPABILITY_INSUFFICIENT，也不是SUPPORTED_AND_STABLE_ENOUGH。不能生成正式EM candidate；不足以进入最终Yahoo vs Eastmoney provider review。

缺口：当前可达性及可复现实测原因、完整retained-window返回、当前raw/qfq配对、必要参数/默认条数、明确HK单位契约与金额精度、具有足够观察跨度的稳定性。由于两家qfq算法表现不同，未来必须选择明确的adjustment方法和版本，不能只比较provider名字。

Canonical仍 **UNDECIDED**。既有 UNIT_CONTRACT_INCOMPLETE / VOLUME_DIFFERENCE_UNEXPLAINED guard 均保留；本轮没有解决Yahoo 8000的真实成因。

## 25. Other HK Symbols

当前23个风险标的中的HK：**2899.HK、1810.HK、1357.HK、2513.HK**，另外19个是A股。

本轮网络仅2899和1810；1357/2513只读既有日志与symbol映射，没有扫描。可复用：同一adapter/endpoint/market116、官方fqt参数语义、历史可变风险、网络阶段诊断方法。不可直接复用：2899的2000股lot、个股公司行动算法细节、全历史覆盖、每个标的单位confirmed标志及amount精度结论。

HK f56股数旁证不得直接推广到A股；A股尺度和市场规则需独立核验。

## 26. Data Integrity

开始/结束两次复核 **93个保护文件**及两份SQLite只读store，全部未变化。正式2899 bars hash重新解析规范JSON计算，未只依赖上次报告。源码git旧版本对比也未变更。

| 对象 | hash / 值（前后相同） |
| --- | --- |
| official 2899 bars | `2ed0c9b77506fe1eb190b47ca46138a7a2990cb2c43d50c083ab88c31055d906` |
| official bridge file | `5ac635d1a9aad099b7738ad5555af1e3103a16aae6ffd76df869a37f192b0c76` |
| Yahoo revision candidateHash | `f4f1f0a88eb42f0a124d747b4a3bf7eead6830e5dab9b7615cbf1b542eb834cb` |
| technicalVersion | `846ba5d57b1fe8c677f357d5e17b4b20e4a91e52f475397b337d3fbf0646f06e` |
| 原store approvals / active | 0 / 0 |
| revision store approvals / active | 0 / 0 |

原store objects/events=3/2；revision store=4/15，均不变。所有SHA、metadata见本轮 `integrity-before.json`、`integrity-after.json`、`artifact-manifest.json`；数据样本、probe记录、公开客户端证据、历史revision证据均在临时目录。

只新增本文和临时分析脚本/资料；**无产品代码或正式数据修改，无新commit，无正式candidate，无push/deploy**。未修改provider timeout/retry/parser/normalization/Engine/source contract/production/technical snapshot/freshness/Discussion/holding/Plan/orders。未访问凭据；launcher仅核对非敏感运行配置，未运行生产Worker。

## 27. Recommended Next Task

唯一后续建议：**EASTMONEY_HK_CONNECTIVITY_FIX_V1**，但必须以前置的断连根因诊断与可修复性确认开始。

严格限定这项建议的含义：**目前尚未确认可修复根因，因此用户列出的B项“确定存在可修复问题”门槛尚未满足，不能把本报告作为已经确认adapter bug或已授权修复的依据。** 四个给定后续任务中，A缺完整能力证据、C缺网络成功、D缺EM不适合的充分证据；本报告只将B列作待确认的后续方向，不推荐立即修改代码。

该后续任务应先区分服务端/中间链路/原请求兼容性，保留原实现作对照，控制请求数量；只有形成可重复、可修复的具体证据后才提出最小修复。不得因公开客户端的参数差别直接补参数、加重试，或以换代理/主机绕过访问限制。当前任务不执行修复。

## 28. Final Classification

- Provider primary：**E / UNAVAILABLE_THIS_RUN**。
- 历史支持证据：日线和增量曾可用，港股整体能力并未被否定。
- Rebase：**REBASE_CAPABILITY_UNCONFIRMED**。
- Revision probe：**UNCONFIRMED**。
- Incremental：**HISTORICALLY_SUPPORTED / CURRENT_OPERATION_UNCONFIRMED**。
- 正式Eastmoney candidate条件：**未满足**。
- 最终provider review条件：**未满足**。
- Canonical：**UNDECIDED**。
- Pilot：**APPLY_BLOCKED**。
- 最终状态：**EASTMONEY_HK_AUDIT_INCOMPLETE_CONNECTIVITY_BLOCKED**。

本轮历史和官方对照取得了实质证据，但决定当前完整history能力的在线门禁仍被连接问题阻塞；不标记审计已具备provider选择条件。
