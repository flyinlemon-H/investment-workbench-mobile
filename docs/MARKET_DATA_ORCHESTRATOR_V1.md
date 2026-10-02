# MARKET_DATA_ORCHESTRATOR_V1

实施日期：2026-10-01 ～ 2026-10-02（Asia/Shanghai）。基于审计 `ba20244403d804d588d1cbb4cd5efb3e178d3e37`。

**状态：READY_FOR_PRODUCTION_REVIEW。测试项目远端闭环与权限验收通过；未部署生产。详见 [远端验收报告](MARKET_DATA_ORCHESTRATOR_V1_REMOTE_ACCEPTANCE.md)。**

## 开发前调查与最小方案

- Browser → Worker：仓库已有 Supabase SDK、统一会话 `SupabaseBrowserClient`、Auth 登录、stock universe RPC；选用同一认证基础上的小型任务/结果 RPC。没有假设 GitHub Pages 可以接收写入。
- Worker 入口：新增 `scripts/market_data_worker.py`，进程从 Registry 领取固定日K任务，不提供入站 HTTP/命令执行服务。
- Daily pipeline：通过既有 `load_source_updater` 导入相邻 PC 仓库 `src.market_data.updater.update_market_data`。复用 ProviderChain、normalize_symbol、完整交易日判定、重叠七天增量范围、merge_price_history、calculate_indicators。
- PC JSON/registry 与 Git bridge：原有 `run_daily_market_update_*` 和 publisher 保留。原 publisher 要求批量覆盖且等待 Git/Pages，不能可靠表达单次交互任务完成；V1 用现有 Supabase 保存小型版本结果并原子同步成功状态。没有迁移旧数据或重写发布器。
- Browser refresh：既有 `normalizePriceHistory`、`updateTechnicalDataFromPriceHistory`、critical `saveState`，仅写行情事实白名单。自动轮询当前技术资料页，重新打开/重新加载按账户与 symbol 找最近任务。
- Freshness：删除 state.js 对 `kline_status=current` 的无条件 fresh 捷径；技术页面与 Discussion 都调用 `TechnicalFreshness.evaluateTechnicalFreshness`；它复用既有 Portfolio technicalConsistency / Universe validBridgeFacts。
- Auth：浏览器只用现有会话。Worker 使用独立可撤销 capability；不复用只读 universe reader，不使用 service_role。执行节点没有操作持仓/Plan/订单的数据库权限。

## 协议与状态

`UPDATE_DAILY_MARKET_DATA`，唯一参数 canonical `symbol`（A股六位 SS/SZ、港股四/五位 HK）。RPC 拒绝多余字段，拒绝 command/path/URL/任意 taskType。执行宿主与路径仅由本地操作者配置，不出现在 task 中。

`queued → running → succeeded | failed`。无 Worker 的任务持续 queued，显示“等待执行端”。数据库部分唯一索引保证同一 owner/symbol 仅一项 active task；锁内 request 返回现有任务。V1 每账户一个有效 Worker capability，轮换会撤销旧凭证；运行中拒绝轮换。Worker 领取后有十分钟期限；过期标失败，用户可创建新任务，旧执行不能提交覆盖结果。无多 Worker scheduler。

`taskId`、symbol、requestedBy、requestedAt、workerId、startedAt、completedAt、status、resultVersion、error 均可查询。成功 envelope 含 provider、latestCompleteBar、technicalAsOf、dataUpdated、warnings、fingerprint、stock。`resultVersion = taskId`；重复 finish 返回终态，不产生第二份 snapshot。

## 存储与权限

迁移：`supabase/migrations/20261001155527_market_data_orchestrator_v1.sql`，以及凭据轮换/撤销并发修复 `supabase/migrations/20261002021235_market_data_worker_capability_lock.sql`。

三个小表在未暴露的 `market_private` schema：workers（仅 token hash）、tasks、results。启用 RLS 并拒绝直接访问；public 仅 SECURITY INVOKER RPC 包装；必要的 SECURITY DEFINER 实现在 private schema、固定空 search_path、显式认证/所有权检查和最小 execute grant。

- `market_data_account(p_action,p_input)`：authenticated 且非匿名 Auth user；owner 由 auth.uid 派生，不接受客户端 owner。request/read/register_worker/revoke_worker。
- `market_data_worker(p_token,p_action,p_input)`：独立 256-bit capability，SHA-256 hash 查找、有效期九十天、限所属账户。claim/finish，仅能对自己 claim 的 task 完成。
- 成功 result insert 与 task succeeded 在一个事务；任何验证失败回滚。失败任务不会删除、修改前一版本 result。
- 本地 outbox 先持久化后发布。HTTP 响应丢失后重放同一 finish，无需重新抓取；进程重启通过 OS 锁释放、持久 outbox 和数据库 lease 恢复。
- 不记录 token、原始 HTTP 错误或 provider 请求 URL。任务错误使用固定诊断码，UI 显示中文原因。

