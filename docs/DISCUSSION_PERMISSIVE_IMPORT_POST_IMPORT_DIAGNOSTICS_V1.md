# Discussion Permissive Import & Post-Import Diagnostics V1

## Product rule / scope
Discussion records AI-authored judgment. Import validates parseability and structural usability, not investment correctness.
V2 contract supersedes V1 content restriction policy for Discussion only.
本任务规则仅适用于 Discussion，不是其他模块的默认 validation policy。
Baseline: `5fb1152`. No push, deploy or production smoke is authorized.

## Pre-implementation validator inventory / before → after
The inventory covers `DiscussionStateContract.parse`, `validateUserDecision`, `validateJudgment`, `processImport`, `buildCandidate`, and persistent `DiscussionWorkbench.validateState/validateStore`.

|Reason|Classification|Before|After|
|---|---|---|---|
|Malformed/truncated JSON; StrictAiJson unsafe transport|STRUCTURAL|BLOCK|BLOCK|
|Unknown/missing root or nested fields, unusable types|STRUCTURAL|BLOCK|BLOCK|
|Unknown fixed enums/schema, text/list storage bounds|STRUCTURAL|BLOCK|BLOCK (existing canonical representation)|
|Wrong symbol/source binding, changed preview/session|STRUCTURAL binding|BLOCK|BLOCK (cannot attach safely to selected object)|
|Missing/invalid complete technical anchor|STRUCTURAL persistence|BLOCK|BLOCK (required by current persistent reader)|
|Shares-only session change|Session consistency|Explicit acknowledgment|Same acknowledgment, never content rejection|
|Any number, exact price, percentage, shares, quantity, cost, date in userDecision|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY; explicit current shares mismatch → WARNING after save|
|Decisive commands / new position values|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY|
|Zero/held prose or status/category contradiction|CONTENT_SEMANTIC|BLOCK|WARNING for high-confidence position mismatch after save|
|Technical jargon, internal English tokens, disclaimers, repeated wording|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY|
|Risk attribution without market input|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY|
|Risk-control versus safe decision contradiction|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY|
|Plan relationship versus active Plan facts|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY|
|High confidence with stale technical evidence|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY|
|Full conditions satisfied / price trigger implies execution|CONTENT_SEMANTIC|BLOCK|ACCEPT SILENTLY|
|Empty reasons list (persistent reader permits it)|CONTENT_SEMANTIC quality|BLOCK|ACCEPT SILENTLY|

Existing schema text/list bounds remain to prevent loss through existing normalization; no investment correctness is inferred from them. Exact typed strings are required, rather than coercing objects to text.

## Post-import diagnostic architecture and fact authority
Derive diagnostics only from saved judgment and `references.holding` import-time snapshot. No live stock fact is used to determine historical mismatch. Existing current applicability/binding/freshness remains separate. Diagnostics have warning/info severity and never enter Preview or save eligibility. Future `rule_conflict` may be added to this derived collection without becoming a gate.
Program-owned shares, cost, price, trades, orders, executionLog, managementCategory and Plan remain unchanged. AI userDecision is not Real User Decision; proposals are not Official Plan.

## Downstream review
Homepage `selectActionSignal` already checks canonical held/zero state, fixed enum eligibility and freshness, uses fixed display sentences, and never extracts trades from prose. Plan Draft `protectedFacts` reads stock.shares/cost and independently validates Preview/Confirm. Discussion V4 records immutable AI evidence; `prepareDecision/commitDecision` requires explicit outcome and canonical shares. Runtime consumes a separately bound judgment as evidence and has its own confirmation contract. No automatic execution path found. Discussion/history presentation now uses snapshot facts for entry/increase labels while retaining all AI summaries, including holding and not_applicable sections. Plan Relation remains the saved AI opinion alongside separately program-derived Plan reference prices.

