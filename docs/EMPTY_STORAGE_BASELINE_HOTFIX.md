# Empty-storage baseline hotfix

Status: **HISTORICAL — release evidence; not the current deployment gate**

Scope: only the first load of genuinely pristine storage. No change to investment calculations, Holdings, Plan, Allocation, orders or broker facts.

## Root cause

`loadState()` converted persisted `null` into an empty UI candidate and registered that candidate's `null:0` revision. The existing locked critical-save check then correctly compared it with persisted `null` (`empty`) and rejected the mismatch. Recovery was also blocked once the tab became stale.

## Correction and safety boundary

- Existing non-null state still takes the original `observeLoadedState(candidate)` path.
- A separate empty-state observation is allowed only before that guard has observed a baseline, only when it is not stale or closed, only with the existing exclusive-lock facility available, and only with an affirmative read-only proof from the storage manager.
- The proof requires localStorage to be active with no source marker, revision, previous successful write, pending write, canonical raw key or draft raw key. It also requires readable IndexedDB and no metadata, canonical, draft or migration record. Stored JSON `null`, even empty persisted draft maps, and unreadable storage do not qualify.
- Only the in-memory baseline `empty` is established. No canonical/version/fixture write is performed by baseline observation.
- The first save still uses the existing exclusive lock, candidate snapshot and revision equality check. The empty proof is repeated inside that lock immediately before persistence. Any intervening state/version/history record fails closed.
- The baseline advances only after the existing persistence call succeeds. A failed atomic save creates neither bytes nor a new storage-manager revision. A stale tab cannot re-enter the first-load branch.
- IndexedDB schema creation is existing adapter behavior; the hotfix creates no database record. Existing populated localStorage operation when IndexedDB is unavailable is unchanged, but first initialization without a verifiable empty IndexedDB history is deliberately not treated as proven empty.

Runtime file boundary: `src/state.js` (load-time call only), `src/multi-tab-protection.js` (empty observation and first-save recheck), `src/storage/storage-manager.js` (read-only proof only). Browser/file permissions are separate from this correction.

## Verification

`node --test tests/empty_storage_baseline.test.js tests/workbench_sprint04c_regression.test.js`

The 13 focused tests cover real application lifecycle functions, unchanged recovery/candidate persistence, zero-write observation, existing/null-version portfolios, stored-null and historical records, deleted canonical state, two independent tab runtimes sharing a lock and persistence store, real version mismatch, first-save failure, failed emptiness proof, unavailable locks, and new records appearing before first save. The 4 existing Sprint04C regression tests remain unchanged.

The concurrency tests use independent JavaScript realms and the Web Locks serialization model; they are not a substitute for the separate real Chrome production acceptance.

Release acceptance remains **in progress** until production resources, empty startup, LNA allow/deny, Manual fallback, clipboard and fixture cleanup are verified. No paid model call is required. Fixed last known-good rollback reference remains `ec24347c9c7a35671912c79bd6a10d255167d1df`, asset version `current-state-input-boundary-20260902`.
