# Homepage Pre-Discussion Risk Screening V1

## Investigation and implementation plan

Authoritative repository: `investment-workbench-mobile`, branch `main`, starting clean HEAD `1997c3d`. Local tracking reference `origin/main` matches that HEAD. No network release action is part of this task.

Existing dataflow: `ui-render.js` calls `HomepageAttention.build(state)`; the derived model selects relevant stocks, checks technical health and accepted Current State, merges action and Runtime candidates, sorts severity/source/recency, and returns one card per canonical stock plus counts. The renderer uses fixed titles, a bounded secondary and the existing Discussion/Plan/data navigation. There is no separate screening store or renderer.

`HomepageAttention.selectActionSignal` owns Action Signal Alignment V1: stop-loss risk, capital risk, reduction, take-profit, buy opportunity, meaningful restriction, and holding caution. Its accepted V3 enum mapping, negative-only veto, V2 compatibility and quiet-state suppression remain unchanged.

`technicalHealth` reuses `TechnicalViewUx.canonicalTechnicalDate`, Portfolio consistency and `UniverseHandoff.validBridgeFacts`. `judgmentSource` requires `Discussion.stateFreshness`, protected references, an unchanged technical review hash and zero new bars after the accepted anchor. Discussion continuity permitting new bars does not make an old homepage judgment current.

`Portfolio.holdingFacts` consumes canonical shares; category/type/value cannot override zero shares. News, Fundamental, Long-Term Logic, Valuation and Discussion age do not establish a homepage event.

Program technical inputs are the dated `technicalIndicators.ma20`, `.ma60`, `.macd.histogram` and complete daily close. The bridge and `state.js:updateTechnicalDataFromPriceHistory` already consume these fields. `Portfolio.compactTechnical.currentJudgment`, `technicalReview`, riskFlags, action hints and structure prose mix AI/research content and are deliberately not used to create screening events.

There are two different existing Plan paths. `PlanV2.evaluatePriceTrigger` is deterministic price observation (`not_triggered`, `near`, `triggered`, `unavailable`). State-watch `PlanRuntime` phases are accepted AI/manual reviews bound to a Plan snapshot/version and Current State identity; `confirmed`/`action_review` is not an independent program proof of textual conditions. State-watch price references have no executable directional trigger contract. No parser or new Runtime engine is introduced.

The implementation plan was to add a pure screening helper inside the existing homepage module, reuse price observation and validity contracts, map its result into the existing candidate list, and verify current-action precedence, technical fallback, zero shares and read-only browser behavior before local release preparation.

## Derived behavior

`HomepageAttention.screenProgramFacts(stock, state, now)` returns temporary signals carrying canonical symbol, source, signalType, requiresDiscussion, sourceAsOf and existing action/strength/order/priority/title fields. Price events additionally carry planId, planVersion, planAction and triggerStatus. These fields are neither persisted nor accepted as User Decision or Plan Runtime phases.

Every new signal requires current technical health, known nonnegative canonical shares, exactly one bar on the canonical technical date, explicit `is_complete_bar === true` and a finite positive close. No valid Current State may exist: a valid specific action **or a valid quiet judgment** keeps the previous homepage behavior intact. Existing freshness windows are not extended.

Technical screening requires held shares, indicator date equal to the canonical complete-bar date, finite positive averages, **close < MA20 < MA60**, and a finite negative MACD histogram. This conservative conjunction is an attention filter, not a trade strategy or statistically calibrated risk probability. Partial weakness, missing indicators and opportunity-like strength are quiet. Its only title is **注意持仓风险**, medium priority, with a fixed sentence inviting Discussion. Even severe-looking technical prose cannot generate reduction, take-profit, stop-loss, entry or increase judgments.

Price screening requires a validated, active, current price Plan collection, no confirmed invalidation, explicit canonical buy/add/sell/reduce action and a current deterministic `triggered` observation. Expired, review-due, unreviewed migrated, malformed and duplicate-id Plans are suppressed. Buy Plans require their existing allocation premise. The stored `priceTriggerStatus` and `triggeredAt` are not treated as fresh evidence and are not rewritten. `near` alone does not create a V1 action.

For conservative price-basis compatibility, the canonical positive current quote must agree with the latest complete close within relative rounding tolerance 1e-6 (absolute floor 1e-6). A stale/different quote cannot be combined with adjusted historical data to claim a new trigger. This may omit reminders until those facts agree; V1 makes no intraday coverage claim.

| Current position and existing Plan | Screened title |
| --- | --- |
| Held + buy/add, objectively triggered | 可以考虑加仓 |
| Held + sell/reduce, objectively triggered | 可考虑减仓 |
| Zero shares + buy, objectively triggered | 可以考虑建仓 |
| Zero shares + add/sell/reduce | Hidden |
| No Plan + favorable technical facts | Hidden |