## Previous behavior and prompt changes
V1 reliability prevented exact numeric facts from appearing in userDecision and asked AI to use qualitative wording even for correct facts. The previous zero-position contract also rejected hold/reduce/TP/SL wording, while several content validators rejected confident judgments, technical jargon, repeated phrases, market attribution and Plan disagreement.
The opening/archive prompts now explicitly permit numeric facts, decisive investment opinions and Strategy Proposal parameters. Program facts remain authoritative. The prompt asks AI not to claim trades were executed, but such text still imports when structurally usable. Optional evidence-quality guidance remains advice to the AI, not an import gate. Existing allowlist, enum, symbol/source binding and fenced StrictAiJson transport instructions remain.
Obsolete semantic-retry directions were removed; structural retry, raw input retention, atomic failure, double-save lock and stale-preview protection remain.

## Import-time versus current facts / history
Diagnostics derive solely from saved `references.holding.shares`; neither live holdings nor the prompt's older starting quantity is substituted. After shares-only reconciliation, the confirmed current quantity is the snapshot. Current State, its history and V4 immutable AI evidence retain this existing snapshot through normalization/reload. There is no new persistent schema, no extra AI output field, and no diagnostic back-write. Matching at 6000 shares stays matching after live shares become 3200; applicability can independently become stale.

## Deterministic detection / known limitations
- `holding_fact_mismatch`: clear clause-leading Chinese current holding statements followed by Arabic numeric quantities and 股, with decimal or grouped thousands support. Compared against import-time canonical shares.
- `position_semantic_mismatch`: explicit current-zero claims versus nonzero shares, explicit holding/reduction/profit wording versus zero shares, or contradictory fixed position enums/category.
- Only `warning` is emitted in V1; the diagnostic collection supports warning/info without affecting saving. UI uses a small amber section and never inserts diagnostics into the import textarea, preview or error message.
- Natural-language detection deliberately omits ambiguous clauses, quotations, hypothetical prefixes, historic statements, Chinese spelled-out quantities and unrecognized phrasings. It is not a general investment-correctness checker.
- V1 emits no price mismatch diagnostic: current market price is not a separately reliable import snapshot here, and a technical close is not a substitute. Strategy price, percentage and quantity proposals do not create current-fact mismatch warnings.
- No arbitrary Plan/technical disagreements are inferred. The old full-condition text matcher was removed from the gate instead of presenting its unproven result as a fact warning; no program evaluator currently supplies sufficient proof for that diagnostic.
- Existing canonical caps are unchanged: stage 40, top summary 500, headline 120/140, decision summaries 160, Plan relation 300; existing array/element caps and fixed field shapes apply. They prevent canonical truncation/reader invalidity, not investment semantics. Existing trim/dedup/list normalization remains; no numeric removal, regex rewrite, automatic correction or investment-content sanitization was added.
- Existing technical-anchor persistence and source/preview session binding requirements still apply. A stale session or missing anchor cannot produce an attachable, valid continuous Discussion object. This is distinct from disagreements inside a structurally valid judgment.
- Old V1/V2 histories use their own saved references when available; missing/unknown shares produce no speculative warning.

## Validation evidence
All fixtures are synthetic; no paid model requests, cloud writes, push, deployment or production smoke.

|Suite|Result|
|---|---|
|Full JS (all Discussion, V3 state contract, V4, Holding reconciliation, technical anchors, Plan workflow and Homepage tests)|1070 PASS / 0 failed / 0 skipped|
|Python|21 PASS|
|New permissive browser acceptance|360×800, 390×844, 1280×900 PASS; matching/mismatching shares, zero-position wording, explicit strategy; Confirm, formal page, reload, later facts, zero AI|
|Updated Discussion reliability browser|Three sizes PASS; numeric preview, structural errors, input retention, forced DOM enable safety, atomic failure, double-save lock|
|Updated Holding reconciliation browser|Three sizes PASS; six change/conflict combinations, snapshot binding, acknowledgment, stale preview, save failure|
|Plan + Discussion V4 core loop browser|Three sizes PASS; explicit user decision, create/update, atomicity, source, history, storage and reload|
|Plan Draft raw-input browser|Three sizes × four background timings PASS|
|Homepage key browser|Three sizes PASS; canonical zero-position suppression, routes, no overflow/no automatic discussion|
|Technical anchor browser|390×844 and 1280×900 PASS|
|Discussion data readiness browser|Three sizes PASS|

