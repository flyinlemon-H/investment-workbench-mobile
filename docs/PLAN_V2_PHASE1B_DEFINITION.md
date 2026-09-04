# Plan V2 Phase 1B — State-Watch Definition

Status: **HISTORICAL — superseded release status; Definition remains active and Plan Runtime Phase 2 is now production**

Repository: `flyinlemon-H/investment-workbench-mobile`, branch `main`.
Accepted production baseline: `fff87b9f5fbd64fecc8aec01d6f6df6e5be4117f`.
Baseline assets: `plan-mode-compatibility-phase1a-20260903`.
Release assets: `state-watch-definition-phase1b-20260903`.

This release saves stable observation and decision-review discipline. It does not evaluate today's phase, match conditions, recommend quantities, or execute a trade. The release stops before production push for explicit user authorization.

## Repository safety gate before editing

- Working repository and remote matched the authoritative repository; no sibling repository was used.
- Branch was `main`; local HEAD and fetched `origin/main` both equaled the accepted production baseline; ahead/behind was `0/0`.
- Worktree was clean; there was no market-bridge divergence.
- Production HTML advertised the expected Phase 1A asset version. The custom Pages workflow run `33724149542` succeeded at the baseline SHA. The legacy Pages Builds API returned an older commit, so the custom Actions run and actual served HTML were used as the deployment evidence.
- No production Plan was created or changed. All acceptance writes were in isolated browser contexts on `http://127.0.0.1:8768`, with external requests blocked.

## 1. Final canonical Definition schema

The single canonical object remains `state.stocks[].plans[]`, with `schemaVersion: "plan.v2"`. There is no second Plan store or independent identity model.

```json
{
  "id": "plan_<generated-id>",
  "schemaVersion": "plan.v2",
  "planMode": "state_watch",
  "planVersion": 1,
  "name": "高位风险观察",
  "applicableConditions": [],
  "entryConditions": ["高位压力后出现明显回撤"],
  "confirmationConditions": ["关键支撑有效失守"],
  "invalidationConditions": ["重新恢复稳定上升结构"],
  "reviewAction": "reduce_review",
  "priceReferences": [{"type":"watch_zone","from":37,"to":40,"meaning":"前高及高位压力观察区域"}],
  "allocationConstraint": {"maxPositionPct":null,"targetWeightRange":null},
  "note": "",
  "status": "active",
  "validityStatus": "active",
  "createdAt": "<creation ISO timestamp>",
  "updatedAt": "<last confirmed edit ISO timestamp>",
  "lastReviewedAt": null,
  "nextReviewDate": null,
  "validUntil": null,
  "source": "manual",
  "legacy": {},
  "action": null,
  "triggerPrice": null,
  "triggerDirection": null,
  "quantity": null,
  "priceTriggerStatus": "unavailable",
  "triggeredAt": null,
  "fullConditionStatus": "unproven",
  "conditions": {"technical":[],"fundamental":[],"catalyst":[],"allocation":[],"market":[],"invalidation":[],"other":[]},
  "invalidationReason": null,
  "terminatedAt": null
}
```

The empty legacy compatibility fields are inherited infrastructure, not a Runtime layer. Rule arrays contain strings only. There is no condition status in the new Definition arrays.

## 2. Required and optional fields

| Draft Definition field | Contract |
| --- | --- |
| `planMode` | Required, exactly `state_watch` |
| `name` | Required, trimmed, 1–80 characters; Chinese supported |
| `entryConditions` | Required, 1–12 nonempty strings, each ≤240 characters |
| `confirmationConditions` | Required, same array limits |
| `invalidationConditions` | Required, same array limits |
| `reviewAction` | Required: `reduce_review`, `add_review`, `hold_watch`, `risk_control` |
| `applicableConditions` | Optional, defaults to `[]`, 0–12 strings with the same limits |
| `priceReferences` | Optional, defaults to `[]`, at most 8 references |
| `allocationConstraint` | Optional, defaults to both existing fields being null; only `maxPositionPct` and `targetWeightRange` allowed |
| `note` | Optional, trimmed, ≤1000 characters, defaults to empty string |
| `validUntil`, `nextReviewDate` | Optional, real calendar `YYYY-MM-DD` dates or null |

`maxPositionPct` is a finite number greater than zero and at most 100, or null. A Draft cannot exceed the stock's existing protected allocation cap. `targetWeightRange` is a descriptive boundary of 1–80 characters or null; it is not parsed into an allocation instruction. No quantities or target allocations are calculated.

Unknown Definition, Draft, target, price-reference and allocation fields are rejected. Canonical state-watch data is checked before the normalizer can silently coerce invalid values. The import UI requires a complete Definition and fails before confirmation or persistence on invalid state-watch input.

Phase 1A opaque state-watch compatibility objects without any Definition fields remain read-only and preservable on existing-storage load and generic stock edits. They are not valid new Definitions and cannot be imported through the Phase 1B import UI without an explicit complete Definition. No placeholder is automatically converted or inferred from its old price/action.

