# Integration Hardening Phase 1 — implementation and acceptance record

Status: **READY_FOR_PUSH — real E2E passed and all test fixtures verified zero** (2026-09-05).
The real-cloud tests passed and cleanup reached all-zero. Local release hardening is now authorized: separate source, asset/version, and manifest commits. Push, Pages deployment, production smoke, and database changes remain prohibited until new explicit authorization.

## Repository gate

- Repository: `investment-workbench-mobile`; remote: `https://github.com/flyinlemon-H/investment-workbench-mobile.git`; branch: `main`.
- Fetched `origin/main` before editing. Local HEAD and origin/main: `79dcd00781763338bf7240528cb45d83603992c9`; ahead/behind: 0/0. Initial worktree clean.
- No initial source or market-bridge divergence. Pre-release asset version: `cleanup-wave1-20260905`.
- Intended release version: `integration-hardening-supabase-sync-v1-20260905`.

## Shared Auth

`src/supabase-browser-client.js` owns the sole normal browser SDK client, validated public configuration, persistent session, SDK automatic refresh, recovery, and the sole SDK Auth subscription. It preserves `universe-auth-${projectRef}` and the existing Supabase SDK JSON format; no storage migration, account recreation, or forced logout is required.

Universe and Manual Analysis Sync expose `getClient()` for reference-identity assertions and delegate to that provider. Their RPC/table operations remain in their own business modules. Universe retains its add-only pending ledger and owner binding; Manual Sync retains module-only payloads and canonical candidate saving. The existing 15-second network timeout is shared.

SDK Auth callbacks normalize session state immediately and defer business notifications outside the SDK Auth lock. Duplicate session/token notifications are suppressed. Consumers never construct clients or own token recovery/refresh. Universe reacts by binding/retrying its queue; Manual Sync invalidates previews and prior success indications on an owner change or sign-out, but not ordinary token refresh. A post-request session check rejects results returned after sign-out/account change. An already dispatched cloud write cannot be undone by signing out.

Supabase guidance checked: [onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession). Existing SDK remains pinned at 2.114.0. Changelog markdown fetch was attempted but blocked by content-type/network access; no SDK dependency upgrade was introduced.

## Local analysis role

`localStorage.analysis_sync_role` accepts `publisher` / `receiver`. Missing, invalid, or unreadable preference means receiver-safe behavior. The existing automatic-sync dialog offers 本机用途: 分析端（可以发布分析更新） / 查看端（获取并确认分析更新）. No startup modal is added.

This is a browser workflow preference, not authorization. An authenticated owner can change it. Authenticated owner identity and Supabase RLS remain the security boundary. Width/orientation/user-agent do not select capabilities; viewport controls layout only. A role change invalidates an old confirmation and refreshes controls.

The role is outside canonical state, Long-Term Logic, cloud payloads, and normal investment backup/export. Actual browser backup import and reload were tested. The current browser preference remains unchanged.

## Missing local entity

Adapters must implement `checkApplyEligibility(state, envelope)`. The generic engine asks it during fetch, Preview, and Confirm. The Long-Term Logic adapter checks canonical stock existence, without creating any stock, holding, Plan, Current State, or Universe membership.

A cloud `long_term_logic / 1810.HK` remains visible but disabled with: 本机尚未添加该股票。请先添加该股票后再获取长期逻辑。 No confirm-ready Preview is produced. After an explicit stock addition, fetching again makes the same cloud revision eligible. Apply still uses the StorageManager detached candidate path.

At 390px and 1024px, browser tests instrument canonical persistence and compare canonical state, the Universe ledger, and actual Universe request count: all remain unchanged on the missing-stock path. The subsequent explicit stock addition is a separate authorized local operation.

## RPC verification

The existing `20260904105937_manual_analysis_sync_v1.sql` contract returns successful `{status, module}` envelopes only for `published` and `no_change`; `conflict` is stale-cloud failure.

Confirm validates exact response/envelope fields, module/entity/schema identity, numeric positive safe revision, ISO timestamp, SHA-256 integrity, and equality with the confirmed local payload/hash. `published` requires expected revision + 1. `no_change` is evaluated before CAS by the server, so a concurrent identical publication/retry may coherently return a later revision; it may not regress behind the preview.

