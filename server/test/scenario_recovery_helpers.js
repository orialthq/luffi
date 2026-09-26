import assert from "node:assert/strict";

export async function correctExtractedField({ service, store, materialId, path,
  value, ownerId, commandId }) {
  const state = await store.snapshot();
  const field = state.knowledge.assertions.find((item) =>
    item.status === "active" && item.subjectId === materialId &&
    item.predicate === "ingestion.extracted_field" &&
    item.typedValue?.value?.path === path);
  assert.ok(field, `Missing active extracted field at ${path}`);
  return service.knowledgeCommand({ commandId, type: "assertion.correct",
    payload: { assertionId: field.id, expectedRevision: field.revision,
      assertion: { id: `${commandId}:assertion`, subjectId: field.subjectId,
        predicate: field.predicate, scope: field.scope, origin: "user_reported",
        assertedBy: { type: "user", id: ownerId },
        evidenceIds: field.evidenceIds, observedAt: new Date().toISOString(),
        typedValue: { type: "ingestion.field",
          value: { ...field.typedValue.value, value } } } } });
}
