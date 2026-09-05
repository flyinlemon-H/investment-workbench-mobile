# Homepage Risk Alert + Reminder Truth V1

首页回答「今天哪些股票或系统状态值得我特别注意」。信息既不需要重点观察，也不需要有意义的复核，就不进入首页。安静是有效状态；提醒不是待办清单，不要求手工勾选完成。

## Repository baseline and scope

- Repository: `investment-workbench-mobile`.
- Remote: `https://github.com/flyinlemon-H/investment-workbench-mobile.git`.
- Branch: `main`; pre-edit HEAD and fetched origin/main: `79a59aff4487305a43f862c69922d00a6c24ba50`.
- Ahead/behind: `0/0`; worktree clean; no source or market-bridge divergence.
- Previous asset version: `integration-hardening-supabase-sync-v1-20260905`.
- Release asset version: `homepage-risk-alert-v1-20260906`.
- Production data, Supabase schema/RLS/RPC, PC Reader, AI Bridge, Windows Tasks, market updater and Pages CI are outside this change. No paid AI calls or production writes are needed.

## Single derived model

`src/homepage-attention.js` owns collection, eligibility, source applicability, priority, merging and lifecycle. `build(state, {now, marketTask, syncStatus})` returns `items`, `count`, priority counts and quiet copy. It performs no writes or network calls. No new stored alert data, reminder acknowledgment or historical migration is introduced.

`homepageAttentionPanel` only renders name, priority, title, one explanation, optional secondary context and one CTA. Dashboard count comes from the same result. Stock/ETF/watch navigation badges remain stock counts, not reminder counts.

Each item exposes internal `source`, `sourceAsOf`, `sourceStatus`, stable ID and `changedAt`; merged stock items retain per-cause provenance. These fields are not shown as technical metadata to users. Live sync queue status has no canonical timestamp, so `sourceAsOf` is explicitly null, not a fabricated observation time.

## Source inventory and old-path treatment

| Source / old condition | Treatment | New homepage behavior |
| --- | --- | --- |
| `updateChecklistRows`: price age, technical age, valuation absence/age, financial absence/age, personal-view age | replace | Old generator returns no rows. Only relevant canonical technical health can qualify. |
| `collectionInputs.newsRawText && !aiReviews.newsReview` | remove | No eligibility, count or badge; canonical News updates cannot leave this old task behind. |
| `collectionInputs.financial/social/technicalRawText` without old AI review slot | remove | Raw input presence does not create a homepage task. |
| Focus stock missing valuation raw text | remove | Optional research is not mandatory homepage work. |
| News/Fundamental entry freshness chips | remove | Stock entry badges no longer advertise these age-only research tasks. |
| LTL/Valuation/News/Fundamental freshness metadata and `todayRelevance` | retain in research | Never sufficient for homepage eligibility. |
| Discussion / Current State age | suppress | No periodic discussion or conclusion-update task. |
| V13 recommendations and `InformationCompleteness` information_update | compatibility-only | Old homepage row/panel entry points return empty; stored recommendation data and detail workflows remain readable. |
| V13 Event decision/prepare/info fallback | compatibility-only | Homepage no longer consumes `getHomeVisibleEventsByStock`, including fallback when no recommendation exists. |
| `AiDecisionReviewReader.homePendingRecords` | compatibility-only | Not an authoritative current homepage risk source; detached from homepage task panel and count. |
| `v13PlanRefreshPanel` / superseded plan-review age tasks | compatibility-only | Retained for existing Plan tools; not called by homepage. |
| Legacy price-trigger list and automatic rebalance/discipline panels | replace at homepage boundary | Removed as independent dashboard card generators; underlying Plan, allocation, rule and execution workflows remain unchanged. Current accepted judgments can provide review-oriented attention. |
| PortfolioReview and DecisionCompression | retain | Audited: opened in their own module UI, not a direct dashboard source. Their schemas, judgments and research limitations are unchanged. |
| Plan Definition + Runtime binding and phase | retain / select | Current meaningful phases qualify; no phase mutation. |
| Program-owned daily bars, technical status and task bridge | retain / select | Relevant data health and global failure, with deduplication. |
| Normal sync, backup reminder and infrastructure metadata | suppress on home | Diagnostic text/settings remain available in Tools; manual 获取更新 remains available. |

The News bug was not a render cache issue: the checklist examined the legacy `aiReviews.newsReview` slot after raw News input was present. Updating canonical `newsReview`/`newsCatalyst` or its analysis date did not necessarily populate that legacy slot. This change removes that generator's eligibility, not merely its displayed text. Regression tests recreate both the pre-update and post-update state and assert zero items and all-zero priority counts.

