# Cleanup Wave 1 — 2026-09-05

Status: CURRENT release record

This release removes confirmed dead code and demotes recovery-only controls without changing canonical data, schemas, migrations, Supabase, Windows tasks, or the market pipeline.

## Removed

- `src/v13-risk-engine.js` and its browser/publication entry. Final searches found no production caller, test caller, HTML dependency, or dynamic/global dispatch.
- Dead `V13PlanEngine` exports `getArchivedPlans` and `archivePlan`. `getActivePlanByType` and `getDisplayActivePlans` remain because compatibility tests call them; `checkPlanTriggerLevel` and its dependencies remain production-active.
- Unreachable UI roots `detailResultsArchivePanel`, `detailResearchArchivePanel`, and `detailAdvancedToolsArchivePanel`, plus their exclusively reachable collection, technical screenshot, generic AI-review, unified-prompt, comprehensive-package, and detail-tools helpers. `downloadOperationApplicationRequest` was also removed after exact-reference checks.
- Small confirmed orphans: `plan-v2.nonNegative`, `position.targetSum`, `rebalance.inferTriggerOn`, and the `price-refresh` helpers `codeKind`, `snapshotPriceRefreshBusinessState`, and `restorePriceRefreshBusinessState`.
- Completed Local Overrides acceptance tooling: `build_chrome_acceptance_overrides.py`, `chrome_acceptance_harness.test.js`, `fixtures/chrome-overrides-harness.js`, and `pc-ai-bridge/LOCAL_OVERRIDES_SETUP.md`. The current allowlisted acceptance server and its security tests remain.

## Demoted

- Discussion now exposes one `转到计划中心` shortcut instead of duplicate `整理计划` / `导入计划` actions. Plan Center retains the complete Plan workflow.
- The toolbar-level `同步到PC` action was removed. Automatic Supabase add remains primary; OneDrive `导出文件交接` remains under `自动同步设置` in a `灾备 / 文件交接` disclosure.
- PC Long-Term Logic keeps `API更新` as the primary action. Manual `复制给AI` and `手动导入JSON` remain reachable under `备用操作`; Manual Analysis Sync is unchanged.

## Bridge contract

The deterministic Python provider now emits exactly the Long-Term Logic Slim V2 AI fields: `investmentThesis`, `coreDrivers`, `keyRisks`, `reviewTriggers`, `logicStatus`, `confidence`, and `nextReviewDate`. A cross-language regression feeds that raw Python response into the browser workflow/validator and requires `previewReady`.

## Preserved boundaries

- Current State V1/V2 readers, V3 `userDecision`, legacy render fallback, anchor/protected-context/stale-tab guards.
- Legacy Long-Term Logic reader and audit/history, Slim V2, manual strict transport, and API transport.
- `legacy_price`, State-Watch, Plan Runtime, PlanReview, Plan Draft compatibility, and legacy Plan editing/trigger semantics.
- IndexedDB, localStorage cutover/recovery, backup/import/export, critical saves, and multi-tab protection.
- OneDrive handoff core, local Universe registry, Supabase auto-add/Auth/RLS/migrations, PC Reader, production PC AI Bridge, Windows scheduled tasks, DailyMarketUpdate, and market/status/application/social bridge boundaries.

No migration write is introduced on load. Source rollback is data-safe within the existing V3/Runtime/LTL compatibility boundaries; it restores UI entries and deleted code/test assets only.

## Verification

- JavaScript: 677/677. The baseline count drops by two because three dead Local Overrides tests were retired and one cross-language contract test was added; surviving coverage was not removed.
- Python: 21/21. Three dead Local Overrides builder tests were retired; the current acceptance-server allowlist/security tests remain.
- Browser acceptance: 1280×900 and 390×844 passed for Discussion User Decision, Manual Analysis Sync/Long-Term Logic, Plan modes, State-Watch, Plan Runtime, and Discussion anchor/storage failure flows. No page errors or horizontal overflow.
- Publication artifact integrity, dependency closure, cache version, manifest hashes, and credential scan are release-gated after the source/version commits.

## Deferred to Wave 2

- Consolidate the three legacy Plan generation paths.
- Clarify PlanReview versus State-Watch UI responsibilities.
- Consolidate maintenance tools without inventing a new settings architecture.
- Repository-script the PC Bridge auto-start installation/check.
- Consolidate old/current documentation.
- Investigate external Plan/Operation application bridges and the social publisher.
- Reduce coupling to the external market updater path.

## Deferred to Wave 3

- Remove Current State V1/V2 readers or legacy Long-Term Logic readers only after migration inventory.
- Deprecate/remove `legacy_price`, shrink old backup readers, or remove Phase 1A guards only after migration evidence.
- Retire the OneDrive fallback only after a separate recovery decision.
