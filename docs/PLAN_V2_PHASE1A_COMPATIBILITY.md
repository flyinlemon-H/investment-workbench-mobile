# Plan V2 Phase 0 / 1A compatibility foundation

Repository: `flyinlemon-H/investment-workbench-mobile`, branch `main`.
Accepted baseline: `40d480dd3ab8dfd86652849babf8139953759809`.
Scope: canonical mode preservation, nullable editor repair, and isolation from legacy price workflows. This release does not expose state-watch creation.

## 1. Canonical mode and defaults

`state.stocks[].plans[].planMode` is normalized by `src/plan-v2.js`.
The only supported values are `legacy_price` and `state_watch`. An absent property deterministically means `legacy_price`; an explicit invalid value is rejected. Price, quantity, action, note, ID, order, and display labels never determine mode. No `name` or future Definition/Runtime fields were added.

Ordinary authoritative edits reject `planMode` as an unsupported field. Plan candidate saves also reject a mode change under an existing Plan ID. State-watch objects are structurally preservable, but the current editing, reconfirmation, termination, and execution APIs refuse their legacy operations.

## 2. Nullable editor bug and repair

Previously, `collectPlans` applied a positive-price-and-quantity filter before looking up the original object. An existing row with either nullable field failed the filter and vanished from the resulting collection without a removal action.

The collector now resolves existing rows by exact ID, preserves the original order and all untouched canonical fields, and applies only supported changes. An unchanged nullable field is preserved. Removing an editable legacy row explicitly cancels that original object, retaining its ID and incrementing its legacy version. State-watch objects are outside the editable row collection and remain present during stock metadata edits.

The ordinary editor shows a short, wrapping state-watch read-only notice outside its price tables. Derived default buy/sell rule text uses a price-pending label instead of displaying `undefined` for nullable legacy prices.

## 3. Preservation does not weaken creation validation

Existing nullable values are preserved only after matching a current, editable legacy object by ID. A changed numeric value must be finite and positive. New ordinary legacy rows still require both positive price and positive quantity; invalid rows reject the save rather than disappearing silently. Duplicate/unknown edit targets and mode injection reject the save. Draft-specific nullable rules remain their existing separate contracts.

Execution retains its existing price, quantity, direction, allocation, confirmation, and critical-save requirements. A state-watch mode check runs before execution calculations or confirmations, including when the fixture contains positive trade-like values.

## 4. Mode gates and inspected consumers

| Area | Phase 1A behavior |
| --- | --- |
| Plan V2 normalizer, validator, edits, candidate saves | Preserve explicit mode; reject invalid modes and ordinary mode mutation |
| Ordinary stock editor | Preserve nullable legacy and read-only state-watch objects; reject invalid new rows |
| `executePlan`, urgency and price execution buttons | Reject state-watch execution; omit legacy trigger/urgency candidates |
| Legacy plan engine and recommendation engine | Neutral trigger result; no action-specific selection, trigger recommendation, or legacy archive |
| Derived buy/sell events, default rules, plan counts | Skip state-watch before legacy direction or action classification |
| TradePlan import/conversion | Reject explicit nonlegacy modes at wrapper and item boundaries; preserve existing state-watch objects during replacement |
| AI refresh import/conversion | Reject nonlegacy payloads; replacement archives legacy objects only |
| Old PlanUpdateDraft | Exclude state-watch from legacy construction context; reject guarded edits/archive targets and mode injection |
| Discussion Plan Draft | Read-only neutral reference; reject scoped or returned state-watch targets; preserve legacy replacement behavior |
| PlanReview | Build neutral review context, render read-only controls, and reject canonical Plan edits; Review remains a separate layer |
| Portfolio/decision context | Consume the neutral Plan projection; no executable direction or invented quantity |
| Quote refresh | Existing save path delegates to mode-aware observation; state-watch canonical price status/timestamps remain untouched |
| OperationEntry | Inspected and unchanged: reads user-confirmed holding facts, never derives a trade from Plan action/price/quantity |
| Position rebalance | Inspected and unchanged: derives from holding/target allocation, not Plan mode or Plan action |