**News/Fundamental/LTL/Valuation freshness is no longer a homepage task by age alone.**

**Discussion age never creates a homepage reminder.**

## Eligibility and relevance

Eligible categories are current position/risk/opportunity judgment, meaningful Plan Runtime state, relevant hard technical-data problem, and a system/sync failure blocking required facts.

Relevance uses existing `PortfolioReviewContext.holdingFacts`, active unexpired State-Watch Plans, explicit `watching`/`watchlist` membership, or a current accepted `focused`/`window` attention level. No new watch-target system or holdings snapshot is added. Expired/inactive/historical-only Plans do not grant relevance. Zero shares plus no active Plan/watch/attention and stale K produces no item.

Current high-priority accepted entry opportunity may qualify a zero-position candidate even without a Plan. Zero-position stocks never get holding reduction, profit-protection or stop-loss wording; an active entry review can receive downside-risk attention. Shares, not the stock's `holding` category label, determine actual holding status.

## Risk evidence and applicability

- Primary source: validated `discussionState.current` V3 `userDecision` (`holding`, `positionDirection`, `addAssessment`, `takeProfit`, `stopLoss`, `riskSource`) together with actionAssessment, attentionLevel and confidence.
- V2 compatibility: validated high `risk_control`, `reduce_review` on holdings or high `entry_review` on zero position. V1 remains readable in Discussion but free-text historical risks are not inferred into homepage alerts.
- Applicability reuses `DiscussionWorkbench.stateFreshness`, `barsAfter`, `technicalSnapshot` and current PlanReview binding. It additionally requires no new complete bars and unchanged technical-review hash. Discussion continuity intentionally allows new bars; homepage current-risk assertions use the stricter latest-facts check.
- Invalid symbol/anchor, changed position/Plan/PlanReview/LTL binding, changed technical review, new complete bars or bad technical health suppress old risk. No “go update Discussion” item is manufactured.
- No current risk is inferred from News sentiment, missing scores, technical enum text or persisted V13 recommendations.
- Low-confidence judgments do not create primary risk alerts.
- An existing explicit `discussionMarketRisk` object lacks a canonical freshness/binding contract. V1 does not independently produce broad-market exposure alerts; market-only judgments are suppressed. `both` can supply stock risk wording without claiming current market conditions. Adding market freshness is a later source-data task, not a pipeline redesign here.

## Priorities

| Priority | Eligible meaning |
| --- | --- |
| critical | Current risk-control judgment; current Runtime invalidation; missing/stale/inconsistent technical data on a holding with an active State-Watch Plan; current global market failure. |
| high | Reduce review; take-profit watch/review; high accepted add/entry opportunity; Runtime confirmed/action_review/downgraded; important Runtime binding change; workflow-blocking sync. |
| medium | Focused holding caution / stop-loss observation / planned-entry downside risk; relevant technical data problem; eligible watch_zone / forming; other active Runtime binding changes. |

No low/informational tier. Equal priorities sort holdings first, then latest meaningful change, then State-Watch relevance. Same-phase Runtime revisions use the last actual phase-change time, not revision activity, for ranking.

## Plan / Runtime

Homepage reads existing `Runtime.runtimeFor`, strict `validateRecord`, `bindingStatus` and canonical Plan freshness. It never calls Runtime prepare/commit or creates transitions.

| Runtime state | Homepage |
| --- | --- |
| watch_zone | Medium for relevant Plan, non-low Runtime confidence. “已到达观察区间，条件还未成熟。” |
| forming | Medium only with current focused/window attention and non-low Runtime confidence. Normal forming is quiet. |
| confirmed | High: key conditions confirmed, review next step. |
| action_review | High: operation review; CTA opens Plan workspace. |
| downgraded | High: conditions weakened, re-observe. |
| invalidated | Critical: original conditions invalidated, review Plan. |
| inactive / resolved / missing / malformed | Suppressed. |
| definition_changed / current_state_changed | For a previously meaningful active phase, clearly stale “计划状态需要重新复核”; never repeats the old phase as current. |

Current phase claims require usable current judgment and technical health. Stale binding notices describe the actual binding change and can coexist with a dominant technical blocker. Plan price alone is not a homepage alert; legacy price checks and program price-reference facts remain in Plan detail. Price reaching a zone never implies full conditions confirmed or automatic execution.

## Technical and system health

`TechnicalViewUx.canonicalTechnicalDate` supplies shared complete-bar/date/freshness rules; `PortfolioReviewContext.compactTechnical` checks snapshot consistency; `UniverseHandoff.validBridgeFacts` checks supplied bridge bar/indicator alignment. Existing business-day tolerance and pipeline `technicalDataStatus` are reused without a new market calendar. Friday bars are not stale merely because it is Sunday. No claim is made to add a holiday calendar beyond existing pipeline facts.

