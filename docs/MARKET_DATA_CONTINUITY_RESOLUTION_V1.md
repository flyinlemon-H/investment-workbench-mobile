# MARKET_DATA_CONTINUITY_RESOLUTION_V1

日期：2026-10-05，北京时间。范围：Network Path → 受控复测 → Provider 证据收口 → 2899 Pilot 决策 → 实施就绪盘点。

## 决策

**2899.HK 可以进入 Provider 选择确认，并继续准备 Rebase Pilot；现在不能 Approve / Apply。**

- 推荐：**YAHOO_RECOMMENDED_FOR_PILOT**（对应 provider recommendation：YAHOO_RECOMMENDED）。
- 下一业务状态：**PILOT_READY_FOR_PROVIDER_CONFIRMATION**。
- Eastmoney：**EXTERNAL_AVAILABILITY_UNRESOLVED**；选择 **STOP_EASTMONEY_INVESTIGATION_FOR_PILOT**。
- 真实 candidate/store：仍 **APPLY_BLOCKED**、approvals=0、active=0；canonical provider 仍 UNDECIDED，等待用户确认。
- 唯一下一动作：**用户确认 Yahoo 作为 2899.HK Pilot 的目标 canonical provider**。这一步不批准任何 candidate hash、不授权安装/部署或真实 Apply。

推荐理由是 Yahoo 的全保留窗口、复权解释、原始字段回放及交易所成交量对照已足够支撑这一有限决策，同时 Eastmoney 实时能力尚未闭合；不是因为 Yahoo 旧 bars 更多，也不永久淘汰 Eastmoney。没有必要先解释远端断开的全部机理才进行选源确认。

已收到附件止于第54节“修改technical”。本文覆盖可见要求；没有假定附件之外的写入授权。本轮未改产品代码、既有 policy 文件、candidate 或生产配置。

## PHASE A：Windows 网络路径

完整只读快照：`.rebase/continuity-resolution/network-path.json`，2026-10-05 00:38:19 北京时间；实际请求后再次保存目标路由。未修改系统配置。

| 目标 | 匹配路由 | 接口/源地址 | 网关 | route / interface metric |
|---|---|---|---|---|
| 117.184.40.129（本轮两次实际连接） | 117.128.0.0/10 | WLAN，ifIndex20，192.168.1.7 | 192.168.1.1 | 0 / 45 |
| 61.129.129.199（DNS快照/前轮连接） | 61.128.0.0/10 | WLAN，ifIndex20，192.168.1.7 | 192.168.1.1 | 0 / 45 |
| 103.220.167.80（前轮连接地址，本轮只查路由） | 0.0.0.0/0 | Cisco AnyConnect，以太网3，ifIndex13，10.105.187.168 | 10.105.0.1 | 1 / 1 |
| 240e:e1:9600:209:1000::178（AAAA快照，只查路由） | ::/0 | AnyConnect，ifIndex13，选到 link-local 源地址 | :: | 1 / 25 |

IPv4 默认路由同时存在 AnyConnect（合计metric2）和 WLAN（合计45）；但上述 /10 路由更具体，当前两个目标优先走 WLAN。这是**分流路由迹象**，不能把较低 VPN 默认 metric 当作全部目标经 VPN 的证明。103.220.167.80 在**本轮快照**会走 VPN；不能倒推上轮当时路由完全相同。

IPv6 默认路由还有 WLAN fe80::1（route metric256/interface45）；当前选中的 VPN IPv6 路径不能据此保证可达。前轮 curl 原生 IPv6连接报错，本轮没有再发 IPv6请求。

DNS：A 快照 61.129.129.199，CNAME push2hisipv6.trafficmanager.cn；AAAA 240e:e1:9600:209:1000::178。实际两次 requests 解析/连接 117.184.40.129。自然 DNS 调度变化，没有固定 hosts 或轮换 IP。

DNS服务器：WLAN IPv4=192.168.1.1、IPv6=fe80::1；AnyConnect IPv4=172.31.255.250。该快照列出配置，不声称追踪了 Windows 每次 DNS 查询实际使用的服务器。

代理：HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY均未设置；Requests trust_env=True，实际 proxies为空。WinHTTP direct；WinINET ProxyEnable=0、AutoConfigURL未配置。注册表有停用的 ProxyServer 值存在，本轮未输出内容/凭据，不能把“值存在”说成“代理正在使用”。

