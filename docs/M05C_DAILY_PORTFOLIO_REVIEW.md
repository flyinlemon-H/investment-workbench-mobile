# M05C Daily Portfolio Review

## Purpose

M05C_1 adds a mobile-first “今日组合” workflow above the existing per-stock analysis modules. It answers which selected stocks deserve attention today, which portfolio-level risks matter, which existing plans are close, and which zero-position candidates merit further review.

The feature is decision support only. It does not trade, modify holdings, alter plans, optimize the portfolio, or claim the selected universe is the user’s entire brokerage portfolio.

## Ownership boundary

The program owns facts:

- canonical stock identity;
- holding shares, average cost, current price, market value, and computable in-app weight;
- allocation facts and existing plans;
- latest saved technical, news catalyst, fundamental, valuation, and long-term-logic data;
- module status, analysis dates, and current-versus-historical labels;
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
  → build compact PortfolioContext
  → copy strict Daily Portfolio Review request
  → paste AI JSON
  → parse and validate the complete snapshot
  → preview (zero writes)
  → explicit save through the critical candidate path
  → render 今日结果
```

`src/portfolio-review-context.js` builds the program-owned context and prompt. `src/portfolio-review-contract.js` owns validation, coherent candidate construction, same-day replacement, bounded history, and atomic commit. `src/portfolio-review-ui.js` owns the mobile workflow and result presentation.

## Compact context

Each selected stock contains one compact current view:

- identity: name, canonical symbol, role, theme, type;
- holding: shares, average cost, price, market value, optional weight and holding status;
- allocation: target/range/upper limit and latest conclusion;
- technical: actual status/date, latest saved judgment, and essential support/resistance/cycle facts;
- news: one current catalyst/sentiment snapshot plus separately labelled bounded historical reference;
- fundamental: latest useful quality conclusion, date, and confidence;
- valuation: latest conclusion/level, date, and confidence;
- long-term logic: status, thesis, validation/invalidation points, validity/review dates;
- active plans: action, trigger, direction, status, and note.

The builder omits full price histories, old technical reviews, full statements, operation history, and repeated module objects. Missing modules remain explicitly unavailable and do not block the whole review.

Weights are emitted only when every known in-app held position has a reliable market value. Their basis is `known_application_holdings`; this is not presented as a verified brokerage-portfolio weight. Cash is `unavailable` unless the application owns a reliable current value.

## Freshness and history separation

Technical context keeps `technicalDataStatus`, `technicalAsOf`, and `latestCompleteBar`. News uses the current `recentCatalyst` and `shortTermSentiment` logical snapshot. Bounded older monthly catalyst text, when present, is nested only under `historicalReference` with status `historical_reference`; it never fills current sentiment or fund-flow fields.

Fundamental, valuation, and long-term modules retain their own slower-moving validity/date semantics. The prompt requires stale, unavailable, and unknown inputs to reduce confidence.

## Output contract

The top level contains only `portfolioReview`. Required fields are:

- `reviewDate`, `summary`, `marketContext`, `portfolioRiskLevel`;
- `priorityStocks`, `riskAttention`, `planWatch`, `candidateReview`;
- `portfolioRisks`, `todayFocus`, `dataLimitations`, `confidence`.

The contract is intentionally small and judgment-only. It does not duplicate `technicalReviews` or accept program-owned facts.

Validation is fail-closed for malformed JSON, truncated output, missing/extra fields, invalid types or enums, a review-date mismatch, symbols outside the selected universe, and duplicate symbols within a section. Symbol comparison is case-insensitive through the existing canonical identity helper; name fallback, suffix guessing, and partial inference are forbidden. A stock need not appear in any priority array.

The parser reuses the M05B safe JSON parser, including complete Markdown-fence recovery and structural smart-quote normalization while preserving legitimate Chinese smart quotes inside content.

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

The existing “今日分析” entry contains two short choices: “技术复核” and “今日组合”. “今日组合” opens the saved result first when one exists, otherwise the generation workflow.

The result hierarchy is:

1. 今日组合结论 and risk level;
2. 优先关注;
3. 今日重点;
4. 风险关注;
5. 计划接近;
6. 候选观察;
7. 组合风险 and 数据限制.

Empty sections are hidden. Priority rows are compact and can open the existing stock-detail workspace. Internal terms such as schema, contract, canonical symbol, and snapshot are not exposed in the normal UI.

## Scope and roadmap

M05C_1 deliberately excludes screenshot analysis and Direct AI integration. It preserves the manual “复制给 AI → 粘贴 AI 结果” flow.

- Future M05C_2: K-line Screenshot Binding / Visual Portfolio Review (`symbol ↔ image attachment`). The current stock-keyed context and result model provide the extension seam; no placeholder upload UI is added now.
- Future M05C_3: Direct AI integration only if justified later. M05C_1 stores no API key and adds no server proxy.

Individual stock modules remain authoritative for detail. M05C orchestrates their latest valid outputs; it does not replace or rewrite them.
