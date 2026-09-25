import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewedCaptureImport, INGESTION_PREDICATES, INGESTION_TYPES, IngestionError, validateImportedValue } from "../src/ingestion/index.js";
import { applyKnowledgeCommand, createKnowledgeState, resolveEntityMention } from "../src/knowledge/index.js";
import { domainRegistry } from "../src/domains/index.js";
import { validateAnalysisResult } from "../src/result_validation.js";
import { makeValidAnalysis } from "./fixtures.js";

const now = "2026-09-25T10:00:00Z";
const predicates = {
  getRelation(id) { return INGESTION_PREDICATES.find((entry) => entry.id === id) ?? domainRegistry.getRelation(id); },
  validate(typeId, value) { return INGESTION_TYPES.some((entry) => entry.id === typeId) ? validateImportedValue(typeId, value) : domainRegistry.validate(typeId, value); },
};
const request = (overrides = {}) => ({
  ownerId: "user-1", importId: "reviewed-capture-1", reviewed: true,
  reviewedAt: "2026-09-25T19:00:00+09:00", analysisRunId: "legacy-run-1",
  capture: { id: "capture-1", capturedAt: "2026-09-20T12:00:00+09:00", sourceApp: "instagram", asset: { status: "device_only", deviceAssetId: "capture-1" } },
  analysis: makeValidAnalysis(), ...overrides,
});
const rejects = (run, code = "INVALID_CAPTURE_IMPORT") => assert.throws(run, (error) => error instanceof IngestionError && error.code === code);
function apply(commands, initial = createKnowledgeState()) {
  return commands.reduce((state, command) => applyKnowledgeCommand(state, command, { predicates, now }).state, initial);
}

test("a reviewed server analysis maps to traceable snapshot fields and unresolved mentions", () => {
  const input = request();
  const snapshot = structuredClone(input);
  const imported = buildReviewedCaptureImport(input);
  const state = apply(imported.commands);
  assert.deepEqual(input, snapshot);
  assert.equal(state.sources.length, 1);
  assert.equal(state.sourceVersions.length, 1);
  assert.equal(state.entities.length, 1);
  assert.equal(state.entities[0].type, "ingestion.material");
  assert.deepEqual(state.sourceVersions[0].content.analysis, input.analysis);
  assert.deepEqual(state.sourceVersions[0].asset, input.capture.asset);
  assert.equal(state.evidence.length, input.analysis.evidence.length);
  assert.equal(state.identityDecisions.length, 0);
  for (const mention of state.entityMentions) {
    assert.equal(resolveEntityMention(state, { ownerId: input.ownerId, mentionId: mention.id }).status, "unresolved");
  }
  for (const assertion of state.assertions) {
    assert.equal(assertion.predicate, "ingestion.extracted_field");
    assert.equal(assertion.origin, "source_extracted");
    assert.equal(assertion.assertedBy.type, "publisher");
    assert.ok(assertion.assertedBy.id.startsWith("unknown:"));
    assert.equal(assertion.subjectId, imported.materialId);
    assert.ok(assertion.evidenceIds.length > 0);
    for (const evidenceId of assertion.evidenceIds) assert.ok(state.evidence.some((entry) => entry.id === evidenceId && entry.sourceVersionId === imported.sourceVersionId));
  }
  assert.equal(state.sources[0].provenance.contentHashTarget, "stored_analysis_snapshot_not_image");
  assert.equal(state.evidence[0].locator.jsonPointer, "/analysis/evidence/0/text");
  assert.equal(state.evidence[0].locator.regionPrecision, "category_only");
});

test("explicit review and a stable review time are required", () => {
  rejects(() => buildReviewedCaptureImport(request({ reviewed: false })), "CAPTURE_REVIEW_REQUIRED");
  rejects(() => buildReviewedCaptureImport(request({ reviewed: "true" })), "CAPTURE_REVIEW_REQUIRED");
  rejects(() => buildReviewedCaptureImport(request({ reviewedAt: "yesterday" })));
});

