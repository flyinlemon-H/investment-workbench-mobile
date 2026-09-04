# REAL MOBILE TRIAL V3 Phase 1：手机股票池交接

Status: **FALLBACK / HISTORICAL**

当前主路径是 Supabase Stock Universe Auto Add；本文保留的是自动同步或 PC 云端读取不可用时的 OneDrive 文件交接灾备流程，不再是日常同步入口。

## 目标与边界

本阶段只解决“手机新增股票进入 PC 行情更新范围”。它不做自动删除、持仓/成本/计划同步，也不引入后端、Supabase 或浏览器 GitHub 写权限。

事实边界保持不变：

- 手机清单只表达“这个代码属于活跃分析股票池”的用户意图。
- PC `DailyMarketUpdate` 继续生成价格、完整日 K、行情新鲜度和技术指标。
- AI 不创建、不删除、也不调和股票池成员。

## 用户流程

1. 手机上新增标的并保存。标的立即保存在当前浏览器；若生产行情桥还没有该代码，会显示“等待同步”。
2. 点“同步到PC”。支持文件分享时会打开系统分享面板；否则下载一个很小的 JSON 文件。
3. 把文件保存到 OneDrive 的专用收件箱：

   `investment-workbench-mobile-sync/inbox/`

4. PC 定时任务下次运行时自动读取最新有效清单，追加到市场股票池，完成行情更新并通过现有隔离发布器发布两份桥文件。
5. 手机再次打开或刷新后，以行情桥中该 canonical symbol 的有效事实作为确认；确认后“等待同步”自动消失。

浏览器不会假装能够静默写入 Windows 文件系统。首次使用时，用户需要在系统分享/下载界面选择上面的 OneDrive 文件夹。

## 清单契约

文件名为 `investment-workbench-universe-rNNNNNN.json`，字段只有：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-26T09:00:00.000Z",
  "revision": 1,
  "symbols": [
    {"symbol": "0700.HK", "active": true, "displayName": "腾讯"}
  ],
  "checksum": {
    "algorithm": "SHA-256",
    "value": "64 lowercase hex characters"
  }
}
```

清单不包含 shares、cost、market value、plans、allocation、AI 判断、技术事实、新闻、估值、基本面或个人财务资料。相同手机股票池重复交接时，revision、generatedAt、内容和 checksum 保持不变；成员变化时才生成下一 revision。

## Canonical symbol

- 去除首尾空白并转为大写。
- `600000.SH` 规范为 `600000.SS`。
- `.SZ` 保持不变。
- 港股为 1–5 位数字输入，少于 4 位时左补零，例如 `700.hk` 规范为 `0700.HK`。
- 其他形式拒绝，不按名称或缺失后缀猜测。

手机新增、手机交接、PC 校验、PC registry、bridge reconciliation 使用等价规则。

## PC 收件箱与 registry

默认收件箱相对于两个项目的共同父目录解析，因此不在可复用源码中硬编码机器专属绝对路径：

`<OneDrive documents>/investment-workbench-mobile-sync/inbox/`

如需改位置，注册任务时传：

```powershell
powershell -File scripts/register_daily_market_update_task.ps1 -Force -UniverseInbox "D:\OneDrive\investment-workbench-mobile-sync\inbox"
```

PC registry 默认位于专用 OneDrive 同步目录的 `investment-workbench-mobile-sync/market_universe.json`，不会弄脏行情源代码仓库。每条记录只有：

- `symbol`
- `active`（Phase 1 始终为 `true`）
- `displayName`
- `addedAt`
- `marketFacts`：仅 `priceHistory`、`marketDataFreshness`、`technicalIndicators`

它不包含持仓、成本、计划、配置或 AI 数据。更新器在内存中计算：

`latest_export.json 非现金代码 UNION market_universe.json 代码`

真实组合股票的市场事实按原逻辑写回 `latest_export.json`；registry-only 股票的市场事实只写回 registry。两份 JSON 先 staging、校验和备份，再替换；失败时回滚已替换目标。

## Add-only 与失败安全

- 清单缺少某代码不会删除 registry 记录。
- `active:false` 不会作为删除指令；Phase 1 清单只接受 `active:true`。
- 重放相同清单不会产生重复 registry 或 bridge symbol。
- 清单格式错误、未来 schema、checksum 错误或非法代码会被拒绝，但现有 PC 股票仍继续更新。
- registry 本身损坏时会停止写入，避免用空 registry 覆盖现有内容。
- 手机只在桥中出现 canonical symbol 且完整日 K、行情日期、指标日期一致时清除等待状态；不使用经过时长推断成功。

## 首次迁移

每次加载都会幂等执行同一 reconciliation：枚举当前手机非现金股票，用 canonical symbol 与当前权威行情桥比较。桥已确认的股票视为已同步；未确认的历史股票与部署后新增股票一起进入 pending set，并包含在下一份清单中。两侧都不执行删除。

## 发布保护

自动发布器 allowlist 保持严格不变：

- `data/market_data_bridge.js`
- `data/market_task_status_bridge.js`

手机 universe manifest 和 PC `market_universe.json` 都是 OneDrive/PC 本地输入，不会由市场桥发布器上传到生产。
