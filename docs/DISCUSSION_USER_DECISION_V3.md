# Discussion User Decision Layer V3

## Purpose and presentation order

Discussion V3 keeps the existing technical Current State as audit evidence and adds a concise, position-centric `userDecision` as the primary conclusion. The mobile workspace renders, in order:

1. compact current-status strip (expanded when a blocking warning exists);
2. the six existing Discussion actions;
3. latest User Decision conclusion;
4. collapsed `判断依据` technical evidence;
5. Current State history.

The action handlers, Discussion and Plan persistence paths, and Plan Runtime lifecycle are unchanged. No control is sticky or duplicated.

## Contract

New Discussion sessions use `stock-discussion.state.v3` and require this exact object inside the existing `currentState` response:

```json
{
  "userDecision": {
    "headline": "可以继续持有，暂时没有明显减仓风险。",
    "holding": { "status": "safe", "summary": "当前持有判断仍然稳定。" },
    "positionDirection": { "status": "hold_no_add", "summary": "维持现有仓位，暂不增加。" },
    "addAssessment": { "status": "wait", "summary": "等待更合适的机会。" },
    "warning": { "summary": "若风险增强，需要重新复核。", "items": [] },
    "takeProfit": { "status": "none", "summary": "暂时没有明显止盈压力。" },
    "stopLoss": { "status": "none", "summary": "暂时没有明显止损风险。" },
    "riskSource": "none"
  }
}
```

The independent dimensions intentionally do not collapse into one overall enum: a stock can be safe to hold while adding is unsuitable and take-profit risk deserves attention.

Enums:

- `holding.status`: `safe`, `caution`, `reduce_review`, `risk_control`, `not_applicable`
- `positionDirection.status`: `hold`, `hold_no_add`, `add_watch`, `add_review`, `reduce_review`, `risk_control`, `not_applicable`
- `addAssessment.status`: `wait`, `watch`, `add_review`, `avoid`, `not_applicable`
- `takeProfit.status`: `none`, `watch`, `review`, `not_applicable`
- `stopLoss.status`: `none`, `watch`, `risk_control`, `not_applicable`
- `riskSource`: `none`, `stock`, `market`, `both`, `unclear`

`headline` is one line and at most 120 characters. Each summary and warning item is at most 160 characters; warning items are limited to three. Unknown fields and enums, exact duplicate block text, deterministic execution commands, and malformed position combinations fail with zero writes.

## Position, market, and risk semantics

For verified holdings, `holding` must answer the holding-risk question and cannot be `not_applicable`. For a verified zero position, `holding`, `takeProfit`, and `stopLoss` must be `not_applicable`; language that assumes holding, adding, reducing, take-profit, or stop-loss is rejected. The UI changes `如果想加仓` to `如果想建仓`.

Market risk may influence `positionDirection` only when Discussion receives explicit structured or user-provided market-risk context. When none is available, the context says it is unavailable and the AI may not attribute risk to the market. Stock safety and a defensive `hold_no_add` or `reduce_review` direction can coexist when explicit market risk supports that distinction.

Take-profit and stop-loss are review judgments based on supplied holding, price position, technical evidence, Plan Definition references, optional Runtime evidence, and explicit market risk. They do not create orders, automatic buy/sell behavior, or fixed-percentage rules.

## Fact ownership and supporting evidence

The program continues to own symbols, holdings, shares, costs, current price, technical dates and bars, Plan identities and hashes, Plan price references, Current State identity, Runtime, protected references, and persistence. AI owns concise qualitative judgments only.

User Decision text may not repeat or invent exact prices, quantities, percentages, or dates. When an active program-owned legacy Plan contains a price reference, the UI renders it separately below the qualitative decision. With no reliable program price reference, no price is displayed or synthesized.

The existing `actionAssessment`, `attentionLevel`, `trendAssessment`, `structureAssessment`, `stage`, `focusPoints`, `summary`, `keyChanges`, `risks`, `watchPoints`, and `planRelation` remain unchanged as the collapsed `判断依据`. Plan Runtime is compact read-only input to Discussion; its schema, revisions, lifecycle, history, review contract, and review-only execution boundary are unchanged.

## Compatibility and semantic guard

Stored V1 and V2 Current States remain valid, load without canonical writes, and use the legacy presentation. Old history is never given a synthetic `userDecision`. Only a genuine new `discussion_v3_*` import requires the V3 decision layer.

The semantic guard permits locally negated legacy language such as `价格进入计划范围不等于完整条件满足` and natural incomplete-state wording. It still rejects affirmative full-condition claims and wording that converts reaching a price into direct execution. The technical-anchor and protected-context stale checks remain fail closed.

The accepted pre-V3 client uses an allowlist normalizer for non-V1 states. A deterministic compatibility projection confirms that when it loads and later saves a V3 Current State, it removes the unknown `userDecision` and writes the remaining technical fields as V2. Therefore, after real V3 data is created, rolling back to a pre-V3 client is not Decision-Layer-data-safe. The actual loss is the new `userDecision` object; the legacy technical Current State fields remain. Prefer a forward fix, or retain a V3-capable reader/normalizer when disabling the feature.
