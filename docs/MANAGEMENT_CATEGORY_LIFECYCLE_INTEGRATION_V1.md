# Management Category Lifecycle Integration V1

## Repository and baseline

Authoritative repository: `investment-workbench-mobile`; remote: `https://github.com/flyinlemon-H/investment-workbench-mobile.git`; branch `main`. The initial worktree was clean. Fresh `git fetch origin main` resolved both HEAD and origin/main to `16be2111de8c5df2540e7f7b043a9faa28f55964`, ahead/behind 0/0, one main worktree. There was no source or generated market-data/bridge divergence. This is the actual editing baseline.

Release candidate: `management-category-lifecycle-v1-20260908`. Stop before push, Pages deployment, or production smoke. The user's explicit push authorization is the final release gate.

## Read-only current production inventory

Inspected the existing user Chrome production page on 2026-09-08 without refreshing, exporting, restoring, assigning categories, or changing investment data. The maintenance page showed **24 / 24 records**, including one established legacy cash ledger. The normal stock page showed **23 pending targets**; each of core/watch/candidate/ETF was empty. Together these observations establish:

| Measure | Count |
| --- | ---: |
| Total records | 24 |
| Classifiable targets | 23 |
| Classified targets | 0 |
| Unclassified targets | 23 |
| Inconsistent classified targets | 0 |
| Excluded special records | 1 |

Old role labels visible in maintenance are not managementCategory assignments. No automatic repair was performed. No real portfolio contents are copied into test fixtures or public release assets.

## Invariant and authority

For every current fully classified classifiable target, canonical `state.stocks[].shares` and `managementCategory` are a single business state:

- `candidate` requires shares = 0; shares = 0 requires `candidate`.
- Shares > 0 excludes `candidate`. Individual stocks allow `core` or `watch`; ETF assets allow `etf`.
- Shares must be finite and nonnegative. Fractional direct corrections retain the existing form's numerical capability; operation-result entry retains its existing integer constraint.

Eligibility reuses **ManagementCategory.isManagementCategoryTarget**, including the accepted SymbolIdentity legacy-cash and special/system exclusions. Malformed market targets are not excluded to evade identity validation. Cash is excluded from counts, assignment, repair, lifecycle derivation, and category/stock-symbol requirements. The four ordinary stock filters remain exactly 核心仓 / 观察仓 / 候选仓 / ETF. Compatibility maintenance screens and legacy role fields are preserved, with no V1B cleanup.

Management category is owned by the user. The deterministic program derives legal transition choices, shows the result, validates it and saves it only after confirmation. AI, Discussion, Current State, Plan judgments, Runtime, PlanReview, News, Fundamental, Valuation, LTL and Homepage gain no category authority. A plan trigger or AI suggestion never creates a lifecycle change. `executePlan` below is an existing **user-confirmed recording action**, not automatic Plan/Runtime execution.

## Transitions and confirmation

Held core/watch/ETF → zero: one combined holding/category confirmation requires candidate. There is no keep-category or later option. A direct correction uses neutral “确认修改” wording and creates no trade or operation audit.

Zero → held individual stock: the shared modal requires an explicit core/watch choice, shows old/new shares and classification, then one final confirmation. Zero → held ETF: only ETF is possible, with explicit combined confirmation. Permanent asset type is never rewritten by lifecycle derivation; the repository's existing `type: 'etf'` survives clear/rebuild, and an explicit `assetType: 'ETF'` is recognized without introducing a schema.

Partial increases/reductions keep category unchanged and show no lifecycle modal. The stock form does not include an unchanged category in its field patch. Category-only core ↔ watch edits retain the existing detached category patch; no holding change, Universe enqueue or Discussion invalidation occurs.

New targets and manual category edits validate shares/category/type together. Invalid manual choices are blocked with inline guidance, not silently normalized. Direct share correction, new stock creation and all ordinary/compatibility stock editors share `save()`.

## Exact canonical share-write inventory

This inventory was established from source before integrating the writers and rechecked after implementation.

