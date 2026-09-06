# Discussion Data Readiness + Return Flow V1

## Scope and baseline

- Repository: `flyinlemon-H/investment-workbench-mobile`; branch: `main`.
- Before editing, fetched `origin/main`; HEAD and origin/main both `ddc61b69982060dd86be3979112b98d20e2f4e91`, ahead/behind `0/0`, clean sole worktree at `E:/users/kaka/onedrive/文档/investment-workbench-mobile`.
- No source or market-bridge divergence at baseline. Accepted asset: `homepage-risk-alert-v1-20260906`.
- Release candidate asset: `discussion-data-readiness-v1-20260906`. Stop before push; no Pages deployment or production smoke without explicit authorization.

## Hard technical prerequisite

`src/discussion-data-readiness.js` derives the model outside the renderer. It does not calculate elapsed days or implement a calendar.

Canonical sources:

1. `PortfolioReviewContext.compactTechnical(stock)` and `technicalConsistency(stock)`: `technicalData.technicalDataStatus`, `technicalAsOf`, `latestCompleteBar`, valid complete positive-close price history, snapshot price and same-snapshot support/resistance consistency.
2. `UniverseHandoff.validBridgeFacts`: when bridge metadata exists, check `marketDataFreshness.last_trade_date`, `is_complete_bar`, `technicalIndicators.last_trade_date` against complete history.
3. `marketDataFreshness.kline_status`: a stale/failed bridge cannot be described as current.
4. `UniverseHandoff.isPending`: unavailable expected market coverage is presented as pending.
5. Existing `DiscussionStateContract.assessTechnicalAnchorReadiness` continues independently to govern archive entry/preview/save. Its implementation is unchanged.

Boundary normalization: canonical `todayRelevance=current` -> current; outdated -> stale; inconsistent -> anomaly; missing complete history/snapshot -> unavailable; expected uncovered symbol -> pending; unrecognized/failed status -> unknown. Only current is ready. A bridge inconsistency cannot be promoted to ready. Missing history has precedence over a bridge mismatch.

Labels include “行情数据正常 · 日K截至 09-04”, “行情数据待更新 · 当前技术判断不能作为最新依据”, and “缺少完整日K · 请先补齐行情数据”. The CTA opens existing technical workspace and explains that complete K is PC-generated. No browser K-generation promise or new update pipeline is introduced.

Weekend/holiday behavior follows the program-owned status: `state.js:technicalFreshnessStatus` already accepts bridge `kline_status=current`, otherwise uses its existing business-day fallback. This selector trusts those facts. The existing `TechnicalViewUx.canonicalTechnicalDate` presentation also has an independent three-business-day check that can conflict with bridge current during long holidays; this pre-existing limitation is recorded, not copied into a second calculator or changed in this task. No new calendar or pipeline facts are claimed.

Free discussion remains available when technical readiness is limited. Prompt rules require conditional current technical/position/TP/SL conclusions, no substitution of old research for current K, and no high confidence. Import validation with a prepared readiness model also rejects high confidence when technical readiness is not ready. An existing usable historical anchor can still permit a conditional archive under the unchanged anchor guard; technical freshness and anchor continuity are distinct facts.

## Soft research and question-dependent necessity

Reuse `PortfolioReviewContext.compactNews`, `compactFundamental`, `compactLongTerm`, and `compactValuation`, including canonical `status`, `todayRelevance`, evidence, and dates. No competing soft freshness policy is added.

- News: `recentCatalyst` analysis/source dates, freshness flag, snapshot/historical evidence.
- Fundamental: `financialReview` and `financialData`, canonical update dates and report period.
- LTL: `longTermLogic`, current audit timestamp fallback, thesis/drivers/risks and existing applicability.
- Valuation: `valuationReview`/`valuationData`, canonical dates, level/conclusion.
- Plan and Runtime availability are supplied alongside their existing exact bound facts in the Discussion context.

Dates and report periods are neutral UI facts. Availability does not imply evidence is adequate for the user's question. `required:false` means there is no program-imposed soft prerequisite; it does not overrule question-dependent AI judgment. Old/missing research never disables Discussion or produces a red age-based task. All four links live inside one collapsed “资料 · 查看资料” section after primary actions.

Both prompts prohibit generic update-all advice. The Discussion prompt includes full question-dependent rules and current statuses/evidence; the short archive prompt preserves minimum-evidence and uncertainty rules without resending the history. Data readiness is input-only and User Decision remains concise.

Deterministic acceptance covers:

