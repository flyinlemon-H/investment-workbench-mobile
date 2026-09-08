# Stock Management Category Foundation V1

## Baseline and release boundary

Repository: `investment-workbench-mobile`. Remote: `https://github.com/flyinlemon-H/investment-workbench-mobile.git`. Branch: `main`. Before editing, fetch succeeded and HEAD = origin/main = `ef8c650f8c4413684e8d25849462af4d1168836d`, ahead/behind 0/0, clean working tree, one main worktree. No source or generated market divergence. Accepted asset: `discussion-holding-reconciliation-v1-20260908`.

Release candidate: `stock-management-category-foundation-v1-20260908`. This task stops before push and Pages deployment; both require subsequent explicit user authorization.

## Canonical classification and authority

The exact field is `state.stocks[].managementCategory`. Its only valid values are:

| Value | Normal UI label |
| --- | --- |
| core | 核心仓 |
| watch | 观察仓 |
| candidate | 候选仓 |
| etf | ETF |

The user chooses one classification. `ManagementCategory.matches` checks only this field; shares, watchlist, legacy role and asset type never determine list membership. Every classified target has exactly one membership. Missing/invalid legacy values have zero normal category memberships and are offered maintenance, never a fifth category. Compatibility is computed by `needsAssignment`, not persisted as an enum or silently written during load.

The field is stored in the existing local canonical state through StorageManager and its active localStorage/IndexedDB adapter. There is no separate category store, Current State V4, or migration of the AI/history contracts. No AI, Discussion, Plan, Runtime, Current State, News, Fundamental, Long-Term Logic, portfolio review or analysis import writes this field. Backup restoration remains an explicit user action and preserves the stored value.

`role` and `type` retain their historical meanings and remain readable. The repository's existing ETF asset representation is `stock.type === 'etf'`; no new asset-type schema is introduced. `type: 'etf'` can coexist with `managementCategory: 'candidate'`. A category-only edit never rewrites type or role. Shares remain the sole canonical held/zero-position fact for Discussion.

## Read-only data inventory and migration confidence

The repository contains `seedStocks=[]` and market/analysis bridge outputs, not the user's current browser investment store. No attached current investment backup was provided. Therefore **zero current personal stock records were accessible for a trustworthy holdings/role inventory**. Market coverage and historical AI outputs cannot establish current shares, roles or management intent. No production browser storage was accessed or changed. This limitation is intentional; the following fixture inventory is not presented as the user's real portfolio.

Repository inspection found that `normalize` synthesizes `role='核心仓'` or `role='观察仓'` from missing role/type, and `openModal` historically defaults role to 核心仓. Thus even a stored exact legacy role string cannot prove explicit user ownership. **There are no safe automatic legacy mappings in this release.** Exact confidence applies only to an already-valid canonical managementCategory. Growth, satellite, generic watchlist, held/zero shares and ETF type alone are ambiguous; absent meaningful evidence is missing. Both require user selection and confirmation.

`ManagementCategory.inventory(stocks)` is a deterministic, read-only projection sorted by symbol. It includes symbol, name, shares, asset type/old type, legacy role, old watch flags, old UI memberships, confidence and confirmation requirement. It does not normalize or mutate the input. The repair UI reads the current local state only when the user opens it; it never bulk-classifies user data on startup.

| Symbol (synthetic) | Name | Shares | Asset/old type | Legacy role | Old watch flag | Old UI memberships | Confidence / confirm |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| 600001.SS | 测试1 | 100 | watching | 成长仓 | true | all, holding, watching | exact core / no |
| 600002.SS | 测试2 | 100 | holding | 成长仓 | absent | all, holding | exact watch / no |
| 600003.SS | 测试3 | 0 | etf | 成长仓 | absent | all, etf, zero | exact candidate / no |
| 600004.SS | 测试4 | 100 | etf | 成长仓 | absent | all, holding, etf | exact etf / no |
| 600005.SS | 测试5 | 100 | holding | 成长仓 | absent | all, holding | ambiguous / yes |
| 600006.SS | 测试6 | 100 | holding | 卫星仓 | absent | all, holding | ambiguous / yes |
| 600007.SS | 测试7 | 100 | absent | absent | absent | all, holding | missing / yes |

The four exact fixture categories above are explicitly set by the fixture author; they were not inferred from their legacy columns. The real current-data table must be populated from the user's local state after release; no real ambiguity is resolved by this task.

## Stock list and navigation

Normal stock tabs are exactly 核心仓 / 观察仓 / 候选仓 / ETF, in one row. 全部, 持仓, 观察 and 零仓候选 no longer appear as normal stock filters. Holding metadata remains 持仓 / 无持仓; ETF type remains card metadata.