Model health distinguishes current, pending, stale, unavailable and inconsistent. Complete bars or required metadata missing -> unavailable; expected pending Universe coverage -> pending; mismatched/future technical evidence -> inconsistent; canonical stale -> stale. These problems appear only on relevant symbols. Healthy data and normal sync produce no cards.

Global market failure comes from current `MARKET_TASK_STATUS` via `taskStatusPresentation`: total task failure, delivery failure or bridge failure. One system card suppresses associated stock stale/pending/unavailable cards. Partial task failure stays per-symbol. A separate per-symbol inconsistency is retained because global failure does not prove that mismatch has the same cause. Historical/unknown task status is not promoted to current failure.

Sync qualifies only when canonical `UniverseAutoAdd.status()` reports error/offline/auth_required with a pending queue AND a relevant symbol has unavailable/pending data and pending canonical Universe coverage. A signed-out user with working local facts sees no alert. This does not alter Auth or sync behavior.

Missing facts: there is no separate reliable per-workflow Auth-failure timeline, complete market holiday calendar or timestamped market-risk context in these inputs. The model does not invent them. An idle/unknown bridge or normal offline local use alone does not generate an alert.

## Deduplication and lifecycle

At most one primary card per stock; highest priority wins. At equal priority a technical blocker wins, then newer evidence. One optional secondary title and internal cause list retain context. Source-level global market failure is merged before stock cards; counts represent final cards.

- Technical alert disappears when canonical facts are repaired; irrelevant symbols remain suppressed.
- Risk disappears when a new accepted judgment no longer qualifies or the source ceases to apply.
- Runtime phase alert disappears when phase becomes inactive/resolved, Plan retires/expires, binding becomes stale or the underlying current judgment/technical facts cease to apply. A meaningful binding change can instead yield the explicit stale Plan notice.
- Global failure disappears when task status recovers or ceases to be authoritative; unresolved relevant per-stock facts can still generate their own data alert.
- Sync failure disappears when blocking queue/facts recover.
- No checkbox, synthetic task completion, second alert database or LLM processing.

## Presentation and existing navigation

Quiet copy: “今日暂无需要优先关注的风险。” Other symbols get no “everything healthy” card. Portfolio distributions remain in a compact collapsed section. Existing nine top-level navigation entries remain intact. Normal sync banners, backup reminders and the legacy RC suffix no longer consume homepage first-screen space.

Risk CTA opens the stock's Discussion workspace without starting a prompt or saving a conclusion. Plan CTA opens the existing Plan workspace. Technical/global-market CTA opens the relevant stock's technical workspace and expands existing data status, including task evidence. Sync CTA opens existing sync settings. No trading instruction or new workflow is added.

## Verification and release gate

- Deterministic fixtures: `tests/fixtures/homepage-attention.js`.
- Focused coverage: `tests/homepage_attention.test.js`, including all 15 requested scenarios, News pre/post-update counts, source invalidation, zero position, active/expired plans, runtime bindings, global/partial failure, sorting and read-only determinism.
- Browser acceptance: `tests/homepage_attention_browser_acceptance.cjs`, real app at 1280×900 and 390×844, isolated fresh browser contexts, fixed fixture clock, all external traffic blocked. Screenshots and JSON evidence are under `test-results/homepage-attention/` (not published).
- Existing full JS includes Current State V1/V2/V3, Discussion User Decision, Runtime, PlanReview, legacy/state_watch, LTL, Stock Universe, Manual Analysis Sync and storage. Baseline 693 tests remains; homepage adds coverage.
- Verified local results: homepage 38/38; full JavaScript 731/731; Python 21/21. Homepage, Discussion V3 and Runtime desktop/mobile browser suites pass. Manual Analysis Sync passes all four existing viewport/role combinations (1280 publisher, 500 publisher, 390 receiver, 1024 receiver). The sync acceptance scripts now open Tools before accessing normal sync settings; assertions are preserved.
- Full Python baseline is 21 tests. No surviving coverage is removed.
- Release preparation: source commit -> asset/version commit -> regenerated manifest commit -> hash/dependency/cache-version/credential scan -> stop before push.
- Push and Pages deployment require the user's separate explicit authorization for this release. Previous Manual Analysis Sync authorization is not reused.

## Discussion Data Readiness boundary

A future explicit Discussion question can request News, Fundamental, Long-Term Logic or Valuation freshness/completeness when relevant to that question. The module contracts, source dates and freshness metadata remain available for that work. Homepage does not implement data readiness, auto-start Discussion, request missing scores or call AI.
