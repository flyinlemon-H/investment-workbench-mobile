# PROVIDER_CONTINUITY_REBASE_V1

日期：2026-10-04。状态：**PILOT_READY_FOR_USER_REVIEW**。真实候选的 `validationStatus=invalid`，**APPLY_BLOCKED**；本状态仅表示已有可审阅的隔离候选，不表示候选可批准或生产迁移已准备完毕。

## 实施范围与基线

- 开发分支：`codex/provider-continuity-rebase-v1`。
- 开发基线：`4d0cdbee7fa730a79cde533adc69dba168fa8e4e`；其前置生产版本为 `156d97b42c5bbaffd88d1c361979665d6707313a`。
- 实施位置：`C:/Users/kakal/.codex/worktrees/auth-password-recovery-v1/investment-workbench-mobile`。目录名称沿用既有 worktree，当前修改属于 provider rebase。
- 原工作目录中的 Worker Shortcut、行情桥及既有文档等未提交修改均保留，没有混入本次修改。
- 只对真实 `2899.HK` 生成候选。真实 approve/apply/rollback/deliver 均未执行；601869.SS 仅出现在临时 fixture；未批量迁移 23 个标的。
- 未推送、未发布前端、未启动生产 Worker、未创建远端任务、未执行数据库 migration 或 Auth 变更。当前修改未提交，无新增 commit hash。
- 用户附件在第 49 节 `symbol / candidateId` 处结束；本报告覆盖已收到内容，没有假定未提供的后续要求。

## 工具与版本模型

入口为 `python -B -m scripts.provider_rebase --store <isolated.sqlite> <command>`，提供 generate、review、approve、apply、rollback、active、deliver。Generate 只抓取、校验并存储候选，绝不调用 Apply。

| 文件 | 实现 |
| --- | --- |
| `scripts/provider_rebase/core.py` | 最小 Yahoo/Eastmoney registry、source contract、保留窗口、单位/覆盖/差异检查、技术预览、canonical JSON SHA-256 |
| `scripts/provider_rebase/fetch.py` | 固定 provider 主机、单次有界请求、daily/qfq/adjusted、完整日过滤；不跨源拼补 |
| `scripts/provider_rebase/store.py` | 本地 immutable objects、append-only audit、hash 绑定审批、generation CAS、原子 active pointer 与旧版归档、回滚 |
| `scripts/provider_rebase/integration.py` | Worker/手动更新的 merge 前校验，已应用版本读取，canonical provider 固定，失败保持旧事实 |
| `scripts/provider_rebase/pc_guard.py` / `pc_patch.py` | 现有 PC engine 配套守卫及补丁生成器；生成补丁但不安装 |
| `scripts/provider_rebase/projection.py` | 显式交付一个本地 JSON，检查目标 hash 与 generation，原子替换四类行情/技术事实 |

Registry 保留 rawProviderId / canonicalProviderId，当前 aliases 为空，没有把 Yahoo 与 Eastmoney 当作别名。Contract 同时固定 symbol、provider/实现版本、adjustment、priceBasis、市场、请求/实际区间和单位证据。Provider 变动、复权口径变动、已完成 OHLC 历史修订都不能静默 incremental merge。

SQLite `BEGIN IMMEDIATE` + synchronous FULL 在同一事务中保存新版本、切换 pointer、增加 generation、记录 audit；旧版本不可修改/删除。Apply 要求已存储的明确审批、无 blocker、reviewItems 逐项说明、相同 baseHash 和 expected generation，并重新构建校验 candidateHash。修改候选必须重新审批。重复 Apply 同一个当前候选幂等。

审批口令绑定完整 hash，形式为 `Approve candidate <candidateHash>`；provider 也必须明确确认。本次真实候选有 blocker，不能靠填写审批口令绕过。

Rollback 也需要明确版本口令、reason 和 expected generation。回退到旧 mixed history 时标记 legacy/migration_required，不能假装恢复为可增量的单源历史。新版本与旧版本均保留。

**原子性边界**：以上事务仅覆盖本地 SQLite 权威版本。JSON delivery 是另一个明确操作，不是跨 SQLite、JSON、远端 result store、浏览器的分布式事务。交付前必须停止或升级其他写入者；hash 二次检查不能锁住不合作的外部进程。CLI 不是生产远程管理接口，不替代 RLS/账户授权。

## 2899.HK 真实抓取与推荐

两源各进行一次真实请求；Eastmoney 超时后没有反复重试。修订校验规则后使用已抓取 bars 离线重新构建候选，未重复抓取行情；旧候选对象保留，旧校验版本不得重新审批。

| 项目 | Yahoo | Eastmoney |
| --- | --- | --- |
| 映射 | `2899.HK` | `116.02899` |
| 当前工程 ProviderChain | 已支持 | 已支持 |
| 此次结果 | 成功，426 根完整日 K | `provider_timeout`，无有效候选 |
| 请求范围 | 2025-01-09 至 2026-10-04 | 同左 |
| 实际范围 | 2025-01-09 至 2026-10-02 | 未取得 |
| 复权实现 | adjclose/close 比例调整 OHLC，round6 | 请求 fqt=1；此次无数据可验证 |
| 价格币种证据 | 响应 meta.currency=HKD | 此次未确认 |
| 成交量单位 | 未确认 share/lot/scale | 未确认 |
| 成交额 | 缺失，NOT_COMPARABLE | 此次未取得 |

