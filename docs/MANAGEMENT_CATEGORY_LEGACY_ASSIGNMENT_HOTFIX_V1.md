# Management Category Legacy Assignment Hotfix V1

## Baseline and production diagnosis

Repository: `investment-workbench-mobile`; remote: `https://github.com/flyinlemon-H/investment-workbench-mobile.git`; branch: `main`. Before edits, HEAD and freshly fetched origin/main both resolved to `2370302a812f4bb40b1f61c799fbff8777152c3e`, ahead/behind 0/0. One main worktree, clean; no source or generated market-bridge divergence.

On 2026-09-08 the production page was inspected read-only in the user's Chrome profile. The banner reported 24 pending records. Opening the assignment dialog exposed 24 labels and existing ID/canonical-symbol DOM bindings. All four normal categories were empty. Under the Foundation's exhaustive missing/valid category partition, this establishes 24 total canonical records, 24 Foundation pending records, zero classified records. Of those, 23 are market targets with valid, unique canonical symbols; one is a cash ledger. Under the corrected eligibility boundary, the pending count is **23**, with **1 excluded special record**. These are dated observations, not constants in product code.

Exact offender: `id=cash`, name `现金(手动维护)`, blank code/symbol, legacy `role=现金`, `type=etf`, displayed shares 0. This is the repository's existing cash compatibility representation, despite the ETF type label. The other 23 identities are unique and canonicalizable; lowercase `2513.hk` correctly canonicalizes to `2513.HK` and is not an error.

The internal, private record-by-record table is in ignored `test-results/category-hotfix-production-diagnostic.md` (ID, symbol, type, domain eligibility, original assignment inclusion, validation outcome). It is not delivered by Pages. No real choices, Preview, Confirm, backup restore or test-state injection were performed on production. The real modal was cancelled.

## Exact failure pipeline

1. Foundation `needsAssignment` checked only whether managementCategory was missing/invalid, for every `state.stocks[]` row. It counted the cash ledger.
2. `inventory` projected all rows; the modal included the cash entry and recovered IDs through a symbol-based `find`, which was also ambiguous for duplicate symbols.
3. After a choice for cash, `buildCandidate` found its existing ID, but `canonicalMarketSymbol('')` returned `''`.
4. The `!symbol` arm of the combined invalid/changed/duplicate condition threw `标的代码无效、已变化或重复，请重新整理。` before creating or saving a candidate.

The exact baseline `2370302` model was loaded in an isolated VM with a synthetic mixed fixture carrying this observed cash identity shape. It reproduced the same message and 24 pending count; evidence is `test-results/category-hotfix-baseline-reproduction.json`. The production record was not assigned to reproduce this.

## Shared eligibility and preserved identity boundaries

`ManagementCategory.isManagementCategoryTarget` excludes only existing recognized non-market compatibility rows. It reuses two shared identity predicates:

- `SymbolIdentity.isLegacyCashRow`: existing `id === 'cash'`, `theme === '现金'`, or `role === '现金'` rule, extracted from `position.js`.
- `SymbolIdentity.isExemptIdentityRow`: existing Storage validation flags `isCash`, `isSystem`, `systemRow`, and cash/system `type` or `objectType`, extracted verbatim from storage validation.

The position cash helper and storage exemption helper delegate to their respective extracted predicate. Their semantics are preserved: storage exemptions are not expanded to all legacy cash rows, and the position helper is not expanded to all system rows. No holding/lifecycle behavior changes.

Ordinary records with malformed or blank market symbols remain in the category domain and block validation. Exclusion is never based on a failed symbol parse or a fuzzy cash name. The existing supported market canonicalization contract remains unchanged. A valid ETF remains eligible; the special cash ETF does not.

`targets`, `pending`, `inventory`, `needsAssignment`, and `matches` share this boundary. Banner count, modal records and Preview's exact expected pending IDs agree. Normal categories/search include only classified eligible records. Their four membership counts sum to classified eligible targets. Completion means no eligible pending targets, even when cash has no category. Plan-center rendering retains its previous scope.

Special rows are absent from assignment controls, counts, category membership, migration diffs and the write set. The detached snapshot retains their content unchanged. Restore does not infer or add a category. No category is inferred from old role, watch flags, ETF type or shares; shares retain only the preexisting manual-category compatibility validation.

## Assignment and atomic save

The modal uses inventory's existing stable record ID directly, with canonical symbol binding. An opening session captures all eligible IDs/symbols and pending membership. Array order has no semantic role. Preview and Confirm both validate:

