# MARKET_DATA_CANONICAL_HASH_COMPATIBILITY_V1

本地工程与发布准备状态：**READY_FOR_CANONICAL_HASH_PRODUCTION_REVIEW**。

后续门禁：**PRODUCTION_SCHEMA_CHANGE_REVIEW_REQUIRED**；部署后必须 **PILOT_REAPPROVAL_REQUIRED_AFTER_DEPLOY**。本任务没有生产部署，没有真实 stage、approval、Apply、rollback，也没有重新冻结 2899 包。下列生产写入步骤全部留待另行授权。

## 1. 根因及真实 484 处核验

Legacy baseHash 是 `SHA256(core.encoded(core.facts(stock)))`。facts 提取 priceHistory、technicalIndicators、technicalData、marketDataFreshness；encoded 是 Python `json.dumps(sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)` 的 UTF-8 字节。它不是整文件 hash，也不是忽略元数据的 OHLCV hash。整数/浮点的 JSON 表示不同会改变 baseHash。

本次对冻结 request、PC Bridge、market_universe、已核对线上字节的 Pages 归档采用 Decimal/lossless 逐字段审计，没有先转 float 再判断等价：

| 核验项 | PC 相对冻结 facts |
|---|---:|
| representationOnlyDifferences | 484 |
| numericValueDifferences / precisionDifferences | 0 / 0 |
| missingFields / extraFields（facts 投影内） | 0 / 0 |
| dateDifferences / sourceContractDifferences | 0 / 0 |
| metadataDifferences / barCountDifferences | 0 / 0 |

484 项全部是 int → float：volume 426、amount 52、open 2、low 2、high 1、close 1；例如 33219061 与 33219061.0。provider、adjustment、price_basis、complete、元数据、日期和 bar 顺序均无事实变化。

当前正式基线是 **426 根，2025-01-09 至 2026-10-02**；它与尚未 Apply 的 **427 根、截至 2026-10-05 的 Candidate** 必须区分。

既有 facts adapter 对缺失的顶层技术容器提供 `{}`（priceHistory 为 `[]`）；审计按这个已存在的事实边界提取。canonical serializer 本身不补字段、不把 null 当 missing、不把空对象当 null；嵌套 missing/null 始终不同。浏览器迁移 adapter 已修正 `??` 对显式 null 的合并。

| 节点 | Legacy baseHash | 新 canonicalContentHash |
|---|---|---|
| 冻结 base / Pages | `041b952f415e516b71543e7831e1183b801aa4e12f98176da2ad41790641fe70` | `8b160e2c790c884fa69db04ea2cba51e7676372c63fa8c49b3f4b26411db4f7d` |
| PC Bridge / market_universe | `642680a9ad62666c5c24d77f23f8ade4317c5f46d49f04ca4d6778e3ac646889` | `8b160e2c790c884fa69db04ea2cba51e7676372c63fa8c49b3f4b26411db4f7d` |

完整 484 个字段路径保存在未提交的 `.rebase/canonical-hash-v1/484-audit.json`；JS 对真实文件的独立验证见 `484-cross-language.json`。没有把私有行情复制进 golden fixtures。

## 2. Hash 调用链