Fresh top-level 标的 entry resets to core and clears search. Returning from a stock detail preserves the selected category. Search filters only the current category and displays `当前分类中没有匹配标的。` on no match. Obsolete all/holding/watching/zero session-like values resolve to core; valid new values remain valid. There was no persisted stock-list session key in the baseline; the filter was an in-memory variable. No navigation or render writes canonical state.

The top navigation remains 今日 / 标的 / 计划 / 记录 / 更多. Stock workspaces remain 当前判断 / 计划 / 研究资料 / 历史, opening to Discussion. Plan center retains its existing plan-oriented scope, independently of stock-list filtering. Homepage reminder eligibility is unchanged.

## Explicit repair flow and atomic persistence

The compact banner reports how many old records lack a valid classification. 整理分类 opens a keyboard-accessible native modal with name, symbol, legacy role/type, shares and an initially blank single select. The user can classify a selected subset; Preview enumerates every assignment and explicitly says remaining stocks are preserved. No selections are silently accepted.

Preview validates the exact enum, unique record ID, canonical symbol identity, duplicate symbols and category/holding compatibility for **all** selected records. Confirm rechecks the full current-state binding and the selection binding and rebuilds the detached candidate. Stale previews require another Preview. A forged selection cannot reuse a valid preview.

One confirmed batch performs one critical `persistCandidateSnapshot` call, retaining the existing MultiTabProtection guard. Only a resolved successful save adopts the candidate. Invalid input makes zero writes. Failure retains the original state and selected choices; the error explicitly says data is preserved. In-flight controls and cancellation are disabled and duplicate confirmation is ignored. No normalize-and-assign step runs on page load.

## Add/edit behavior

The ordinary add/edit form exposes a required 管理分类 single select with no new-stock default. Null, empty, unknown and multiple values are rejected with Chinese guidance next to the field. New stocks additionally satisfy existing name, canonical code, duplicate-symbol and Plan validation. New category assignments require finite nonnegative shares: candidate requires zero; core/watch/etf require positive shares. Category does not overwrite actual asset type.

A category-only edit is detected using the original form snapshot and persisted as a detached category patch. It changes only managementCategory and the store's modification timestamp. Shares, average cost, old role/type, Plans, Current State, Runtime, history, Universe queues and Discussion binding remain identical. Concurrent canonical changes since opening require reopening the category editor. No Universe reconcile/enqueue call is made by the category-only patch.

Combined ordinary field edits retain the existing Plan candidate builder, with detached critical persistence instead of early global adoption. The form cannot be closed/reopened or submitted repeatedly while saving. Successful new-stock add retains the existing Universe add behavior. These persistence adjustments do not change Plan or operation semantics.

## Backup and AI boundaries

`alpha3ExportSnapshot` and `createValidatedCandidateSnapshot` preserve the new stock property. Actual isolated canonical storage round trips and reloads retain all four values. Old backups remain loadable, receive no invented classification, and display repair after restore/reload. Invalid historical values likewise require repair rather than breaking load. The repair helper never stores `needs_assignment` as managementCategory.

Discussion continues using shares for holding facts. Management category is absent from protectedHash, sourceDiscussionVersion, holding references and technical anchor. A category-only edit produces byte-identical Discussion context. AI output allowlists and scoped module importers are unchanged. Legacy role references in prompts remain a later migration opportunity, not a new AI management authority.

Stock Universe and Manual Analysis Sync contracts are unchanged. Universe projection remains symbol/display name only; explicit queue tests show an existing-symbol category change generates zero inserts. No Supabase schema, migration, policy, cloud data or market pipeline changes.

## Lifecycle V1 handoff

No automatic clear-out/build-position transitions are implemented. A shares-only edit leaves managementCategory unchanged. Inline compatibility feedback identifies contradictions; the existing holding/operation paths continue working. Explicit new/reassigned categories are blocked if contradictory.

Detected synthetic dependency: an ETF candidate with zero shares, changed through the real stock editor to 100 shares, remains `candidate`, with a visible warning. Also, older or imported states may contain `core/watch/etf + zero shares` or `candidate + positive shares`; they remain readable. These are not presented as current real portfolio observations.

Management Category Lifecycle Integration V1 must own:

1. `>0 → 0`: confirm the clear-out rule and atomically persist shares/category as candidate, including ETF assets while preserving ETF type.
2. `0 → >0`: require explicit appropriate management choice as part of the same successful holding/trade transaction; candidate cannot remain a valid held current state.
3. Integrate manual shares edits, operations/execution, relevant imports and failure rollback without partial category/holding adoption.
4. Repair preexisting contradictions using canonical shares and user ownership, preserving Discussion's shares-based validation and category-only hash stability.

## V1B cleanup candidates (not broadly deleted here)