| Entry/path | Can change canonical shares? / current save | Lifecycle protection and reason |
| --- | --- | --- |
| Normal target add/edit; detail edit; maintenance “编辑基础信息/编辑计划”; parked legacy table edit | Yes: all route to `openModal` → `save()` → PlanV2 detached candidate → `persistCandidateSnapshot` | Integrated. Cross-zero confirmation; explicit stock build choice; type/category validation; stale opening state rejected; unchanged category omitted from patch. New target requires a valid category. |
| Direct holding correction | Yes: the same `fShares` stock form/save handler | Integrated identically. No invented buy/sell/execution/operation record. |
| “实际操作结果录入”, manual or AI-request-associated source | Yes: `previewOperationEntry`/`confirmOperationEntry` → `OperationEntry.applyDirectResult` | Integrated. Contrary to a history-only workflow, this actually writes shares and average cost. It retains exactly one factual operationApplicationAudit and never derives trade price, direction, cash or fees. |
| Operation draft save/exported application request | No: `saveDraft`, `createApplicationRequest`, `markApplicationRequest` write a draft/request, not `state.stocks` | No canonical transition until the explicit direct apply above. Application bridge status is read-only. |
| Compatibility `executePlan`, user elects automatic holding/cash update | Yes: old shares ± recorded quantity, existing ETF value/cash updates, completed plan and executionLog, now detached `persistCandidateSnapshot` | Integrated. Mode selection precedes final combined holding/category confirmation. Re-entrant execution is guarded. Plan trigger evaluation itself does not call this writer. Existing ledger behavior is preserved. |
| Compatibility `executePlan`, history-only mode | No share changes; saves completed plan/executionLog | Category-neutral. The history-only option changes no holding fact, so it cannot leave a newly invalid cross-zero pair. |
| JSON backup import / recovery adoption | Yes: replaces a complete snapshot via `handleImport` → `createValidatedCandidateSnapshot` → `persistCandidateSnapshot` | Shared save validator blocks invalid classified pairs. Inconsistent backup opens detached repair Preview/Confirm before adoption; cancel/failure retains current state. Valid backup retains exact shares/category/type. |
| Explicit reset/clear local data | Removes all targets: `resetSeed` → detached critical snapshot | Empty target set satisfies the invariant; no per-target holding transition is fabricated. |
| Startup load, normalize, export projection, legacy storage recovery/migration/cutover | No user holding edit: reads/copies existing compatibility state through existing storage architecture | Read-first compatibility. Missing categories and old contradictions are not inferred or repaired on load. Classified contradictions are exposed for explicit repair and cannot pass the normal save gate. Storage engine recovery is not redefined as a new holding operation. |
| `StorageManager.saveState`; generic `saveState`; all other canonical module commits | Save whole state; no other discovered business share assignments | `ManagementCategory.validateState` is applied at StorageManager's normal save queue boundary, plus detached critical persistence. Plan/Runtime/Current State/analysis/price/Universe writers cannot persist an invalid classified pair. |
| Position calculations, old role/type readers, portfolio/analysis DTOs and v13 models | Read/derive quantities in noncanonical view models, not writes to canonical stock shares | No lifecycle authority. No portfolio rewrite, market-pipeline mutation or new Universe record. |

`shares` writes discovered in product JavaScript are the stock payload assignment, `OperationEntry.applyDirectResult`, and optional holding update inside `executePlan`; snapshot replacement covers backup/reset. All are reviewed above.

## Atomic save, stale data and duplicate prevention

`ManagementCategory.transition`, `compatibility` and `validateState` are shared deterministic rules. StorageManager validates before queuing a normal canonical save; load validation remains separate. `persistCandidateSnapshot` also validates before protected critical persistence.

The lifecycle dialog binds the complete canonical state at opening, derives constrained choices, and verifies that binding on Confirm. The stock form binds its opening state and freezes inputs while confirmation/saving is pending. Operation Preview additionally binds complete state and input values separately from the existing position hash. A stale/forged choice cannot persist an invalid category. Repeated clicks are guarded in the dialog, stock save, operation confirmation/application and compatibility execution.

Operation application now builds a detached candidate containing shares + category + cost + its existing factual audit. Canonical state is adopted only after a confirmed successful save; thrown or false persistence leaves the old state intact. Successful operation/execution also advances the existing top-level modified timestamp. The existing MultiTabProtection lock/revision guard remains in use; a second tab's newer canonical write blocks the old tab.

After successful lifecycle commit, targetFilter follows the new category and the current detail remains open. Returning to the list shows the new category without refreshing. Membership remains exactly one for every classified target. No category-only Universe enqueue occurs. Combined existing-symbol edits retain Foundation's idempotent Universe reconcile/check; no duplicate identity is introduced and no Universe redesign is included.

## Legacy, repair and backups

Old unclassified records remain readable and enter the existing 整理分类 flow with no inferred assignment. `pending` additionally includes inconsistent classified targets. The banner signals that management categories need organization or repair. Explicit repair shares the exact eligible identity/session and Preview binding safeguards from the Legacy Assignment Hotfix.

A classified zero-position target has only candidate in repair; a held ETF has only ETF. The mandatory result is displayed, not written, on opening. A held individual candidate requires core/watch selection. Preview shows old → new classification and one Confirm atomically saves the repaired snapshot. Storage failure retains original data and selections.