| 节点 / 文件与函数 | 输入、序列化与校验 |
|---|---|
| PC provider → `scripts/provider_rebase/fetch.py`、外部 PC DailyBar / updater | 原有 parser、qfq/source contract 与 complete-bar 规则；原来的 float 转换、provider continuity/revision 比较不修改 |
| `scripts/update_market_universe.py` canonical_json / checksum / Bridge writer | universe 保留四组 facts；checksum 是既有排序 JSON SHA256；Bridge 使用 compact JSON。checksum 不冒充新的 facts hash |
| `scripts/publish_market_bridges.js` → Pages `data/market_data_bridge.js` | 发布文件完整性使用文件字节 SHA256；不能代替行情版本 |
| `src/market-data-bridge.js` / browser storage | JS JSON number、既有导入 guard；没有给普通写入加入 migration bypass |
| `src/market-data-task-ui.js` / normal Remote Result | SDK/JSON transport、既有任务 owner/result version；普通 RPC 和写入 guard 不变 |
| `core.request` / `core.digest` | 原 baseHash / requestId 继续保留排序 JSON byte hash，不静默改算法 |
| `revision.candidate` / `revision.content_hash` | 旧 contentHash 保留既有 semantic rows 与 source contract 规则；新 canonical hash 不替换它，也不改变原来的六位技术计算规则 |
| `revision.candidate` schema4 | 完整证据验证后新增 baselineBinding，再计算 approvalPackageHash、candidateHash；两者自然变化，不转移旧批准 |
| `remote.capsule` | 重建完整 Candidate，校验旧 hash 与新 baselineBinding；传送原始 canonical strings，保持 legacy byte hash 可验证 |
| `migration_validate` / `canonical_baseline` | PostgreSQL 自行计算 canonical hash、原 hash、source contract hash；不能相信客户端标签 |
| `migration_stage` / `migration_account` | 保留 owner、capability、approval、current pointer、generation、active task/migration、daily anchor 检查；canonical 相同也不能跳过版本冲突 |
| SQLite `Store.apply` | schema4 要求 expected_current_version，事务内校验新 baselineBinding；保存实际旧完整 facts 供 rollback |
| `migration_view` → Browser / PC reader | 服务端从 immutable bundle 派生 current/previous canonical hash；接收端重新计算，不一致或数字解析精度损失即拒绝 |

普通 PC `integration.guarded_updater` 中的单进程并发检查仍使用原始 facts digest；那是同进程前后防覆盖检查，不是跨端等价判定，因此未改动。

## 3. MARKET_DATA_CANONICAL_SERIALIZATION_V1 规范

Hash 输入为 ASCII 编码的 `VERSION + LF + typedEncoding`，算法 SHA-256。

- null=`n`，true=`t`，false=`f`。
- 字符串=`s`+UTF-8 字节的小写 hex；不转换数字字符串、不做 Unicode normalization。拒绝孤立 surrogate。
- 数值=`d`+有符号十进制有效系数+`e`+十进制指数；去除无意义前导零和尾零；所有零（含 -0）=`d0e0`。
- 数组=`[`+逗号分隔的递归编码+`]`；保持原顺序，不排序 bars。
- 对象=`{`+逗号分隔的 `stringKey:value`+`}`；按 key 的 UTF-8 hex 字节序排序。拒绝重复 JSON key。
- `1` / `1.0`、`33.42` / `33.420000`、等值指数形式相同；真实十进制差异保留，不舍入、不设容差。
- NaN、Infinity、unsupported values、稀疏 JS 数组拒绝。null/missing、字符串/数值、日期变化均不同。
- 原始 JSON 使用 lossless decimal/token parser，能区分超出 JS safe integer 的相邻整数。已解析 native unsafe integer 拒绝；不会声称能够从已损坏 Number 恢复原值。
- 有界输入：JSON ≤12M 字符，递归≤64层，数字 token≤2048字符、有效位≤1024、规范化前指数绝对值≤10000。超限安全拒绝。
- facts 必须包含四个明确字段；bars 1–3000 根，日期严格有效、唯一且递增。重复/乱序日期拒绝，而非重新排序后合并。

Python `load_native` 先 lossless parse，再与 native parse 编码比较，发生精度损失即拒绝。Browser/Worker 对服务端派生 canonical hash 再验证，避免 JSON transport 静默降低精度。普通行情解析器在更早阶段已丢弃的信息无法由任何 hash 恢复；本任务未扩大为重写全部 Provider parser。

## 4. 实现与 hash 版本兼容

- Python：`scripts/provider_rebase/canonical.py`；CLI 使用 checked native load；`pc_patch.py` 包含新模块，仅生成隔离补丁，未安装到真实 PC。
- JS：`src/market-data-canonical.js`，浏览器与 Node 共用；lossless parser 与 WebCrypto SHA256。
- SQL：private `canonical_encode(json,integer)`、`canonical_hash(json)`、`canonical_baseline(jsonb,jsonb)`。
- schema4 的 baselineBinding 明确含 `canonicalSerializationVersion`、`canonicalContentHash`、`legacyBaseHash`、`expectedCurrentVersion`、`sourceContractHash`。
- Candidate type、target contract、raw contentHash、technicalVersion、candidateHash、approvalPackageHash 和 release binding 各自保留独立含义。
- schema1–3 旧对象仍可读、可验证其历史字节 hash；新生产 stage/approve/apply 路径拒绝 legacy 包，要求 refreeze。没有修改或删除旧 approval。

