# Discussion Holding Context Reconciliation V1

## Production prerequisite and repository baseline

Authoritative repository: `investment-workbench-mobile`; remote: `https://github.com/flyinlemon-H/investment-workbench-mobile.git`; branch: `main`.

Before edits, HEAD was `e5297ca07c02e7b0311a42a9115be33e2ee2495a`. Fetch succeeded and origin/main advanced to `4a392121d4f7e5c22395079a5b88435256a94bc1`; ahead/behind was 0/1. The only remote commit was `Daily market data update 2026-09-07`, changing two generated bridge files. The two initial local modifications were those same files, with contents identical to origin/main. They were preserved in stash `holding-reconciliation-baseline-bridges`, main was fast-forwarded, and the stash was applied without conflicts or remaining differences. Editing baseline: HEAD = origin/main = `4a392121d4f7e5c22395079a5b88435256a94bc1`, 0/0, clean, one main worktree. No source divergence or market bridge divergence remained. The preservation stash is retained.

The prior task **Fix Discussion workflow reliability** records **Discussion Workflow Reliability Hotfix V1 production status: PASS** at `e5297ca`, asset `discussion-workflow-reliability-v1-20260907`. Pages deployment [34087812431](https://github.com/flyinlemon-H/investment-workbench-mobile/actions/runs/34087812431) succeeded; its production report confirms 79 matching assets and isolated production smoke at 360×800, 390×844 and 1280×900. This is the accepted source baseline; the newer market-only commit does not overlap Discussion source.

## Root cause and new principle

State change is not an error. Proven conflict with current canonical facts is an error.

`DiscussionWorkbench.buildContext` puts `{shares, avgCost, role, type}` into `protectedSnapshot.holding`, alongside symbol, technical anchor, Plan references, PlanReview, Runtime, market risk and LTL. `protectedHash` hashes that entire snapshot. `sourceDiscussionVersion` hashes that snapshot plus current State ID, evidence fingerprint and technical readiness. A shares edit therefore changes both values.

Previously the UI's `DiscussionDataReadiness.sessionChanged` check blocked archive/import on any such mismatch. `DiscussionStateContract.validateJudgment` also required an exact source version; `buildCandidate` rebuilt canonical context and rejected protected hash, evidence or source version changes unconditionally. Thus even a final AI judgment informed by an intervening manual correction could not save.

Manual transport is a multi-turn human/AI conversation that the application cannot observe. A changed prompt snapshot does not prove that AI is unaware of the new facts. This release allows an explicit acknowledgment and current-fact validation only for proven shares-only changes.

## Deterministic reconciliation and protected boundaries

The small `reconcileContext` layer lives in the existing Discussion contract, outside rendering. Its outcomes are `no_change`, `warning_reconcilable` and `hard_block`.

`buildContext` retains a cloned `sourceBinding` containing the **exact original version hash input** in the in-memory prepared session. The hash algorithm, original hash inputs and resulting versions remain unchanged. This metadata is neither AI output nor persistent Current State data.

For a mismatch, reconciliation:

1. Requires explicit manual transport and finite, nonnegative original/current shares with an actual change.
2. Verifies both snapshots against their protected hashes and both full version preimages against their original source versions.
3. Removes **only** `protectedSnapshot.holding.shares` from copied preimages and compares every remaining field using deterministic stable serialization.
4. Requires identical evidence and full technical snapshots. Checks shares consistency across protected snapshots, currentFacts and references; compares all references except the shares and its derived holding hash.
5. Keeps missing/ambiguous preimages, unknown fields, identical facts with a mismatched version, symbol/State identity, technical changes, Plan/PlanReview, Runtime, LTL, market risk and research changes blocked.

Quantity and cost are separate in the canonical source. Only shares are authorized here. Cost, role and type differences still block, including shares plus any of those changes. The diff reports holding quantity/status changes and known technical/symbol/Plan/Runtime/LTL changes; other differences remain protected.

There is no new nonsemantic revision exception. The source version is deterministic from canonical fields rather than a general revision counter. If identical snapshots arrive with different versions, the code retains the hard block.

## Current-fact behavior

| Original → current | Result |
| --- | --- |
| Held → held, e.g. 6000 → 3200 | Quantity warning; acknowledgment permits current held-position validation and Preview. No mandatory restart. |
| Held → zero | Stronger status warning; compatible zero-position judgment passes, holding/reduce/protect-existing-profit claims fail. |
| Zero → held | Stronger status warning; compatible held-position judgment passes, explicit current-zero-position claims or invalid held contract fail. |
| Same shares | No new holding warning; normal flow remains. Other protected mismatches still block. |

Canonical facts come only from `stock.shares` through `buildContext(...).context.currentFacts.holding.shares`. Category, historical conclusions and AI prose are never holding sources. The existing `process` / `validateJudgment` / `validateUserDecision` remain the business authority. Narrow semantic guards additionally reject the requested explicit current holding/zero-position conflicts, including when hidden in secondary judgment prose. No AI wording is rewritten. The validator is deterministic and does not claim general understanding of arbitrary investment prose or judge whether a quantity change should change the investment opinion.

AI must return the original symbol and sourceDiscussionVersion binding. It must **not** echo shares, facts, dates, IDs or acknowledgment fields; the allowlist still rejects them. Saved provenance retains the original discussion version, while `technicalSnapshot` and `references` are supplied from the rebuilt current canonical context. Thus the saved holding reference contains 1340, never the original 1000, after a 1000 → 1340 reconciliation.

## Preview, acknowledgment and atomic Confirm

`processImport` parses the preserved JSON, checks anchor and context safety, and uses the shared schema/business processor. An unacknowledged holding change cannot produce a confirm-ready result. Holding-specific validation waits for acknowledgment; unrelated schema, symbol, source and hard guard failures may reject immediately. After acknowledgment the same processor runs with current shares. A factual conflict cannot be overridden by clicking acknowledgment or forging ok/preview flags.

The compact message appears below JSON, next to Preview. It shows original/current shares, stronger zero-boundary wording when needed, **确认并继续预览** and **返回讨论**. Confirm remains disabled until valid Preview. Opening/reopening a same-stock import, a warning, failed validation and failed save retain the original text. Editing text invalidates acknowledgment and Preview. A direct textarea value mutation cannot reuse an older Preview.

Acknowledgment is bound to the original and latest current context. Preview is bound to the latest version, hash, evidence, technical snapshot and references. `buildCandidate` rebuilds canonical facts at Confirm, repeats reconciliation, checks the Preview binding and acknowledgment, then reruns the authoritative business validator. A holding change after Preview disables the save and requires fresh Preview/acknowledgment, including no-change → change and repeated quantity edits. Only the original and latest quantity matter.

The existing detached candidate and critical storage transaction remain intact: business/guard rejection invokes zero writes; one valid confirmation produces one atomic save; failed storage never adopts a partial candidate; double-click and stale-tab protections remain. No acknowledgment is persisted.

Holding reconciliation does not auto-start a discussion, invoke AI, discard JSON or redirect. An explicit **整理结论** action can build an archive prompt with current facts and the original source binding. Opening an import does not regenerate an existing archive prompt just because shares changed. The opening Discussion snapshot is retained for reconciliation.

## Manual/API boundary

Repository inspection confirms no active Discussion-specific PC/API request path in this baseline. Generic `AiApi` remains a transport service; legacy analysis helpers target other contracts. Only manual Discussion UI entry points pass `transport: 'manual'`. The common final importer and commit path default to hard-blocking holding mismatches for absent, API or Bridge transport. Existing direct `process` callers do not acquire reconciliation privileges. There is one business validator, not an API/manual duplicate.

## Validation and release

Accepted Hotfix baseline: 779 JS tests and 156 focused Discussion tests. This release adds 44 focused tests: all three transitions, no warning on no change, compatible historical V1/V2/V3, explicit conflict/forged Preview zero writes, source/symbol/schema allowlist, cost/role/type/Plan/Runtime/LTL/news/market/State/technical protection, ambiguous snapshots, conservative transports, stale Preview and atomic failure. Focused: **200/200**. Full JS: **823/823**. Python: **21/21**.

New real-handler browser acceptance passes at **360×800, 390×844 and 1280×900**: archive continuity, original binding with current facts, visible warning/action, acknowledgment, compatible saves, incompatible zero/held disabled + zero writes, JSON retention, return/reopen, stale Preview rejection, storage failure and duplicate-save protection. Screenshots were inspected at mobile and desktop sizes. Local results: `test-results/holding-reconciliation/` and `test-results/holding-browser.log`.

Existing Hotfix reliability, Data Readiness/Return Flow, V1A navigation and Homepage Risk Alert browser suites pass at all three sizes. Technical-anchor/protected-context/storage/stale-tab browser regression passes at 390×844 and 1280×900. Full JS also includes V1/V2/V3, parser/import, Plan/Runtime, LTL and storage atomicity. All browser fixtures use isolated storage and block external requests; no paid AI or production data writes occur.

Two existing source-shape assertions were adapted for the explicit archive refresh option. The missing-anchor browser message assertion now checks the earlier, specific anchor failure; its disabled/zero-write behavior remains. The remote market-only update had made the old 19-stock assertion obsolete (current delivery has 23); it now verifies a nonempty unique-symbol bridge against `latest_run.delivered_stock_count`, retaining technical indicator/complete-bar checks. No market data or generator was changed.

Dependency validation: `npm ls --all --offline` passes; expected optional platform packages may be absent. No dependencies or lockfiles changed. Release artifact integrity, cache binding, dependencies and credential markers are validated using the existing artifact planner against committed files, and changed source/test/doc files are scanned separately. Release candidate asset: `discussion-holding-reconciliation-v1-20260908`. Source commit, version commit, then manifest commit; final status must stop at **READY_FOR_PUSH**, with no push or Pages deployment until explicit authorization.

## Explicit non-goals

No Current State schema change, V4, Discussion V3 output schema change, AI-owned shares, persistent acknowledgment, category work (core/watch/candidate/ETF), actual operations/trade lifecycle, Homepage behavior, navigation redesign, general evidence reconciliation, Supabase migration/RLS/RPC, DailyMarketUpdate/bridge/provider/pipeline change, or API safety relaxation.