| Question | Expected evidence behavior with current K and insufficient recent research |
| --- | --- |
| 今天是否安全持有？ | Technical/position judgment may proceed; limit claims about new event risk. |
| 现在有没有高位减仓风险？ | Technical conclusion may proceed without mandatory News update. |
| 如果想加仓应该等什么？ | Discuss technical conditions without forced soft updates. |
| 今天大跌是不是消息导致？ | “本次判断需要近期新闻依据，建议先更新新闻。” |
| 长期逻辑是不是变了？ | Request only materially insufficient thesis, report or event evidence; no generic valuation/update-all requirement. |

These are deterministic response-contract fixtures and prompt assertions, not claims that a live model was evaluated. No paid AI calls are used.

## Return flow and stale context

`discussionResearchReturn` in `ui-render.js` is an in-memory navigation value containing canonical symbol and visit-entry source snapshots. It is not part of `state`, storage, cloud, export, backup, Current State, Plan, Runtime or LTL. It is cleared when returning, closing the stock, or opening another stock normally. Losing it on reload is intentional V1 behavior.

Leaving Discussion through existing tabs/links to News, Fundamental, LTL, Valuation, Technical or Plan creates this return context. Only the matching canonical stock gets the banner. Saving changed canonical research yields e.g. “新闻已更新” plus “返回讨论”. Viewing or cancelling returns equally well. Normal direct module entry has no special return banner.

Prepared sessions stay in the existing in-memory `discussionPreparedContexts` Map. A deterministic evidence fingerprint includes canonical News/sentiment, fallback review/source dates/logic notes used by the shared selectors, both financial source objects, both valuation source objects, full LTL/current audit, and shared completeness metadata. Stable hashing ignores object-key ordering and all unrelated UI navigation. Readiness, source version and protected bindings are compared on return and before reuse. Opening a module alone never invalidates a session.

Changed canonical evidence shows “资料已更新，请重新生成本次讨论上下文。” with explicit “重新开始讨论”. Old copy/archive/preview/confirm paths fail closed. Restart builds a new prompt only after the user's action, without sending it or saving a conclusion. Neither return nor save invokes AI or updates other modules automatically.

### Binding audit and change

Before V1, News/Fundamental/Valuation had `references.modules` hashes and incremental prompt evidence but were absent from `protectedSnapshot`; sourceDiscussionVersion did not distinguish those changes. LTL, holdings, anchor, Plan/PlanReview, Runtime and market risk were already protected.

V1 retains that protectedSnapshot and its strict comparison. The new transient `prepared.evidenceHash` is checked at candidate confirmation. Existing `sourceDiscussionVersion` derivation also includes the evidence fingerprint and derived technical readiness, so after regeneration an old AI reply cannot pass with the same version. This reuses the existing binding field, adds no persisted field, and does not claim soft research became protected investment facts. No Current State schema extension or new persistent readiness object is necessary. V1/V2/V3 history remains compatible.

## Boundaries

Homepage Risk Alert eligibility and source are unchanged; News/Fundamental/LTL/Valuation/Discussion age still cannot generate homepage alerts. No research-save “Discussion待更新” homepage task is created.

No Current State schema change, Plan/Runtime redesign, Supabase/auth/migration/cloud publication, Stock Universe write, market generation/provider/PC Reader/Windows task change, or CI YAML change. Navigation uses the existing workspace router. No new modules or automatic research refresh.

## Validation and release gate

Focused deterministic tests cover current/missing/incomplete/stale/inconsistent/unknown technical evidence, weekend/holiday semantics, question fixtures, unchanged source order, every soft source mutation, technical status change, Plan/Runtime protected bindings, no-write stale confirmation, high-confidence rejection and unchanged homepage counts.

Browser acceptance `tests/discussion_data_readiness_browser_acceptance.cjs` runs the real app at 1280×900 and 390×844 with isolated storage and external requests blocked. It imports changed News through the existing editor and local save, cancels a visit, traverses every return path, verifies canonical symbol, stale archive rejection, explicit regeneration, normal-entry behavior, visible primary actions, missing-K CTA, zero horizontal overflow and zero global errors.

Verified source results: full JS 760/760, Python 21/21. Discussion readiness, Homepage Risk Alert, Discussion User Decision V3 and technical-anchor browser acceptance pass both viewports (8 suite/viewport runs); screenshots were inspected. Final manifest integrity/credential checks are recorded in the release gate report after release preparation. Baseline coverage was 731 JS / 21 Python; no surviving test is removed. The anchor test's VM harness now loads the new session-check helpers so it exercises the real guard path.

Release sequence: source commit -> asset/version commit -> manifest from committed source -> manifest commit -> final git/hash/dependency/cache-version/security gate -> stop before push.