1. Valid market symbols and unique real IDs/symbols; specific messages identify invalid/duplicate symbols.
2. Opening-session identities, removals, additions, category-domain changes and pending-set changes. Changed/removed identity messages identify the old symbol and require reopening.
3. Exactly one explicit allowed category for every pending ID, with the existing category/share compatibility guard.

Preview stays disabled until every displayed row has a choice. The migration now requires the exact complete pending set; the separate category-only editor still uses Foundation's single-target candidate path. Preview shows only category assignments. Changing selections invalidates it. Validation errors retain choices while the dialog remains open. Confirm retains Foundation's full-state/selection binding since Preview and rechecks the opening identity session. Unrelated post-Preview state changes require another Preview.

Only explicit Confirm calls `persistManagementCategory` / the existing detached critical `persistCandidateSnapshot` path. One candidate writes target `managementCategory` fields plus the existing top-level modification timestamp. Canonical state is adopted only after successful persistence. Storage exceptions/false results preserve prior canonical state and all choices. In-flight controls and repeated confirmation remain guarded. The StorageManager adapter and stale-tab persistence behavior are unchanged.

## Regression evidence

Synthetic fixture: 23 valid targets spanning held individual stocks, zero-position candidates, ETFs, old roles and watch flags, plus a cash row with the observed compatibility identity shape. No real holdings or investment choices are copied into fixtures.

New unit coverage: cash eligibility/memberships; mixed exact sets and field-only diffs; malformed/empty real symbol; canonical duplicate; before-Preview changed symbol, removal, addition, category change, domain change and duplicate; reordering; multiple blank special records; special symbol collision; every established special marker; exact assignment set/enum/compatibility; old backup and classified restore.

New browser acceptance uses actual handlers and isolated storage at **360×800, 390×844, 1280×900**. It verifies 23 banner/modal/Preview identities; all four user choices; disabled Preview; associated labels; no hidden special controls or duplicate DOM IDs; zero writes from Preview/Cancel; one atomic Confirm; thrown/false storage failures with choice retention; special-row preservation; category counts/search/completion and reload. Invalid, duplicate, changed, removed, added and externally classified targets are blocked at both Preview and Confirm. Multiple blank special rows do not block. Screenshots show no horizontal overflow and there are no runtime errors.

Results: `test-results/category-legacy-hotfix/results.json`; original Foundation browser acceptance also passes all three sizes. Full JavaScript, Python, existing browser suites, dependency tree, credential and release-integrity results are recorded in the release gate below.

## Explicit non-goals

No clear → candidate or build → core/watch/ETF lifecycle transitions; no trade-operation integration, AI recommendations/calls, legacy-role deletion, UI redesign, V1B cleanup, Discussion Holding Reconciliation/zero-position changes, protected-context/Current State schema changes, Plan/Runtime changes, Homepage changes, Supabase/Universe changes or market provider/registry/bridge/pipeline changes. No real classification is completed. No push or Pages deployment is performed by this task without separate explicit authorization.

## Validation and release gate

- Full JavaScript: **861/861**, including all 846 prior tests and 15 new regressions.
- Python: **21/21**.
- Foundation + hotfix browser suites: all three required viewports each.
- Holding Reconciliation, Discussion Reliability, Data Readiness, V1A Navigation and Homepage: all three required viewports each.
- Technical Anchor, Plan Mode, State Watch and Plan Runtime: 390×844 and 1280×900 each. Together with the above: **11 scripts, 29 viewport runs passed**.
- Dependencies: `npm ls --all --offline`, exit 0; dependencies and lockfile unchanged. Expected platform-specific optional packages remain absent.
- All changed source, tests and documentation pass the repository credential-marker check and `git diff --check`. Committed release asset/manifest integrity is checked during local release preparation.

Supplemental legacy scripts were also attempted. `discussion_user_decision_browser_acceptance.cjs` still asserts five primary actions; V1A intentionally exposes two primary actions and moves the others. It fails identically on an isolated, hash-verified unmodified `2370302` production artifact and on this hotfix. `manual_analysis_sync_browser_acceptance.cjs` attempts to click V1A's hidden old `tools` tab. These scripts are outside the accepted Foundation browser set documented in `STOCK_MANAGEMENT_CATEGORY_FOUNDATION_V1.md`. Their obsolete assertions have not been weakened and no unrelated UI has been changed to satisfy them. The supplemental failures are disclosed separately; do not describe every historical browser script as passing. The user has been asked whether the accepted Foundation suite defines this gate or whether historical-script maintenance should be included first.

Planned release asset: `management-category-assignment-hotfix-v1-20260908`. Local source/version/manifest preparation is authorized; push and Pages deployment remain separately gated.
