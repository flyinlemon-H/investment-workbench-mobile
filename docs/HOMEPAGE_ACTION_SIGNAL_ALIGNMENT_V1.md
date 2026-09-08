# Homepage Action Signal Alignment V1

## Repository and release boundary

Authoritative repository: `investment-workbench-mobile`; remote `https://github.com/flyinlemon-H/investment-workbench-mobile.git`; branch `main`. Before editing, `git fetch origin main` resolved HEAD and origin/main to `7e1d5ef2e0d4ab25c33e1dc5f43c83568b164b46`, ahead/behind **0/0**, one main worktree, clean working tree. No generated market-data divergence or source divergence existed.

Release asset: `homepage-action-signal-alignment-v1-20260908`. Prepare source, version and manifest commits locally; **do not push, deploy Pages, or run production smoke without the user's explicit next authorization**. All portfolio inputs used for acceptance are isolated synthetic states, not real holdings or accepted production judgments.

## Confirmed root cause and limits of the observation

The old path was `HomepageAttention.build` → `riskSignals` in `src/homepage-attention.js` → candidate priority sort → `homepageAttentionPanel` in `src/ui-render.js`. Its exact test was `['watch','review'].includes(d.takeProfit.status)`. Both statuses unconditionally yielded code `take_profit`, priority `high`, title **开始关注利润保护**, body **当前止盈判断需要关注，复核利润保护条件。**

This discarded the watch/review strength distinction. A focused `holding.caution` was only medium priority, so even a watch-only profit field outranked it; the second candidate became the generic holding-risk secondary. Summary/headline were not used to guard contradictions. The old test explicitly required *both* watch and review to be high priority. There was no generic `requires_attention` field in this path, and a merely non-null field or a `none` status did not trigger the bug. Reduction candidates already preceded profit candidates on equal-priority insertion ties, so profit did not universally outrank reduction.

The reported three real production archives were not exported or changed. The confirmed code defect explains the observed shared card whenever their stored TP status was `watch` (or `review` conflicting with explicit negative prose); it does **not** establish their exact live enum values. Synthetic A reproduces the defect with `watch` and an explicit no-current-TP sentence. No symbol-specific branches were added.

## Audited V3 contract and complete mapping

Sources audited before implementation: enum exports, `normalizeUserDecision`, `validateState` and prompt in `src/discussion-workbench.js`; `validateUserDecision` in `src/discussion-state-contract.js`; `docs/DISCUSSION_USER_DECISION_V3.md`. These dimensions are independent. In particular, holding may be safe while TP review is warranted, or exposure reduction is worth considering. `hold` is not a formal `no_reduce` enum and there is no `immediate_action` status. All TP/SL statuses are qualitative judgments, not orders or mandatory execution.

Gates for every action: accepted, valid Current State; existing strict Homepage freshness; confidence not low; canonical held/zero position match; existing market-only-source suppression. “Focused” below means `attentionLevel` focused/window. No free text, category label, price proximity, generic high priority, or warning object creates an action.

| Dimension / status | Existing meaning | Derived action / strength | Eligibility or suppression |
| --- | --- | --- | --- |
| holding.safe | Holding safety acceptable | none | Ordinary holding hidden; independent current actions may qualify |
| holding.caution | Holding warrants caution | 注意持仓风险 / attention | Focused only |
| holding.reduce_review | Holding safety merits reduction review | none by itself | Reduction requires positionDirection.reduce_review; otherwise record conflict and do not upgrade |
| holding.risk_control | Holding risk control warrants priority | 注意持仓风险 / attention | Critical attention, never invent stop-loss from this field |
| holding.not_applicable | No held-position assessment | none | Required for zero; held mismatch suppresses |
| positionDirection.hold | Maintain holding | none | Hidden by itself |
| positionDirection.hold_no_add | Maintain holding, no increase | none alone; 暂不加仓 / wait when corroborated | Ordinary restriction hidden; can qualify via focused wait decision below; vetoes add opportunity |
| positionDirection.add_watch | Watch increase/entry opportunity | none alone | Never a buy opportunity; can corroborate meaningful waiting |
| positionDirection.add_review | Increase/entry merits consideration | none alone | Opportunity still needs addAssessment.add_review and matching high-priority actionAssessment |
| positionDirection.reduce_review | Consider reducing exposure now | 可考虑减仓 / consider | Held; explicit no-current/future-only veto; high priority |
| positionDirection.risk_control | Defensive exposure/risk-control direction | 注意持仓风险 / attention | Held, critical; not synonymous with compulsory stop-loss |
| positionDirection.not_applicable | No current exposure direction | none | Allowed for zero; ordinary empty-position waiting remains quiet |
| addAssessment.wait | Conditions not mature | none ordinarily; 暂不加仓 / 暂不建仓, wait | Only focused + actionAssessment.wait_confirmation medium/high + compatible waiting direction |
| addAssessment.watch | Opportunity still under observation | same conservative waiting treatment | Never add/build opportunity from watch |
| addAssessment.add_review | Current increase/entry merits consideration | 可以考虑加仓 / 可以考虑建仓, consider | Matching actionAssessment category add_review/entry_review, priority high; no defensive or hold_no_add conflict; negative/future-only veto |
| addAssessment.avoid | Avoid increasing/entering | 暂不加仓 / 暂不建仓, wait | Relevant + focused + stock/both risk; otherwise hidden |
| addAssessment.not_applicable | No buying assessment | none | Hidden |
| takeProfit.none | No current TP need | none | Always suppress TP, regardless of other priority/headline words |
| takeProfit.watch | Watch possible future profit protection | none | Always suppress TP; no “开始关注利润保护” or secondary TP from watch |
| takeProfit.review | Current TP deserves consideration | 可以考虑止盈 / consider | Held, high priority, negative/future-only veto |
| takeProfit.not_applicable | No held profits to assess | none | Required for zero; never TP |
| stopLoss.none | No current capital-risk stop-loss signal | none | Never SL |
| stopLoss.watch | Observe potential capital risk | 注意持仓风险 / attention | Held and focused; never mandatory SL |
| stopLoss.risk_control | Current capital risk warrants risk-control consideration | 需关注止损 / consider | Held, critical, negative/future-only veto; deliberately weaker than “需要止损” |
| stopLoss.not_applicable | No holding capital at risk | none | Required for zero; never SL |
| warning.summary / items | Bounded prose, no status/severity | none | Neither existence nor text makes an alert; never rendered |
| headline | Bounded prose headline, no status | none | Never positive classification or display input; narrowly vetoes explicit contradictory action wording |
| riskSource.none | No identified risk source | none | No independent eligibility |
| riskSource.stock | Individual-stock attribution | none | May corroborate focused avoid restriction |
| riskSource.both | Stock and market attribution | none | Same stock restriction gate; no raw attribution text displayed |
| riskSource.market | Market-only attribution | none | Preserve V1 suppression: no freshness-bound authoritative market source |
| riskSource.unclear | Uncertain attribution | none | No independent eligibility; no focused avoid from attribution alone |
| Unknown status / mismatched position | Unsafe to interpret | none | Suppress with diagnostic reason |