**AnyConnect结论：** 路由证明它参与部分目的地址的选择；本轮失败请求的 socket 源地址和选路都指向 WLAN，而非 VPN虚拟接口。未发现这两次 IPv4请求的本地选路错误或 TLS校验错误。因此不能把 AnyConnect Up 认定为故障根因；也不能排除其系统过滤驱动、上游网络或其他中间设备影响。没有抓包/外部网络对照，不归责某个节点。

无需让用户切热点或关闭VPN：即使该对照成功，也不改变“Yahoo证据足以先做Provider确认、Eastmoney可保留为未来备选”的当前决策，其对Pilot的边际价值低。

## PHASE B：受控复测与停止

直接使用实际 Worker 对应的 `C:\Python314\python.exe` 与 PC `src/market_data/provider.py::EastMoneyDailyProvider`。只调用 adapter.fetch_daily，不运行 Worker/updater，不写行情。Requests2.34.2、urllib3 2.7.0、Python3.14.0，15秒timeout、retry0、原headers、TLS校验开启。

| 请求 | 北京时间 | 实际连接 | 实际 socket.connect 次数 | 阶段与结果 | 耗时 |
|---|---|---|---:|---|---:|
| 2899.HK，116.02899，2025-01-09～2026-10-02 | 00:38:50.153 | 192.168.1.7 → 117.184.40.129:443 | 1 | DNS/TCP/TLS成功；HTTP前 RemoteDisconnected | 0.922s |
| 1810.HK，116.01810，2026-09-01～2026-10-02 | 00:39:58.961 | 同上 | 1 | 同上 | 0.565s |

第一请求完成到第二请求开始约67.881秒。合计2次连接，无隐式重连；没有第三标的，没有新curl/PowerShell/浏览器矩阵。均 HTTP/1.1，TLS1.3、TLS_AES_256_GCM_SHA384，证书验证成功，无状态码/正文。

探测时为10月5日凌晨，未到新交易日收盘，本轮 required latest complete bar 沿用10月2日；未修改完整日K规则。

连续失败后停止Connectivity深挖：**EXTERNAL_AVAILABILITY_UNRESOLVED**。这是任务收口分类，不表示证明源站单方面故障或网络全球不可用。本轮没有自然恢复，不标FIXED或INTERMITTENT_AVAILABILITY。

## PHASE C：Eastmoney能力的有限结论

实时成功条件未满足，故不执行成功后的能力补证，不生成 comparison dataset或任何候选。

已成立的历史证据继续有效：

- 116.02899映射；官方K线组件使用同一HTTPS endpoint、daily101/fqt1；历史价格HKD/share、volume=f56 shares scale1、amount=f57 HKD scale1具有STRONG_EVIDENCE。
- 9/18、9/21、9/22成交量分别32589835、25275000、37165464，与HKEX一致；amount相差+8、+7、0港元。
- 五个已完成日OHLC在7/23后统一减约0.484，volume/amount不变；不能与Yahoo比例复权拼接。
- 四个港股历史各39次Eastmoney selected、12次Yahoo selected为选源日志，不是网络请求分母/成功率。

尚未证明：当前2899完整窗口可返回、当前firstDate/lastDate/barCount、10/2 Eastmoney量额、当前full-window revision probe可靠性。它们阻止推荐Eastmoney直接进入本轮Pilot，但**不作为评估Yahoo的无限等待门禁**。

## PHASE D：Yahoo证据收口

本轮全部复用已保存raw/候选/官方文件，不重新请求Yahoo历史、不改变冻结候选。

| 条件 | 本轮裁决 |
|---|---|
| Full retained history | PASS：426条，2025-01-09～2026-10-02，与旧正式426日期完全对应，无oldOnly/newOnly；这不是独立证明整个交易所日历无停牌/缺日 |
| 单一来源/qfq | PASS：全部Yahoo；AdjClose/Close调整OHLC，round6；严格parser缺factor会拒绝 |
| 价格历史修订 | 强支持现金股息再调整：374同源日361变13不变；0.98551845附近observed factor对应7/23每股0.4839736港元股息；保留旧raw缺失限制 |
| HKD价格 | 响应currency=HKD；HKEX报价HKD；本地无FX/lot价格换算 |
| share volume | STRONG_EVIDENCE：固定历史quote字段、scale1、旧新parser回放一致、直接官方多日核对；不是provider正式合同声明 |
| Revision检测 | 已实现全保留窗口、日期/价格/量/额独立差异、版本冲突和禁止自动Apply；离线测试通过 |
| 候选生成 | 实际schema2冻结对象存在，三类hash与重建核验通过 |
| 可持续增量 | 有完整探测、固定provider、revision即暂停的设计与测试；尚未在生产安装验收，不承诺供应商持续可用 |
| Amount | 使用的Yahoo响应不提供；保持null，不用close×volume伪造，依赖amount的功能不得冒称可用 |