Unknown status, missing/malformed envelope, incorrect identity/revision/hash/payload/timestamp all fail closed as `verification_failed`. The UI does not show 已同步 and removes the confirmation action. This means the response could not be verified, not that the server rolled back: the server may already have committed. A later read/retry reconciles through normal current-row / no_change behavior. `cloudCommitUnknown: true` explicitly records this boundary; `writes: 0` is not a claim of zero server commits on this path.

## Validation

- Full JavaScript: **693/693**, baseline 677 retained; focused new cases: **16/16**.
- Full Python: **21/21**.
- Existing full suites include Universe add-only/canonical/offline/owner/idempotent/ledger behavior, LTL API/Bridge/local-first/Slim/legacy/manual fallback, Manual Sync privacy/CAS/atomic save, Discussion V3/anchor, state_watch/legacy_price/Runtime/PlanReview, storage/recovery/stale-tab protections.
- `tests/integration_auth_browser.cjs`: **PASS with real bundled SDK and mocked HTTP endpoints**. One client construction, one SDK subscription, same underlying references, legacy-format persisted session restore, supported `auth.refreshSession()`, concurrent Universe and Manual RPC with identical bearer session, valid published/no_change, one sign-out, pending recovery after sign-in, reload.
- `tests/manual_analysis_sync_browser_acceptance.cjs`: **PASS** for 1280×900 publisher, 500×900 publisher, 390×844 receiver, 1024×900 receiver. Explicit role setting, resize, reload, real backup import, Preview/Cancel/Confirm, malformed/unknown RPC UI, missing-stock zero-write/no-request path, later-stock apply, no horizontal overflow, no page errors.
- Existing browser acceptance: Discussion User Decision, Discussion anchor, state_watch (including PlanReview), Plan Runtime (including stale tabs), and Plan modes: **PASS**, desktop/mobile.
- Worktree Pages asset/credential/dependency/market-integrity check: **PASS**, 75 public assets / 76 output assets. This constructed an in-memory candidate manifest; it does not finalize the release manifest or claim committed-source integrity.
- `git diff --check`: PASS. No paid AI call was made.
- Detailed JSON/logs and screenshots are under ignored `test-results/integration-hardening/`, with full-suite logs in `test-results/`.

## Real-cloud E2E and cleanup

The designated project `lblyapnsngqnjimgskkp` was verified as `investment-analysis-test-s01`. This continuation did not access production project `fntslvdxnupmdljnadec`. Following explicit user authorization, exactly **one** disposable user was created and auto-confirmed through the official Dashboard Auth Users management form. No SQL INSERT/DELETE/UPDATE against Auth internal tables was issued in this continuation, and no password was sent through SQL.

Fixture UID: `fd32c91f-0714-4452-a2f6-7e143df49771`; fixture email: `ih-526990a63f32@example.net`. The randomly generated password stayed in local runtime memory and an owner-local OS temp file, outside the repository; it was never written to Git, migrations, SQL, reports, shell history, or Pages assets.

Actual test-project results:

- `tests/integration_auth_browser.cjs --real`: **PASS**. One client construction, strict same-client reference, one SDK subscription; existing session storage restore; supported `auth.refreshSession()` with token change; concurrent authenticated Universe and Manual Sync operations; one sign-out notification; local-data preservation, pending recovery after sign-in; reload.
- Missing `1810.HK`: actual cloud update remains visible but disabled; zero canonical writes, zero additional Universe requests, unchanged local ledger. Explicit local stock creation enables Preview/Confirm at the same cloud revision.
- Strict RPC envelopes: real `published` and `no_change` accepted. After actual server commits, browser routing corrupts only the response (unknown status or absent revision). Client rejects both, never shows synced success, and a subsequent normal read reconciles with `no_change`. No server transaction rollback is claimed.
- The first extended test exposed an inconsistent synthetic audit snapshot after direct fixture editing; the fixture now normalizes a consistent snapshot. No application source change was needed. Both the deterministic and real reruns passed.
- Existing Manual Sync cloud/browser E2E: **PASS**, revisions 1 → 2, publish, no_change, mobile Cancel/Confirm, allowlist, atomic save, no Universe side effects.
- Existing Universe browser E2E: **PASS** at 1280×900 and 390×844, durable-local-before-cloud, canonical symbols, offline queue, online retry, reload, no overflow.
- Existing isolated PC Reader → mock market pipeline: **PASS**, 2 cloud symbols, 3 merged symbols, holdings preserved, DPAPI fixture, valid mock market bridge. PC Reader/AI Bridge source unchanged.

