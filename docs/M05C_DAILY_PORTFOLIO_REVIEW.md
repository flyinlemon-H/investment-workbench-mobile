# M05C Daily Portfolio Review

## Purpose

M05C_1 adds a mobile-first “今日组合” workflow above the existing per-stock analysis modules. The 2026-08-18 real-trial fix turns its context builder from a module-output collector into a portfolio-level fact coordination layer. It answers which selected stocks deserve attention today using facts that are current enough, clearly dated, internally coordinated, and safe to present.

The feature is decision support only. It does not trade, modify holdings, alter plans, optimize the portfolio, or claim the selected universe is the user’s entire brokerage portfolio.

## Ownership boundary

The program owns facts:

- canonical stock identity;
- holding shares, average cost, current price, market value, and computable in-app weight;
- allocation facts and existing plans;
- latest saved technical, news catalyst, fundamental, valuation, and long-term-logic data;
- module status, analysis dates, current-versus-historical labels, portfolio-level relevance, and narrow consistency checks;
- review date, generation timestamp, persistence timestamp, and selected universe.

AI owns judgments:

- cross-stock priority;
- portfolio risk interpretation;
- plan proximity interpretation;
- candidate and observation prioritization;
- today’s focus, limitations, and confidence.

Actual broker positions, executions, and orders remain authoritative. AI may not invent missing facts, recalculate program-owned numbers, mutate plans, or issue deterministic trade instructions.

## Data flow

```text
今日分析
  → 今日组合
  → select 1–12 stocks using M05B selection preferences/groups
  → optionally refresh through the existing quote path
  → compact holdings, allocation, technical, news, fundamental, valuation, long-term logic, and plans
  → coordinate current/historical precedence, today relevance, and inconsistencies
  → build compact PortfolioContext
  → copy strict Daily Portfolio Review request
  → paste AI JSON
  → parse and validate the complete snapshot
  → preview (zero writes)
  → explicit save through the critical candidate path
  → render 今日结果
```

`src/portfolio-review-context.js` builds the program-owned context and prompt. Its exact path is `selectableStocks` → `holdingFacts` and the seven `compact*` functions → `stockContext` → `readiness` / `coordinationLimitations` → `buildPortfolioContext` → `buildRequest`. `src/portfolio-review-contract.js` owns parsing, validation, user-language safety, coherent candidate construction, same-day replacement, bounded history, and atomic commit. `src/portfolio-review-ui.js` owns the mobile workflow and localized result presentation.

The complete runtime flow is:

```text
application state
  → holdingFacts / compactAllocation / compactTechnical / compactNews
  → compactFundamental / compactValuation / compactLongTerm / compactPlans
  → portfolio context + readiness + coordinated limitations
  → strict prompt
  → AI portfolioReview JSON
  → contract validation and preview
  → one coherent portfolioReview snapshot
  → atomic candidate save
  → localized mobile result
```

## Compact context

Each selected stock contains one compact current view:

- identity: name, canonical symbol, role, theme, type;
- holding: current shares, average cost, current price, current market value, optional current in-app weight, and holding status;
- allocation: strategic target/range/upper limit, analysis date, and a conclusion with historical actual-weight wording removed;
- technical: actual status/date, complete-bar invariant, latest saved judgment, essential support/resistance/cycle facts, and consistency metadata;
- news: one current catalyst/sentiment snapshot only when suitable for today, plus separately labelled bounded historical reference;
- fundamental: latest useful quality conclusion, date, and confidence;
- valuation: latest conclusion/level, date, and confidence;
- long-term logic: status, thesis, validation/invalidation points, validity/review dates;
- active plans: action, trigger, direction, status, and note.

The builder omits full price histories, old technical reviews, full statements, operation history, and repeated module objects. Missing modules remain explicitly unavailable and do not block the whole review.

Weights are emitted only when every known in-app held position has a reliable market value. This is an in-app weight, not a verified brokerage-portfolio weight. Cash is treated as not reliably provided unless the application owns a current value.

## Portfolio relevance and fact precedence

M05C adds, without changing any underlying module schema, the orchestration-only enum:

```text
current
usable_with_caution
outdated
unavailable
inconsistent
```

Classification is module-specific:

- Technical is current only when module status is fresh and `priceHistory` last complete date, `latestCompleteBar`, and `technicalAsOf` all agree. Stale technical data is outdated. Missing invariant metadata is cautious rather than silently current.
- News uses the News Catalyst module’s existing 7-day current and 30-day historical windows. A fresh flag cannot override an old source date. Anything outside the current window is removed from `currentSnapshot` and can appear only as dated historical/continuing background; beyond the historical window it is outdated.
- Fundamentals use their authoritative availability/completeness state first. An unknown state cannot be rescued by a high confidence value. The existing 30-day refresh guidance separates current from cautious context.
- Valuation uses the existing 30-day refresh guidance, but older valid valuation remains available with caution rather than becoming unavailable.
- Long-term logic follows status, `validUntil`, and `nextReviewDate`; old analysis age alone does not invalidate a still-valid thesis.
- Allocation and plans retain their longer-lived strategic/persistent meaning. Plans always remain manual-review objects.

Current fact precedence is explicit:

1. Current holding facts override allocation-era actual-position references.
2. Current program technical facts override old technical narrative and numbers.
3. Current coherent News Catalyst snapshot overrides historical catalyst context.
4. Current stored plan overrides commentary about an earlier plan version.
5. Broker holdings, executions, and orders remain outside application authority.

Historical `currentWeight` / `actualWeight` observations and `weightStatus` are not included in the M05C allocation compact. The current in-app weight comes only from current holdings and known market values. This prevents an old 20.61% allocation observation from competing with a current 9.24% holding weight.

## Freshness and history separation

Technical context keeps module status, `technicalAsOf`, `latestCompleteBar`, and the last complete price-history date. It does not recalculate technical analysis. Newer program facts supersede a lagging saved narrative. A mismatch within the same dated snapshot marks the compact inconsistent; missing level provenance with an otherwise coherent snapshot withholds only precise support/resistance. In both cases AI is told not to rely on unproven precise levels.

News uses the current `recentCatalyst` and `shortTermSentiment` logical snapshot only when its source date remains within the module’s current lookback. Bounded older catalyst text is nested only under `historicalReference`; it never fills current sentiment or fund-flow fields. Thus a 2026-06-25 snapshot marked fresh cannot become current news in a 2026-08-18 portfolio review.

Fundamental, valuation, and long-term modules retain their own slower-moving validity/date semantics. The prompt requires stale, unavailable, and unknown inputs to reduce confidence.

## Output contract

The top level contains only `portfolioReview`. Required fields are:

- `reviewDate`, `summary`, `marketContext`, `portfolioRiskLevel`;
- `priorityStocks`, `riskAttention`, `planWatch`, `candidateReview`;
- `portfolioRisks`, `todayFocus`, `dataLimitations`, `confidence`.

The contract is intentionally small and judgment-only. It does not duplicate `technicalReviews` or accept program-owned facts.

Validation is fail-closed for malformed JSON, truncated output, missing/extra fields, invalid types or enums, a review-date mismatch, symbols outside the selected universe, and duplicate symbols within a section. Symbol comparison is case-insensitive through the existing canonical identity helper; name fallback, suffix guessing, and partial inference are forbidden. A stock need not appear in any priority array.

The parser reuses the M05B safe JSON parser, including complete Markdown-fence recovery and structural smart-quote normalization while preserving legitimate Chinese smart quotes inside content.

Normal user-facing strings are validated separately from structural JSON fields. They may not expose backend field names, English status enums, object labels, or implementation terms. The contract also limits data limitations to five aggregated, consequence-oriented items. The presentation layer localizes known legacy/internal terms as a defense for previously saved snapshots.

For plans, the existing output enum remains stable. `triggered` means only that the price threshold was crossed and is displayed as “价格已触发，待确认其他条件”. Every compacted plan has manual confirmation required and full-condition status unproven because M05C cannot verify execution, technical, volume, allocation, or review prerequisites. New output claiming “完整条件已满足” or the ambiguous “已到计划条件” fails validation.

## Persistence semantics

Preview never mutates application state. A valid result creates one candidate state containing one coherent snapshot:

```text
portfolioReview.current
portfolioReview.history[]
```

One explicit save invokes the existing critical candidate path once. It therefore inherits IndexedDB/local-storage cutover, revision/checksum, recovery, and multi-tab stale-write protection. The candidate becomes authoritative only after persistence succeeds. If persistence fails, the previous state remains active.

Reviews are keyed by `reviewDate`. A later valid review on the same day replaces that day’s complete current/history entry; no morning field is merged into an afternoon result. Different dates are retained in a bounded 30-day-entry history. This is a convenience history, not a portfolio analytics database.

Saving a review never changes holdings, cost basis, allocations, or plans. The successful atomic save also remembers the selected symbols in the existing M05B selection preference.

## Mobile information architecture

The top module switch contains only two peers: “技术复核” and “今日组合”. The selected module uses the accent/red state. Workflow actions are no longer rendered as peer tabs: “生成组合复核”, “查看今日结果”, and “返回选股” live inside the 今日组合 page; primary next actions use the dark button and secondary actions use neutral outlines. “今日组合” opens the saved result first when one exists, otherwise the selection/generation workflow.

The result hierarchy is:

1. 今日组合结论 and risk level;
2. 优先关注;
3. 今日重点;
4. 风险关注;
5. 计划接近;
6. 候选观察;
7. 组合风险 and 数据限制.

Empty sections are hidden. Data limitations are collapsed by default and capped at five displayed items. Priority rows are compact and can open the existing stock-detail workspace. Internal terms, backend fields, and raw English states are not exposed in the normal UI. The 390×844 layout remains full-screen, single-column, touch-safe, and horizontally bounded.

## Scope and roadmap

M05C_1 deliberately excludes screenshot analysis and Direct AI integration. It preserves the manual “复制给 AI → 粘贴 AI 结果” flow.

- Future M05C_2: K-line Screenshot Binding / Visual Portfolio Review (`symbol ↔ image attachment`). The current stock-keyed context and result model provide the extension seam; no placeholder upload UI is added now.
- Future M05C_3: Direct AI integration only if justified later. M05C_1 stores no API key and adds no server proxy.

Individual stock modules remain authoritative for detail. M05C orchestrates their latest valid outputs; it does not replace or rewrite them.
