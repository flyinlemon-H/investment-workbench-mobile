# Stock Universe Auto Add V1A

This release synchronizes **new canonical stock membership only**. It leaves all
investment state and market calculations in their existing owners.

## Deployment surfaces and current gate

Prepared on 2026-09-03; source push requires separate explicit approval.

| Surface | State at preparation |
| --- | --- |
| Test Supabase `lblyapnsngqnjimgskkp` | Active; both migrations applied; real Auth, RLS and browser → PC → mock bridge E2E passed |
| Production Supabase `fntslvdxnupmdljnadec` | Active; automatic approval review rejected production migrations for lack of explicit production permission; no V1A migration applied |
| Pages | Local release candidate only; no source push or deployment |
| PC DailyMarketUpdate | Existing task points to this checkout; adapter integrated inside its existing lock; production credential not configured, so original registry remains in use |

Production Auth has email/password enabled, signup enabled, anonymous signup off,
and email confirmation required. A real user has not been created. Dashboard
sign-in is required to verify the Site URL/redirect allowlist and SMTP readiness.
Do not label production onboarding verified until this is done.

## Data and persistence boundaries

`StorageManager.drain()` emits the actual committed snapshot only after its local
adapter write succeeds. This covers normal `saveState()` and critical
`persistCandidateSnapshot()` calls, including coalesced saves. Observer failures
cannot reject the already successful save. The observer projects membership via
existing `UniverseHandoff`/`SymbolIdentity` semantics, excluding cash-like rows.

The dedicated localStorage ledger `universe-add-queue-<projectRef>` stores only
schema version, observed symbols, last owner and pending/synced additions. It is
separate from portfolio state. The first run establishes the existing stocks as
a baseline; it does not upload historical membership. Later snapshots only add
`newUniverse - previousUniverse`. Renames and removals do not send mutations.
Deleting a local stock does not cancel its already committed addition.

Startup reconciles a save that completed just before the queue callback was
interrupted. Previously bound additions retain their owner across account changes;
first-login additions bind once. Web Locks serialize ledger writes across tabs.
An outage leaves local stocks usable. Startup, login/session recovery, the online
event and the manual retry action retry pending additions. There is no polling or
Realtime. The browser SDK persists and refreshes the normal Supabase Auth session.

Only `{user_id, symbol, display_name}` is inserted. PostgreSQL
`public.stock_universe_entries` has these columns plus `created_at`, a canonical
symbol CHECK, and primary key `(user_id,symbol)`. Own-user SELECT and INSERT are
the only browser grants/policies. `ON CONFLICT DO NOTHING` makes retries idempotent
and preserves the first name. No stock UPDATE or DELETE API is provided. A set
union needs no snapshot revision/CAS.

## PC credential and one-time connection

After production migrations and Pages deployment:

1. Confirm the production Auth Site URL is
   `https://flyinlemon-h.github.io/investment-workbench-mobile/`, allow that exact
   redirect URL, and confirm email delivery is available. Preserve email
   confirmation and unrelated Auth settings. The browser requests this page as
   `emailRedirectTo`; the SDK handles confirmation callbacks.
2. In the app, open **自动同步设置**, register/confirm email or log in once.
3. Expand **连接 PC 行情任务** and generate a read-only PC configuration.
4. Under the same Windows account that runs DailyMarketUpdate, open a terminal in
   this repository and run `python scripts/fetch_cloud_universe.py --configure`.
   Paste the JSON into its hidden prompt. Never put it in command arguments, Git,
   `.env`, OneDrive inbox or a shared file.
5. The command verifies the connection and stores only a DPAPI encrypted blob at
   `%LOCALAPPDATA%\InvestmentWorkbench\credentials\universe-reader.bin`.
   Run `python scripts/fetch_cloud_universe.py` for a read-only connection check.

The dedicated random 256-bit capability can only read one owner's Universe. The
server stores SHA-256 hashes in the unexposed `universe_private` schema. It cannot
insert, change stock membership, obtain Auth sessions or read investment state.
It expires after 180 days. Generate/install a replacement before expiry and
revoke the old credential from the app; there is no service/admin key on the PC.
Expiry/revocation causes a cloud warning and preserves local market coverage.
DPAPI binds the file to the Windows user; reconfigure after account/machine moves.