The existing canonical `buy` action is entry-capable; `add` alone is not interpreted as an entry Plan after a zero crossing. Existing Plan normalization conflates some historical aliases; screening does not migrate or reinterpret them. There are no distinct canonical take-profit/stop-loss objectives in the price Plan contract. Sell direction, notes and watch `risk_control` never manufacture those specialized actions. Existing valid AI take-profit/stop-loss mappings remain available unchanged.

All screened actions navigate through the existing **开始讨论** CTA. Price reminder text states **已有计划的价格条件已达到，请进入讨论确认其他条件。** Price observation does not assert complete conditions, execution readiness or permission to trade.

## Priority and safety

A valid Current State suppresses screening entirely. When Current State is unusable, a screened reduction takes precedence over generic technical attention. Any defensive screening event suppresses buy/add screening. Only the strongest screened event enters the existing homepage list, with no screened secondary action; equal Plan actions are ordered by stable Plan id. The existing severity/source/recency ordering and final counts remain in use.

Fresh screening also suppresses a generic old state-watch binding notice for that stock, so stale Runtime metadata does not hide a current risk or introduce a second, weaker instruction. When screening is absent, all prior Runtime binding/phase reminders retain their behavior. Data and system-health alerts retain their existing eligibility and global deduplication; unhealthy facts cannot produce new screened actions.

Canonical zero shares prevent all held-risk and sale screening regardless of type, managementCategory or stale market value. Unknown/invalid shares fail closed. No holdings, trades, Plan definitions, Runtime records, Current State, managementCategory, research facts or User Decisions are changed. No new persistent schema, network call, AI invocation, automatic Plan or automatic execution is added.

## Changed files

- `src/homepage-attention.js`: pure screening and integration with existing candidates.
- `tests/fixtures/homepage-screening.js`: isolated program facts and formal price Plans.
- `tests/homepage_screening.test.js`: 22 focused regressions covering required behavior and fail-closed boundaries.
- `tests/homepage_screening_browser_acceptance.cjs`: real renderer, counts, copy, CTA, state immutability, protected/technical invalidation, desktop/mobile and blocked external traffic.
- This document: investigation, product boundary, evidence and release gate.
- Release preparation only: `index.html`, `scripts/generate_publish_manifest.js`, the existing version assertion in `tests/workbench_market_bridge_release.test.js`, and `publish-manifest.json`.

## Validation

Focused Homepage tests: **86/86** (64 existing + 22 new). Full JavaScript regression: **929/929**, no failures/skips/cancellations. Python regression: **21/21**. No unrelated tests were modified to pass.

Browser acceptance: **7 scripts / 17 viewport runs**, all passing. New screening, existing Homepage and Holding Reconciliation each run at 1280×900, 390×844 and 360×800; Technical Anchor, Plan Mode, State Watch and Plan Runtime retain their existing two viewports each. New screening verifies missing/current/stale State, strong risk versus ordinary conditions, increase/reduce/entry price Plans, zero shares, defensive suppression, malformed data, counts, Discussion navigation without opening an AI prompt, no automatic AI request, zero page errors and no horizontal overflow. The risk card and its CTA fit the first screen. Mobile risk and desktop entry screenshots were visually inspected.

Evidence: `test-results/screening-focused.log`, `screening-full-js.log`, `screening-python.log`, `screening-new-browser.log`, six `screening-*-browser.log` compatibility logs and `test-results/screening-browser/` screenshots/results. These are isolated synthetic states and contain no real portfolio fixtures. Committed-source manifest evidence is recorded below after release preparation.

The first browser launch found no browser at the bundled Playwright default revision. Acceptance was run with the already-installed Chromium executable via the scripts' existing `CHROME_EXECUTABLE` option; no dependency or application change was needed. This was a test environment setup issue, not an application regression.

## Deferred follow-ups and production boundary

- Plan V4 + Discussion V4.
- No-plan Opportunity Signal (including opportunity → Discussion → User Decision → optional Plan Draft).
- Management Category Lifecycle Production Regression Investigation V1.
- CI Release Gate V1.

The previously reported **Management Category Lifecycle cross-zero option derivation** production failure remains deferred and **BLOCKED**: expected candidate option, actual empty options, before Confirm, zero writes, fail-closed, original holdings/category unchanged. Its root cause is unknown. This task does not repair, investigate further, rerun production smoke or label it flaky. Existing category tests still run as part of the unchanged full JS suite; their local success does not clear the production blocker.

Release boundary: implementation → focused/full regression → desktop/mobile → source commit → asset/version preparation → manifest → **READY_FOR_PUSH** → STOP. No push, Pages deployment or production smoke is authorized by this task.
