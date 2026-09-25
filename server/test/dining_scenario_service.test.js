import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { makeFiling, makeTag, makeValidAnalysis } from "./fixtures.js";

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-dining-scenario-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = createJsonStateStore({ filePath: join(folder, "state.json"),
    initialState: createCommonKernelState });
  return { store, service: createCommonKernelService({ ownerId: "diner", store }) };
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

test("reviewed restaurant images form branch-safe candidates and a user-confirmed visit", async (t) => {
  const { service, store } = await fixture(t);
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
  const candidates = board.tasks.find((item) => item.id === "select_place").readiness.inputs.candidates;
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.find((item) => item.name === "모퉁이식당 성수점").importIds, ["a", "c"]);
  assert.ok(candidates.every((item) => !item.importIds.includes("b")));
  const selected = await service.selectDiningPlace({ commandId: "choose-dinner", activityId: "dinner-one",
    expectedRevision: board.revision, candidateId: candidates[0].id });
  assert.equal(selected.replayed, false);
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

test("unconfirmed visit creates no visited assertion and direct task bypass is rejected", async (t) => {
  const { service, store } = await fixture(t);
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

test("deleting a captured source redacts the derived board and tombstones retries", async (t) => {
  const { service, store } = await fixture(t);
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