Public RPCs are SECURITY INVOKER wrappers around tightly scoped private
implementations. Account RPCs derive ownership from `auth.uid()`; the anonymous
PC reader requires the unguessable capability and derives its owner only from
the private hash lookup. Implementations use empty `search_path`, explicit EXECUTE
grants and no table grants to API roles. Direct credential-table access is denied.

`fetch_cloud_universe.py` enforces the expected project, owner, schema version,
canonical symbols, exact row fields, expiry and response size. HTTPS requests
have bounded timeouts and reject redirects. Credentials appear only in request
bodies/headers, never query strings or diagnostic output.

## Scheduled pipeline and fallback

`run_daily_market_update_and_publish.ps1` →
`run_daily_market_update_with_universe.ps1` (existing lock) →
`update_market_universe.py` loads formal state/registry, fetches the cloud set,
unions cloud and OneDrive additions, persists newly accepted registry membership,
then calls the existing `build_update_state()` and market updater.

Missing/malformed/expired credentials, auth errors, outages and unsupported remote
schemas produce safe warnings; known registry symbols never disappear. An empty
valid cloud set also cannot remove a local symbol. Registry-only stocks enter the
existing update universe with `marketOnly: true`; holdings remain untouched.
Provider failure after ingestion does not forget accepted membership.

The existing OneDrive manifest, manual button and two-file market publisher
allowlist remain operational. `active: true` in the old local registry/manual
format is retained for compatibility; this release adds no `active:false`, remote
removal, tombstones, snapshot replacement or Universe CAS.

UI states distinguish **股票已保存在本机**, **新增股票清单已同步**, and market
readiness acknowledged by the existing validated market bridge. Cloud success
alone can still show **等待 PC 更新行情**.

## Reproducible migration and recovery

Apply the checked-in SQL in order, via the migration API after approval:

1. `20260903123538_stock_universe_auto_add_v1a.sql`
2. `20260903125524_stock_universe_private_rpc_boundary.sql`

The MCP migration API assigns deployment timestamps. Test history versions are
`20260903123919` and `20260903125657` respectively. Match migrations by name and SQL
content when auditing; do not blindly run `db push` against project histories with
different baselines. SQL intentionally fails if conflicting objects already exist;
inspect history instead of reapplying a successful migration.

Test the chain with `supabase/tests/stock_universe_v1a.sql`; its synthetic auth users
and rows are wrapped in a rolled-back transaction. Do not apply fixture setup to
production. The separate real Auth E2E uses only a disposable test identity and
temporary local files, then removes that identity, memberships and credentials.

Forward fixes must be new migrations. For an operational rollback, redeploy the
previous Pages source and restore only PC adapter source if needed, keep existing
registry membership and cloud rows, and revoke PC read capabilities/EXECUTE grants
if needed. Do not drop data-bearing tables or shrink registry as a rollback.
Pages rollback alone does not reverse Supabase or PC deployment.

The production project also contains pre-existing `input_queue` anonymous test
SELECT/INSERT/UPDATE policies. V1A does not use or modify that legacy table; its
security review is separate. The test project's remaining Auth advisory is
[leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
The new Universe SQL has no remaining schema security-advisor findings.

## Verification commands

```powershell
node --test tests/*.test.js
python -B -m unittest discover -s tests -p 'test_*.py'
node scripts/build_supabase_client.js
python -B tests/serve_browser_acceptance.py
# In a separate terminal, with Playwright installed and a disposable test identity:
node tests/universe_cloud_browser_acceptance.cjs <temporary-fixture.json> test-results
python -B -m tests.run_cloud_universe_e2e <temporary-reader.json> test-results/cloud-e2e-results.json
```

The browser acceptance uses the actual Add Stock UI, standard test-project Auth,
real idempotent inserts, network-offline mode, reload/session recovery, 1280×900 and
390×844 viewports. The PC E2E protects/loads its credential with DPAPI and mocks only
the market provider. It never edits production stock state. Existing Current State
anchor acceptance also runs at both sizes.