## 5. 可信 Preflight 修复

新 hash 只负责事实等价。可信迁移边界仍同时校验：canonical version/hash、source contract、expected current version、pointer/generation、Candidate/package/content hashes、migration type、guard/release、blockers、active migration/task 和 daily result anchor。错误绑定即使重新计算 Candidate/package 外壳 hash，也会被服务端拒绝。

Browser 在异步 WebCrypto 完成后重新核对 owner、state identity 与 facts，防止等待 hash 时发生变化后仍覆盖。原子持久化成功后才采用新 state；Discussion 正文、holding/Plan/orders 不在四字段替换范围内。

## 6. RPC 最小增量与权限

**需要未来生产 RPC 变更授权；本次没有部署。** 保持 public protocol 名 `approved-provider-migration-v1`，以 schema4 + canonical version + 新 release/guard pin 显式升级。新增三项纯 private helper；替换既有 validate/stage/account/view/release_binding 实现。不新增表、列、policy、Auth 配置或普通任务 RPC 修改。

待评审 migration：`supabase/migrations/20261008080857_market_data_canonical_serialization_v1.sql`。

本地新 guard implementation hash：`2b95be757867fe4b45e193d68368a68a46448a2314c0b02bdddf35ffed062ab3`。

全部新 helper 为空 search_path、INVOKER，撤销 PUBLIC/anon/authenticated/service_role execute；原有 wrapper、ownership、capability、RLS/grants 保持。受信任 operator 才能 stage；客户端不能直接提交 approved flag 或绕过服务端 hash 计算。

