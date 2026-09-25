import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

const OWNER = "regression-owner";
const OBSERVED_AT = "2026-09-25T12:00:00Z";

async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), "luffi-kernel-regression-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState });
  const service = createCommonKernelService({ store, ownerId: OWNER });
  return {
    store,
    filePath,
    service,
    restart: () => createCommonKernelService({
      ownerId: OWNER,
      store: createJsonStateStore({ filePath, initialState: createCommonKernelState }),
    }),
  };
}

function scaleTask() {
  return {
    id: "scale", kind: "action", capabilityId: "recipe.scale_servings",
    inputBindings: {
      recipe: {
        id: "tofu-recipe", revision: 1, title: "두부 한 접시", baseServings: 2,
        ingredients: [{ id: "tofu-required", ingredientId: "tofu", name: "두부",
          quantity: { status: "known", amount: 300, unit: "g" }, scaling: "linear", optional: false }],
      },
      targetServings: 4,
    },
  };
}

function confirmationTask() {
  return {
    id: "confirm", kind: "observation", capabilityId: "dining.confirm_reservation",
    // Valid inputs ensure a missing-output rejection is not merely a blocked task.
    inputBindings: { reservationId: "reservation", placeId: "restaurant" },
  };
}

async function createActivity(service, tasks, { activityId = "board", contextId } = {}) {
  return service.activityCommand({
    commandId: `create-${activityId}`, type: "activity.create", activityId,
    expectedRevision: 0,
    ...(contextId ? { contextId } : {}),
    payload: {
      title: "회귀 검증 활동", goal: { description: "저장한 정보에 맞게 준비하기" },
      planDraft: { tasks, dependencyLinks: [], dataBindings: [], artifacts: [] },
    },
  });
}

async function addEvidence(service) {
  await service.knowledgeCommand({ commandId: "create-proof-source", type: "source.create",
    payload: { id: "proof-source", kind: "message" } });
  await service.knowledgeCommand({ commandId: "create-proof-version", type: "source.version.add",
    payload: { id: "proof-version", sourceId: "proof-source", contentHash: "proof-hash" } });
  await service.knowledgeCommand({ commandId: "create-proof-evidence", type: "evidence.add",
    payload: { id: "proof", sourceVersionId: "proof-version", locator: { line: 1 }, quote: "예약이 변경됨" } });
}

const reservationQuery = {
  subjectId: "reservation", predicate: "dining.reservation_status",
  scope: { type: "activity", id: "board" },
};

async function createReservation(service) {
  await service.knowledgeCommand({ commandId: "create-reservation", type: "entity.create",
    payload: { id: "reservation", type: "dining.reservation", label: "저녁 약속" } });
}

async function addCancellation(service) {
  await addEvidence(service);
  await service.knowledgeCommand({ commandId: "reservation-cancelled", type: "assertion.add",
    payload: {
      id: "cancelled", subjectId: reservationQuery.subjectId, predicate: reservationQuery.predicate,
      scope: reservationQuery.scope,
      typedValue: { type: "dining.reservation_status", value: "cancelled" },
      evidenceIds: ["proof"], origin: "user_reported",
      assertedBy: { type: "user", id: OWNER }, observedAt: OBSERVED_AT,
    },
  });
}

function isCode(...codes) {
  return (error) => codes.includes(error?.code);
}

test("regression: dining confirmation cannot complete without a validated result", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, [confirmationTask()]);
  const board = await service.getBoard("board");
  assert.equal(board.tasks[0].readiness.status, "ready");
  const before = await store.snapshot();

  await assert.rejects(service.activityCommand({
    commandId: "complete-without-proof", type: "task.transition", activityId: "board",
    expectedRevision: board.revision, payload: { taskId: "confirm", to: "completed" },
  }), isCode("INVALID_OUTPUT", "INVALID_TRANSITION"));

  assert.deepEqual(await store.snapshot(), before, "Rejected completion must not write results, events, or receipts");
  assert.equal((await service.getBoard("board")).tasks[0].executionStatus, "not_started");
});

test("regression: a changed watched knowledge context blocks deterministic runTask", async (t) => {
  const { service, store } = await fixture(t);
  await createReservation(service);
  const context = await service.createContext({ queries: [reservationQuery] });
  // The same outing contains meal preparation and a restaurant reservation.
  await createActivity(service, [scaleTask()], { contextId: context.contextId });
  await addCancellation(service);
  const board = await service.getBoard("board");
  assert.equal(board.revision, 1, "Knowledge changes do not inherently change the Activity revision");
  assert.ok(board.pendingChanges.length > 0, "The change must have reached the board's watch");
  const before = await store.snapshot();

  await assert.rejects(service.runTask({
    activityId: "board", taskId: "scale", commandId: "run-stale", expectedRevision: board.revision,
  }), isCode("CONTEXT_STALE", "TASK_BLOCKED"));

  assert.deepEqual(await store.snapshot(), before, "Stale execution must leave the task, results, and receipts unchanged");
});