Evidence: `test-results/permissive-*` logs and `test-results/permissive/` browser JSON/screenshots. Phone shares warning (360), zero-position warning (390) and desktop numeric proposal (1280) screenshots were visually inspected: original text readable, amber nonfatal diagnostics, no horizontal overflow.
The existing reliability fixture framework was reused. Former content BLOCK assertions were superseded only in Discussion suites; structural/unknown enum/strict parser/source-binding/save-failure assertions remain. New focused tests cover all requested content classes, unchanged canonical domains, historical matching/mismatch and downstream canonical shares.
The browser save path also refreshes existing derived V13 projection IDs/timestamps and embeds updated Discussion evidence in its legacy projection. Accordingly browser assertions compare canonical domains; pure candidate tests additionally compare the entire state excluding Discussion evidence and its existing updatedAt. No projection generator was changed.

## Safety assertions / downstream module boundary
Candidate comparisons prove zero changes to shares, average cost, current price, holdings, trades, orders, executionLog, managementCategory, allocation, Plan and long-term logic. Real User Decision count remains zero after import; V4 stores AI evidence only. The browser confirms those canonical domains across real persistence. Homepage fixed enum/canonical shares guard still suppresses a zero-position imported reduce judgment.
StrictAiJson, Plan Draft/Confirm, Plan V4 definitions, Runtime, PlanReview, Technical Review, Homepage, manual sync, API import, holdings, trades, orders and DB02 business implementations remain unchanged. The only consumer UI adjustment is the Discussion saved-card renderer. This policy must not be generalized to any other module.

## Deferred DB02 diagnostics / recommended next task
No DB02 rule engine or evaluator is implemented. A later evaluator may append a program-derived `rule_conflict` diagnostic from bound rule evidence, never changing this Discussion gate into a semantic blocker. It must distinguish rule version, evaluated facts and applicability from AI judgment and preserve its own independent contracts.
This provides a safe foundation to enter **DB02 Rule Evaluator / Plan Runtime & Trigger V4 design**: record/evidence authority, explicit user confirmation and independently bound Plan contracts remain intact. Recommended next task is that design work, defining deterministic rule inputs/results, fact/rule version binding and module-specific ACCEPT/WARN/BLOCK policies before implementation; do not assume Discussion permissiveness governs execution.

## Release discipline
Builds directly on `5fb1152`; V1 reliability infrastructure and this policy will be released together. Source commit → asset/version → manifest → committed artifact/hash verification → READY_FOR_PUSH. Existing local edits to `data/market_data_bridge.js` and `data/market_task_status_bridge.js` are preserved and excluded from task commits; manifest and artifact verification use committed blobs, not those unrelated working files. Existing `_site` is not overwritten.
- Source implementation commit: `c5d14140adc45a0a376cb32601acf70346943e08`.
- Asset/version commit and manifest sourceCommit: `2c84d7190fdd7df735a1c107ac56b6077891be2a`.
- Asset version: `discussion-permissive-import-diagnostics-v1-20260912`.
- Final focused suites: **536 PASS**. Versioned full JS: **1070 PASS**, 0 failed / skipped. Versioned permissive browser acceptance: all three sizes PASS again.
- `test-results/permissive/verify-release.cjs` runs the real `artifactPlan` using committed blobs; **85 source files / 86 artifact files PASS**. Every byte count and SHA-256 is verified, including both committed market files; sourceCommit ancestry and unchanged non-Discussion runtime modules are verified. `_site` remains untouched.
- The final preparation commit contains only this document and the generated manifest. Post-commit `--committed` verification records the final HEAD in `test-results/permissive/ready-for-push.json`. Intentional working-tree exceptions are only the two pre-existing market bridge modifications, excluded from all three task commits.

Completion status: **DISCUSSION_PERMISSIVE_IMPORT_POST_IMPORT_DIAGNOSTICS_V1_COMPLETE**.
Final stopping point: **READY_FOR_PUSH**. No push, deploy or production smoke performed.