### 8000差异的工程裁决

必须分开三个事实：

1. `meta.regularMarketVolume=26155630` 与 `indicators.quote[0].volume=26147630` 是同一保存响应的不同字段。PC旧parser和新严格parser均使用后者；meta.volume不进入canonical bar，也不属于其volume source contract。
2. 旧正式10/2 bar=26155630，候选=26147630，确实存在真实的旧→新canonical数值修订；不能把它仅称为“无关meta差异”。没有旧时点raw，不能证明旧值来自meta或断言四手撤单/迟到交易。
3. 候选/保存historical-K=HKEX官方10/2 **26147630 shares**；raw全426条volume与候选完全一致，旧新parser回放所有OHLCVA差异均为0。旧Yahoo374日期中只有10/2量改变，其他373相同；价格变化与该量变化日期不重合。

本轮额外用**已保存HKEX原始日报**核验Yahoo候选的9/18、9/21、9/22量，也逐日相同。因此Yahoo现有官方量对照为 **4/4日精确一致**，并非只有一个孤立日期。

**裁决：meta差异本身不应成为daily-history永久阻塞项。** 当前历史值有更强的交易所对照，可作为“交易所数值已验证、上游成因未知”的独立字段修订进入人工评审；未知成因作为有边界的残余风险保留，不必无限索取缺失旧raw。但这不是忽略旧bar修订、不是按0.03%容差放行、不是自动清除现有Engine blocker。

### V1 practical unit contract与证据门槛

**工程推荐：不要求所有provider均出具正式文字API单位合同才允许未来人工Apply。** 可以采用统一的 `empirically_validated` 审查路径，但它必须与formal provider contract分列，不把STRONG_EVIDENCE改名confirmed。

该路径对所有symbol按同一规则使用，不能写2899白名单：

- 固定provider/raw field、market、interval、adjustment、currency、scale、parser/normalization版本，证据带时间与原始文件hash。
- 对目标instrument的官方交易所多日同字段对照精确吻合；本轮已有四日。不能只靠两家供应商互相一致，也不能把HK验证自动推广到CN或所有股票。
- parser回放证实无lot/FX/volume价格因子转换；board lot与volume单位分离。
- 对每一个发生volume修订的日期独立验证。值与当前官方记录一致、无额外未核差异、合法非负量、单位/拆股口径未发生未验证改变，才可提交人工复核。
- split、consolidation、instrument类型/上游字段变化或官方对照冲突使此证据失效；未知单位/混合尺度仍硬阻断。不得用百分比容差抹掉差异。
- 批准绑定新source contract、证据profile、candidate/approvalPackage hash；保留旧版本和审计。无自动Approve/Apply，旧AI/Discussion不被重写。

这是一条**明确可实施的通用准入建议**，足以让当前Pilot进入Provider确认；不是已经实施的生产Policy。现有 `revision.py:209` 只接受confirmed，`:227` 无条件阻断changed volume；旧Policy的审批及成交量段要求未解释问题保持blocker。旧代码/政策原文未改，旧候选仍invalid。要采用本裁决，后续需把通用证据规则版本化并测试，而不是手工填confirmed=true或删blocker。

Yahoo建议source语义为HKD/share、historical quote volume/shares/scale1、amount不适用；旧Eastmoney参与比较的单位也必须登记其经验验证证据，不能只补新来源而遗漏旧52根。Eastmoney的amount小额差异不得声称完全精确。

## PHASE E：Canonical-provider比较