| Obsolete path | Status / later cleanup |
| --- | --- |
| targetFilter all / holding / watching / zero membership | Replaced only at normal stock-list filter boundary; remove obsolete call assumptions in V1B |
| Old ETF type-derived tab | Normal membership now canonical category; legacy type metadata remains |
| Hidden `.tabs [data-tab=holding/etf/watching]` | Kept parked by V1A and not focusable; compatibility handlers remain |
| countHolding / countEtf / countWatching DOM nodes | Hidden compatibility nodes retained |
| currentTab legacy aliases, filtered(), renderTable() historical definitions | Retained; normal route enters renderTargets with safe new category |
| typeToggle watching and fRole legacy fields | Kept as labeled compatibility data; not top-level classification |
| v13_detail_workspace_tab_v1 | Detail-workspace compatibility only; not a management-category session key |

## Acceptance questions

1. Yes: normal stock UI has exactly 核心仓 / 观察仓 / 候选仓 / ETF.
2. Yes: 全部 is removed from normal stock UI; unrelated advanced-comparison filters are unchanged.
3. Yes: 持仓 is display metadata, not a management category.
4. Yes: 观察仓 uses managementCategory=watch exclusively.
5. Yes: 候选仓 replaces 零仓候选 in normal navigation.
6. Yes: each classified target belongs to exactly one category.
7. Canonical field: state.stocks[].managementCategory; enum: core/watch/candidate/etf.
8. Yes: new stocks require explicit classification, with inline validation.
9. Yes: users decide; shares/watchlist/type/legacy role never infer category.
10. Yes: ETF type and candidate category coexist.
11. Yes: ambiguous legacy roles are never silently migrated; even synthesized core/watch roles require confirmation.
12. Yes: backups lacking category load and enter repair, without category writes on load.
13. Yes: changing category alone preserves Discussion protected context and source version.
14. No: automatic lifecycle transitions have not been implemented.
15. Lifecycle V1 must atomically integrate >0→0 candidate transitions and 0→>0 explicit noncandidate selection, preserve ETF type, repair contradictions and cover all holding-changing operations with rollback.

## Validation evidence

Full JavaScript: **846/846**, including 23 new category tests; focused category/editor/identity: **55/55**. Python: **21/21**. Existing full suites cover Discussion Holding Reconciliation, Reliability, Readiness, V1/V2/V3 Current State, Homepage, Plan/Runtime, stock add/edit, storage, backup and Universe. One source-shape identity assertion was updated for the explicit new payload field; the actual canonical identity and duplicate checks remain unchanged. The Plan editor VM harness now supplies an explicitly classified synthetic stock and realistic form-field snapshots.

New real-handler browser acceptance passes at **360×800, 390×844, 1280×900**: exact four tabs, one row, no duplicate membership, overlapping held/watch fixture, ETF candidate separation, core default, scoped search, return navigation, required add, contradiction prevention, category-only protected-state preservation, zero Universe changes, category/migration save failures with selection retention, stale Preview, duplicate confirmation, old backup restore/reload, keyboard access and no runtime errors/overflow. Mobile and desktop screenshots were inspected. Results: `test-results/management-category/results.json`.

Existing Discussion Holding Reconciliation, Workflow Reliability, Data Readiness/Return Flow, V1A Navigation and Homepage Risk Alert browser suites pass at all three sizes. Technical Anchor, Plan Mode, State Watch and Plan Runtime suites pass at 390×844 and 1280×900. V1A's fixture now explicitly assigns categories and searches within candidate; legacy mixed-filter expectations were replaced by unique category counts. Existing stock-editor browser fixtures explicitly supply candidate for their zero-position test stocks. Live cloud E2E was not run; Universe isolation/projection/queue/security regressions run locally with mocks, and no cloud writes are made.

Dependency tree validation (`npm ls --all --offline`) passes; missing platform-specific optional packages are expected. Dependencies and lockfile are unchanged. The precommit artifact planner validates **82 delivered files** (81 source assets plus effective manifest), market bridge delivery consistency, cache-version bindings, browser dependencies and credential markers. Changed source/tests/docs also pass the credential scan. `git diff --check` passes. The final committed version/manifest receives the same artifact checks during release preparation.

All automated fixtures use isolated synthetic browser/state storage. Browser routing blocks external requests, and no paid AI calls or real investment data writes occur. Source changes are limited to category model/UI, stock form persistence/navigation wiring, publication manifest generation and tests/docs. Homepage, Discussion contracts, Plan/Runtime schemas, Supabase and market pipeline files remain unchanged.


## Local release preparation

Source commit: `19d6365`. Version commit: `b1dfa35e720c92c6c2c1a8a13b3bb791d9f96018`. The final manifest references that version commit and lists 81 source assets. The exact committed asset planner passes for 82 delivered files, including the effective manifest. Release/cache/publication-boundary tests pass **10/10** after versioning. The local review artifact is in `test-results/category-release-artifact/`. No push, Pages run or production smoke has been initiated. Final main/remote/ahead-behind and clean-worktree evidence is reported at the push gate after the manifest commit.