test("regression: a context from an old Activity revision cannot create a fresh proposal", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, [scaleTask()]);
  const context = await service.createContext({ activityId: "board", queries: [] });
  assert.equal(context.activityRevision, 1);
  await service.activityCommand({
    commandId: "change-servings", type: "plan.applyPatch", activityId: "board", expectedRevision: 1,
    payload: { basePlanRevision: 1,
      operations: [{ type: "updateTaskInput", taskId: "scale", inputs: { targetServings: 6 } }] },
  });
  const current = await service.getBoard("board");
  assert.equal(current.revision, 2);
  const before = await store.snapshot();

  await assert.rejects(service.proposePlan({
    activityId: "board", contextId: context.contextId, kind: "patch",
    // A fresh patch base must not launder the older context's captured task state.
    plan: { basePlanRevision: current.currentPlanRevision,
      operations: [{ type: "addTask", task: { ...scaleTask(), id: "old-context-follow-up" } }] },
  }), isCode("CONTEXT_STALE", "REVISION_CONFLICT"));

  assert.deepEqual(await store.snapshot(), before, "No pending proposal may be created from obsolete activity state");
});

test("regression: recording the same result replays after deletion of its cited source", async (t) => {
  const { service, store, restart, filePath } = await fixture(t);
  await addEvidence(service);
  await createActivity(service, [confirmationTask()]);
  const command = {
    commandId: "record-confirmation", type: "task.recordResult", activityId: "board", expectedRevision: 1,
    payload: { taskId: "confirm", evidenceRefs: ["proof"], value: {
      reservationId: "reservation", placeId: "restaurant", status: "confirmed",
      confirmationReference: "confirmation-reference", confirmedAt: OBSERVED_AT, evidenceIds: ["proof"],
    } },
  };
  const first = await service.activityCommand(command);
  await service.knowledgeCommand({ commandId: "delete-proof", type: "source.delete",
    payload: { sourceId: "proof-source" } });
  const afterDeletion = await store.snapshot();
  assert.equal(afterDeletion.knowledge.evidence.find((item) => item.id === "proof").status, "deleted");

  // Reload the durable store so this proves persisted idempotency, not an in-memory shortcut.
  const restored = restart();
  const replay = await restored.activityCommand(command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.resultId, first.resultId);
  assert.equal(replay.revision, first.revision);
  const restoredBoard = await restored.getBoard("board");
  assert.equal(restoredBoard.results.length, 1);
  assert.equal(restoredBoard.revision, first.revision);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), afterDeletion,
    "Replay must return the stored receipt without reapplying or revalidating deleted evidence");
});

test("regression: a missing runTask commandId is rejected without changing state", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, [scaleTask()]);
  const before = await store.snapshot();

  await assert.rejects(service.runTask({ activityId: "board", taskId: "scale", expectedRevision: 1 }),
    (error) => ["INVALID_REQUEST", "INVALID_INPUT"].includes(error?.code) && error.httpStatus === 400);

  assert.deepEqual(await store.snapshot(), before, "A missing idempotency key must not create undefined:* result/command ids");
});

test("regression: a new matching entity invalidates a context produced from an empty search", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, []);
  const retrievalQuery = { text: "두부", typeIds: ["recipe.ingredient"], maxHops: 0 };
  const empty = await service.searchKnowledge(retrievalQuery);
  assert.deepEqual(empty.candidates, []);
  const context = await service.createContext({ queries: [], activityId: "board", retrievalQuery });

  await service.knowledgeCommand({ commandId: "new-tofu", type: "entity.create",
    payload: { id: "new-tofu", type: "recipe.ingredient", label: "두부" } });
  const found = await service.searchKnowledge(retrievalQuery);
  assert.ok(found.candidates.some((candidate) => candidate.entityId === "new-tofu"));
  const before = await store.snapshot();

  await assert.rejects(service.proposePlan({
    activityId: "board", contextId: context.contextId, kind: "draft", plan: { tasks: [] },
  }), isCode("CONTEXT_STALE"));

  assert.deepEqual(await store.snapshot(), before, "A negative discovery result must not remain valid after the catalog changes");
});