Compatible meaningful waiting directions are held `hold_no_add`/`add_watch`, or zero `not_applicable`/`add_watch`. This deliberately does not infer that a change “recently approached” from historical prose. A focused `hold_watch` plus routine add wait still stays quiet.

## Action selector, strength and provenance

`HomepageAttention.selectActionSignal` is a deterministic derived layer within the existing module, separate from rendering and persistence. It returns primary, optional secondary, internal candidates and debug metadata: source, primaryDimension, primaryStatus, secondaryDimension, eligibilityReason, suppressionReason, conflicts. `build().diagnostics` also explains stocks suppressed by source freshness/validity. These values are not rendered or saved.

Candidate order is explicit SL capital risk → other explicit capital-risk attention → current position reduction → current TP review → held add opportunity → zero entry opportunity → meaningful buy restriction → focused holding risk. Selection uses actual dimension strength; no `watch` becomes `review` or execution. An existing critical risk can properly precede a consider-strength reduction. A secondary must have a different action/title; at most one is visible. All causes may remain internal for debugging.

One candidate representing the selected Current State action joins the existing per-stock data/Runtime candidates. Severity remains critical/high/medium. For equal severity, data-health blockers precede current actions, which precede generic Runtime arrangements; recency breaks remaining ties. Existing one-stock-one-card, global failure dedupe, relevance, ordering across stocks and recovery behavior remain intact. The displayed count is exactly the final eligible-card count.

Final Current State primary vocabulary: **注意持仓风险、需关注止损、可考虑减仓、可以考虑止盈、可以考虑加仓、可以考虑建仓、暂不加仓、暂不建仓**. `继续持有` alone is omitted instead of generating routine cards. No “建议减仓” or “需要止损” is claimed because the reviewed contract does not establish mandatory execution.

V2 read-only compatibility retains its narrow high-priority risk_control/reduce_review/zero-entry rules with the same conservative action labels; no fabricated User Decision layer is persisted. V1 has no inferred prose risk.

## Contradictions and language boundary

Structured fields determine action type. `holding.safe` and TP review may legitimately coexist; holding is a safety dimension, not an unconditional refusal of every partial sale. An explicit position hold remains insufficient for reduction despite holding.reduce_review. A buy opportunity conflicting with hold_no_add, risk_control, current reduction or current TP review is suppressed and recorded.

A small **negative-only veto** checks the relevant dimension summary and headline for bounded explicit negatives associated with that action, and the summary for a future-only opening such as 若/如果/一旦. It cannot infer an action, priority, technical meaning or investment recommendation from arbitrary prose. It can conservatively suppress an ambiguous mixed sentence. It is not a general natural-language consistency validator, and does not claim to understand every possible Chinese paraphrase. No new persistent field or V4 contract is needed. The mandatory explicit no-TP, no-reduce and conditional fixtures are vetoed even if their structured review status conflicts.

All ordinary card titles and sentences come from fixed action vocabulary. Raw headline, warning, summary, riskSource, technical indicator and reasoning text never reach the homepage. Thus MA20/MACD, 支撑、均线、放量、承接区域、趋势结构、技术锚点 cannot leak through ordinary action cards. Discussion remains the detail layer and Current State action CTAs still open the stock Discussion.