推荐 `yahoo` **仅供候选审阅**，selected provider 仍待用户确认。依据是此次实际抓取成功、整个保留区间覆盖及现有实现支持；不是旧 Yahoo bars 多。Eastmoney 仍是 alternative。一次成功/超时不是可靠性统计，也不保证未来 incremental 可用。

保留窗口使用原有最早日到指定 end，不以 PC 普通增量抓取的 550 天窗口截断已有历史。候选全部来自此次 Yahoo 请求，没有复制旧 mixed history 的任一片段作为缺口补丁。

## 覆盖、差异与阻塞

- 旧历史：426 根，Yahoo 374 / Eastmoney 52，14 次 provider 切换。
- 候选：426 根，Yahoo 单源；commonDates=426，oldOnlyDates=0，candidateOnlyDates=0。
- 日期相同不等于交易日历验证通过。日期间隔单独列出，周末、休市、停牌尚需日历证据，不直接认定为缺 bar。
- 原 Yahoo 374 根可进行同源价格比较：OHLC 各有 13 根 exact、361 根 different。
- 原 Eastmoney 52 根缺少已确认单位证据，不作跨源 OHLC 数值比较。
- 成交量 426 根单位未确认，不报告虚假的 match 或比例变化；volume-derived facts 标记 unavailable。
- Yahoo 成交额为空，记录 NOT_COMPARABLE。缺 amount 本身不是使整个候选失败的理由。

| 字段 | 最大绝对差异 | 最大相对差异（约） |
| --- | ---: | ---: |
| open | 0.664071 | 1.448179% |
| high | 0.670928 | 1.448181% |
| low | 0.636653 | 1.448177% |
| close | 0.658932 | 1.448175% |

