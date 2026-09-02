# Browser acceptance record — 2026-09-02

Overall status: **partial acceptance; production-Origin gate is not passed**.

Release-policy update: the user subsequently authorized deployment before the remaining real-Chrome checks. Local Overrides is no longer a pre-deployment requirement. See `docs/PC_AI_BRIDGE_CONTROLLED_RELEASE.md`; this record does not claim the pending production acceptance has passed.

## Repository and scope

- Repository: `investment-workbench-mobile`, branch `main`.
- Local source baseline: `ec24347c9c7a35671912c79bd6a10d255167d1df`.
- Fetched `origin/main`: `eeb111056527cec08d6d6cce5182fd917c52ad47`.
- Ahead/behind: 0/1. The remote-only commit changes only `data/market_data_bridge.js` and `data/market_task_status_bridge.js`; no remote source divergence.
- No source commit, asset-version bump, manifest generation, push, or deployment was performed.
- All AI requests used deterministic mock providers. No paid provider request or provider secret was used.

## Target browser and data isolation

Real Windows Chrome, connected through its extension in the user's target profile.

The actual application was served at `http://127.0.0.1:8768/`. The Bridge listened at `127.0.0.1:18765`. The test runner allowed only the production Origin and this exact local test Origin.

The fixture page initialized an empty local Origin with one synthetic watching stock, zero shares and no plans. It refuses to overwrite non-empty storage, and refuses to inspect unrelated data. It listens to browser `storage` events and compares the exact main-state string. The application itself used its existing StorageManager, multi-tab protection, shared Long-Term Logic pipeline, and real persistence functions; none were replaced by test implementations.

The existing production-origin data was not reset, seeded, or changed.

## Browser-discovered fix

Two read-only health requests in the same Chrome session proved:

| Request metadata | Result |
| --- | --- |
| `targetAddressSpace: local` | `TypeError: Failed to fetch` |
| `targetAddressSpace: loopback` | HTTP 200; `aiRequest: true` |

The client now correctly uses `loopback` for its loopback-only URLs. Permission detection prefers `loopback-network` and falls back to the older `local-network-access` alias only when unsupported. A regression test covers the preference and fallback.

The [LNA explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md#integration-with-fetch) requires the declared address space to match the destination. [Chrome 145 release notes](https://developer.chrome.com/release-notes/145#local_network_access_split_permissions) document the split permissions.

## Executed checks

| Check | Actual result |
| --- | --- |
| User-triggered AI, valid mock response | UI displayed `已更新 · mock / deterministic-long-term-v1`; exactly 1 main-state write |
| Current/history | New current `ltl_4e9955c7`; previous logic retained as 1 history entry |
| Invalid manual JSON `{}` | Exact-field validation failed; 0 writes; main-state bytes unchanged |
| Bridge stopped | UI displayed `API不可用`; 0 writes; main-state bytes unchanged; manual controls remained visible |
| Invalid API response `{"bad":true}` | Shared strict contract rejected it; 0 writes; main-state bytes unchanged |
| Real local CORS/preflight | Runner logged `GET /health 200`, `OPTIONS /ai/request 204`, `POST /ai/request 200`, all from `http://127.0.0.1:8768` |
| Valid manual response | Prepared by the same application `prepareLongTermLogic` builder, pasted into the real import dialog; exactly 1 write; success alert |
| Second save/history | New current `ltl_3fe91862`; history length 2; shares remained 0 and plans remained empty |
| Reload | Same current/history retained; 0 additional writes; main-state bytes unchanged |
| 390×844 Chrome viewport | Document client/scroll widths both 375; 8 workspace tabs; no device-mode selector |
| Mobile actions | All three primary actions were 44px high; their right edges remained within the viewport |
| Mobile import dialog | Left 10, top 20, width 355, bottom about 681; textarea width 319; controls visible and usable |

The temporary viewport override was reset.

## Explicitly not passed

1. **Production Origin → loopback E2E and LNA grant/deny.** The real production page was opened, but it still serves the pre-POC source and therefore cannot run the new UI workflow. Local-Origin success is not production-Origin proof. The user has explicitly authorized local-only Chrome Local Overrides; its directory access/setup and real permission interactions remain pending. Do not claim acceptance until that test is performed.
2. **Native clipboard round trip.** The automation clipboard reported no virtual clipboard data after the real copy action. This does not establish whether the OS clipboard succeeded or failed. Manual import was verified using the same builder via the fixture, not by pretending this was a successful clipboard round trip. A user-visible native copy/paste check remains required.
3. **Fresh empty-storage startup.** Both the existing production page and a clean local Origin showed `stale_tab`. Source tracing shows a normalized empty state revision (`null:0`) versus raw empty storage (`empty`) in the existing protected-save check. This pre-existing storage path was not changed. The local test used an explicit fixture seed to exercise the requested AI workflow without disabling protection.

## Final regression

- `node --test tests\*.test.js`: **466/466 passed** (the accepted 460-test baseline plus 6 publication-boundary tests).
- `python -B -m unittest discover -s tests -p "test_*.py"`: **18/18 passed** (including 3 new override-builder tests).
- `git diff --check`: no whitespace errors (only repository CRLF conversion notices).

## Reproduce the local checks

Run two terminals from the repository root:

```powershell
python tests\serve_browser_acceptance.py
python tests\run_pc_ai_bridge_acceptance.py
```

Open `http://127.0.0.1:8768/tests/fixtures/long-term-logic-browser-acceptance.html`, initialize only empty test storage, and open the actual app in a second tab. Record a checkpoint before each action, then compare storage. Use `--invalid` on the mock runner to test invalid provider content. Stop the runner to test unavailable-Bridge behavior.

The static acceptance server uses test-only cache busting without changing production asset versions; it does not serve `.env`, Git internals, Python files, or the Bridge directory. The Bridge runner logs HTTP metadata only, never prompts or model content.

## Authorized Local Overrides preparation

- Prepared a repository-external, local-only bundle with 59 current static scripts in original order. See [setup and cleanup instructions](LOCAL_OVERRIDES_SETUP.md).
- Source scripts are fingerprinted. Generated copies only rename storage/database/channel/lock/session keys. A test prelude forwards allowed operations to native storage and counts successful main-key writes; it does not replace business validation or save logic. Network, permission and clipboard APIs remain unchanged.
- Unit tests prove namespace forwarding, blocking of non-test storage/database operations, rejection of unexpected Origins, script ordering, unmodified transport/contract/clipboard sources, and no repository-source changes during generation.
- Real Chrome preflight at `http://127.0.0.1:8768/` loaded the bundle, showed the isolation banner, and opened the synthetic stock's Long-Term Logic workspace with all 3 actions. The report showed 0 non-test storage accesses, zero shares and no plans. Its initial 3 writes include test seeding and existing startup normalization; they are **not** an AI commit result. Every AI acceptance action needs its own checkpoint.
- No production-Origin override was enabled or claimed as passed by this preparation. Native LNA grant/deny and clipboard acceptance remain pending.