## 行情保护

Worker 默认只读本仓库 `data/market_data_bridge.js` 作为尚无云结果时的种子；有成功结果后直接使用 Registry 的上一版本。所有计算发生在深复制的纯行情 stock 上，不写 PC portfolio JSON/registry、旧静态 bridge 或持仓。

新增 guard 包装原 ProviderChain，检查 OHLC 有限正数和范围、日期唯一排序、qfq/adjusted、历史与本次 provider 一致。完整历史的重叠 OHLC 出现实质修订则失败 `adjustment_revision_requires_full_rebuild`，避免只更新七天却保留旧复权基准。无法证明连续时要求操作者使用既有维护流程重建一致历史；V1 不自动纠正公司行动。

沿用 A股15:10、港股16:10（当地时间）完整日K保护，并再核对 provider 的完整标记。未完成 bar 不进入 versioned snapshot 或指标。完成≠新交易日：no-change 也产生新任务版本，fingerprint 不变、dataUpdated=false。

浏览器校验 taskId/resultVersion/symbol、完整 bar、日期、指标一致性；同一版本重复读取不再保存。保存失败还原原行情字段与 updatedAt。更新失败、旧日期/旧抓取时间结果均不覆盖当前快照。静态桥接也不会以较晚失败记录或旧日期替换已确认版本。

## Freshness 与 Discussion

统一策略：上海时区参考日、未来日期拒绝、三个工作日宽限、显式 stale/failed、完整 bar/date/price/levels/bridge 一致性。任务成功与行情 fresh 是不同概念；无新交易日也可成功，陈旧快照仍 stale。复用周末排除规则，**未新增交易所节假日日历**；长假仍可能保守显示 stale。不得把示例 10-01 当作必然交易日；本次真实数据最新完整日为 09-30。

Discussion currentFacts.technical.dataStatus、dataReadiness.technical.ready、技术页 canonicalTechnicalDate 读取同一判定，且 context 明确携带 resultVersion。过期标记不会在已构造 prompt 中变成 fresh；新版本通过既有 source context revalidation 路径生效。没有任何自动 AI 请求、Plan 写入、持仓/订单变更。

## Worker 首次设置与运行

需要现有 PC 仓库及其 Python dependencies。生产/测试环境均须先部署迁移。浏览器技术资料页 → 执行端设置 → 登录已有账户 → 生成执行端授权。下载的是敏感 capability，仅交给可信执行端，配对后删除传输副本；不要提交 Git。

PowerShell 示例（路径由本地操作者指定；无远端路径输入）：

```powershell
python -B scripts/market_data_worker.py --source-root 'E:\users\kaka\onedrive\文档\投资分析程序' --state-dir "$env:LOCALAPPDATA\InvestmentWorkbench\market-worker" --pair
# 在隐藏提示中粘贴凭证 JSON；凭证由 Windows DPAPI 加密落盘。
python -B scripts/market_data_worker.py --source-root 'E:\users\kaka\onedrive\文档\投资分析程序' --state-dir "$env:LOCALAPPDATA\InvestmentWorkbench\market-worker"
# --once 只处理一次；异常/失败返回非零退出码。
```

UI 可撤销 capability。Worker 离线不自动启动、不伪报 running。`state-dir` 必须位于本仓库之外；outbox 为行情数据，无 token。默认轮询五秒。凭证过期需重新配对。平台无关任务协议，当前凭证保护适配 Windows，非 Windows 宿主须替换本地安全存储适配。

## 验证与证据