Import normalization preserves invalid classified pairs for inspection. `handleImport` detects them and opens the same repair UI against the detached backup, clearly stating that confirmation adopts/replaces local data and downloads the old backup first. No intermediate inconsistent snapshot is adopted. A wholly legacy backup without category retains Foundation's normal explicit restore compatibility. If a backup also contains unclassified records, the existing exact-set organization flow asks for explicit assignments for its pending records; no choice is inferred.

## Discussion and other boundaries

Discussion continues to derive held/zero-position semantics solely from canonical shares. `managementCategory` is not added to protectedHash, sourceDiscussionVersion, holding snapshots, technical anchors, AI JSON, Current State or Discussion V3 schemas. Category-only edits preserve the entire built Discussion context. Cross-zero category changes add no second hard block; real-handler acceptance starts Discussion, confirms the holding change, acknowledges the existing holding warning and successfully imports valid current zero/held semantics.

No Homepage Risk Alert, portfolio classification, Plan/Runtime schema, Current State schema, Discussion schema, LTL schema, Manual Analysis Sync field, Supabase schema/RLS/RPC/cloud field, or market-pipeline change. No paid AI calls, brokerage orders, deployment or real data mutation in testing.

## Validation and release evidence

Deterministic focused unit suite: 20 new tests (clear core/watch/ETF; individual core/watch build; ETF build; partial changes; invalid shares/type/category; explicit repair; legacy/cash; Discussion context; detached operation failure/staleness/duplicate).

Full JavaScript: **881/881**; Python: **21/21**. Surviving prior coverage is retained. The Plan compatibility VM load order was corrected to load SymbolIdentity before ManagementCategory, matching production. Foundation browser coverage now expects the required confirmed ETF rebuild instead of its former documented lifecycle gap.

Browser acceptance: lifecycle, category Foundation, category Legacy Hotfix, Discussion Holding Reconciliation, Discussion Reliability, Discussion Data Readiness/Return Flow, V1A Navigation, Homepage Risk Alert at **360×800, 390×844, 1280×900**; Technical Anchor, Plan Mode, State Watch and Plan Runtime at their existing **390×844, 1280×900**. **12 accepted scripts / 32 viewport runs**. New lifecycle acceptance includes actual-operation clear/build, compatibility execution, atomic storage failures (throw/false), duplicate submit, stale Preview, stale tab, list movement/detail retention, invalid save gate, explicit backup repair, legacy restore, and actual Current State import across clear/build. No page errors or overflow. Screenshots were inspected.

Two supplemental historical scripts were first run against unmodified fetched `16be211`, then the candidate. `discussion_user_decision_browser_acceptance.cjs` fails the same obsolete five-action assertion (actual two primary Discussion actions). `manual_analysis_sync_browser_acceptance.cjs` fails the same attempt to click hidden `.tab[data-tab="tools"]`. No test assertion in these scripts or corresponding obsolete UI assumption was changed. These are disclosed pre-existing non-blocking failures, not represented as passing. Logs: ignored `test-results/lifecycle-baseline-*.log` and `test-results/lifecycle-{discussion_user_decision,manual_analysis_sync}.log`.

Dependency validation: `npm ls --all --offline` passes; dependencies/lockfile unchanged. Credential and asset-integrity checks use the repository's existing `containsCredential` and `artifactPlan` validators. Source/version/manifest commit and final Git gate evidence are recorded below after local preparation. No push is performed.

## Fifteen acceptance answers

1. Current fully classified classifiable targets: zero ↔ candidate; held individual ↔ core/watch; held ETF ↔ etf.
2. Yes, valid current candidate means zero shares.
3. Yes, held candidate is blocked at the canonical save boundary.
4. Core clear requires confirmed atomic candidate transition.
5. Watch clear requires the same confirmed candidate transition.
6. ETF clear preserves permanent ETF asset type and sets managementCategory=candidate.
7. Individual build allows exactly user-selected core or watch.
8. ETF rebuild enters etf after confirmation.
9. Partial increases/reductions keep category, without a lifecycle prompt or category field patch.
10. Direct holding correction uses the same lifecycle rules and creates no fake history.
11. Actual operation entry really changes canonical shares; it now uses the same rules and preserves one factual audit.
12. Yes, shares/category are persisted in one detached atomic business candidate.
13. No, managementCategory does not enter Discussion protected context.
14. Yes, Discussion still uses canonical shares for holding status.
15. No, AI/Plan/Runtime acquire no authority to modify managementCategory.