Plan/Runtime eligibility, validation, phase transitions, binding and schemas are preserved. Its user-facing wording is conservatively **关注持仓安排 / 关注建仓安排** with one short operation sentence; a stale binding is **原计划需要确认**. Without an explicit current judgment it does not establish buy permission. Watch/formation says conditions are not mature; invalidated says to pause use of the old plan. No technical paragraphs or phase-code titles are shown. Data/system-health alerts remain distinct and genuine failures are retained.

## Three realistic regressions

| Synthetic state | Relevant structure | Homepage |
| --- | --- | --- |
| A: hold / no current TP / add wait | safe, hold_no_add, wait, TP watch with 尚未进入明显止盈复核阶段, SL none | Hidden; no TP signal |
| B: hold / focused short-term risk / no active reduction | caution, hold_no_add, wait, TP watch, SL none, focused, stock risk | 注意持仓风险; no reduction or TP |
| C: defensive holding / actual reduction / current profit protection | caution, reduce_review, avoid, TP review, SL none, focused, stock risk | 可考虑减仓; one secondary 可以考虑止盈 |

The combined count is **2**, with two distinct primary actions. Quiet holding with TP none and routine wait produces zero. Zero-position add_review + matching high entry_review produces 可以考虑建仓; replacing it with wait removes the card. No fixture uses real portfolio snapshots or stock-name-based branches.

## Unchanged boundaries and next task

No Current State schema, Discussion V3 output, accepted Discussion content, technical-anchor guard, holding reconciliation, category lifecycle, canonical holding/category writer, Plan/Runtime schema, Supabase configuration/service, market pipeline, dependency or automatic AI call is changed. No News/LTL/Fundamental/Discussion-age reminder is restored. Technical/source freshness remains exactly the V1 strict existing rule: latest complete bars, unchanged technical review and current protected references are required. A stale judgment is not prolonged to fill the homepage.

**This does not solve the homepage being empty before a fresh Discussion exists.** Next task: **Homepage Pre-Discussion Risk Screening V1**, to determine worthwhile current risks/opportunities before a new accepted Discussion, with a separately designed source and freshness contract. Nothing here introduces that screening.

## Validation and local gate

Focused Homepage tests: **64/64**, including **26** new action-signal cases. Final full JavaScript: **907/907**, zero skipped/cancelled; Python: **21/21**. `npm ls --all --offline` passes; dependencies and lockfile unchanged (other-platform optional esbuild packages are correctly omitted).

Browser acceptance: Homepage, Discussion Holding Reconciliation, Discussion Reliability, Discussion Data Readiness, Category Lifecycle, Category Foundation, Category Legacy, and V1A Navigation at **360×800, 390×844, 1280×900**; Technical Anchor, Plan Mode, State Watch and Plan Runtime at their existing two sizes: **12 accepted scripts / 32 viewport runs**. Homepage includes the three semantic shapes, zero-position entry vs wait, quiet state, count, compact height, jargon exclusion, all CTA routes, zero AI requests, no page errors and no horizontal overflow. Mobile and desktop screenshots were inspected. Evidence: ignored `test-results/action-final-browser/homepage/`, `test-results/action-regression/` and `test-results/action-*.log`.

Baseline historical scripts were executed before edits against fetched 7e1d5ef: User Decision browser expects obsolete five actions instead of current two (`discussion_user_decision_browser_acceptance.cjs:26`, same deepStrictEqual diff); Manual Analysis Sync browser tries to click hidden `.tab[data-tab="tools"]` (same 30000ms timeout and hidden-element signature). Candidate failures match those exact signatures. They are disclosed pre-existing non-blocking script failures, not counted as passing.

The first candidate Category Lifecycle run transiently reported shares 1000 instead of 500 at line 20. This was investigated separately: an isolated archive of origin/main passed all three sizes, followed by **two complete candidate passes** with no source or test edits to the lifecycle module. Its form auto-focus timer was inspected as a possible input-timing cause; a further 40 input iterations on each baseline/candidate found zero failures. The transient's precise cause was **not established**, and it is not misreported as a reproduced baseline failure. Full evidence is retained in `action-management_category_lifecycle.log`, `action-baseline-lifecycle.log`, `action-lifecycle-rerun.log`, `action-lifecycle-final.log`, and `action-focus-investigation.log`.

Before source commit, the daily scheduler independently delivered/published **fe2aa04e96956279344b625ede00fac4c3a6c860**, changing only `data/market_data_bridge.js` and `data/market_task_status_bridge.js`. Their local contents were verified identical to origin/main. Local main was advanced to that existing commit without changing either file or discarding source work; HEAD/origin/main returned to 0/0. No unexpected source divergence occurred. The feature commits exclude those market files.

Precommit artifact validation checks all **81 source assets / 82 delivered files**, dependency completeness, cache bindings, public-asset credential markers and market-bridge consistency. Changed source/test/documentation files also pass the existing credential scanner. Source/version/manifest commit identifiers and final clean-worktree evidence are reported after local release preparation; no push or deployment occurs.