安全定义参考：[Supabase Database Functions](https://supabase.com/docs/guides/database/functions)。本次验证使用本地 PGlite PostgreSQL 与 SQLite；没有声称在测试 Supabase 做过本轮远端部署。

## 7. Golden fixtures 与隔离验收

`tests/fixtures/canonical-hash-v1.json`：34 个合成向量覆盖整数/小数尾零、-0、指数、safe/unsafe/极大整数、微小价格差、volume+1、日期/顺序/重复日期/根数、provider/adjustment/priceBasis、complete、null/missing、数字字符串、NaN/Infinity、key order、whitespace、Unicode 与精度损失。

Python / JS 全向量一致；SQL 对可接受 JSON 向量输出同 hash，并拒绝无效 JSON/重复 key 等。日期/bars 门禁另外在事实与迁移校验中验证。

真实 484 处基线通过独立 Python/JS lossless 读取，得到上述统一 canonicalContentHash。未把真实包 stage 到任何数据库。

SQLite 与本地 PostgreSQL隔离验收：同事实异表示通过；微小数值变化拒绝；无 approval、错误 Candidate/package hash、版本/活动任务冲突、伪造 intent、匿名/outsider 越权拒绝；精确 approved Apply 可执行；重复幂等；pointer 更新后的失败整体回滚；旧完整版本/审计保留；rollback 完整恢复；已消费 approval 不能重放。

## 8. 全量回归与三视口

- Python：119/119 PASS，无 skip；使用既有隔离 PC 基线 `MARKET_SOURCE_ROOT`。
- JS/SQL：1333/1333 PASS，无 skip；覆盖完整原功能及 canonical 测试。
- Production Release Gate：207/207 PASS；Entry Clarity 31/31 包含在门禁中，原 required-test hash 不变。
- 360/390/1280 Clarity：24/24 场景；原 AI 正文、业务字段保持，无 overflow/pageerror。
- schema4 候选审阅与 canonical browser runtime：3/3 视口通过，无 overflow/pageerror，无真实写入。
- PC mixed-provider / same-provider revision / manual fallback / 完整补丁交付在 Python 全量覆盖，未放宽原 guard。

修复过程中发现新 canonical 模块未列入 companion patch 清单，已补齐；初次 full JS 缺少测试专用 MARKET_SOURCE_ROOT，配置隔离路径后通过。浏览器使用已有 Chromium 1223，不安装新浏览器。上述中间失败不被当成通过。

## 9. 生产基线与发布 Candidate

最新只读 fetch 的 production main：`1e939b10e66d7c115381da774a5c73d0699a504c`。

本地分支：`codex/market-data-canonical-hash-v1`。发布资源版本：`market-data-canonical-hash-v1-20261008`。生产 baseline 文件已更新到该 main；没有改动 Entry Clarity 必须保留的测试 hash。

发布 manifest 必须从本地实现提交生成，增加 canonical runtime；原七个 data 资源保留原字节。最终本地 Candidate commit 和资源完整性 receipt 保存在 `.rebase/canonical-hash-v1/candidate-receipt.json`，同时随交付回复给出。未 push、未更新生产 main、未触发 Pages workflow。

## 10. 原审批包影响

| 字段 | 结论 |
|---|---|
| 原 candidateHash `1d8be707…` | 历史保留；新版 schema4 必然改变，不能沿用批准 |
| 原 contentHash `3504c6fe…` | 算法不改；如 bars/contract 保持相同，则值保持相同 |
| 原 approvalPackageHash `5d4bc0e9…` | 基线安全语义及 release/guard 变化，必然改变 |
| expected legacy baseHash | 旧包原值不改；未来基线与 pointer 必须重新核验，不能仅因 canonical 相同而改写 pointer |
| 新 canonical baseline hash | `8b160e2c…db4f7d`，不能当作 legacy pointer 或授权 |
| source contract / technical preview | 本次未改原对象；计算与连续性规则不变 |
| guard implementation / release binding | 改变，须新部署配套绑定 |

本次未生成新的真实 2899 Candidate/approval package，也未自动将旧批准标成另一个 hash 的批准。未来部署后重新读取事实、重新冻结并取得用户精确批准。

## 11. 数据保护与 rollback 方案

30 个既有保护文件相对本任务开始状态未变，包括实际 PC/universe/Bridge、原候选和审计文件；两处 representation drift 是本任务之前已有状态，未擅自“修复”文件。正式 bars、technical current、freshness 和其他22个标的未写入。没有访问/修改用户手机本地真实 Discussion、holding/Plan/orders；保护证明是本任务零写入及隔离投影测试，不冒称读取了手机隐私存储。

生产只读复核：migration records/versions/heads/events 均为0，原 RPC/release pin 不变。本地测试只用合成 symbol，临时表事务与 SQLite/PGlite，不创建真实任务、账户或凭据。

真实业务 rollback 路径保持完整 previous version、原子 pointer 和 append-only audit；本次没有真实 rollback pointer。

`supabase/review/market_data_canonical_serialization_v1_rollback.sql` 仅供下阶段评审：若存在任意 schema4 record，必须停止 schema 回退，保留数据并采用前向修复；空控制面才可恢复旧函数并删除三个新纯 helper。隔离 PostgreSQL 已验证空控制面回退恢复旧 binding/helper 移除，以及存在 schema4 record 时拒绝且记录不变。不删除迁移 ledger，不 drop 业务表，不自动执行。正式数据不一致时仍按独立的已批准版本回滚策略判断。

## 12. 已知限制、剩余门禁与唯一下一步

- 本轮没有测试/生产 Supabase migration 写入；远端验收留给部署阶段。
- canonical hash 不认证数据来源，不证明交易日完整性，不替代审批/版本/ownership/guard。
- 超大精确数字可在 lossless 层表示，但当前 native 浏览器/PC业务模型无法无损接收时安全拒绝；不会伪装支持全部极大数值。
- 原 contentHash 的既有六位语义与技术计算未改；新 canonical 基线比较不降精度，二者不可互换。
- 旧 input_queue、leaked password protection 等独立事项未改。

唯一推荐下一任务：**MARKET_DATA_CANONICAL_HASH_PRODUCTION_DEPLOY_V1**。需明确授权这一份最小 RPC migration 与配套 frontend/PC release；先做测试项目远端验收，再生产只读门禁、显式部署、线上跨端 hash 复验，之后重新冻结 2899 包并等待新批准。不得把本地测试完成理解为已获生产部署或真实 Apply 授权。
