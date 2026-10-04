# EASTMONEY_HK_CONNECTIVITY_FIX_V1

调查日期：2026-10-04（下表北京时间 UTC+8）。

**结论：REMOTE_OR_NETWORK_LEVEL；未证明可修复的客户端根因，不修改产品代码。**

当前实际 Provider、Python 最小请求、curl、PowerShell/.NET 均复现：TCP/TLS 成功后，在收到 HTTP 状态码前连接结束。浏览器对照因工具请求头策略加载失败未执行，不计为失败样本。当前证据不能区分 Eastmoney 源站、边缘节点、出口策略或链路中间设备，不能宣布“Eastmoney 封禁”“VPN 导致”或“Python 3.14 不兼容”。

Pilot 保持 `APPLY_BLOCKED`；canonical provider 保持 `UNDECIDED`。连接未恢复，未具备补齐实时 capability 缺失项或进入 Provider Review 的条件。

## 1. 范围与执行环境

- 沿用 worktree：`C:\Users\kakal\.codex\worktrees\auth-password-recovery-v1\investment-workbench-mobile`；HEAD `4d0cdbee7fa730a79cde533adc69dba168fa8e4e`。此前未提交产品修改全部保留，本轮未修改这些文件。
- 实际 PC source：`E:\users\kaka\onedrive\文档\投资分析程序`。
- Worker launcher 的非敏感配置指向 `C:\Python314\python.exe` 和上述 sourceRoot；本轮直接导入该目录的 EastMoneyDailyProvider，未启动生产 Worker、未创建任务、未调用会写正式数据的 updater。
- 探测在该 Windows 主机通过同一 Python 运行，网络调用在获授权的本机执行通道完成；并非其他容器/云端的成功替代。未读取 Worker 凭据。
- 新文件仅本报告、`.rebase/eastmoney_connectivity.py`、`.rebase/eastmoney_client_matrix.py`、`.rebase/eastmoney_powershell_probe.ps1` 及 `.rebase/eastmoney-connectivity/` 诊断证据。
- 未改系统 DNS、代理、VPN、防火墙、TLS 校验；未安装依赖、未换 host、未固定 IP、未发送 cookie/登录身份。
- 无产品修复、无 commit、无 push、无 deploy、无 Approve/Apply、无生产数据库调用。

## 2. 有限客户端矩阵

同一 endpoint：`https://push2his.eastmoney.com/api/qt/stock/kline/get`。

核心参数：`klt=101`、`fqt=1`；`fields1=f1,f2,f3,f4,f5,f6`；`fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`。
2899 完整窗口：`secid=116.02899, beg=20250109, end=20261002`；1810 短窗口：`secid=116.01810, beg=20260901, end=20261002`。

| 本轮调用 | 北京时间开始 | 目标/实际 IPv4 | TCP/TLS | HTTP / 结果 | 总耗时 |
|---|---|---|---|---|---|
| A1 实际 Provider / Requests | 23:27:16.813 | 2899 full / 103.220.167.80 | 成功 / TLS 1.3 | 无状态码；ConnectionError → ProtocolError → RemoteDisconnected | 2.286s |
| A2 实际 Provider / Requests | 23:28:41.549 | 1810 short / 117.184.40.129 | 成功 / TLS 1.3 | 无状态码；相同异常链 | 1.148s |
| B 最小 urllib.request | 23:32:12.874 | 2899 full / 117.184.40.129 | 成功 / TLS 1.3 | 无状态码；RemoteDisconnected | 0.156s |
| C curl / Schannel | 23:33:14.930 | 2899 full / 117.184.40.129 | 成功 / 校验通过 | 请求已发出；HTTP 000（未收到状态）；exit 56，missing close_notify | 0.847s（curl 内部 0.825s） |
| D PowerShell / .NET | 23:34:37.433 | 2899 full / 61.129.129.199 | 成功 / TLS 1.3 | 无状态码；HttpRequestException → HttpIOException(ResponseEnded) | 0.875s |
| E 浏览器 | 未发送请求 | 未知 | 未测 | 工具无法加载 browser request-header policy；不作为网络失败证据 | — |

A/B/C/D 无行情正文。A/B 未进入 JSON 解析；没有 parse、volume、QFQ 或数据验证失败可以解释本次断开。

**探测计数限制：** 应用级调用共 5 次（A 两次，其余各一次），调用间隔均至少 60 秒；没有应用级重试循环。一次 PowerShell 脚本在间隔门禁处停止，未发请求，随后满足间隔后才执行。

