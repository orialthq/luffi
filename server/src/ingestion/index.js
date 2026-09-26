import { createHash } from "node:crypto";
import { object, text, validateSchema } from "../domains/schema.js";
import { assertSafeJson, fail, record, string, timestamp, validateLegacyAnalysis } from "./validation.js";

export { IngestionError, validateLegacyAnalysis } from "./validation.js";

export const INGESTION_TYPES = Object.freeze([
  { id: "ingestion.material", schema: object({ id: text, sourceVersionId: text, legacyCaptureId: text }) },
  { id: "ingestion.field", schema: object({
    sourceVersionId: text, path: text,
    value: { oneOf: [{ type: "string", minLength: 1 }, { type: "number" }, { type: "boolean" }] },
  }) },
]);
export const INGESTION_PREDICATES = Object.freeze([
  {
    id: "ingestion.extracted_field", subjectTypes: ["ingestion.material"], valueType: "ingestion.field",
    cardinality: "single", resolution: { strategy: "consensus", version: "1" },
    temporalSemantics: "source_snapshot_only",
  },
]);

export function validateImportedValue(typeId, value) {
  const resolve = (id) => {
    const type = INGESTION_TYPES.find((entry) => entry.id === id);
    if (!type) fail(`unknown ingestion type: ${id}`);
    return type;
  };
  validateSchema(resolve(typeId).schema, value, resolve);
  if (typeId === "ingestion.field" && !/^\/(?:title|place|ingredientGroups|steps|facts)\//.test(value.path)) fail("imported field path must address a supported legacy analysis field");
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");

function asset(input, ownerId, verifyAvailableAsset) {
  if (input === undefined) return { status: "unavailable" };
  record(input, "capture.asset", ["status"], ["assetId", "deviceAssetId", "contentHash"]);
  assertSafeJson(input);
  if (input.status === "available") {
    string(input.assetId, "capture.asset.assetId", { max: 512 });
    if (input.deviceAssetId !== undefined) fail("available assets must not contain device locators");
    // Only server-owned resolution can establish availability. A client boolean
    // or an arbitrary HTTP/file URL never establishes an accessible source.
    if (typeof verifyAvailableAsset !== "function" || verifyAvailableAsset({ ownerId, assetId: input.assetId }) !== true) fail("available asset must be verified by the server");
  } else if (input.status === "device_only") {
    if (input.assetId !== undefined) fail("device-only assets cannot claim a server assetId");
    if (input.deviceAssetId !== undefined) string(input.deviceAssetId, "capture.asset.deviceAssetId", { max: 512 });
  } else if (input.status === "unavailable") {
    if (input.assetId !== undefined || input.deviceAssetId !== undefined) fail("unavailable assets cannot claim a locator");
  } else fail("capture.asset.status must be available, device_only or unavailable");
  if (input.contentHash !== undefined) {
    string(input.contentHash, "capture.asset.contentHash", { max: 512 });
    if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(input.contentHash)) fail("asset contentHash must be SHA-256");
  }
  return structuredClone(input);
}

/** Build candidates only: the caller must authorize ownerId and apply the whole
 * batch transactionally, persisting inputHash as the import receipt. */
export function buildReviewedCaptureImport(input, options = {}) {
  record(input, "import", ["ownerId", "importId", "capture", "reviewed", "reviewedAt", "analysis"], ["analysisRunId"]);
  const ownerId = string(input.ownerId, "ownerId", { max: 512 });
  const importId = string(input.importId, "importId", { max: 512 });
  if (input.reviewed !== true) fail("only explicitly reviewed captures can be imported", "CAPTURE_REVIEW_REQUIRED");
  const reviewedAt = timestamp(input.reviewedAt, "reviewedAt");
  record(input.capture, "capture", ["id"], ["capturedAt", "sourceApp", "sourceUrl", "locale", "asset"]);
  assertSafeJson(input.capture);
  const capture = {
    id: string(input.capture.id, "capture.id", { max: 512 }),
    capturedAt: timestamp(input.capture.capturedAt, "capture.capturedAt", true),
    sourceApp: input.capture.sourceApp ?? null,
    sourceUrl: input.capture.sourceUrl ?? null,
    locale: input.capture.locale ?? null,
    asset: asset(input.capture.asset, ownerId, options.verifyAvailableAsset),
  };
  for (const key of ["sourceApp", "sourceUrl", "locale"]) string(capture[key], `capture.${key}`, { nullable: true, max: 2000 });
  if (capture.sourceUrl !== null) {
    let url;
    try { url = new URL(capture.sourceUrl); } catch { fail("capture.sourceUrl must be an HTTP URL"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fail("capture.sourceUrl must be a credential-free HTTP URL");
  }
  const analysis = validateLegacyAnalysis(input.analysis);
  const analysisRunId = input.analysisRunId == null ? null : string(input.analysisRunId, "analysisRunId", { max: 512 });
  const inputHash = hash({ adapterVersion: 1, ownerId, importId, capture, reviewed: true, reviewedAt, analysis, analysisRunId });
  if (options.previousImport) {
    const previous = options.previousImport;
    if (previous.ownerId !== ownerId || previous.importId !== importId || previous.inputHash !== inputHash) fail("importId is already bound to different reviewed content", "INGESTION_IMPORT_CONFLICT");
  }
  const id = (kind, key = "") => `${kind}-${hash([ownerId, importId, kind, key])}`;
  const sourceId = id("source");
  const sourceVersionId = id("source-version");
  const materialId = id("material");
  const runId = analysisRunId ?? id("legacy-analysis");
  const evidenceIdMap = Object.fromEntries(analysis.evidence.map((entry) => [entry.id, id("evidence", entry.id)]));
  const commands = [];
  const omissions = [];
  const unresolvedMentions = [];
  const add = (type, key, payload) => commands.push({ ownerId, commandId: id("command", key), type, payload });
  const content = { format: "legacy_structured_analysis", adapterVersion: 1, analysis, review: { reviewed: true, reviewedAt } };
  add("source.create", "source", {
    id: sourceId, kind: "capture_analysis", title: analysis.title.value ?? capture.id,
    provenance: {
      importId, inputHash, adapterVersion: 1, legacyCaptureId: capture.id,
      sourceApp: capture.sourceApp, sourceUrl: capture.sourceUrl, locale: capture.locale,
      analysisRunId: runId, reviewedAt, publisherIdentity: "unknown",
      contentHashTarget: "stored_analysis_snapshot_not_image",
    },
  });
  add("source.version.add", "version", {
    id: sourceVersionId, sourceId, expectedSourceRevision: 1,
    contentHash: `sha256:${hash(content)}`, capturedAt: capture.capturedAt, content, asset: capture.asset,
  });
  add("entity.create", "material", {
    // Keep personal source text in the source/evidence lifecycle. A material
    // entity must not retain a deleted title in a second label field.
    id: materialId, type: "ingestion.material", label: "Imported capture material",
    externalIds: { legacyCaptureId: capture.id, sourceVersionId, identityScope: "source_snapshot" },
  });
  analysis.evidence.forEach((entry, index) => add("evidence.add", `evidence:${entry.id}`, {
    id: evidenceIdMap[entry.id], sourceVersionId, expectedSourceVersionRevision: 1,
    quote: entry.text, createdByRunId: runId,
    locator: { kind: "legacy_analysis_text", jsonPointer: `/analysis/evidence/${index}/text`, legacyEvidenceId: entry.id, region: entry.region, regionPrecision: "category_only" },
  }));

  const cited = (entry) => [...new Set(entry.evidenceIds)].map((legacyId) => evidenceIdMap[legacyId]);
  function field(path, value, entry) {
    if (value == null) return;
    const evidenceIds = cited(entry);
    if (!evidenceIds.length) { omissions.push({ path, reason: "no_source_evidence", preservedInSource: true }); return; }
    const fieldValue = { sourceVersionId, path, value };
    validateImportedValue("ingestion.field", fieldValue);
    add("assertion.add", `field:${path}`, {
      id: id("assertion", path), subjectId: materialId, predicate: "ingestion.extracted_field",
      typedValue: { type: "ingestion.field", value: fieldValue },
      scope: { type: "source_field", id: id("field-scope", path) },
      origin: "source_extracted", assertedBy: { type: "publisher", id: `unknown:${sourceId}` },
      evidenceIds, supportSets: [evidenceIds], createdByRunId: runId,
      observedAt: capture.capturedAt, validFrom: null, validTo: null, refreshDueAt: null,
    });
  }
  function mention(path, value, entityType, entry) {
    const evidenceIds = cited(entry);
    if (!value || !evidenceIds.length) return;
    // No Entity or accepted identity is created for a real-world target. A
    // matching name in another capture is not proof of the same product/place.
    if (value.length > 512) { omissions.push({ path, reason: "mention_text_exceeds_contract", preservedInSource: true }); return; }
    const mentionId = id("mention", path);
    add("mention.create", `mention:${path}`, { id: mentionId, sourceVersionId, text: value, entityType, evidenceIds });
    unresolvedMentions.push({ id: mentionId, path, entityType, evidenceIds, status: "unresolved" });
  }

  if (analysis.title.status === "observed") {
    field("/title/value", analysis.title.value, analysis.title);
    const titleType = { recipe: "recipe.recipe", sauce_recipe: "recipe.recipe", beauty_product: "core.product", commerce_product: "core.product" }[analysis.contentKind];
    if (titleType) mention("/title/value", analysis.title.value, titleType, analysis.title);
    if (analysis.contentKind === "unknown" &&
        analysis.tags?.some((tag) => tag.value === "생활·팁" && tag.facet === "field") &&
        analysis.facts?.some((fact) => fact.value?.trim() && fact.evidenceIds?.length)) {
      mention("/title/value", analysis.title.value, "life_tip.tip", analysis.title);
    }
  } else if (analysis.title.status === "inferred") omissions.push({ path: "/title/value", reason: "inferred_title_not_source_fact", preservedInSource: true });
  if (analysis.place) {
    for (const key of ["name", "address", "searchArea", "category"]) field(`/place/${key}`, analysis.place[key], analysis.place);
    if (["restaurant", "cafe"].includes(analysis.place.category)) mention("/place/name", analysis.place.name, "dining.place", analysis.place);
    if (analysis.contentKind === "place" && analysis.place.category === "activity") {
      mention("/place/name", analysis.place.name, "travel.place", analysis.place);
    }
  }
  analysis.ingredientGroups.forEach((group, groupIndex) => group.ingredients.forEach((entry, index) => {
    const path = `/ingredientGroups/${groupIndex}/ingredients/${index}`;
    for (const key of ["name", "amount", "unit", "preparation", "originalText"]) field(`${path}/${key}`, entry[key], entry);
    // The legacy required boolean cannot distinguish a visible declaration
    // from the model's default, so optional remains in the source snapshot only.
    if (["recipe", "sauce_recipe"].includes(analysis.contentKind)) mention(`${path}/name`, entry.name, "recipe.ingredient", entry);
  }));
  analysis.steps.forEach((entry, index) => {
    for (const key of ["instruction", "durationSeconds", "temperature"]) field(`/steps/${index}/${key}`, entry[key], entry);
  });
  analysis.facts.forEach((entry, index) => {
    field(`/facts/${index}/label`, entry.label, entry);
    field(`/facts/${index}/value`, entry.value, entry);
  });
  omissions.push({ path: "/", reason: "domain_facts_require_explicit_mapping_and_identity_resolution", preservedInSource: true });
  return {
    adapterVersion: 1, ownerId, importId, inputHash, sourceId, sourceVersionId, materialId,
    evidenceIdMap, commands, unresolvedMentions, omissions,
    importReceipt: { ownerId, importId, inputHash, legacyCaptureId: capture.id, sourceId, sourceVersionId },
  };
}
