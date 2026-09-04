# Long-Term Logic Slim Contract + Manual Analysis Sync V1

## Product boundary

The product records durable investment judgments, not the full research process.

- Stock Universe remains an automatic, add-only infrastructure sync.
- Analysis modules remain explicit and manual.
- V1 enables only `long_term_logic` in the direction PC → Cloud → Mobile.
- PC-only publishing is a UI/workflow boundary. It does not add device attestation, a PC credential, or another security identity.
- The accepted PC AI Bridge and its auto-start behavior are unchanged. Manual Analysis Sync starts only after its canonical local save succeeds.

## Long-Term Logic Slim Contract

Stored V2 records use `schemaVersion = long-term-logic.v2` and these judgment fields:

```json
{
  "schemaVersion": "long-term-logic.v2",
  "investmentThesis": "1–3 concise sentences",
  "coreDrivers": ["up to five concise drivers"],
  "keyRisks": ["up to five concise risks"],
  "reviewTriggers": ["up to five explicit reasons to revisit the thesis"],
  "logicStatus": "valid | weakening | broken | unclear",
  "confidence": "high | medium | low",
  "nextReviewDate": "YYYY-MM-DD"
}
```

`investmentThesis` is capped at 400 Unicode characters. Each list contains 1–5 unique items; every item is capped at 180 Unicode characters. The prompt explicitly asks for an investment-manual conclusion and rejects short-term technical language.

The production status enum remains unchanged to avoid a breaking migration. UI wording maps `broken` to “逻辑失效”.

### Consolidation

- `industryDrivers`, `companyDrivers`, and `portfolioDrivers` become `coreDrivers` on the next explicit review.
- `longTermRisks` becomes `keyRisks`.
- `reviewTriggers` is new.
- `fundamentalSupport` is removed from the primary contract. Its useful conclusion belongs in concise drivers; a separate paragraph duplicated those judgments and encouraged report inflation.
- `validUntil` and `sourceSummary` are removed from the judgment payload. Program-owned save time and audit provenance remain in `longTermLogicAudit`; `nextReviewDate` remains the explicit AI recommendation.

Legacy records are normalized only into their legacy readable shape. Loading does not write or concatenate the three old driver lists into V2. A new API/manual Long-Term Logic update creates V2 and moves the prior record into local bounded history.

## Manual Analysis Sync envelope

The cloud stores one latest, explicitly published snapshot per `(user_id, module_type, entity_key)`:

```json
{
  "moduleType": "long_term_logic",
  "entityKey": "1810.HK",
  "moduleSchemaVersion": "long-term-logic.v2",
  "revision": 4,
  "payloadHash": "sha256:…",
  "publishedAt": "…",
  "payload": {}
}
```

The payload contains only the seven judgment fields. It cannot contain holdings, cost, Plans, Runtime, Current State, Discussion, orders, market data, account data, or API keys. Local history is not uploaded.

Canonical key-sorted JSON is hashed with SHA-256. Equal meaningful payloads produce the same hash. Sync status is derived primarily by comparing the canonical local payload hash with the cloud hash. Publishing an equal hash returns `no_change`, creates no revision, and performs zero cloud writes.

Changed publication is serialized atomically per owner/module/entity. Preview binds the exact local hash plus expected cloud revision/hash. If local or cloud changes before Confirm, publication is rejected and must be previewed again.

## Responsibilities

The generic engine owns envelope validation, SHA-256, adapter registration, Preview binding, revision/no-change transport, manual fetch, exact-version confirmation, unsupported-module handling, and common errors.

`LongTermLogicSyncAdapter` owns the V2 serializer allowlist, business validation, business-level diff, label, source fingerprint, and canonical local candidate construction.

Future Current State, Plan Definition, or Plan Runtime support adds only a module adapter (serializer, schema validator, business diff, source fingerprint, candidate builder, label) plus an explicit server allowlist migration and UI registration. Hashing, revision/CAS, owner binding, transport, fetch, Preview/Confirm, and error handling are reused.

## User flow

PC:

```text
API更新 → existing Bridge → strict validation → atomic local save
→ 本地已更新 · 尚未同步
→ 同步到手机 → Preview → Confirm → cloud publication
```

Mobile:

```text
获取更新 → compare hashes → update list → 本机 vs 云端 Preview
→ 同步到本机 → exact revision/hash recheck → existing critical canonical save
```

Opening or cancelling either Preview makes zero writes. Mobile does not auto-fetch on startup and never auto-applies. If the stock does not exist locally, apply is blocked; no holding and no Stock Universe membership is fabricated.

## Local metadata and backup/restore

The optional `lastAppliedRevision + lastAppliedHash` receipt is stored in a separate device-local key. It is transport metadata, not investment state, and is therefore excluded from normal backup/export/import/restore. No credential or Auth session is included in application backups.

A mobile backup imported on PC retains legacy/current Long-Term Logic. A subsequent API update saves Slim V2 locally while cloud remains unchanged. Publication still requires an explicit Sync Preview and Confirm.

## Cloud security and migration gate

The migration creates a private table and owner-derived RPC boundary. RLS remains enabled, direct table grants are revoked, anonymous access is rejected, and public wrappers are executable only by `authenticated`. The private definer functions derive the owner only from `auth.uid()`, accept no owner argument, validate the V1 module/schema/payload allowlist, and use a transaction advisory lock for atomic revision updates.

The existing Stock Universe RLS, PC Reader credential, and Bridge are untouched. No service role, database password, DeepSeek key, session token, or PC-specific analysis credential is introduced.

The migration must first be applied and tested against the dedicated test project. Applying it to production requires separate explicit authorization. Source/Pages deployment requires a later, separate push authorization.

## Rollback boundary

- Legacy clients do not understand the Slim V2 fields and may normalize them back to the old shape on a later save. After real V2 use, forward-fix is preferred over rolling Pages back.
- Device-local sync receipts can be lost without losing judgments; hashes will be re-derived on the next manual check.
- A Pages rollback does not remove already published cloud snapshots.
- The migration is additive. Do not drop the table/RPCs while clients may still call them; forward-fix the client or server contract.