- 原有 JS 1098 项通过；新增 client/freshness 6 项；数据库集成 1 项覆盖多种真实 SQL 条件。最终JS/SQL全量1105项通过；Python27项通过。
- Python：27项（含6项 Worker）。真实调用相邻 PC updater/merge/indicator，fixture ProviderChain 仅替代网络。
- `npm test` 包含 PGlite 本地 PostgreSQL 数据库测试；仅开发依赖，无生产后端或浏览器依赖。Auth JWT lookup 和 pgcrypto digest 在本地测试脚手架中等价模拟；没有把它计作 Supabase Auth 实网验收。
- 三视口：1280×900、390×844、360×800；实际页面/本地存储/SQL任务，覆盖未登录提示、切到Discussion后自动回读、queued/running/succeeded/failed、resultVersion、页面与Discussion一致、失败保留快照、无持仓/Plan/订单变化、无页面异常/横向溢出。截图已检查。
- 真实 ProviderChain 网络 probe：东方财富，测试历史365→368根；latestCompleteBar=2026-09-30、dataUpdated=true。
- 真实本地 Browser→SQL Registry→Python Worker→ProviderChain→SQL result→Browser：390×844通过，task/resultVersion=`9457268f-9bd4-40fc-8e3b-9ddd601ef918`，Yahoo 回退成功，最新完整日09-30；不自动AI。
- 真实增量网络与本地闭环是两次独立实验。实网增量闭环曾两次因 EastMoney 历史遇 Yahoo 回退，按 guard 正确 failed；最终本地成功闭环使用空种子完整初始化，未绕过连续性保护。不可声称“远端真实手机增量闭环已通过”。

本地证据在忽略目录 `test-results/market-data-orchestrator/`：browser-results.json、real-local-loop-results.json、real-worker-log.jsonl、real-provider-result.json、各状态/视口PNG。测试脚本在 `tests/market_data_*` 与 `tests/test_market_data_worker.py`，网络 probe 需显式运行，普通测试不访问市场。

### 二十案例映射

| Case | 验证 |
|---|---|
| 1/2/3/4 | SQL与三视口：创建queued、claim running、成功版本、离线等待 |
| 5/19 | Worker/SQL/浏览器：provider失败保留旧结果、重试新task |
| 6 | SQL：并行八次 request 返回同一 active task；client in-flight合并 |
| 7/8 | 真实网络365→368；Worker fixture新增/重叠/no-change/fingerprint幂等 |
| 9 | Python既有完整日判定与未完成bar回归 |
| 10/11 | Worker复权/price_basis/provider/重叠修订拒绝；实网provider mismatch |
| 12/13/14/15 | 三视口回读与Discussion版本/ready一致；09-01/current标记审计回归 |
| 16/17/18 | SQL与Worker/client拒绝非法symbol/taskType/command/path/URL |
| 20 | durable outbox响应丢失重放；SQL终态幂等与过期claim不可覆盖 |

## 测试部署与生产评审

2026-10-02 获用户对测试项目 `investment-analysis-test-s01`（`lblyapnsngqnjimgskkp`）的明确部署授权后，完成两个必要迁移、隔离账户真实 Auth/REST、Browser→PC Worker→ProviderChain→versioned result→Browser 增量闭环与权限验收。实际远端版本、基线对比及测试清理见 [远端报告](MARKET_DATA_ORCHESTRATOR_V1_REMOTE_ACCEPTANCE.md)。

本轮追加浏览器 read/create 竞态修复，最终 JS/SQL 1106 项、Python 27 项及三视口通过。上文历史本地测试局限仅描述首次实验；现已有真实远端 365→368 根增量闭环证据。

生产未部署；Git push/Pages deploy 未执行。状态为 **READY_FOR_PRODUCTION_REVIEW**。

## 兼容与来源

旧手动 PC、batch、quote、technical review、Discussion、Entry、Plan、Runtime、首页、旧浏览器存储格式和静态桥接保持兼容。原有两个未提交市场生成文件的SHA256完全未变：

- market_data_bridge.js：C352E6BB7EF435BBF1C2D6C8DAC2F2F03AB5CE69557F3F6826B71EC2BD0E24D0
- market_task_status_bridge.js：86571BE0F6CE094260EFF237B0626DB2203018CAF87D1884FC4B807D00E89998

参考：[既有审计](MARKET_DATA_API_CAPABILITY_AUDIT_V1.md)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[数据库函数权限](https://supabase.com/docs/guides/database/functions)、[PGlite本地测试引擎](https://pglite.dev/docs/)。

## 可重复运行

```powershell
npm ci
npm test
python -B -m unittest discover -s tests -p 'test_*.py'
# 相邻 PC 仓库不在默认目录时，设置 MARKET_SOURCE_ROOT；缺失该依赖时 Worker tests 明确 skip。
# 三视口脚本需要可用 Playwright 与 Chromium；可通过 PLAYWRIGHT_MODULE / CHROME_EXECUTABLE 指向已有安装。
node tests/market_data_browser_acceptance.cjs
# 仅在明确允许访问公开行情网络时运行：
python -B -m tests.market_real_provider_probe --source-root '<PC仓库路径>' --output test-results/market-data-orchestrator/real-provider-result.json
```

发布资产已加入同一缓存版本 `market-data-orchestrator-v1-20261002`。清单校验使用已提交 Git blobs，排除原有行情未提交改动；没有覆盖既有 `_site`。