## 3. Why name is implemented and planType is deferred

The theme name is the useful business identity for cards, Preview and review context. `planType` would add classification without changing this phase's behavior, so it is deferred. Names are never mutation targets; duplicate names may coexist with different IDs. Legacy actions and prices never determine a name or type.

## 4. Confirmation versus upgrade/downgrade

All supported observations require entry, confirmation and invalidation rules. Confirmation describes evidence that would strengthen the hypothesis; it does not record today's confirmed judgment. Upgrade/downgrade arrays are deferred to avoid duplicating confirmation meaning before Runtime transitions are designed. Observing an invalidation rule does not cancel the Plan.

## 5. Price-reference schema and non-trigger boundary

Only these two exact shapes are accepted:

```json
{"type":"reference","price":35,"meaning":"关键支撑观察参考"}
{"type":"watch_zone","from":37,"to":40,"meaning":"高位压力观察区域"}
```

Prices must be finite positive numbers; ranges must satisfy `from <= to`. Meaning is required, trimmed and at most 120 characters. No quantity, trigger direction or execution action is accepted. Zero, one or multiple references work. The reference collection is rendered as context only; no matching, phase, derived trade event or persistence observer consumes it. It is never copied into `triggerPrice` or `triggerDirection`.

## 6. Ordinary edits retain the same ID

`StateWatchWorkflow` uses a dedicated `state-watch-draft.v1` envelope with:

```json
{
  "schemaVersion":"state-watch-draft.v1",
  "operation":"update",
  "symbol":"600000.SS",
  "draftSessionId":"<exact prepared session>",
  "draftSessionVersion":1,
  "draftSessionHash":"<exact prepared session hash>",
  "targetPlan":{"id":"<exact Plan ID>","planVersion":1,"snapshotHash":"<exact existing plansnap hash>"},
  "definition":{"planMode":"state_watch","name":"...","entryConditions":["..."],"confirmationConditions":["..."],"invalidationConditions":["..."],"reviewAction":"hold_watch"},
  "reason":"说明本次纪律变化"
}
```

Ordinary confirmed edits preserve ID, creation time, source, lifecycle and review metadata, and increment `planVersion` exactly once. Whitespace normalization or identical content becomes `no_change`, with zero write, timestamp change or version increment. Market price and Current State updates do not modify Definition versions. Explicit cancellation/completion retain the existing canonical lifecycle revision convention and increment once; no market observation invokes them.

Sessions bind stock ID, symbol, protected holding facts, allocation cap and the existing ID/version/snapshot list. Existing-plan sessions are scoped to one exact Plan. Registered sessions and previews are held in memory; they are invalidated on close, replacement or successful commit. Confirmation reparses the original validated Draft and rechecks live state. A second prepared-rule comparison catches even an externally malformed edit that changes rules while retaining a version. This is an in-memory session check, not a new Definition hash.

**The existing snapshotHash remains canonical snapshot binding, not pure Definition identity.** `PlanReview.planSnapshot`, its projection and hash function are unchanged. The historical hash fixture remains `plansnap_ed0cd296`. No `planDefinitionHash` was added.

## 7. Paths that still create replacement IDs

State-watch ordinary editing never uses replacement IDs. Phase 1B has no implicit replacement or split operation; `create` means an explicitly requested independent Plan and always allocates a new ID/version 1. A fundamentally different Plan can be handled explicitly by cancelling the old Definition through its Preview/Confirm flow and separately creating another; there is no automatic two-step replacement.

Existing legacy Discussion `update` still archives the old legacy Plan as `replaced` and creates a new ID, preserving its established semantics. Legacy AI refresh, TradePlan conversion and old Draft paths keep their existing mode gates and replacement behavior. They preserve state-watch objects and cannot target them for legacy edits.

## 8. Execution gates and compatible modules

The Phase 1A guards remain in `executePlan`, price evaluation, quote observation, urgency selection, legacy plan/recommendation engines, derived buy/sell events, TradePlan/AI-refresh conversion, old PlanUpdateDraft, legacy Discussion mutations and PlanReview mutations. Generic stock editing keeps state-watch read-only. Rebalance continues to use holding/target facts, without classifying a watch as sell.

Phase 1B adds a stricter canonical and Draft boundary: complete state-watch Definitions require null action/price/direction/quantity and empty legacy condition rows, and cannot persist triggered/confirmed compatibility statuses. PlanReview additionally rejects suggestions to modify legacy trigger fields for a state-watch target, renders safe context, and routes editing to the dedicated Definition UI. Discussion and Portfolio use Definition summaries and a neutral read-only projection. Decision Compression carries the theme/observation summary and review direction without Runtime ranking.

## 9. Remaining buy/sell inference

No inspected state-watch path infers buy/sell from `reviewAction`. Legacy mappings remain for legacy data and historical modules, guarded by `isLegacyPricePlan`. `reduce_review` and `add_review` are only review-direction values in the new Definition path. Its read-only context may carry `action: "observe"` for old consumers; that projection is never written into the canonical Definition's null action.