All browser test contexts were closed and their sessions signed out. Test business rows were removed with user-ID-constrained cleanup from `stock_universe_entries`, `universe_private.reader_credentials`, and `analysis_private.analysis_sync_modules`. These are business fixture tables, not Auth internal tables. The temporary password and reader files were deleted; CUA runtime password references were cleared.

**Final Auth cleanup completed:** after the user supplied immediate confirmation for this exact UID, the official Dashboard Auth Users `Delete user` → `Delete` action succeeded. Its associated identity was removed by the official Auth management operation. No SQL mutation of Auth internal tables was used. Immediate read-only verification returned zero for all seven requested categories.

Read-only post-cleanup verification:

| Fixture category | Remaining |
| --- | ---: |
| Auth users | 0 |
| Auth identities | 0 |
| Auth sessions | 0 |
| Auth refresh tokens | 0 |
| Universe entries | 0 |
| Universe reader credentials | 0 |
| Analysis modules | 0 |
| Local password / reader files | 0 |
| Isolated test browser contexts | 0 |

Pre-commit repository check: branch `main`; fetched `origin/main` and local HEAD are `79dcd00781763338bf7240528cb45d83603992c9`, ahead/behind 0/0. No source or market-bridge divergence. Only Integration Hardening source/tests and release documentation belong in these commits.

## Release and rollback boundary

**NO_NEW_PRODUCTION_MIGRATION**: no schema/RLS/RPC migration performed in either project. No PC Reader, PC market ingestion, AI Bridge/startup, market bridge data, CI Pages gate, or Cleanup Wave 2 changes.

Final test/cleanup gate: READY_FOR_PUSH. The user authorized three local release commits. Commit the implementation first, then cache-bust the HTML and generator to `integration-hardening-supabase-sync-v1-20260905` and commit those version changes. Generate the formal manifest from that committed asset revision, then commit the manifest. The manifest `sourceCommit` intentionally names the asset/version commit because it anchors the exact published bytes. Verify the committed artifact and stop before push.

Rollback needs no investment-data migration. The older Pages client ignores the new local role key and returns to its prior viewport-based publishing UI and two-client Auth behavior. The local role preference can remain in storage; investment backups and canonical data are unaffected. Auth session storage remains compatible across rollback.

## Answers to the requested 14 questions

1. Both modules reuse the same Supabase client: yes.
2. Proof is strict object-reference equality plus construction/subscription counts, not matching storage keys.
3. Existing session restores through the original key/SDK format with one shared recovery entry point; both deterministic and actual test-project real-SDK upgrade fixtures passed.
4. One SDK owner refreshes tokens and one SDK listener normalizes notifications; business listeners do not own Auth lifecycle.
5. Sign-out retains Universe local membership/pending work as auth-required; Manual cloud requests fail auth-required and previews/success indications are invalidated; LTL is untouched.
6. Analysis/receiver roles are editable local workflow preferences; authenticated owner + RLS authorize cloud access.
7. Role lives at localStorage `analysis_sync_role`, outside normal investment backup/cloud state.
8. Viewport cannot change publishing capability.
9. Remote LTL with no local stock shows 本机尚未添加该股票 and the add-first instruction, with disabled apply.
10. Missing-stock browser tests prove zero canonical writes and zero additional Universe requests/ledger changes.
11. Only `published` and `no_change` are successful publish statuses.
12. Malformed/unknown envelopes fail verification without success UI; possible prior server commit is explicitly acknowledged.
13. No Supabase schema/RLS/RPC, PC Reader, or AI Bridge change.
14. CI Pages gate unchanged; deferred to the next task.