完整逐日差异、分位数和单位证据见 `.rebase/2899-review.json`。上述同源历史变化也需要解释；未证明其具体原因，未自创 0.1%/0.5%/1% 等迁移通过阈值。Yahoo 的 adjusted close 会考虑拆股/分配只是一般背景，不能据此认定本次差异原因：[Yahoo 官方说明](https://in.help.yahoo.com/kb/adjusted-close-sln28256.html)。

当前 blockers：

1. `writer_deployment_not_confirmed`：配套写入守卫尚未安装/发布。
2. `open_units_unconfirmed` / `high_units_unconfirmed` / `low_units_unconfirmed` / `close_units_unconfirmed`：旧 Eastmoney 部分单位未确认；并非新 Yahoo 的 HKD 元数据缺失。
3. `volume_units_unconfirmed`：成交量 share/lot/scale 证据不足。

Review items：交易日历完整性，以及 OHLC 各自的历史修订差异。补足证据会生成新的候选 hash，仍需重新审阅，不能直接批准旧 hash。

## 技术重算预览

仅为候选，未改变正式 freshness、技术页或 Discussion。

| 字段 | 候选值 |
| --- | ---: |
| latestCompleteBar / technicalAsOf | 2026-10-02 |
| MA5 | 32.004001 |
| MA10 | 32.870001 |
| MA20 | 34.207000 |
| MA60 | 34.208496 |
| MA120 | 33.576579 |
| MACD DIF / DEA / histogram | -0.972472 / -0.648726 / -0.647492 |
| 程序支撑 / 阻力（最近 60 根收盘极值） | 28.954500 / 38.560000 |
| volume-derived facts | unavailable，单位未确认 |
| price action classifier | needs_review，无可复用的版本化 deterministic classifier |
| AI judgments | needs_review，不调用 AI |

短历史不足时 MA 返回 null，不伪造 0。旧 technicalReview、Discussion 正文和锚点保留；新 Discussion 复用既有 continuity warning 表达来源迁移，在重新审阅前不把旧 AI 趋势/风险结论当新历史上的结论。sourceMigration 标记的清除流程尚未扩展，默认保守保留 needs_review。

Apply 的 fixture 已验证 indicators、technicalData 与 freshness 绑定同一 dataVersion；即使日期相同，版本不一致也不 ready。真实候选未 Apply，不能声称线上 freshness 已切换或已完成远端验收。

## 候选审阅定位

- candidateId：`rebase_f184badf402c860c987c3b4c507b7fa94a52d3ea57b8c175c981d061e3bdcec0`
- candidateHash：`f184badf402c860c987c3b4c507b7fa94a52d3ea57b8c175c981d061e3bdcec0`
- candidate object：`f237e5110ef854a98a4d606c4c28ac6a9efb95f16d04fa40a86997768171588d`
- request object：`6a5ae58257e4c45862ed4af627db8dacbb87f60b7ec4c13046897f4f3b3ce69c`
- generatedAt：`2026-10-04T11:17:17.410878+00:00`
- providerVersion：`provider-continuity-rebase-v1:256d5d5875e4c5875cf7367fabf2ed0c278b229a10d61849ece38552dd61e86d`
- 隔离 store：`.rebase/pilot-2899.sqlite`；可读导出：`.rebase/2899-review.json`；均被 `.gitignore` 排除。
- 最终 store 检查：approvals=0、active=0，当前没有 canonical active bundle。

在此 worktree 可只读审阅候选内容：

```powershell
python -B -m scripts.provider_rebase --store .rebase/pilot-2899.sqlite review --object f237e5110ef854a98a4d606c4c28ac6a9efb95f16d04fa40a86997768171588d
```

注意 review 通过本地 store 打开已存在对象；无远端调用，不 Apply。

## 写入路径审计

| 路径 | 本次保护 | 当前部署边界 |
| --- | --- | --- |
| PC Worker，`scripts/market_data_worker.py` | opt-in `--rebase-store` 读已应用版本；替换旧混合 seed；固定 provider；失败保留有效结果 | 仅 worktree，未启动生产 Worker |
| 手动 PC 包装/股票池更新，`scripts/update_market_universe.py` | merge 前 guard；成功后复查；深拷贝失败不写回 | 仅 worktree |
| 外部 PC 直接 updater / merge | `pc_patch.py` 生成配套 guard、provider pinning、量能 normalization、版本保留 | 补丁 `.rebase/pc-continuity-guard.patch` 未安装；真实 PC 仍是旧代码 |
| 构建静态桥，`scripts/prepare_market_bridge.js` | 声明 contract 的 bars 必须匹配 | 未发布 |
| 浏览器静态桥，`src/market-data-bridge.js` | 整批预检后才修改，拒绝旧桥覆盖 certified version | 未发布 |
| 浏览器 versioned result，`src/market-data-task-ui.js` | 应用前 continuity / generation 检查 | 未发布 |
| CSV 手工 K 线，`src/ui-render.js` | 不允许覆写 certified history | 未发布 |
| 整份 JSON 导入及 candidate save，`src/import-export.js` | 持久化前检查现有相同 code 的 contract、generation 和 bars | 未发布；显式删除标的仍属既有操作 |
| 初始加载/全新设备恢复 | 不可能仅靠不存在的本地旧状态识别全部远端历史；需受控交付与已升级写入者 | 不声称具备跨设备中央版本强制能力 |

因此 writer deployment blocker 必须保留。仅有 SQLite Apply 成功，不代表旧手动工具、所有设备或生产远端发布通路已升级。

## 测试与真实数据保护

最终 JS 全量 **1218/1218 PASS**，日志见 `.rebase/js-tests-final.log`；Python 相关套件 **41/41 PASS**。临时 fixture 覆盖候选篡改、审批绑定、base/generation 冲突、事务故障回滚、幂等、rollback、immutable objects、delivery 的业务字段保留、已应用版本后的 Worker 增量、跨源拒绝、PC 直接 merge、未知量能、短历史、Discussion 保存、版本与日期冲突以及整份备份导入阻断。

测试期间发现既有 universe handoff E2E 默认继承本机 LOCALAPPDATA，内部只读查询到 23 个远端股票池 symbol，导致 mock 数量不符；写入目标为临时 fixture，没有创建生产任务或修改生产数据，没有打印凭据。随后将该测试和后续回归的 LOCALAPPDATA 指向空临时目录，修复隔离缺陷。不能把本次测试描述为完全无远端读取。

以下文件结束时 SHA-256 与开始时一致：

| 正式文件 | SHA-256 |
| --- | --- |
| 原工作目录 `data/market_data_bridge.js` | `5ac635d1a9aad099b7738ad5555af1e3103a16aae6ffd76df869a37f192b0c76` |
| PC `data/latest_export.json` | `e1a12254adb08ce1bde49508ec4d9e9087743692849823397eb7d16b658945d8` |
| sync `market_universe.json` | `e0b5b9b288aa55dad73a9ab446f00e546664a96f96daf20cd6c07a9fa6f280ff` |
| PC `src/market_data/updater.py` | `3be6c46a2969131f84b39cb18bb6dfed5bea3233757c19836d1fce7b5c72b8bd` |

原目录 git status 与开始时一致。没有进行真实 holding、Plan、orders 写入；没有伪称做过本任务未授权的生产数据库逐行验收。

## 后续决策

先审阅 Yahoo 候选、解释同源价格修订，并补足旧 Eastmoney 价格单位与双方量能证据、交易日历证据。若仍希望比较 Eastmoney，应另行进行有界候选抓取。本次一次超时不能替代备选源长期评价。

在未来真实 Apply 前，还需评审/交付配套写入守卫和版本消费路径，重新生成无 blocker 的候选，再由用户明确选择 provider 并批准确定 hash。本次停止于 **PILOT_READY_FOR_USER_REVIEW / APPLY_BLOCKED**，不请求或执行真实 Apply。
