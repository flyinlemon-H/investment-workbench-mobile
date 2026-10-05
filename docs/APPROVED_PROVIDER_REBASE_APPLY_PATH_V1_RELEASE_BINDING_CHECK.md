# APPROVED_PROVIDER_REBASE_APPLY_PATH_V1 — Release binding preflight

状态：**PILOT_REAPPROVAL_REQUIRED**。

最小 schema/RPC 实施授权已经收到，原 PRODUCTION_SCHEMA_CHANGE_REVIEW_REQUIRED 边界已解除。本次停止源自用户新指令：发现需要重新冻结 2899 审批包时，必须停止并重新请求授权。

## 已确认的绑定

原批准包 evidence.productionDeployment.commit 精确固定为：

`d3f578d764e3bed111e850cf3c419013575b8241`

`scripts/provider_rebase/deployment.py:17` 同时要求 deploymentCommit、assetVersion、每个 guardFiles hash 一致。guard 文件相同也不能替代 exact deploymentCommit。

`scripts/provider_rebase/revision.py` 将完整 evidence 纳入 approvalPackageHash 和 candidateHash。`evidence.py` 还将 deployment.py/store.py 等关键实现纳入 guardImplementationHash。因此不能通过弱化部署检查、删去 evidence 字段或故意排除新保证来沿用旧 approval。

本任务要求发布新的手机 migration acceptance / Review Apply 通路。现有生产没有该通路，所以完成该发布必然得到新 deployment commit。只修改后端 schema 不会使现有前端自动获得迁移接收能力。

## 隔离验证

使用原始真实 candidate/request，只在内存中构造反事实 fixture，没有改写冻结对象：

1. 以现有代码重建原包：三个真实 hash 全部一致。
2. 模拟仅 production deployment commit 改变，其余 assetVersion/guardFiles 均相同：原验证器返回 `production_guard_version_changed`。
3. 在内存 evidence 中更新该 commit 并重建：contentHash 保持相同，candidateHash 和 approvalPackageHash 都改变。

反事实 commit 和派生 hash 不是实际 release 或新审批对象，未保存为 candidate、未写入任何 candidate store，也不提交用户批准这些模拟值。

证据：`.rebase/approved-apply-path/hash-binding-preflight.json` 与 `check_release_binding.py`。

## 当前真实状态

- 当前冻结包三个 hash 未改变。
- approvals=1，active=0；原 approval 未消费。
- 没有真实 Apply、rollback、重新冻结。
- 没有修改产品代码、测试项目 schema、生产 schema/RPC/Auth 或正式行情。
- 尚未执行本任务新 schema 的远端验收或发布，不将旧测试结果充作新实现的测试结果。

旧批准 hash：

- candidateHash: `070b3c14465c91f1ca7ae91eed47e1bbdc07b9179d2912dd5055c2f9f6909b86`
- contentHash: `3504c6fe5941eb5df494bc3c04580a1202125c0f82c43794138b475e8ae3cc12`
- approvalPackageHash: `e54cc2f4ce6e7736492bda99a70c0ad08385f2871d18853957f9247e119561fe`

## 需要补充的单一授权

允许在已授权的最小 schema/RPC/客户端迁移通路实现、测试和部署完成后，**重新冻结 2899.HK 审批包**，将最终生产版本、guard compatibility、可信审批与 Apply/rollback 保证正确绑定进去。

该授权只允许生成和呈交新包，**不授权真实 Apply**。新 candidateHash/contentHash/approvalPackageHash 和变化原因必须再次交给用户；收到针对新冻结对象的明确批准之前，原 approval 不能自动迁移或复用。

现有 schema/RPC 授权无需重复确认；不需要修改其他 22 个 symbol，也不需要改变普通行情守卫。此处只请求解除“重新冻结之前先停止”的流程边界。