test("partial import replay produces the same records without duplicated assertions", () => {
  const imported = buildReviewedCaptureImport(request());
  assert.deepEqual(buildReviewedCaptureImport(request()), imported);
  const partial = apply(imported.commands.slice(0, 5));
  const resumed = apply(imported.commands, partial);
  const once = apply(imported.commands);
  assert.deepEqual(resumed, once);
  assert.deepEqual(apply(imported.commands, resumed), resumed);
});

test("same importId with different reviewed content conflicts before new records are applied", () => {
  const imported = buildReviewedCaptureImport(request());
  const changed = request();
  changed.analysis.evidence[0].text = "Different title evidence";
  rejects(() => buildReviewedCaptureImport(changed, { previousImport: imported.importReceipt }), "INGESTION_IMPORT_CONFLICT");
  const replacement = buildReviewedCaptureImport(changed);
  assert.equal(replacement.commands[0].commandId, imported.commands[0].commandId);
  assert.notEqual(replacement.inputHash, imported.inputHash);
  const state = apply(imported.commands);
  assert.throws(() => applyKnowledgeCommand(state, replacement.commands[0], { predicates, now }), (error) => error.code === "KNOWLEDGE_COMMAND_CONFLICT");
});

test("stored Flutter tags and nullable place are accepted without binding storage to a model name", () => {
  const analysis = validateAnalysisResult(makeValidAnalysis());
  analysis.place = null;
  analysis.schemaVersion = "1.5";
  analysis.model = "historical-analysis-model";
  const imported = buildReviewedCaptureImport(request({ analysis }));
  assert.deepEqual(apply(imported.commands).sourceVersions[0].content.analysis, analysis);
  assert.ok(!Object.hasOwn(analysis, "filing"));
});

test("inferred titles, ungrounded facts and missing recipe context remain in the source only", () => {
  const analysis = makeValidAnalysis({
    title: { value: "Probably dinner", status: "inferred", confidence: 0.8, evidenceIds: ["e1"] },
    facts: [{ label: "효능", value: "피부가 좋아짐", confidence: 0.9, evidenceIds: [] }],
  });
  const imported = buildReviewedCaptureImport(request({ analysis }));
  const state = apply(imported.commands);
  assert.ok(!state.assertions.some((entry) => entry.typedValue.value.path === "/title/value"));
  assert.ok(!state.assertions.some((entry) => entry.typedValue.value.path.startsWith("/facts/")));
  assert.ok(!state.entities.some((entry) => entry.type === "recipe.recipe"));
  assert.ok(!state.assertions.some((entry) => entry.predicate.startsWith("recipe.")));
  assert.deepEqual(state.sourceVersions[0].content.analysis.facts, analysis.facts);
  assert.ok(imported.omissions.some((entry) => entry.reason === "inferred_title_not_source_fact"));
  assert.ok(imported.omissions.some((entry) => entry.path === "/facts/0/value" && entry.reason === "no_source_evidence"));
  assert.ok(!state.assertions.some((entry) => entry.typedValue.value.path.endsWith("/optional")));
});

test("two same-name captures do not merge products, recipes or evidence IDs", () => {
  const first = buildReviewedCaptureImport(request());
  const second = buildReviewedCaptureImport(request({ importId: "second-import", capture: { id: "capture-2" } }));
  const state = apply(second.commands, apply(first.commands));
  assert.notEqual(first.evidenceIdMap.e1, second.evidenceIdMap.e1);
  assert.notEqual(first.materialId, second.materialId);
  assert.equal(state.identityDecisions.length, 0);
  assert.equal(state.entities.length, 2);
  assert.equal(state.entityMentions.length, first.unresolvedMentions.length + second.unresolvedMentions.length);
});

test("unknown asset availability is preserved and a client cannot invent a server asset", () => {
  const absent = buildReviewedCaptureImport(request({ capture: { id: "capture-1" } }));
  assert.deepEqual(apply(absent.commands).sourceVersions[0].asset, { status: "unavailable" });
  const input = request({ capture: { id: "capture-1", asset: { status: "available", assetId: "asset-1" } } });
  rejects(() => buildReviewedCaptureImport(input));
  rejects(() => buildReviewedCaptureImport(input, { verifyAvailableAsset: () => false }));
  const verified = buildReviewedCaptureImport(input, { verifyAvailableAsset: ({ ownerId, assetId }) => ownerId === "user-1" && assetId === "asset-1" });
  assert.deepEqual(apply(verified.commands).sourceVersions[0].asset, { status: "available", assetId: "asset-1" });
  rejects(() => buildReviewedCaptureImport(request({ capture: { id: "capture-1", asset: { status: "device_only", assetId: "server-pretend" } } })));
});

