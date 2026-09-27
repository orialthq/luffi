import assert from "node:assert/strict";
import test from "node:test";
import { createCommonKernelService } from "../src/common/kernel_service.js";
import { createRelationalTestPool, createScenarioTestStore } from "./relational_fixture.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";
import { makeFiling, makeTag, makeValidAnalysis } from "./fixtures.js";
import { correctExtractedField } from "./scenario_recovery_helpers.js";

async function fixture(t, backend) {
  const { store, reopenStore } = await createScenarioTestStore(t, backend, "dining");
  return { store, reopenStore,
    service: createCommonKernelService({ ownerId: "diner", store }) };
}

function analysis(name, area) {
  return makeValidAnalysis({ contentKind: "place", ingredientGroups: [], warnings: [],
    title: { value: name, status: "observed", confidence: 0.99, evidenceIds: ["e1"] },
    place: { name, address: null, searchArea: area, category: "restaurant",
      confidence: 0.99, evidenceIds: ["e1"] },
    evidence: [{ id: "e1", text: `${name} ${area}`, region: "image_text", confidence: 0.99 }],
    filing: makeFiling({ fields: [makeTag("맛집·카페", [name])] }),
    summary: `${area}의 식당`,
  });
}

async function imported(service, id, name, area) {
  return service.importReviewedCapture({ importId: id, reviewed: true,
    reviewedAt: "2026-09-26T08:00:00+09:00",
    capture: { id, asset: { status: "unavailable" } }, analysis: analysis(name, area) });
}