| 维度 | Yahoo | Eastmoney |
|---|---|---|
| 1 Full history | 已取得完整单源候选 | 当前未取得全窗 |
| 2 Coverage | 2025-01-09～2026-10-02，426，覆盖全部retained日期 | 历史52根仅为旧系统保留片段，不能当最大能力 |
| 3 QFQ | AdjClose比例调整，parser/raw可回放 | 官方fqt1和历史数据支持 |
| 4 Corporate-action revision | 361日价格变化有股息factor强证据；mutable | 五个完成日减约0.484；mutable且算法不同 |
| 5 Price unit | HKD元数据+官方价位，本地scale1 | HK官方页面/历史价量额关系强支持HKD/share |
| 6 Volume unit | shares经验验证，4日直接HKEX匹配 | shares经验验证，3日HKEX匹配 |
| 7 Amount | 缺失，保持不适用 | 可提供HKD金额；3日误差+8/+7/0 |
| 8 HKEX agreement | 4日volume一致；10/2优于旧值的证据 | 3日volume一致，amount近似/一致 |
| 9 Current availability | 最近保存的10/4多次真实成功；本轮未live重抓，不把过去成功说成当刻可用 | 本轮2次均HTTP前断开 |
| 10 Historical availability | 历史fallback selected；不计算成功率 | 长期多次selected；不能因本轮失败永久淘汰 |
| 11 Incremental suitability | 固定Yahoo+每次全窗口验证；不做跨源merge | 同样需要固定源/全窗口，但当前获取受阻 |
| 12 Revision probe | 实现支持，raw/candidate/fixture可验证 | 实现有接口，实时全窗口尚未验明 |
| 13 Rebase suitability | 足以推荐Pilot目标；仍有实施与审批门禁 | 当前不足以推荐本轮Apply路径 |
| 14 Known anomalies | meta/history8000不一致、旧raw缺失、amount缺失 | availability、当前覆盖未知、qfq与Yahoo不同、amount小差异 |
| 15 Operational reliability | 无SLA/完整尝试统计；失败和revision必须安全暂停 | 当前运维风险更高；不能通过无限重试解决 |
| 16 Auditability | raw/hash/官方样本/可重建候选/版本化Engine | 历史归档与官方客户端证据充分，缺实时full-window样本 |

建议 **YAHOO_RECOMMENDED_FOR_PILOT**；未满足BOTH_VIABLE的当前完整能力证据，不输出“都一样让用户猜”。Eastmoney保留为未来备选，但停止对本Pilot的追加调查。

## PHASE F：冻结候选复核

本轮读取真实store仅用SQLite mode=ro；在内存中按现有构造器重建，不save新对象。

| 项目 | 结果 |
|---|---|
| objectId | ce462705807db20ef7d0cb8292b35907264d4bdc21e9e6f3b7c3aa5cfe952386 |
| candidateHash | f4f1f0a88eb42f0a124d747b4a3bf7eead6830e5dab9b7615cbf1b542eb834cb |
| contentHash | 2638d0a6d4d812ffc145334eafced99f07ded0f7c347373d18b5348ded6e4f80 |
| approvalPackageHash | 6e56ba21452e597234ab15845e18143f69e59e1b5c70b43acafcd5d6e0f5c0dd |
| Hash /重建 | PASS；canonical JSON逐字一致，候选对象hash一致 |
| 当前formal/base | 正式四类事实和bars均与request base一致，无输入漂移 |
| 全窗/价格/量 | 426日覆盖；price股息解释仍成立；volume独立官方证据如上 |
| 技术版本 | 846ba5d57b1fe8c677f357d5e17b4b20e4a91e52f475397b337d3fbf0646f06e，重算核验一致 |
| 状态 | pending_user_review / validationStatus=invalid / applyAllowed=false |

**不能直接复用旧审批包。** 虽然它按旧输入完整且可重建，但其中volume/旧EM单位仍缺失，本轮新官方核对和经验profile未包含在包内。现有providerVersion为 `provider-continuity-rebase-v1:256d5d5875e4c5875cf7367fabf2ed0c278b229a10d61849ece38552dd61e86d`；按当前Worker integration计算的版本为 `provider-source-sha256:f743881566f546ca997195203c5ba3c6db07496923e03a4ad1a6cf2e53189137`，不相同。当前inspect会把这种版本差异作为SOURCE_CONTRACT_MISMATCH，不能把旧fetch版本直接当成可持续Worker基线。

