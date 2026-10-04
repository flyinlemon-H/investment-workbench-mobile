# PROVIDER_EVIDENCE_CONTRACT_V1

Status: implemented locally in `scripts/provider_rebase/evidence.py`; profile `empirical-exchange-v1`. Approval and production delivery remain separate gates. This version supersedes the earlier requirement that every practical unit must be backed by an explicit provider contract.

## Evidence levels

- CONFIRMED_CONTRACT: contract evidence and SHA-256 of its document; semantic fields still validated.
- EMPIRICALLY_VALIDATED: accepted for V1 required units only when multiple dated official-exchange checks and replay evidence meet the field-bound rules below. Keep `confirmed=false` so empirical results are not mislabeled as an official provider promise.
- STRONG_EVIDENCE: retained for review; cannot pass required-unit gates.
- UNKNOWN: cannot pass required-unit gates. An explicitly optional amount field can remain unavailable.

## Scope and units

Bind symbol, market, provider, canonical field, provider implementation version and normalization version. Require positive finite scale; price currency must match market, price unit is currency/share, volume unit is shares. Reject boolean scales, malformed hashes, wrong official domains, mismatched samples, missing or single-date evidence. Official source URL and cached SHA-256 are audit references, not a cryptographic endorsement by the exchange; human review must establish provenance before constructing the evidence package.

Yahoo canonical volume is `indicators.quote[0].volume`; Eastmoney is `klines.f56`. Board-lot size never implies conversion of either field. Yahoo HK evidence currently supports scale 1. Other markets/providers need their own scoped samples; the generic engine does not certify them by association. Price-unit evidence uses documented exchange quote currency/share semantics, provider currency and parser scope; it does not claim adjusted prices equal the exchange's unadjusted historic prices.

For empirical volume, require at least two distinct dates, provider raw/archive hash, parser replay hash, official exchange values and units. Check each value against the actual candidate rows (or the old provider rows when validating baseline units). Historical archives must be labeled as archives, not fresh raw responses.

## Historical volume revisions

Every changed date requires one unambiguous record binding old value, candidate value, exchange value, symbol, provider, canonical field, scope unchanged, shares/scale=1, raw and official evidence hashes. Candidate volume must match official volume. A text explanation alone never passes. This version accepts review eligibility, not automatic Apply.

If an unused provider metadata value differs, preserve KNOWN_PROVIDER_INCONSISTENCY. It must not override canonical historical K or enter technical recomputation. The original-to-candidate volume change remains VOLUME_HISTORY_REVISION even when current K is officially corroborated. Classify price and volume together as MULTI_FIELD_REVISION; retain PRICE_HISTORY_REVISION, VOLUME_HISTORY_REVISION and PROVIDER_META_INCONSISTENCY evidence.

## Optional amount and technical scope

Missing optional amount is NOT_COMPARABLE / NOT_AVAILABLE and does not itself block Apply. If a source/engine makes it required, unresolved evidence blocks. Never synthesize amount from price*volume. Technical readiness requires currently supported MA/MACD/volume/support/resistance/date facts; absent classifiers must be labeled unavailable rather than invented. AI judgments and historical Discussion are preserved.

## Approval and delivery

Use the same Rebase request, immutable Store, candidate, approval, atomic Apply, rollback and audit path. Legacy schema reconstruction stays compatible; new evidence candidates use schemaVersion 3. Every approval-relevant evidence, technical, blocker or guard change changes approvalPackageHash. Source implementation changes reject stale approval reconstruction. Normalize text line endings when calculating source versions so copying identical Python code to Windows does not create a false provider change.

Write-path evidence must cover Worker, Manual, Batch, PC direct, Legacy JSON/CSV, Bridge and Browser result with implementation/test hashes and actual delivery status. Tested local code is not production delivery. Any release_pending path keeps the candidate blocked. Never mark a path delivered merely to make Apply eligible.

Local review export is read-only. User source selection is not candidate approval. Only a future explicit candidate approval and separately authorized Apply may move a real active pointer.

Validation: `tests/test_provider_evidence.py`, `tests/test_provider_review_delivery.py`, existing rebase/revision/Worker/legacy import/bridge regression suites. Multiple non-pilot symbols exercise the rules; no 2899 or 8000 exception exists.