## 10. Decisions remaining before Phase 2

- Define a separate Runtime storage/revision contract and its binding to Definition ID/version and evidence snapshots.
- Decide transition semantics, evidence requirements and confirmation ownership; map any future upgrade/downgrade rules without duplicating Definition confirmation rules.
- Decide how Runtime becomes stale when a Definition changes, is cancelled, or is completed.
- Decide whether a stable planType classifier, non-confirmable observation type, or explicit atomic split/replacement UI is useful.
- Plan a separately authorized legacy migration and a safe client-version/downgrade policy. Phase 1A opaque compatibility objects are not automatically migrated.
- Decide future Current State proposal linkage and any review-to-execution handoff. Neither is implemented here.

## UI and save behavior

The stock Plan area and Plan Center expose **新建观察计划**. The dedicated modal supports manual rule entry and copying a mode-aware AI prompt with a strict JSON return envelope. Both converge on the same validator, human-readable Preview/Diff and explicit Confirm button. There is no AI request or automatic saving. The ordinary stock editor retains a short read-only notice. PlanReview edits route to the dedicated modal.

The candidate is constructed separately. The new UI uses the critical candidate persistence path and adopts it only after success; it does not call `saveState` to adopt before persistence. The state revision is advanced monotonically for the existing multi-tab checks. A stale tab never rebases. Validation and stale failures make zero persistence calls. Storage rejection makes one attempted save but zero committed canonical writes, and leaves the prior in-memory state unchanged. Double confirmation and forged/unregistered previews are rejected.

The existing Current State output contract, schema, validators and snapshot binding are unchanged. Only its input Plan summary was extended. No Runtime store, phase, matcher, transitions, history, condition status, autosave or automatic migration was added. No Allocation, Bridge, DeepSeek, Supabase or Cloud Sync behavior was changed.

## Verification

- New Definition suite: 108 passed, including all three specified synthetic business examples.
- Focused Definition/Plan/Discussion/Review/empty-storage suites: 243 passed.
- Full JavaScript: 612 passed, including all 504 baseline tests; zero skips.
- Full Python: 18 passed; no DeepSeek calls or Supabase writes.
- Isolated Chromium: desktop 1280×900 and mobile 390×844 passed create → Preview → Confirm → save → reload → edit → Diff → same ID/version increment; no-change; manual and AI Draft; export/import/reload; failed persistence; and stale two-tab rejection.
- Browser acceptance verifies legacy Plan preservation and execution rejection, generic editor preservation, Current State/Discussion navigation, PlanReview open and routing back to a scoped Definition editor, no Runtime fields, no document/dialog horizontal overflow and no global JavaScript errors.
- The mobile stale-tab banner remains visible and protective. Acceptance dispatches a synthetic click to the covered Confirm handler to verify storage still rejects it, then uses the real reload button; the protection is never disabled.
- Browser contexts contain one synthetic zero-holding stock and three synthetic watches alongside one legacy fixture; fixtures are cleared and contexts closed at completion. Screenshots and machine-readable results are retained outside the release allowlist.

Commands:

```text
node --test tests/state_watch_definition.test.js
node --test tests/plan_v2_foundation.test.js tests/plan_mode_compatibility.test.js tests/discussion_plan_workflow.test.js tests/plan_review_batch.test.js tests/empty_storage_baseline.test.js tests/state_watch_definition.test.js
node --test tests/*.test.js
python -m unittest discover -s tests -p 'test_*.py'
python tests/serve_browser_acceptance.py
node tests/state_watch_browser_acceptance.cjs <output-directory>
```

The browser runner accepts `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE`; it never attaches to a real user browser profile.

## Rollback and production boundary

Before any real Phase 1B state-watch Definition has been created, `fff87b9f5fbd64fecc8aec01d6f6df6e5be4117f` remains the safe code rollback baseline for the existing Phase 1A data. Its legacy normalizer behavior and snapshot hashes are preserved by regression tests.

**After real state-watch Definitions exist, Phase 1A is not a data-safe rollback client.** It recognizes the mode but strips the new Definition fields during normalization. A pre-planMode client is still less safe because it can additionally reinterpret mode. Do not downgrade users with Phase 1B data to either client.

The supported strategy after data creation is a forward fix retaining this Definition reader/validator/export schema. A feature rollback must preserve Phase 1B normalization/import/export and non-execution gates while disabling new creation if necessary. Before any recovery, export the complete current JSON backup and retain an unchanged copy; verify IDs, versions, condition arrays, references and lifecycle fields in a Phase 1B-capable isolated client. Restoring an old pre-creation backup would discard later user changes and requires a separately explicit recovery decision, never an automatic rollback.

Production acceptance must use read-only page/asset checks or a non-persisted isolated fixture. A persistent production Plan requires separate user authorization. Source, asset/version and manifest commits are prepared locally and recorded in the final push safety gate; push and Pages deployment remain pending authorization.