但 D 的事件证据明确显示：虽然 `-MaximumRetryCount 0`，.NET 底层在这一次 Invoke-WebRequest 内部建立了 **4 条连接、发送了 4 次请求头**，每次 TLS 成功后关闭；这是本轮探测纪律的实现限制，不能声称线上的请求总数只有 5 次。A1/A2/B/C 各一次，加上 D 的四次，至少观察到 8 次 HTTP 请求发送。发现后立即停止全部网络探测，未再补发 D、浏览器或 IPv6 对照。未来诊断应先验证客户端内部重试行为。

## 3. Python 客户端与 headers

实际 runtime：Python 3.14.0，Requests 2.34.2，urllib3 2.7.0，OpenSSL 3.0.18（30 Sep 2025）。

代码：PC `src/market_data/provider.py:57-86`，构造持久 `requests.Session()`；timeout=15 秒；默认 verify=True、trust_env=True；连接池 connections=10 / maxsize=10；Retry(total=0, connect=None, read=False, redirect=None, status=None)。默认 HTTP/1.1。

实际 Provider headers：

| Header | 值 |
|---|---|
| User-Agent | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 |
| Accept | application/json,text/plain,*/* |
| Accept-Encoding | gzip, deflate, zstd |
| Connection | keep-alive |
| Referer | https://quote.eastmoney.com/ |
| Host | push2his.eastmoney.com（由 URL 生成） |

最小 urllib：同核心 query，默认 `Python-urllib/3.14`、`Accept-Encoding: identity`、`Connection: close`、无 Referer。仍失败。因此本轮不支持只增加 Referer、更换 UA、禁用压缩或脱离 Session 就能恢复的结论。没有成功样本，不开展大量 header 组合试验。

curl：8.21.0 / libcurl 8.21.0 / Schannel / zlib 1.3.2；构建未列 HTTP2。使用 `-q` 忽略 curlrc、HTTP/1.1、connect timeout15、总 timeout25、retry0，不使用 cookie/凭据。原生 User-Agent 为 curl；不添加 Provider Referer。没有取得响应头。

PowerShell：7.6.5，.NET 10.0.11；Invoke-WebRequest 原生请求特征，HTTP/1.1、timeout15、maximumRetryCount0、maximumRedirection0、默认 TLS 校验；未使用持久 WebSession。内部重连已单列，不能当作连接复用对照。

## 4. DNS、IPv4/IPv6、TLS 与连接池

- DNS 快照 CNAME：`push2his.eastmoney.com → push2hisipv6.trafficmanager.cn`。
- 快照 A：117.184.40.129；AAAA：2409:8c1e:5b70:2:5000:1000:0:150。不同时间自然解析命中过 103.220.167.80、117.184.40.129、61.129.129.199；本轮未做 IP 轮换或 host pinning。
- Requests/urllib 实际 AF_INET。curl 尝试 AAAA 时立即 `Bad access`，随后自然转 IPv4 并完成 TLS；没有追加强制 IPv6 探测。IPv6 路径未可用与 IPv4 TLS 后断开是两个不同观察，不能据此标为“某 IP 族成功”的 IP_STACK_DIFFERENCE。
- .NET 事件中的 `::ffff:61.129.129.199` 为 IPv4-mapped 地址，不能误记为原生 IPv6 成功。
- Python TLS：TLSv1.3，TLS_AES_256_GCM_SHA384。证书 CN/SAN `*.eastmoney.com`，East Money Information Co., Ltd.，issuer GeoTrust G2 TLS CN RSA4096 SHA256 2022 CA1 / DigiCert，有效期 2026-07-22 至 2027-02-05；验证未关闭。
- curl 的 ALPN 接受 http/1.1，ssl_verify_result=0，time_appconnect≈0.788s，Request completely sent off，随后 Schannel 提示协商事件及 `server closed abruptly (missing close_notify)`；没有 HTTP status / body。
- .NET HandshakeStop protocol=12288（Tls13），ConnectionEstablished HTTP1.1，RequestHeadersStop 后关闭连接；不存在可见的服务端 HTTP 错误响应。
- 所有 A/B 都是新 Session/新连接的第一次请求即失败；curl num_connects=1。已经说明失败并非“只发生在复用后的旧连接”。因首次请求从未成功，无法建立成功连接再做干净的 reuse 对照，未伪称完成该对照。
- 错误发生在 0.156–2.286 秒量级，而 timeout=15 秒；延长 timeout 没有对应证据。没有引入 HTTP/2 栈或增加 retry。

## 5. 代理与网络环境

HTTP_PROXY、HTTPS_PROXY、ALL_PROXY、NO_PROXY 均未配置；Requests 实际 proxies 为空。WinINET ProxyEnable=0，未配置 AutoConfigURL；WinHTTP 为 direct。

同时发现 Cisco AnyConnect Secure Mobility Client Virtual Miniport Adapter（以太网3）状态 Up；WLAN、WSL/Hyper-V 及部分 WAN miniport 也为 Up。

**无显式 HTTP 代理不等于没有 VPN/路由影响。** 本轮没有出口路由对照或抓包证据，不能认定请求经 AnyConnect，也不能认定该组件造成断开。未关闭 VPN/安全软件、未切换网络或修改任何接口配置。暂时只能把当前出口/链路与远端可用性列为待区分原因。

## 6. Endpoint 与历史成功版本

沿用前置审计已保存的 Eastmoney 官方静态代码证据：

- [官方 K 线组件](https://quote.eastmoney.com/newstatic/libs/quotekchart/1.0.6.old.js)，SHA-256 `01b5ad831596aa93fa07fb58e23a2de95648418390d1ed2ef4af881f51ed7693`。
- [官方 fullscreen 代码](https://quote.eastmoney.com/newstatic/build/fullscreen_full.js)，SHA-256 `02d0228e1d13bb76251d51f863395b81f7739f0c4e1315fce519d720836bf00a`。
- 同一 HTTPS host/path；daily=101，Bfq=0 / Qfq=1 / Hfq=2，fields 与当前 adapter 一致。官方默认窗口/limit、JSONP 参数与 Provider 不完全相同；这只能证明 endpoint/字段仍出现在官方代码，不能证明当前服务实时可用或所有请求参数均等效。
- 官方代码含 HTTP 数字子域分支；本轮仅记录，没有切换或降级 HTTP。

最近找到的港股 Eastmoney selected 日志：PC `data/logs/market_data/market_update_20261001_231023.log`，开始于 2026-10-01T23:10:23.8229263+08:00；第27行 2899.HK 使用 Eastmoney，projected=2026-09-30；1810/1357/2513 同样成功选择 Eastmoney。

当前 provider.py / symbols.py / requirements.txt 与其最后提交 `040136d05ef9f64ba422c8c2452c3cb07d2764c8`（2026-07-13）无工作区差异；endpoint、显式 headers、timeout 与 query 构造没有已发现的近期代码变化。历史日志未逐次记录工作区 hash，不能把当前 git 一致性扩大为每次历史请求的精确源码证明。

2026-07-13 的手动日志明确写 `C:\Python314\python.exe`。最新成功日志只写 universe-aware DailyMarketUpdate，并未记录完整 Python/Requests/urllib3 版本、实际 DNS/IP、路由或协商信息。requirements.txt 的 requests 未锁版本；无法证明成功至失败期间依赖是否升级，也不能据此做版本降级。历史 Python 可执行路径提供 3.14 系列线索，但不是历史精确 patch 版本证明。

前置审计的四港股各39次 Eastmoney selected /12次 Yahoo selected 继续有效；这些是最终选择结果，不是完整尝试账本，不能计算成功率。

## 7. Worker、手动流程与错误分类

- Workbench `scripts/market_data_worker.py:67` 调用 `load_source_updater(source_root)`；`scripts/update_market_universe.py:354` 加载 PC `src.market_data.updater`，默认 ProviderChain 仍来自同一 PC adapter。
- 原 PC `scripts/run_daily_market_update.ps1` 和 workbench `scripts/run_daily_market_update_with_universe.ps1:60` 都通过 Get-Command python 解析 Python；当前解析为 C:\Python314\python.exe，与 launcher 一致。未运行完整更新脚本。
- ProviderChain 在 `provider.py:137` 把异常文本收集到 fallback errors，Requests 外层 ConnectionError 内仍包含 ProtocolError / RemoteDisconnected；可诊断，但不是结构化故障分类。Worker 对外归入安全的 provider_or_pipeline_failure。
- 今后可独立增加 dns/tls/remote_disconnect/timeout/http_error 诊断分类；本轮未把这项可观测性改进伪装成连接修复。
- 不变更跨 provider continuity guard。即使 Yahoo 可用也不准静默混入 Eastmoney 历史；两家的 qfq 修订算法不等价。

## 8. 假设判定与未完成能力项

| 假设 | 本轮判断 |
|---|---|
| Python/Requests 独有问题 | 不支持；stdlib、Schannel、.NET 均失败 |
| 只有 Provider headers、Referer 或编码造成 | 未证明；最小请求同样断开，无成功控制组 |
| 仅 connection reuse 问题 | 不支持；fresh first request 已失败 |
| TLS 证书不兼容 | 不支持；Python/系统栈均成功校验并发送 HTTP 请求 |
| 需要更长 timeout | 不支持；迅速断开并非超时 |
| 单一股票/完整窗口太长 | 不支持；1810短窗口同样失败 |
| endpoint 已迁移 | 无足够证据；官方静态代码仍引用相同 HTTPS endpoint |
| 不同自然 DNS 节点 | 多个 IPv4 均失败，但没有同时间固定节点控制组 |
| 远端/网络层原因 | 所测客户端一致支持该定位层级，具体责任方未确定 |
| 自然恢复/INTERMITTENT_PROVIDER_AVAILABILITY | 本轮没有成功样本，不标记为已恢复 |

本轮没有可用行情数据，故 firstDate/lastDate/barCount、2025-01-09 至2026-10-02覆盖、raw/qfq实时对照、10月2日 Eastmoney volume/amount 均未补证。沿用已有历史单位强证据，不重新展开单位审计，不改变其未完成项。未生成 candidate/technical result。

## 9. 测试与保护验证

已运行实际 PC 现有 provider/updater 测试：

`C:\Python314\python.exe -B -m unittest discover -s tests -p test_market_data.py -v`

**13/13 PASS，0.048s。** 测试用 StaticProvider / 临时目录验证映射、fallback、完整K线、合并和临时文件行为；这不表示真实 Eastmoney 请求成功。无产品修改，未重复无关前端/全量发布测试。

结束后 `eastmoney_connectivity.py verify`：**unchanged=true；93个保护文件零变化**，两份只读 store 与 baseline 完全一致（亦比较其文件 hash）。

| 保护对象 | 前后结果 |
|---|---|
| official bridge 全文件 SHA-256 | `5ac635d1a9aad099b7738ad5555af1e3103a16aae6ffd76df869a37f192b0c76` 不变 |
| official 2899 bars canonical JSON SHA-256 | `2ed0c9b77506fe1eb190b47ca46138a7a2990cb2c43d50c083ab88c31055d906` 不变 |
| candidateHash | `f4f1f0a88eb42f0a124d747b4a3bf7eead6830e5dab9b7615cbf1b542eb834cb` 不变 |
| candidate technicalVersion | `846ba5d57b1fe8c677f357d5e17b4b20e4a91e52f475397b337d3fbf0646f06e` 不变 |
| pilot-2899.sqlite | objects3 / events2 / approvals0 / active0，不变 |
| revision-engine-pilot.sqlite | objects4 / events15 / approvals0 / active0，不变 |
| Revision Engine / Worker / freshness / Discussion 等保护代码 | 不变 |

没有访问生产数据库/真实持仓/Plan/orders 的写入口；本轮不声称做过生产表逐行比对。

## 10. 证据索引与后续建议

当前证据目录 `.rebase/eastmoney-connectivity/`：

- `probe-1.json` / `probe-2.json`：实际 Provider 参数、环境与阶段。
- `minimal-python.json` / `curl.json` / `powershell.json`：客户端对照；curl transportTrace 和 .NET transportEvents 保留发送/断开证据。
- `network-environment.json`：DNS、接口、代理存在性。
- `integrity-before.json` / `integrity-after.json`：93文件 + store前后核验。
- `diagnosis-summary.json`、`evidence-manifest.json`：分类和证据 hash 索引。
- 前置 `.rebase/eastmoney-hk-audit/official-client-evidence.json`、`log-hk-success-observations.json`、`log-statistics.json`：官方代码与历史成功证据。

建议保持当前代码与保护门禁，先由网络环境负责人只读复核实际出口路由、VPN策略或边缘断开记录；不要默认关闭安全软件。后续经单独安排低频复测，若自然恢复，须用原 adapter验证2899完整窗口和1810短窗口，再补关键能力项；不能宣称代码修复成功。若长期不可用，可另行讨论 provider availability policy，但仍不允许跨 provider直接merge。

最终状态：**REMOTE_OR_NETWORK_LEVEL / ROOT_CAUSE_UNPROVEN / NO_PRODUCT_FIX**。

前置 capability 状态仍为 **EASTMONEY_HK_AUDIT_INCOMPLETE_CONNECTIVITY_BLOCKED**；**APPLY_BLOCKED / UNDECIDED** 不变。
