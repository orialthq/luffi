# Reviewed legacy capture import

```js
import {
  buildReviewedCaptureImport,
  INGESTION_TYPES,
  INGESTION_PREDICATES,
  validateImportedValue,
} from "./ingestion/index.js";

const batch = buildReviewedCaptureImport({
  ownerId: authenticatedOwnerId,
  importId: persistedImportId,
  reviewed: true,
  reviewedAt: "2026-09-25T19:00:00+09:00",
  capture: { id: legacyCaptureId, asset: { status: "device_only" } },
  analysis: structuredAnalysis,
});
```

The adapter is pure and creates knowledge command candidates. The service must
authorize the owner, register the ingestion types/predicate alongside domain
contracts, apply the ordered batch in one storage transaction, and persist
`batch.importReceipt`. Nothing here performs an upload or writes storage.

Input includes `ownerId`, `importId`, `reviewed: true`, `reviewedAt`, `capture`,
and `analysis`; `analysisRunId` is optional. Capture metadata accepts `id`,
`capturedAt`, `sourceApp`, `sourceUrl`, `locale`, and `asset`. The adapter accepts
the current server model shape with `filing`, or Flutter's normalized stored
shape with `tags` and a nullable `place`. Historical data must already be in
that normalized shape; retired category/axes migrations remain the client's
responsibility. Supported schema versions are explicit and model names are
stored metadata, independent of the currently configured analysis model.

`INGESTION_TYPES` contains `ingestion.material` and `ingestion.field` schemas;
`INGESTION_PREDICATES` contains `ingestion.extracted_field`.
`validateImportedValue(typeId, value)` validates these values. An extracted field
contains `{ sourceVersionId, path, value }`. It says what a reviewed analysis
extracted from cited text, not what is true about the user or the world now.
Publisher identity remains explicitly unknown and assertions remain
`source_extracted`; review never turns them into `user_reported` facts.

All analysis JSON is preserved unchanged inside the source version. Evidence
locators point to exact text entries in that stored snapshot, retaining the old
region category without inventing image coordinates. Assertions need nonempty
valid evidence references. Inferred titles, summary, tags, conflicts, warnings,
and unsupported semantic meanings stay in the source snapshot. Required legacy
booleans such as `optional: false` do not become facts when the format cannot
distinguish an explicit observation from an extraction default.

Real-world recipe, ingredient, dining place, and product names become unresolved
mentions. No entity identity is accepted or merged. The only created entity is
the source-scoped material container, whose label contains no personal source
text. The adapter never guesses servings, standardizes package units, invents
product variants, asserts ownership, or creates executable activities.

## Asset and replay boundaries

- `unavailable` is the default asset state.
- `device_only` may carry an opaque `deviceAssetId`, never a file path.
- `available` requires `assetId` and the server-owned option
  `verifyAvailableAsset({ ownerId, assetId }) === true`. Client declarations
  cannot establish availability. This callback must verify access and durable
  availability, not merely accept the identifier's syntax.
- An optional asset SHA-256 is supplied metadata; this adapter does not hash
  image bytes. SourceVersion's `contentHash` hashes the stored analysis snapshot
  and is explicitly labeled as such in source provenance.
- Strict shape checks, a one MiB analysis limit, nesting limits, binary-image
  checks, and local-path checks exclude inline image payloads and device paths.
  Raw `CaptureRecord`, `RawCapture`, and normalized image objects are not accepted.

IDs derive from `(ownerId, importId, record role)` and stay stable across retries.
Keep the same `importId` for one logical import. A new ID intentionally starts a
different import and does not automatically merge the capture with an old one.
`inputHash` covers the complete normalized import, including review and asset
state. It is also part of the first source command, so a changed payload with
the same ID hits the knowledge command conflict before any new records apply.
Pass `{ previousImport: savedReceipt }` to check the receipt before building a
replacement batch. Existing command receipts also allow safe restart after a
partial attempt and prevent a deleted source from being resurrected on replay.

Review UI authorization and asset verification are service responsibilities.
The metadata flag only proves that the caller supplied explicit review; it is
not independent evidence that a human reviewed the screenshot.