后续正式候选必须从固定目标provider、最终已评审实现版本及新证据profile重新构造，**所有hash重新计算**。新增unit/scale语义及providerVersion会影响contentHash；仅更改证据文字也至少影响approvalPackageHash/candidateHash。不是改旧对象或重用旧批准。若届时已过新交易日/数据更新，重新获取当时所需完整窗口并审阅新差异；不把这份10/2快照永久当最新。

### Technical Preview

| 事实 | 当前冻结预览 |
|---|---|
| MA5/10/20/60/120 | 32.004001 / 32.870001 / 34.207000 / 34.208496 / 33.576579 |
| MACD DIF/DEA/histogram | -0.972472 / -0.648726 / -0.647492 |
| 60日收盘极值支撑/阻力 | 28.9545 / 38.56（算法事实，不是交易建议） |
| 程序关系/交叉/风险事实 | 有，确定性重建一致 |
| volume facts | **unavailable**：旧unit gate仍未接纳，volume/avg20/changePct为null |
| price-action classifier | unavailable/no_versioned_deterministic_classifier；不得补造AI结论 |
| 日期 | latestCompleteBar=technicalAsOf=2026-10-02 |
| AI/Discussion | needs_review；保留历史Discussion，未调用AI |

因此**技术预览尚不完整，不能进入Approval**。本轮仅独立算术核验了经验shares口径的候选量能：latest26147630、avg20=37092819.4、recent5avg=30322667.6、prior5avg=32796346.2、change=-7.54%。存于audit-only文件，不替换technical snapshot或technicalVersion。最终版本须在通用单位profile实现后从同一bars重算完整量能事实；priceActionEvent的unavailable须明确证明消费者可安全处理，不能冒称该classifier已实现。

现有blockers全部保留：UNIT_CONTRACT_INCOMPLETE、VOLUME_DIFFERENCE_UNEXPLAINED、四项OHLC units_unconfirmed、volume_units_unconfirmed、writer_deployment_not_confirmed。
Review items保留calendar_coverage_unconfirmed、四项价格差异、revision_evidence_review、technical_diff_review。全retained覆盖不自动冒充交易所日历验证；最终评审要明确此覆盖定义和缺日处理。

## PHASE G：实施与写入就绪

| 能力 | implemented / tested | 当前提交、安装与生产状态 |
|---|---|---|
| Rebase/Revision core、full-window guard、store/hash/CAS | worktree实现；本轮离线55项最终全部通过 | 目录仍untracked，相关集成修改未提交；未部署 |
| PC companion | 生成器/补丁存在；临时独立包两项测试通过，git apply --check通过 | **现用PC未安装**，禁止把check当install |
| Worker/Manual/Batch integration | worktree调用统一guard | 未交付的本地实现，不宣称生产Worker已使用 |
| Browser/bridge/import guard | worktree实现；前轮JS1228/1228证据 | 本轮只读检查两份公开production JS均没有这些guard |
| 官方Apply后分发 | SQLite权威版本及单JSON投影存在 | 不是SQLite/远端result/浏览器的统一事务；最终明确交付与版本验收尚未完成 |
| 通用经验单位/量修订规则 | 本报告给出决策和准入条件 | **未实现**，不通过改confirmed或删除blocker冒充完成 |

源码worktree HEAD：4d0cdbee7fa730a79cde533adc69dba168fa8e4e，branch codex/provider-continuity-rebase-v1。原工作目录当前HEAD：af84cd0ec7bc27b4128b1e4662549d023a3f3650，未包含这些guard；保留两个目录各自既有未提交改动。

生产只读证据（2026-10-05 00:44，北京时间，HTTP200、Cache-Control:no-cache）：

- `src/state.js` SHA256 `4619aac35b85a0448b167592cb2fff6c81b8b080ae0ea11a925ac05e14464ac0`，没有assertMarketHistoryContinuity定义。
- `src/market-data-task-ui.js` SHA256 `14d033b24c2b9202f680d630047b7a5d7aa4632595802bd1e5a8aca2f83d473e`，没有该guard调用。

只说明本轮读取到的公开资源，不声称审计所有手机缓存/所有部署。没有访问Supabase、Auth或生产数据库。

### Write-path清单与DEPLOYMENT BLOCKER

