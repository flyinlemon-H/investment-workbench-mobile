# 本机 Chrome Local Overrides 验收

本流程已被本次受控生产发布授权取代，保留仅供历史复现。无需继续配置 Overrides；部署后验收必须关闭 Overrides。

状态：覆盖包已准备并完成本机 Origin 预检；尚未启用正式 Origin 覆盖，LNA 允许/拒绝及原生剪贴板验收仍待执行。

## 一次性人工设置

1. 在真实 Chrome 打开 ``。
2. 按 F12，进入 **Sources → Overrides → Select folder for overrides**。
3. 选择下面的目录（不要选择仓库目录，也不要选择目录内的域名子目录）：

```text
<本机临时验收目录>\chrome-local-overrides
```

4. 由用户亲自点击 Chrome 顶部的 **Allow / 允许** 目录访问提示，勾选 **Enable Local Overrides**。保持 DevTools 打开并刷新页面。
5. 页面应出现黄色横幅：**本机 Local Overrides 验收 · 独立测试存储 · 非正式资产**。若没有出现，停止，不要点击调用 AI、导入或清空数据；把 Overrides 文件树及 Network 中文档请求的状态交给 Codex 核对。

请不要执行“Override content”覆盖已经准备好的本地文件，也不要清空站点数据或修改任何响应安全头。

目录和启停方法见 [Chrome 官方 Local Overrides 文档](https://developer.chrome.com/docs/devtools/overrides)。设置仅替换本机响应，不更新服务器。

## 隔离范围

- 包含当前工作区 59 个静态脚本，按原顺序内联到一个本地 HTML 中；每个原始脚本的 SHA-256 保存在 `acceptance-manifest.json`。
- 仅生成副本中的存储键、IndexedDB 数据库、BroadcastChannel、锁及会话偏好名称增加 `__pc_ai_acceptance_20260902__` 前缀。
- 测试保护层只转发带此前缀的原生存储操作，阻止其它键的读写及全库清空/枚举。实际 StorageManager、StrictAiJson、业务校验、candidate 和 commit 算法未替换。
- 只初始化独立测试键，数据为零持仓、无计划的合成样例。不会读取、复制、覆盖或清理真实持仓数据。
- `fetch`、LNA 权限、剪贴板 API 不作替换；网络权限必须通过浏览器真实处理。
- 不修改正式 `index.html`、静态资源版本、远端仓库、Pages 或生产数据。
- 这不是正式发布产物，不应提交到仓库或发布。

## 后续验收顺序

1. Codex 确认横幅、真实 Origin、测试存储状态后启动 `python -B tests/run_pc_ai_bridge_acceptance.py`。只监听 `127.0.0.1:18765`，使用免费确定性 mock。
2. 记录检查点，再用应用“调用AI”触发请求。浏览器的 LNA 允许/拒绝提示由用户亲自操作，不通过自动化更改权限或安全设置。
3. 允许：记录真实 GET /health、OPTIONS、POST；确认成功保存 1 次，current/history 正确，真实持仓和计划不变。
4. 拒绝：确认清晰提示、0 写入、手工路径可用。允许/拒绝切换如需站点权限调整，由用户操作，并在验收后恢复原设置。
5. 原生剪贴板：用户点击应用“复制给AI”，亲自在黄色面板的粘贴区按 Ctrl+V，再点击“核对原生粘贴内容”。核对可信粘贴事件、完整 Prompt 相等；自动化虚拟剪贴板不能单独作为证明。
6. 完成错误响应、Bridge 不可用、手工导入、刷新保留检查，更新验收记录。
7. 验收结束后取消 Enable Local Overrides 并停止测试服务。不清空站点数据。只有验收通过后才进入源代码提交、版本及发布清单准备，最后停在 production push safety gate 等待另行授权。

## 重新生成

只能输出到仓库外的空目录；拒绝覆盖非空目录：

```powershell
python -B tests/build_chrome_acceptance_overrides.py --output <新的空目录>
```

当前包 SHA-256：`32979104471f700b4e416d6714121d09a9d9ee2aeaf6b97edc45a36170bb1150`。