## 5. Remaining buy/sell inference

Existing legacy action mappings remain for compatibility. Inspected canonical state-watch paths are gated before these mappings, or present a neutral read-only view. Context projections may use `observe` and null price/direction for compatibility; this is not written back to the canonical object. Tests include a state-watch fixture with `action: sell`, positive price, positive quantity, and triggered-looking metadata; it cannot execute or create legacy trigger signals.

## 6. Snapshot hash contract

`PlanReview.planSnapshot`, its `plansnap_` prefix, the stable projection, and the hash algorithm are unchanged. `planMode` is deliberately not added to that historical projection. The regression fixture captured before edits from the accepted baseline remains `plansnap_ed0cd296`, both with absent mode and explicit `legacy_price`.

The old PlanUpdateDraft whole-list SHA-256 is a separate hash and retains its existing algorithm. Adding the explicit default property can make a previously saved whole-list draft stale; the existing safety check requires regenerating that draft instead of silently retargeting it. Existing `plansnap_` bindings retain their historical values for unchanged legacy Plans.

## 7. Version and future Definition continuity

Legacy `planVersion` remains the existing canonical revision: no-op edits retain the version; substantive edits, reconfirmation, and termination keep their existing increments. Quote observations retain their existing legacy behavior and never confirm full Plan conditions. Discussion updates still terminate the old legacy Plan as replaced and create a new ID/version 1.

Forward decision for Phase 1B: an ordinary edit to the same state-watch business Definition should retain the Plan ID and increment `planVersion`. A true replacement, split, or new business Plan may create a new ID and mark the old Plan replaced. This phase does not implement those state-watch operations or redefine historical versions.

## 8. Boundaries before Phase 1B

The remaining work is the dedicated Definition schema and business validation, creation/edit Draft + Diff + explicit confirmation workflow, and a supported client-version/rollback boundary before any real state-watch data is created. Semantic migration must be a separate reviewed workflow; similarity-based deduplication is not an identity mechanism.

An independent Runtime layer remains a later phase. No Runtime store, revision, transitions, matcher, autosave, history, `reviewAction`, business identity, or Definition hash was introduced. Current State contracts, allowlists, `planRelation`, source binding, protected context, semantic guards, and input-only technical status remain unchanged. StorageManager, multi-tab protection, empty-storage rules, and the single canonical state storage remain in place. No Bridge, DeepSeek, Supabase, Cloud Sync, execution algorithm, or Allocation algorithm changes were made.

## Verification and release boundary

- Focused baseline plus compatibility tests: 156 passed (131 existing + 25 new).
- Full JavaScript regression: 504 passed; no skipped tests.
- Full Python regression: 18 passed.
- Isolated Chromium desktop 1280×900 and mobile 390×844 acceptance: editor save/reload, nullable Plan preservation, legacy cards, read-only state-watch, Discussion/Current State navigation, and PlanReview passed; no fatal script errors or document overflow.
- Browser acceptance uses a new browser context on loopback only, one synthetic zero-holding stock, four fixture Plans, no executions, and no Allocation changes. The fixture is cleared and the isolated context closed after acceptance.
- Reproducible checks: `node --test tests/*.test.js`, `python -m unittest discover -s tests -p 'test_*.py'`, and `tests/plan_mode_browser_acceptance.cjs` against `tests/serve_browser_acceptance.py`. The browser runner accepts `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, and an output-directory argument.

Prepare the source, asset/version, and manifest commits locally, then stop for explicit production push authorization. Market bridge updates must not be included in source commits. Published files continue to come only from the existing manifest allowlist.

Rollback to the accepted pre-planMode baseline remains practical for Phase 1A because it creates no user-facing state-watch data. Once a future release creates real state-watch Plans, rollback to a pre-planMode client is unsafe: that client can discard the mode and reinterpret the Plan through legacy paths. A client-version and data-compatibility strategy is required before enabling creation.
