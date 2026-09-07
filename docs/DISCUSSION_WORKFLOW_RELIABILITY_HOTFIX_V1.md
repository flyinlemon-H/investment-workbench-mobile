# Discussion Workflow Reliability Hotfix V1

## Baseline and scope

Authoritative repository: `investment-workbench-mobile`; remote: `https://github.com/flyinlemon-H/investment-workbench-mobile.git`; branch: `main`.
Before edits, `git fetch origin main` succeeded. HEAD and origin/main both resolved to `7bba4f65fdf341d2cb62fab29b4015b5b960d503`; ahead/behind `0/0`; clean worktree; no source or market-bridge divergence. Accepted asset: `discussion-centric-v1a-20260906`.

This hotfix only addresses Discussion entry reliability and the canonical zero-position prompt/import workflow. PROGRAM OWNS FACTS / AI OWNS JUDGMENTS remains authoritative.

## Root cause A and render inventory

`aiDiscussionWorkspacePanel` previously constructed the actions but passed them into `discussionStateCard`. The V1/legacy early return did not interpolate `actions`; V2 and V3 did. Thus an otherwise valid legacy conclusion removed both workspace actions. Empty state already rendered the actions directly. Pending data was a separate limitation: `buildDiscussionRequest` threw for a continuation with blocked bar continuity, including a historical state with no available complete daily K.

| Representation | Previous CTA mount | Start / organize before | After |
| --- | --- | --- | --- |
| V1 / legacy compatible | Early-return legacy card, ignored actions argument | missing / missing | One workspace action surface |
| V2 | Card before full conclusion details | present / present | Same shared surface |
| V3 / userDecision | Card before evidence details | present / present | Same shared surface |
| No Current State | Workspace fallback | present / present | Same shared surface |
| Technical current | Depended on representation | inherited above | Same shared surface |
| Technical pending / unavailable | Depended on representation; continuation could throw on start | inherited above | Start opens discussion; archive anchor guard remains |
| Stale state / stale news or LTL / Plan review due | Depended on representation | inherited above | Same shared surface; existing readiness rules remain |

Actions are now mounted once by `aiDiscussionWorkspacePanel`, after its status strip and before version-dependent conclusion content. This keeps Start and Organize together and reachable in the first useful mobile viewport even for verbose historical states. `discussionStateCard` has no actions parameter and only renders content. Import and Current Plan remain secondary below the conclusion. No hidden duplicate CTA or new event binding is introduced. Existing handlers retain their guards; Organize may be blocked by technical-anchor or changed-context checks.

## Root cause B and prompt inventory

Canonical holding quantity was **not missing**: the existing `DiscussionWorkbench.buildContext` reads `stock.shares` into `context.currentFacts.holding.shares`, `protectedSnapshot.holding`, and protected references. The gap was instruction strength and consistency:

- The opening prompt led with held-position questions, followed by a short zero-position exception.
- The archive prompt also led unconditionally with held-position questions; its zero-position paragraph was later in the contract and omitted an explicit ban on textual TP/SL assumptions.
- Neither prompt explicitly gave today's holding fact precedence over held-position language in old V1/V2/V3 conclusions or conversation history.
- The zero-position archive example repeated the same takeProfit and stopLoss summary, conflicting with the existing no-duplicate-judgment validator.

This identifies the repository-level routes to the production symptom; it does not claim access to the original AI conversation or provider behavior.

| Prompt / transport path | Business construction | Holding semantics after fix |
| --- | --- | --- |
| Start, all state versions and empty state | `buildDiscussionRequest` | Shared `holdingPromptRules(context)` |
| Organize, including direct first use | `ensureDiscussionArchiveContext` → `buildArchiveRequest` | Same shared rule from prepared canonical context |
| Direct import preparation | Same archive preparation; no independent business prompt | Same facts and binding |
| Manual Copy to AI | Copies prepared `.request` unchanged | No transport rewrite |
| PC API / Bridge | No active Discussion request transport in this baseline; generic AI API remains transport-only | No additional Discussion business prompt to synchronize |
| Legacy analysis helpers | `buildAnalysisPrompt` / `buildAiAssistantPrompt` target `analysisFramework`, not Discussion Current State | Not a V3 Discussion import path; untouched |

No state-version branch builds an alternative Discussion prompt. `holdingPromptRules` is reused, not copied into renderers or transports. It reads existing canonical context, not categories or historical holding references. No second holding calculator is introduced.

