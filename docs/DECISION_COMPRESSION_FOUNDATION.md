# Decision Compression Foundation

Decision Compression is a judgment snapshot above the existing Portfolio Review. It answers which selected stocks deserve attention today, why, what kind of review or waiting is appropriate, and what blocks direct action. It does not execute trades or mutate Plan V2, PlanReview, holdings, allocation, or orders.

## Authority boundary

- Program facts: selected symbols, holdings and known weights, allocation conflicts, Plan V2 identity/version/lifecycle/freshness, price trigger, full-condition confirmation, PlanReview identity/freshness, technical relevance, and module limitations.
- AI judgments: dominant reason, attention priority, workflow category, blocker importance, and confidence.
- User authority: every Plan mutation remains in the existing explicit confirmation workflow.

The compact context is built from the saved Portfolio Review and current authoritative state. A Portfolio Review Plan reference hash is compared with current Plan facts. PlanReview is current only when Plan ID, Plan version, and the authoritative Plan snapshot hash still match. Old judgments are retained only as stale audit references and are not supplied as current conclusions.

## Contract and persistence

The strict `decisionCompression` envelope contains a review date, one short overall summary, at most five detailed items, a collapsed no-action symbol list, confidence, and at most three material limitations. Each item has a controlled attention priority, workflow category, one-sentence reason, at most two supported blockers, a fact-supported Plan state, and confidence.

All selected symbols must appear exactly once across detailed items and the no-action list. Unknown/duplicate symbols, unsupported Plan states or blockers, unsafe market claims, deterministic trade commands, malformed JSON, and truncated JSON fail with zero writes.

One successful save creates one coherent `decision-compression.snapshot.v1` object under `decisionCompression.current` and bounded history. Audit references preserve the Portfolio Review date/schema/hash plus relevant Plan ID/version/snapshot hash and current PlanReview ID/review time. A pre-save context hash check rejects the snapshot if Portfolio Review, Plan, PlanReview, holdings, allocation, or relevant facts changed after preview.

## Mobile hierarchy

The first layer shows “今日组合结论”, then “今日处理” with three to five compact rows. Each row shows a stock, Chinese workflow label, one reason, and optional blocker chips. Remaining stocks collapse into “其他 X只 · 暂不处理”. The existing Portfolio Review remains intact under “查看详细组合复核”.

## Deliberate limitations

There is no Market Regime engine in this phase. The context explicitly marks broader market state unavailable and the contract rejects unsupported breakout, bull-market, strengthening-market, or risk-appetite claims.

There is no Intraday Context in this phase. The layer uses complete daily technical facts only and must not infer live percentage moves, gaps, intraday reversals, real-time volume, or opening/closing strength. K-line screenshot binding is also out of scope.
