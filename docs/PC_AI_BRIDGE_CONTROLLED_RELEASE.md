# PC AI Bridge + Long-Term Logic controlled release

Status: **HISTORICAL — superseded production status**

This document records the 2026-09-02 controlled-release process. The Bridge is now an accepted production capability and starts through the existing Windows logon task. Use `pc-ai-bridge/README.md` for current operation; the pending/deployment language below is retained only as release evidence.

## Immutable rollback baseline

- Last known-good production HEAD: `ec24347c9c7a35671912c79bd6a10d255167d1df`
- Asset version: `current-state-input-boundary-20260902`
- This baseline must not be confused with the later market-only commit `eeb111056527cec08d6d6cce5182fd917c52ad47`.

The user explicitly authorized this one controlled release on 2026-09-02: final review/tests → source commit → asset version → manifest → integrity and push safety report → main push/deploy → immediate real Windows Chrome acceptance. Local Overrides is no longer a pre-deployment gate. Deployment success is not functional acceptance.

## Scope and publication boundary

Only PC AI Bridge Foundation, Long-Term Logic strict shared Manual/API processing, atomic persistence, history, availability UI and necessary release packaging are in scope. No redesign of Discussion, Current State, Plan, PlanReview, Portfolio Review, Decision Compression, holdings, allocation or market modules.

The two market bridge files in this checkout currently match the independently published `eeb1110` blobs. They must not enter the feature/source commit. Preserve the market-only commit in history.

Read-only Pages configuration inspection found legacy publication from `main:/`. A manifest alone cannot exclude local components from that deployment. The minimal Actions publication workflow instead builds `_site` from a strict browser-asset allowlist and checks committed source hashes/cache versions. It excludes `pc-ai-bridge`, tests, scripts, environment files and local artifacts. Pages must be switched to workflow publishing at the final production safety gate, before pushing the commit containing the Bridge.

Automatic market-only commits remain supported: artifact generation validates the two committed market files and updates only their hashes in the delivered manifest. Source commits and the repository manifest are not rewritten by market publication. The delivered manifest also records `deploymentCommit` for exact production identification.

Official workflow guidance: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## Post-deployment acceptance

- Verify the expected deployment commit, asset version, all published hashes and absence of Bridge/env/test assets.
- Confirm Chrome Local Overrides is disabled. Check startup, core workspaces, manual Long-Term Logic controls and 390×844 layout first.
- Use deterministic mock Bridge only for initial production-Origin health, LNA allow, OPTIONS/CORS, POST and shared pipeline proof. No provider secret or paid call is required.
- Run a controlled synthetic Long-Term Logic save once, verify history and reload; invalid content and unavailable Bridge must leave canonical data unchanged with zero writes. Never alter real holdings, plans, allocations, orders or broker facts.
- The user handles native LNA allow/deny choices and native clipboard paste where automation cannot safely operate or prove them.
- Only after transport/pipeline acceptance consider a separate minimal paid DeepSeek request. It is not automatic.

## Rollback response

For startup/core workflow regression, broken manual transport, wrong-stock writes, failed-request writes, history corruption, fatal cache mismatch or leaked public secrets: stop feature testing and restore the exact rollback baseline promptly. Preserve candidate commits and evidence; never force-reset user work or rewrite remote history.

A safe emergency path is a dedicated rollback ref pointing at the immutable baseline and temporary legacy Pages publication from that ref (the baseline contains no new local Bridge). Verify deployment and old asset hashes before further repair. Keep the candidate main history for diagnosis. Do not switch legacy publication back to a candidate containing the Bridge.

LNA UI differences or Bridge-not-running alone are not automatic rollback triggers when manual/core workflows work and no erroneous writes occur.

Until all production acceptance checks pass, status remains **deployed candidate / production acceptance in progress**, not **fully accepted production release**.