The zero-position block explicitly states quantity 0 and zero holding, prohibits assumptions of an existing position, and gives canonical facts precedence over historical wording. It asks about waiting, observing, and possible position entry. Existing V3 dimensions and enums remain: holding/takeProfit/stopLoss use not_applicable; positionDirection uses a zero-safe direction; addAssessment answers “如果想建仓”; category uses entry_review/wait_confirmation/no_action. No output fields are added. Program-owned quantity, dates, technical anchors and internal IDs remain input-only; the existing allowed symbol/sourceDiscussionVersion bindings must be returned unchanged.

The existing strict validator rejects any 加仓/减仓/止盈/止损/继续持有 wording in userDecision, including negations. The prompt now states this precisely and supplies distinct not-applicable summaries. Historical/background text cannot override current decisions. Held stocks retain their original held-position questions and allowed V3 judgments.

## Failed import and final commit

The baseline already set native `disabled` after business validation failure; there was no scoped disabled visual styling, so the button could still look active. Its error also remained low in the modal without the existing scroll/focus error helper. This hotfix does not claim the old ordinary disabled button actually saved invalid data.

Failure now clears the cached preview and preview DOM, disables Confirm, uses visible disabled styling, scrolls/focuses concise Chinese guidance, and exposes **返回讨论**. The JSON is preserved on failure and when reopening the same stock's dialog. Returning does not invoke AI or regenerate automatically. Different-stock imports clear the previous stock's text.

Syntactic parse success does not create a valid preview: a business-invalid result is only an error explanation. Valid business output enables Confirm only after a valid preview and technical binding. Editing invalidates preview, and a direct DOM value change without an input event cannot reuse an older valid preview. Any final failure disables Confirm again. In-flight save locking prevents duplicate saves.

`DiscussionStateContract.buildCandidate` now calls the same existing `process`/`validateJudgment` business validation again using rebuilt canonical facts before constructing the candidate. Forged ok/previewReady flags cannot bypass zero-position validation. Existing protected-hash, evidence-hash, source version, technical-anchor, storage validation, detached candidate, atomic save, rollback and stale-tab guards remain. The authoritative `validateJudgment`, `validateUserDecision`, tolerant parser, and strict parser rules are unchanged.

## Acceptance

Deterministic fixtures only; browser contexts use isolated local storage and block every external request. No paid AI calls or production account writes.

- Focused Discussion suites: 156/156, including 19 new tests for V1/V2/V3/empty/pending/historical CTA, canonical zero fact in both prompts, valid zero/held output, invalid holding/reduce/TP output, forged previews, zero writes, program-injected facts and archive examples.
- Full JavaScript: 779/779 (baseline 760 retained, 19 added). Python: 21/21.
- New browser acceptance at 360×800, 390×844 and 1280×900: V3 held, V1, V2, empty, zero with historical held state, technical pending and stale soft data. Exactly one primary surface, no duplicate IDs, one Start action per tap, first-viewport reachability, no overflow or page errors.
- Real import handlers: parsed invalid zero-position JSON, Chinese error in viewport, disabled styling, no valid preview, DOM-disabled bypass blocked, zero canonical writes, preserved input and recovery, valid zero/held saves and reload persistence, stale preview text blocked, atomic save failure and duplicate-save lock.
- Existing browser suites passed: UI Simplification V1A, Discussion Data Readiness / Return Flow, Homepage Risk Alert (all three sizes), and technical-anchor/protected-context/storage/stale-tab regression (390×844 and 1280×900).
- Full JS includes Current State V1/V2/V3 compatibility, Discussion Data Readiness, technical anchors, Plan Runtime, PlanReview, LTL protected context, storage and parser/validator regressions. One old source-layout assertion was updated to verify workspace-owned actions; no behavioral coverage was removed.

Screenshots and machine-readable results are generated under `test-results/discussion-reliability/`; existing browser regression outputs are under `test-results/hotfix-regression/` (ignored local artifacts).

## Explicit boundaries and release

No Current State schema or Discussion V3 schema changes. No holdings/trades/operations mutation, Plan or Runtime change, LTL contract change, Homepage change, navigation redesign, management category implementation, Supabase schema/RLS/RPC/auth change, market pipeline/registry/provider/bridge change, parser rewrite or legacy reader deletion.

Stock Management Category Unification V1 remains a separate future task. Category names do not determine holding semantics.

Candidate asset version: `discussion-workflow-reliability-v1-20260907`. Prepare local source and release metadata commits, regenerate the manifest, verify asset hashes/dependencies/credential markers and Git push safety gate. **Stop before push and Pages deployment; explicit user authorization is required.**

Release preparation evidence: source commit `ea2e6a9`; candidate Pages artifact validation passed for all 80 delivered files (including effective manifest), browser script dependencies/cache bindings and credential-marker scan. `npm ls --all --offline` succeeded; only expected optional packages for other platforms/optional telemetry are absent. No dependency or lockfile changes. `git diff --check` passed.