for (const backend of ["json", "postgres"]) {
test(`reviewed restaurant images form branch-safe candidates and a user-confirmed visit (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  await imported(service, "a", "모퉁이식당 성수점", "성수");
  await imported(service, "b", "모퉁이식당 연남점", "연남");
  await imported(service, "c", "모퉁이식당 성수점", "성수");
  await imported(service, "d", "성수국수집", "성수");
  const request = { commandId: "create-dinner", activityId: "dinner-one", confirmed: true,
    importIds: ["a", "b", "c", "d"], scheduledAt: "2026-09-27T19:00:00+09:00",
    area: "성수", partySize: 2 };
  const created = await service.createDiningScenario(request);
  assert.equal(created.candidateCount, 2);
  assert.equal((await service.createDiningScenario(request)).replayed, true);
  const before = await service.getBoard("dinner-one");
  assert.equal(before.tasks.length, 0);
  assert.equal(before.pendingProposals.length, 1);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-dinner" });
  let board = await service.getBoard("dinner-one");
  await service.activityCommand({ commandId: "create-travel-peer", type: "activity.create",
    activityId: "travel-peer", expectedRevision: 0,
    payload: { title: "성수 여행", goal: { description: "방문할 곳 정하기" } } });
  await store.transact((state) => {
    state.activities.activities["travel-peer"].currentPlanRevision = 1;
    state.travelScenarioReceipts["travel-peer"] = { result: { activityId: "travel-peer" } };
    return { state, result: null };
  });
  await service.createScenarioConnection({ commandId: "travel-dinner-link",
    fromActivityId: "travel-peer", toActivityId: "dinner-one", kind: "travel_dining",
    expectedFromRevision: 1, expectedToRevision: board.revision, confirmed: true });
  const candidates = board.tasks.find((item) => item.id === "select_place").readiness.inputs.candidates;
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.find((item) => item.name === "모퉁이식당 성수점").importIds, ["a", "c"]);
  assert.ok(candidates.every((item) => !item.importIds.includes("b")));
  const selected = await service.selectDiningPlace({ commandId: "choose-dinner", activityId: "dinner-one",
    expectedRevision: board.revision, candidateId: candidates[0].id });
  assert.equal(selected.replayed, false);
  const linked = (await service.listScenarioConnections("travel-peer")).connections[0];
  assert.equal(linked.otherSubject?.entityId, selected.placeId);
  assert.equal((await store.snapshot()).knowledge.assertions.find((item) =>
    item.predicate === "scenario.connection_to_subject")?.objectEntityId, selected.placeId);
  assert.equal((await store.snapshot()).knowledge.assertions.find((item) =>
    item.predicate === "scenario.connection_to_subject")?.evidenceIds.length, 2);
  board = await service.getBoard("dinner-one");
  const details = board.tasks.find((item) => item.id === "review_visit_details");
  assert.equal(details.readiness.inputs.placeId, selected.placeId);
  await service.activityCommand({ commandId: "review-dinner", type: "task.transition",
    activityId: "dinner-one", expectedRevision: board.revision,
    payload: { taskId: details.id, expectedTaskRevision: details.revision,
      to: "completed", output: { placeId: selected.placeId, status: "unknown",
        reviewedAt: "2026-09-26T09:00:00+09:00" } } });
  board = await service.getBoard("dinner-one");
  const visit = await service.recordDiningVisitOutcome({ commandId: "visit-dinner",
    activityId: "dinner-one", expectedRevision: board.revision, status: "visited" });
  assert.ok(visit.visitId);
  assert.equal((await service.recordDiningVisitOutcome({ commandId: "visit-dinner",
    activityId: "dinner-one", expectedRevision: board.revision, status: "visited" })).replayed, true);
  const resolved = await service.resolveKnowledge({ subjectId: visit.visitId,
    predicate: "dining.visited", scope: { type: "activity", id: "dinner-one" } });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.values[0].objectEntityId, selected.placeId);
  const state = await store.snapshot();
  assert.equal(state.knowledge.identityDecisions.filter((item) => item.status === "accepted").length, 2);
  const next = await service.createDiningScenario({ commandId: "create-next-dinner",
    activityId: "dinner-two", confirmed: true, importIds: ["a", "c"],
    scheduledAt: "2026-09-28T19:00:00+09:00", area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: next.proposalId, commandId: "approve-next-dinner" });
  const nextBoard = await service.getBoard("dinner-two");
  const nextCandidate = nextBoard.tasks.find((item) => item.id === "select_place")
    .readiness.inputs.candidates[0];
  const reused = await service.selectDiningPlace({ commandId: "choose-next-dinner",
    activityId: "dinner-two", expectedRevision: nextBoard.revision,
    candidateId: nextCandidate.id });
  assert.equal(reused.placeId, selected.placeId);
  assert.equal((await store.snapshot()).knowledge.identityDecisions
    .filter((item) => item.status === "accepted").length, 2);
});

test(`unconfirmed visit creates no visited assertion and direct task bypass is rejected (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  await imported(service, "a", "모퉁이식당 성수점", "성수");
  const created = await service.createDiningScenario({ commandId: "create", activityId: "dinner",
    confirmed: true, importIds: ["a"], scheduledAt: "2026-09-27T19:00:00+09:00",
    area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve" });
  let board = await service.getBoard("dinner");
  const selection = board.tasks.find((item) => item.id === "select_place");
  await assert.rejects(service.activityCommand({ commandId: "bypass", type: "task.transition",
    activityId: "dinner", expectedRevision: board.revision,
    payload: { taskId: selection.id, expectedTaskRevision: selection.revision,
      to: "completed", output: { candidateId: "fake", placeId: "fake",
        selectedAt: "2026-09-26T09:00:00+09:00" } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  const selected = await service.selectDiningPlace({ commandId: "select", activityId: "dinner",
    expectedRevision: board.revision, candidateId: selection.readiness.inputs.candidates[0].id });
  board = await service.getBoard("dinner");
  const details = board.tasks.find((item) => item.id === "review_visit_details");
  await service.activityCommand({ commandId: "details", type: "task.transition",
    activityId: "dinner", expectedRevision: board.revision,
    payload: { taskId: details.id, expectedTaskRevision: details.revision, to: "completed",
      output: { placeId: selected.placeId, status: "unknown",
        reviewedAt: "2026-09-26T09:00:00+09:00" } } });
  board = await service.getBoard("dinner");
  const result = await service.recordDiningVisitOutcome({ commandId: "not-visited",
    activityId: "dinner", expectedRevision: board.revision, status: "not_visited" });
  assert.equal(result.visitId, null);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "dining.visited" && item.status === "active").length, 0);
});

test(`corrected restaurant name changes a reviewed candidate before selection (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const source = await imported(service, "a", "모퉁이식당 성수점", "성수");
  const created = await service.createDiningScenario({ commandId: "create-review",
    activityId: "dinner-review", confirmed: true, importIds: ["a"],
    scheduledAt: "2026-09-27T19:00:00+09:00", area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-before-name-correction" });
  const before = await service.getBoard("dinner-review");
  await correctExtractedField({ service, store, materialId: source.materialId,
    path: "/place/name", value: "모퉁이식당 성수 본점", ownerId: "diner",
    commandId: "correct-dining-name" });
  const review = await service.getBoardReview("dinner-review");
  assert.equal(review.status, "ready");
  assert.ok(review.changes.some((item) =>
    item.before.includes("모퉁이식당 성수점") &&
    item.after.includes("모퉁이식당 성수 본점")));
  const proposed = await service.proposeBoardReview({ activityId: "dinner-review",
    commandId: "propose-dining-correction", expectedRevision: before.revision,
    confirmed: true });
  await service.acceptProposal({ proposalId: proposed.proposalId,
    commandId: "approve-dining-correction" });
  const after = await service.getBoard("dinner-review");
  assert.equal(after.tasks[0].readiness.inputs.candidates[0].name,
    "모퉁이식당 성수 본점");
  assert.equal(after.tasks[1].inputBindings.partySize, 2);
});

test(`deleting a captured source redacts the derived board and tombstones retries (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const source = await imported(service, "a", "모퉁이식당 성수점", "성수");
  const request = { commandId: "create", activityId: "dinner", confirmed: true,
    importIds: ["a"], scheduledAt: "2026-09-27T19:00:00+09:00",
    area: "성수", partySize: 2 };
  await service.createDiningScenario(request);
  await service.knowledgeCommand({ commandId: "delete-source", type: "source.delete",
    payload: { sourceId: source.sourceId } });
  await assert.rejects(service.getBoard("dinner"), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createDiningScenario(request),
    (error) => error.code === "SCENARIO_DELETED");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.diningScenarioReceipts["diner:create"].deleted, true);
});

test(`retracted restaurant identity prevents a visit report (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  await imported(service, "a", "모퉁이식당 성수점", "성수");
  const created = await service.createDiningScenario({ commandId: "create", activityId: "dinner",
    confirmed: true, importIds: ["a"], scheduledAt: "2026-09-27T19:00:00+09:00",
    area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve" });
  let board = await service.getBoard("dinner");
  const candidateId = board.tasks.find((item) => item.id === "select_place")
    .readiness.inputs.candidates[0].id;
  await service.selectDiningPlace({ commandId: "choose", activityId: "dinner",
    expectedRevision: board.revision, candidateId });
  const decision = (await store.snapshot()).knowledge.identityDecisions.find((item) =>
    item.status === "accepted");
  await service.knowledgeCommand({ commandId: "retract-place-identity",
    type: "identity.retract", payload: { decisionId: decision.id,
      expectedRevision: decision.revision } });
  board = await service.getBoard("dinner");
  await assert.rejects(service.recordDiningVisitOutcome({ commandId: "report-stale-visit",
    activityId: "dinner", expectedRevision: board.revision, status: "visited" }),
  (error) => ["CONTEXT_STALE", "TASK_BLOCKED"].includes(error.code));
  assert.equal((await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === "dining.visited").length, 0);
});

test(`correcting a selected branch preserves visit history and requires a new board (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  await imported(service, "first", "성수국수집", "성수");
  await imported(service, "second", "성수밥집", "성수");
  const created = await service.createDiningScenario({ commandId: "create-correctable",
    activityId: "correctable-dinner", confirmed: true, importIds: ["first", "second"],
    scheduledAt: "2026-09-27T19:00:00+09:00", area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-correctable" });
  let board = await service.getBoard("correctable-dinner");
  const originalCandidate = board.tasks.find((item) => item.id === "select_place")
    .readiness.inputs.candidates[0];
  const original = await service.selectDiningPlace({ commandId: "select-original",
    activityId: "correctable-dinner", expectedRevision: board.revision,
    candidateId: originalCandidate.id });
  await service.activityCommand({ commandId: "create-connected-travel", type: "activity.create",
    activityId: "connected-travel", expectedRevision: 0,
    payload: { title: "성수 여행", goal: { description: "식사 장소 연동" } } });
  await store.transact((state) => {
    state.activities.activities["connected-travel"].currentPlanRevision = 1;
    state.travelScenarioReceipts["connected-travel"] = {
      result: { activityId: "connected-travel" } };
    return { state, result: null };
  });
  board = await service.getBoard("correctable-dinner");
  await service.createScenarioConnection({ commandId: "connected-dinner",
    fromActivityId: "connected-travel", toActivityId: "correctable-dinner",
    kind: "travel_dining", expectedFromRevision: 1,
    expectedToRevision: board.revision, confirmed: true });
  assert.equal((await service.listScenarioConnections("connected-travel"))
    .connections[0].otherSubject.entityId, original.placeId);
  board = await service.getBoard("correctable-dinner");
  const details = board.tasks.find((item) => item.id === "review_visit_details");
  await service.activityCommand({ commandId: "review-original", type: "task.transition",
    activityId: "correctable-dinner", expectedRevision: board.revision,
    payload: { taskId: details.id, expectedTaskRevision: details.revision,
      to: "completed", output: { placeId: original.placeId, status: "unknown",
        reviewedAt: "2026-09-27T09:00:00+09:00" } } });
  board = await service.getBoard("correctable-dinner");
  const visit = await service.recordDiningVisitOutcome({ commandId: "visit-original",
    activityId: "correctable-dinner", expectedRevision: board.revision, status: "visited" });
  const editable = await service.getEditableDiningSelection("correctable-dinner");
  assert.equal(editable.candidateId, originalCandidate.id);
  const replacement = editable.candidates.find((item) => item.id !== originalCandidate.id);
  const correction = { commandId: "change-place", activityId: "correctable-dinner",
    expectedGraphFingerprint: editable.graphFingerprint, candidateId: replacement.id,
    confirmed: true };
  const changed = await service.correctDiningPlace(correction);
  assert.equal((await service.correctDiningPlace(correction)).replayed, true);
  assert.notEqual(changed.placeId, original.placeId);
  assert.equal((await service.getEditableDiningSelection("correctable-dinner")).candidateId,
    replacement.id);
  await assert.rejects(service.correctDiningPlace({ ...correction,
    commandId: "stale-correction", candidateId: originalCandidate.id }),
  (error) => error.code === "DINING_REVISION_CONFLICT");
  const snapshot = await store.snapshot();
  const choice = snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "dining.choice_place");
  assert.equal(choice.filter((item) => item.status === "active").length, 1);
  assert.equal(choice.find((item) => item.status === "active").objectEntityId, changed.placeId);
  assert.equal(choice.find((item) => item.status === "corrected").objectEntityId, original.placeId);
  assert.equal((await service.listScenarioConnections("connected-travel"))
    .connections[0].otherSubject, null);
  assert.equal(snapshot.knowledge.assertions.find((item) =>
    item.predicate === "scenario.connection_to_subject").status, "retracted");
  assert.equal(snapshot.knowledge.assertions.find((item) =>
    item.predicate === "dining.visited" && item.status === "active").objectEntityId,
  original.placeId);
  assert.equal((await service.resolveKnowledge({ subjectId: visit.visitId,
    predicate: "dining.visited", scope: { type: "activity", id: "correctable-dinner" } }))
    .values[0].objectEntityId, original.placeId);
  board = await service.getBoard("correctable-dinner");
  const review = await service.getBoardReview("correctable-dinner");
  assert.equal(review.status, "blocked");
  assert.deepEqual(review.affectedTasks.map((item) => item.id),
    ["review_visit_details", "record_visit_outcome"]);
  const continued = await service.createReviewSuccessor({ activityId: "correctable-dinner",
    commandId: "continue-corrected", expectedRevision: board.revision, confirmed: true });
  assert.notEqual(continued.activityId, "correctable-dinner");
  const next = await service.getBoard(continued.activityId);
  assert.equal(next.pendingProposals.length, 1);
  const visitSourceId = snapshot.knowledge.sources.find((item) =>
    item.provenance?.scenario === "dining" && item.provenance.activityId === "correctable-dinner" &&
    item.kind === "user_report").id;
  await service.knowledgeCommand({ commandId: "delete-corrected-dinner-source",
    type: "source.delete", payload: { sourceId: changed.sourceId } });
  assert.equal((await store.snapshot()).knowledge.sources.find((item) =>
    item.id === visitSourceId).status, "deleted");
});

test(`deleting a dining correction removes its dependent selection board (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  await imported(service, "first", "성수국수집", "성수");
  await imported(service, "second", "성수밥집", "성수");
  const created = await service.createDiningScenario({ commandId: "create-delete-correction",
    activityId: "delete-correction-dinner", confirmed: true, importIds: ["first", "second"],
    scheduledAt: "2026-09-27T19:00:00+09:00", area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-delete" });
  const board = await service.getBoard("delete-correction-dinner");
  const first = board.tasks[0].readiness.inputs.candidates[0];
  await service.selectDiningPlace({ commandId: "select-delete", activityId: "delete-correction-dinner",
    expectedRevision: board.revision, candidateId: first.id });
  const editable = await service.getEditableDiningSelection("delete-correction-dinner");
  const request = { commandId: "correct-delete", activityId: "delete-correction-dinner",
    expectedGraphFingerprint: editable.graphFingerprint,
    candidateId: editable.candidates.find((item) => item.id !== first.id).id,
    confirmed: true };
  const correction = await service.correctDiningPlace(request);
  await service.knowledgeCommand({ commandId: "delete-dining-correction", type: "source.delete",
    payload: { sourceId: correction.sourceId } });
  await assert.rejects(service.getBoard("delete-correction-dinner"),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.correctDiningPlace(request),
    (error) => error.code === "CORRECTION_DELETED");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.find((item) =>
    item.id === correction.sourceId).status, "deleted");
  assert.equal(snapshot.diningScenarioReceipts["diner:create-delete-correction"].deleted, true);
});

test(`an older task-result-only dining choice is upgraded when corrected (${backend})`, async (t) => {
  // Build an old JSON snapshot, then import that snapshot into either backend.
  // Relational graph rows are append-only after import, as they are in production.
  let { service, store } = await fixture(t, "json");
  await imported(service, "first", "성수국수집", "성수");
  await imported(service, "second", "성수밥집", "성수");
  const created = await service.createDiningScenario({ commandId: "create-legacy",
    activityId: "legacy-dinner", confirmed: true, importIds: ["first", "second"],
    scheduledAt: "2026-09-27T19:00:00+09:00", area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-legacy" });
  const board = await service.getBoard("legacy-dinner");
  await service.selectDiningPlace({ commandId: "select-legacy", activityId: "legacy-dinner",
    expectedRevision: board.revision, candidateId: board.tasks[0].readiness.inputs.candidates[0].id });
  await store.transact((state) => {
    const receipt = state.diningScenarioReceipts["diner:create-legacy"];
    const sourceId = receipt.result.confirmationSourceId;
    const versionIds = state.knowledge.sourceVersions.filter((item) =>
      item.sourceId === sourceId).map((item) => item.id);
    const evidenceIds = state.knowledge.evidence.filter((item) =>
      versionIds.includes(item.sourceVersionId)).map((item) => item.id);
    state.knowledge.sources = state.knowledge.sources.filter((item) => item.id !== sourceId);
    state.knowledge.sourceVersions = state.knowledge.sourceVersions.filter((item) =>
      !versionIds.includes(item.id));
    state.knowledge.evidence = state.knowledge.evidence.filter((item) =>
      !evidenceIds.includes(item.id));
    state.knowledge.assertions = state.knowledge.assertions.filter((item) =>
      item.predicate !== "dining.choice_place");
    state.knowledge.entities = state.knowledge.entities.filter((item) =>
      item.type !== "dining.choice");
    delete receipt.result.confirmationSourceId;
    return { state, result: null };
  });
  if (backend === "postgres") {
    const legacy = await store.snapshot();
    const { pool } = await createRelationalTestPool(t);
    store = createPostgresRelationalStore({ pool, initialState: () => legacy });
    await store.ready();
    service = createCommonKernelService({ ownerId: "diner", store });
  }
  const editable = await service.getEditableDiningSelection("legacy-dinner");
  assert.equal(editable.revision, 0);
  const changed = await service.correctDiningPlace({ commandId: "correct-legacy",
    activityId: "legacy-dinner", expectedGraphFingerprint: editable.graphFingerprint,
    candidateId: editable.candidates.find((item) => item.id !== editable.candidateId).id,
    confirmed: true });
  assert.equal((await service.getEditableDiningSelection("legacy-dinner")).revision, 2);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "dining.choice_place" && item.status === "active").length, 1);
  assert.equal(snapshot.knowledge.assertions.find((item) =>
    item.predicate === "dining.choice_place" && item.status === "active").objectEntityId,
  changed.placeId);
});

test(`repeated dining corrections resolve the active evidence after restart (${backend})`, async (t) => {
  const { service, reopenStore } = await fixture(t, backend);
  await imported(service, "first", "성수국수집", "성수");
  await imported(service, "second", "성수밥집", "성수");
  const created = await service.createDiningScenario({ commandId: "create-repeat",
    activityId: "repeat-dinner", confirmed: true, importIds: ["first", "second"],
    scheduledAt: "2026-09-27T19:00:00+09:00", area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-repeat" });
  const board = await service.getBoard("repeat-dinner");
  const firstId = board.tasks[0].readiness.inputs.candidates[0].id;
  await service.selectDiningPlace({ commandId: "select-repeat", activityId: "repeat-dinner",
    expectedRevision: board.revision, candidateId: firstId });
  const initial = await service.getEditableDiningSelection("repeat-dinner");
  const secondId = initial.candidates.find((item) => item.id !== firstId).id;
  await service.correctDiningPlace({ commandId: "repeat-change-b",
    activityId: "repeat-dinner", expectedGraphFingerprint: initial.graphFingerprint,
    candidateId: secondId, confirmed: true });
  const restarted = reopenStore();
  if (backend === "postgres") await restarted.ready();
  const resumed = createCommonKernelService({ ownerId: "diner", store: restarted });
  const middle = await resumed.getEditableDiningSelection("repeat-dinner");
  assert.equal(middle.candidateId, secondId);
  await resumed.correctDiningPlace({ commandId: "repeat-change-a",
    activityId: "repeat-dinner", expectedGraphFingerprint: middle.graphFingerprint,
    candidateId: firstId, confirmed: true });
  const final = await resumed.getEditableDiningSelection("repeat-dinner");
  assert.equal(final.candidateId, firstId);
  assert.equal(final.revision, 3);
});

}
