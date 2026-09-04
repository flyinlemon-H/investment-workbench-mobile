# Plan V2 Phase 2 — Runtime State Foundation

## Three separate layers

The application keeps three concerns separate:

1. **Discussion / Current State** answers what is happening to the stock now. Its existing AI output contract and `currentState.planRelation` allowlist are unchanged.
2. **Plan Definition** in `state.stocks[].plans[]` describes stable decision discipline. Phase 2 does not add changing Runtime fields to a Plan and does not weaken the existing Preview/Confirm edit workflow.
3. **Plan Runtime State** answers where one exact State-Watch Plan is in its lifecycle. It is stored in `state.planRuntimeStates`, inside the same canonical whole-state snapshot.

Discussion does not automatically update Runtime in Phase 2. The user opens one exact State-Watch Plan and selects **复核状态**. The program prepares its current Plan Definition and latest saved Current State automatically.

## Canonical storage

`state.planRuntimeStates` uses schema `plan-runtime.store.v1` and contains one `plan-runtime.v1` record per exact Plan ID in `byPlanId`. It is saved by the existing candidate construction, validation, `StorageManager`, critical atomic-save, stale-tab, backup, export, import, and restore paths. It does not have its own database, localStorage authority, write queue, or Supabase sync.

Missing branches in old state normalize deterministically to an empty Runtime store in memory. Opening old state does not itself cause a write and does not bulk-create Runtime records.

Runtime applies only to `planMode = "state_watch"`. `legacy_price` plans are not migrated and have no Runtime controls or execution changes.

## Runtime lifecycle

The internal phases are:

| Enum | UI label | Meaning |
| --- | --- | --- |
| `inactive` | 未激活 | The Plan exists but relevant conditions are not active. |
| `watch_zone` | 观察区 | A relevant observation window has been entered; this is not confirmation. |
| `forming` | 形成中 | Relevant conditions are developing but incomplete. |
| `confirmed` | 已确认 | Observation/confirmation logic is materially satisfied; this is still not execution. |
| `action_review` | 操作复核 | The user should explicitly review the planned direction. No order or trade is created. |
| `resolved` | 已处理 | The Runtime episode has been explicitly considered or closed. |
| `downgraded` | 已降级 | Previously stronger conditions weakened. |
| `invalidated` | 已失效 | The current Plan thesis/condition framework was materially invalidated; the Definition remains present. |

The transition assessment enum is `advance`, `hold`, `downgrade`, `invalidate`, `resolve`, or `unclear`. A small validator rejects contradictory results and nonsensical jumps without trying to turn prices into deterministic lifecycle facts.

## Program facts and AI judgments

The program owns Plan identity, Plan version, Plan snapshot hash, Current State identity, `sourceDiscussionVersion`, Runtime revision, timestamps, persistence, holdings, Allocation, technical facts, and protected bindings.

The AI output contains judgment only:

```json
{
  "planRuntimeReview": {
    "suggestedPhase": "forming",
    "transitionAssessment": "advance",
    "summary": "...",
    "evidence": [],
    "watchPoints": [],
    "risks": [],
    "confidence": "medium"
  }
}
```

Unknown fields, malformed/truncated JSON, invalid enums, contradictory assessment/phase pairs, and oversized content fail closed with zero writes. The existing Manual AI Transport and `StrictAiJson` parser are reused; no provider behavior or paid retry path was added.

## Revision and protected binding

Every meaningful accepted Runtime review increments `runtimeRevision`. It does not increment `planVersion`, change the Plan snapshot hash, or mutate any Definition field. A fully identical review is canonical `no_change`: no revision, no history entry, and zero canonical writes.

A Runtime record binds to:

- exact `planId`;
- `sourcePlanVersion`;
- existing Plan `snapshotHash` (no new `planDefinitionHash`);
- exact Current State `stateId`;
- `sourceDiscussionVersion`.

If the Definition changes, the old Runtime phase and history are preserved but its derived binding becomes `definition_changed`. If Current State changes, it becomes `current_state_changed`. Neither change silently rebases Runtime or increments `runtimeRevision`; a new user-triggered Runtime Review is required.

If the Plan ID no longer exists, the record derives `missing_plan` and remains historical evidence. It is never rebound by symbol, name, or list position.

Prompt, Preview, and Confirm are bound to the exact Plan and Current State context used to prepare the request. Any intervening Plan version/hash change, Plan removal, Current State identity/version change, or stale-tab conflict blocks Confirm with zero Runtime update.

## Preview, confirmation, and execution boundary

Every meaningful Runtime update requires Preview and explicit Confirm. The Preview shows current/suggested phase, direction, summary, evidence, watch points, risks, and confidence, and states that Plan Definition remains unchanged.

Entering `action_review` uses the acknowledgement wording **确认进入操作复核**. The committed history entry records a program-owned acknowledgement timestamp. Runtime has no call or mapping to order, trade, holding, quantity, price-trigger, rebalance, or legacy execution paths. `add_review` is not buy and `reduce_review` is not sell.

## Transition history

Each meaningful committed review stores a compact audit entry with from/to phase, Runtime revision, Plan binding, Current State binding, accepted judgment, confidence, commit timestamp, and optional `action_review` acknowledgement timestamp. Full Plan or Current State snapshots are not copied into history.

History is capped at **30 entries per Plan Runtime**. The newest 30 are retained and the current Runtime remains aligned with the newest entry.

## Backup, Universe, and Supabase boundaries

Because Runtime is part of the canonical state snapshot, normal export, backup, import, and restore include it. Raw Runtime is strictly validated before normalization, so malformed stores do not get silently repaired or dropped. Older backups without the branch remain valid and load as no Runtime.

Stock Universe cloud behavior remains membership-only. Its post-save observer projects only canonical stock symbol/display-name rows. A Runtime-only save produces an empty membership diff and therefore does not enqueue a Supabase write. Runtime itself is not synced to Supabase in Phase 2.

## Rollback / forward-fix boundary

The accepted pre-Phase2 client normalizer preserves unknown top-level canonical state fields during ordinary load/edit/save cycles, so it preserves `planRuntimeStates` bytes even though it cannot display them. This is covered by a compatibility test against the pre-Phase2 normalization behavior.

However, an old client cannot validate or edit Runtime. Replacing all state from an older backup, using an old reset flow, or importing a snapshot that lacks the branch will naturally remove Runtime along with any other data absent from that replacement snapshot. After real Runtime use, prefer a forward fix and keep a current export before any rollback. A source rollback is routine-save compatible, but an old-backup state replacement is not Runtime-data-safe.

## Phase 2 limitations

Phase 2 intentionally has no automatic Discussion-to-Runtime update, automatic or multi-Plan matching, background monitoring, auto-save, push notification, legacy Plan Runtime, Plan Definition auto-edit, Current State schema extension, broker/order execution, Runtime-based portfolio prioritization, Supabase Runtime sync, or full PC/mobile state sync.