test("binary fields, disguised image base64 and device paths never enter source content", () => {
  for (const mutate of [
    (input) => { input.analysis.image = { base64: "/9j/2Q==" }; },
    (input) => { input.analysis.summary = "data:image/png;base64,iVBORw0KGgoAAAA"; },
    (input) => { input.analysis.evidence[0].text = "/9j/2Q=="; },
    (input) => { input.analysis.evidence[0].text = "image bytes: /9j/2Q=="; },
    (input) => { input.analysis.evidence[0].text = "saved at /Users/alice/capture.png"; },
    (input) => { input.analysis.summary = "file:///private/capture.jpg"; },
    (input) => { input.analysis.summary = "path=/custom/folder/capture.jpg"; },
    (input) => { input.capture.asset = { status: "device_only", deviceAssetId: "/storage/emulated/0/Pictures/capture.png" }; },
    (input) => { input.capture.asset = { status: "unavailable", localPath: "capture.jpg" }; },
  ]) {
    const input = request(); mutate(input);
    rejects(() => buildReviewedCaptureImport(input));
  }
});

test("missing or duplicate evidence IDs are rejected instead of repaired after review", () => {
  const missing = request(); missing.analysis.title.evidenceIds = ["not-real"];
  rejects(() => buildReviewedCaptureImport(missing));
  const duplicate = request(); duplicate.analysis.evidence.push(duplicate.analysis.evidence[0]);
  rejects(() => buildReviewedCaptureImport(duplicate));
});

test("mixed place and recipe observations preserve both facets without assuming a branch identity", () => {
  const input = request();
  input.analysis.place = { name: "Tofu House", address: null, searchArea: "Seoul", category: "restaurant", confidence: 0.6, evidenceIds: ["e1"] };
  const imported = buildReviewedCaptureImport(input);
  const state = apply(imported.commands);
  assert.ok(state.entityMentions.some((entry) => entry.entityType === "recipe.recipe"));
  assert.ok(state.entityMentions.some((entry) => entry.entityType === "dining.place"));
  assert.equal(state.identityDecisions.length, 0);
  assert.ok(state.assertions.some((entry) => entry.typedValue.value.path === "/place/searchArea" && entry.typedValue.value.value === "Seoul"));
});

test("a completely unsupported capture with no evidence still preserves its reviewed analysis", () => {
  const analysis = makeValidAnalysis({ domain: "unknown", contentKind: "unknown", completeness: "unsupported", filing: { fields: [], areas: [], kinds: [], traits: [] }, title: { value: null, status: "missing", confidence: 0, evidenceIds: [] }, evidence: [], ingredientGroups: [], summary: "", warnings: [] });
  const imported = buildReviewedCaptureImport(request({ analysis }));
  const state = apply(imported.commands);
  assert.equal(state.assertions.length, 0);
  assert.equal(state.entityMentions.length, 0);
  assert.deepEqual(state.sourceVersions[0].content.analysis, analysis);
});

test("replaying an import after source deletion does not resurrect its text or image", () => {
  const imported = buildReviewedCaptureImport(request());
  const state = apply(imported.commands);
  const deleted = applyKnowledgeCommand(state, { ownerId: "user-1", commandId: "delete-import", type: "source.delete", payload: { sourceId: imported.sourceId, expectedRevision: 1 } }, { predicates, now }).state;
  const replayed = apply(imported.commands, deleted);
  assert.equal(replayed.sourceVersions[0].content, null);
  assert.equal(replayed.sourceVersions[0].asset, null);
  assert.ok(replayed.evidence.every((entry) => entry.quote === ""));
  assert.equal(replayed.entities[0].label, "Imported capture material");
  assert.deepEqual(replayed, deleted);
});