| 写路径 | worktree保护 | 现用状态/阻塞 |
|---|---|---|
| Worker→PC updater | market_data_worker.py:67 → update_market_universe.py:354 → guarded_updater | 未验证生产Worker已切到该实现；DEPLOYMENT BLOCKER |
| 手动包装与batch | 同一load_source_updater/guard，每symbol隔离 | 原工作目录尚无新guard；DEPLOYMENT BLOCKER |
| PC直接CLI/API/merge | companion使用同一规则 | 现用updater仍直接按日期覆盖，未检provider/revision；**UNSAFE WRITE PATH / DEPLOYMENT BLOCKER** |
| 静态bridge构建/发布 | assertProjection检查全部历史与receipt | worktree未交付，旧发布器能绕过新检查；DEPLOYMENT BLOCKER |
| 手机versioned result | market-data-task-ui.js先检查guard再保存 | 公开生产JS未包含；DEPLOYMENT BLOCKER |
| JSON导入/候选恢复 | import-export.js调用共享guard，普通import禁止改变历史 | 未发布；不能以普通JSON导入交付已批准rebase绕过 |
| CSV legacy import | ui-render.js共享guard | 未发布；DEPLOYMENT BLOCKER |
| Store apply/rollback | 显式审批、哈希重建、generation CAS、事务 | 仅隔离实现，真实active为空 |
| 已批准版本交付 | projection.py只对一个显式JSON目标原子替换 | 需受控端到端交付与旧写入者隔离；不是普通增量入口/任意设备全局版本锁 |

这些是确定的上线前工程门禁，不能因为Provider推荐明确就忽略。后续应在一个有边界的实施验收中完成规则版本化、最终runtime绑定、完整技术重算、写入者交付和新candidate包评审；不再开新一轮无期限Eastmoney调查。任何安装、部署、停用现用写入者和真实Apply都仍需相应授权，本轮未执行。

## 验证、数据保护与证据

本轮候选纯函数hash/重建/正式base绑定/技术hash核验通过。Rebase+Revision离线55测试：初次53通过、2项因缺MARKET_SOURCE_ROOT配置跳过；指定MARKET_SOURCE_ROOT后只补跑两项，2/2通过，合计55/55。LOCALAPPDATA指向临时隔离目录；Apply/rollback仅合成fixture，真实store只读。

前轮Python67/67、JS1228/1228及RPC兼容证据继续作为现有实现测试记录；本轮没有产品修改，不伪称重跑全量。PC companion git apply --check通过但未安装。

结束核验以`.rebase/continuity-resolution/integrity-before.json`与`integrity-after.json`为准：93个保护文件、正式bridge/PC导出、Engine代码、候选与两份store保持不变。原store objects3/events2/approvals0/active0；revision store objects4/events15/approvals0/active0。

本轮交付仅报告和`.rebase/continuity-resolution/`审计材料、两个临时脚本；无新commit、无网络设置修改、无产品代码修复、无生产写入、无新正式candidate、无Approve/Apply/真实Rollback、无技术/freshness/Discussion/holding/Plan/order更新。

证据目录包含network-path、observed-destination-routes、两份probe、candidate-review、volume-facts-audit、online-guard-check、Python/companion测试日志、完整性前后快照和evidence-manifest。正式候选仍冻结在原位置。

官方证据沿用已保存原文并核对hash：[HKEX 10/2日报](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d261002e.htm)、[9/18](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d260918e.htm)、[9/21](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d260921e.htm)、[9/22](https://www.hkex.com.hk/eng/stat/smstat/dayquot/d260922e.htm)、[7/23股息公告](https://www.zijinmining.com/upload/file/2026/07/22/f1c55d0bc3694ba292f77119610ce771.pdf)。不把官方单日数值证明扩大为供应商全市场永久契约。

## 最终状态与唯一下一动作

**YAHOO_RECOMMENDED_FOR_PILOT**

**PILOT_READY_FOR_PROVIDER_CONFIRMATION**

**STOP_EASTMONEY_INVESTIGATION_FOR_PILOT**

唯一下一动作：用户确认“选择 Yahoo 作为 2899.HK Pilot 的目标 canonical provider”。确认后进入有边界的实现/交付和新审批包准备；此确认本身不是批准旧hash、不是部署授权、更不是Apply。真实canonical状态和candidate store仍保持 **UNDECIDED / APPLY_BLOCKED**，直到对应授权及门禁完成。
