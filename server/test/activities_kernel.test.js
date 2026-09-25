import assert from "node:assert/strict";
import test from "node:test";
import { ActivityError, createActivityState, applyActivityCommand, getActivityBoard, validatePlanDraft } from "../src/activities/index.js";

const NOW = "2026-09-25T12:00:00+09:00";
const task = (id, extra = {}) => ({ id, title: id, kind: "action", capabilityId: "generic.perform", ...extra });
const rejects = (fn, code) => assert.throws(fn, (error) => error instanceof ActivityError && error.code === code);
function session(draft = {}, options = {}) {
  let state = createActivityState(); let serial = 0;
  const run = (type, payload = {}, overrides = {}) => {
    const command = { commandId: `cmd-${++serial}`, ownerId: "owner-1", activityId: "activity-1", expectedRevision: state.activities["activity-1"]?.revision ?? 0, type, payload, ...overrides };
    const outcome = applyActivityCommand(state, command, { now: NOW, ...options });
    state = outcome.state; return { ...outcome, command };
  };
  run("activity.create", { title: "Mixed activity", planDraft: draft });
  return { run, get state() { return state; }, get board() { return getActivityBoard(state, "activity-1"); } };
}
const linkedPlan = () => ({
  tasks: [task("observe", { kind: "observation", outputSchema: { type: "object", properties: { missing: { type: "array", items: { type: "string" } } }, required: ["missing"] } }), task("shop", { inputSchema: { type: "object", properties: { list: { type: "array" } }, required: ["list"] } })],
  dependencyLinks: [{ id: "after-observe", fromTaskId: "observe", toTaskId: "shop" }],
  dataBindings: [{ id: "missing-list", sourceTaskId: "observe", targetTaskId: "shop", inputKey: "list", outputKey: "missing" }],
});

test("serializable state preserves stable task ids and does not mutate prior state", () => {
  const initial = createActivityState();
  const command = { commandId: "create", ownerId: "owner-1", activityId: "a", expectedRevision: 0, type: "activity.create", payload: { planDraft: { tasks: [task("b"), task("a")] } } };
  const { state } = applyActivityCommand(initial, command, { now: NOW });
  assert.deepEqual(initial, createActivityState());
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.deepEqual(getActivityBoard(state, "a").tasks.map(({ id }) => id), ["b", "a"]);
});

test("validates cycles across both dependency and data edges and dangling endpoints", () => {
  rejects(() => validatePlanDraft({ tasks: [task("a"), task("b")], dependencyLinks: [{ id: "ab", fromTaskId: "a", toTaskId: "b" }], dataBindings: [{ id: "ba", sourceTaskId: "b", targetTaskId: "a", inputKey: "x" }] }), "INVALID_PLAN");
  rejects(() => validatePlanDraft({ tasks: [task("a")], dependencyLinks: [{ id: "dangling", fromTaskId: "a", toTaskId: "missing" }] }), "INVALID_PLAN");
});

test("rejects duplicate stable ids, unregistered capabilities and incompatible binding types", () => {
  rejects(() => validatePlanDraft({ tasks: [task("a"), task("a")] }), "INVALID_PLAN");
  rejects(() => validatePlanDraft({ tasks: [task("a")] }, { capabilities: {} }), "INVALID_PLAN");
  rejects(() => validatePlanDraft({ tasks: [task("a", { outputSchema: { type: "string" } }), task("b", { inputSchema: { type: "object", properties: { x: { type: "number" } } } })], dataBindings: [{ id: "bad", sourceTaskId: "a", targetTaskId: "b", inputKey: "x" }] }), "INVALID_PLAN");
});

test("plan completion policies cannot mark unfinished required tasks complete", () => {
  for (const allowedTerminalStatuses of [[], ["not_started"], ["in_progress"], ["waiting"], ["completed", "not_started"]]) {
    rejects(() => validatePlanDraft({ tasks: [task("a", { completionPolicy: { allowedTerminalStatuses } })] }), "INVALID_PLAN");
  }
  const s = session({ tasks: [task("a", { completionPolicy: { allowedTerminalStatuses: ["completed", "skipped"] } })] });
  rejects(() => s.run("activity.complete", { goalConfirmed: true }), "TASK_BLOCKED");
  s.run("task.transition", { taskId: "a", to: "skipped" });
  s.run("activity.complete", { goalConfirmed: true });
  assert.equal(s.board.lifecycle, "completed");
});

test("bindings must name declared source outputs and target inputs", () => {
  const source = task("source", { outputSchema: { type: "object", properties: { result: { type: "string" } } } });
  const target = task("target", { inputSchema: { type: "object", properties: { selected: { type: "string" } } } });
  const binding = { id: "bound", sourceTaskId: "source", targetTaskId: "target", outputKey: "result", inputKey: "selected" };
  assert.equal(validatePlanDraft({ tasks: [source, target], dataBindings: [binding] }).valid, true);
  rejects(() => validatePlanDraft({ tasks: [source, target], dataBindings: [{ ...binding, outputKey: "absent" }] }), "INVALID_PLAN");
  rejects(() => validatePlanDraft({ tasks: [source, target], dataBindings: [{ ...binding, inputKey: "absent" }] }), "INVALID_PLAN");
});

test("activity revisions reject stale commands atomically", () => {
  const s = session({ tasks: [task("a")] }); const before = JSON.stringify(s.state);
  rejects(() => s.run("task.transition", { taskId: "a", to: "completed" }, { expectedRevision: 0 }), "REVISION_CONFLICT");
  assert.equal(JSON.stringify(s.state), before);
});

test("command receipts replay identical payload despite old expected revision and reject changed content", () => {
  const s = session({ tasks: [task("a")] });
  const first = s.run("task.transition", { taskId: "a", to: "completed" });
  const replay = applyActivityCommand(s.state, JSON.parse(JSON.stringify(first.command)), { now: NOW });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.result, first.result);
  assert.equal(replay.state.events.length, s.state.events.length);
  rejects(() => applyActivityCommand(s.state, { ...first.command, payload: { taskId: "a", to: "skipped" } }), "COMMAND_CONFLICT");
});

test("ownership is checked on mutations and scoped reads", () => {
  const s = session({ tasks: [task("a")] });
  rejects(() => s.run("task.transition", { taskId: "a", to: "completed" }, { ownerId: "owner-2" }), "FORBIDDEN");
  rejects(() => getActivityBoard(s.state, "activity-1", { ownerId: "owner-2" }), "FORBIDDEN");
});

test("skipped predecessor does not satisfy a completion dependency", () => {
  const s = session(linkedPlan());
  s.run("task.transition", { taskId: "observe", to: "skipped" });
  rejects(() => s.run("task.transition", { taskId: "shop", to: "in_progress" }), "TASK_BLOCKED");
  assert.equal(s.board.tasks[1].readiness.status, "blocked");
});

test("output schema is enforced and blocked transition leaves no result behind", () => {
  const s = session(linkedPlan()); const before = JSON.stringify(s.state);
  rejects(() => s.run("task.transition", { taskId: "observe", to: "completed", output: { missing: "tofu" } }), "INVALID_OUTPUT");
  assert.equal(JSON.stringify(s.state), before);
  rejects(() => s.run("task.transition", { taskId: "observe", to: "completed" }), "INVALID_OUTPUT");
});

test("inline task output cannot be recorded by a non-completion transition", () => {
  const s = session({ tasks: [task("a", { outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] } })] });
  const before = JSON.stringify(s.state);
  for (const to of ["in_progress", "waiting", "skipped", "canceled"]) {
    rejects(() => s.run("task.transition", { taskId: "a", to, output: { answer: "injected" } }), "INVALID_TRANSITION");
    assert.equal(JSON.stringify(s.state), before);
  }
  s.run("task.transition", { taskId: "a", to: "completed", output: { answer: "confirmed" } });
  assert.equal(s.board.tasks[0].latestOutputRef !== null, true);
});

test("result versions are immutable and running consumers preserve exact consumed results", () => {
  const s = session(linkedPlan());
  s.run("task.transition", { taskId: "observe", to: "completed", output: { missing: ["tofu"] } });
  assert.deepEqual(s.board.tasks[1].readiness.inputs.list, ["tofu"]);
  s.run("task.transition", { taskId: "shop", to: "in_progress" });
  const consumed = s.board.tasks[1].consumedBindings[0].resultId;
  s.run("task.recordResult", { taskId: "observe", value: { missing: ["mushroom"] } });
  assert.equal(s.board.tasks[1].consumedBindings[0].resultId, consumed);
  assert.deepEqual(s.state.activities["activity-1"].results.find(({ id }) => id === consumed).value, { missing: ["tofu"] });
  assert.equal(s.board.tasks[1].readiness.status, "needs_review");
  rejects(() => s.run("task.transition", { taskId: "shop", to: "completed" }), "TASK_BLOCKED");
});

test("unstarted consumers pick up latest source result without rewriting history", () => {
  const s = session(linkedPlan());
  s.run("task.transition", { taskId: "observe", to: "completed", output: { missing: ["tofu"] } });
  s.run("task.recordResult", { taskId: "observe", value: { missing: [] } });
  s.run("task.transition", { taskId: "shop", to: "in_progress" });
  assert.deepEqual(s.board.tasks[1].readiness.inputs.list, []);
  assert.equal(s.board.tasks[0].resultHistoryRefs.length, 2);
});

test("completed tasks cannot be reset and patches retain stable ids", () => {
  const s = session({ tasks: [task("done"), task("pending")] });
  s.run("task.transition", { taskId: "done", to: "completed" });
  rejects(() => s.run("task.transition", { taskId: "done", to: "not_started" }), "INVALID_TRANSITION");
  s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "updateTaskInput", taskId: "pending", inputs: { quantity: 2 } }, { type: "addTask", task: task("additional", { supersedesTaskId: "done" }) }] });
  assert.equal(s.board.tasks[0].executionStatus, "completed");
  assert.equal(s.board.tasks[1].id, "pending");
  assert.equal(s.board.currentPlanRevision, 2);
});

test("patch validation is atomic when its final graph contains a cycle", () => {
  const s = session({ tasks: [task("a"), task("b")] }); const before = JSON.stringify(s.state);
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "updateTaskInput", taskId: "a", inputs: { x: 1 } }, { type: "addDependency", dependency: { id: "ab", fromTaskId: "a", toTaskId: "b" } }, { type: "addDependency", dependency: { id: "ba", fromTaskId: "b", toTaskId: "a" } }] }), "INVALID_PLAN");
  assert.equal(JSON.stringify(s.state), before);
});

test("patch checks plan, task, knowledge versions and protects pinned input", () => {
  const s = session({ tasks: [task("a", { inputBindings: { color: "black" }, pinnedFields: ["color"] })] });
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 0, operations: [] }), "REVISION_CONFLICT");
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 1, expectedTaskRevisions: { a: 0 }, operations: [] }), "REVISION_CONFLICT");
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 1, expectedKnowledgeDependencies: ["fact-1"], operations: [] }), "INVALID_PLAN");
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "updateTaskInput", taskId: "a", inputs: { color: "blue" } }] }), "PROTECTED_FIELD");
});

test("patch dependency validator receives the owning activity ID", () => {
  const calls = [];
  const s = session({ tasks: [task("a")] }, { validateKnowledgeDependencies: (dependencies, activityId) => {
    calls.push({ dependencies, activityId });
    return true;
  } });
  s.run("plan.applyPatch", { basePlanRevision: 1, expectedKnowledgeDependencies: ["fact-1"], operations: [] });
  assert.deepEqual(calls, [{ dependencies: ["fact-1"], activityId: "activity-1" }]);
});

test("activity and reminder timestamps reject impossible dates and unsupported precision", () => {
  for (const now of ["2026-02-30T12:00:00Z", "2026-02-29T12:00:00Z", "2026-09-25T12:00:00+15:00", "2026-09-25T12:00:00.1234Z"]) {
    rejects(() => applyActivityCommand(createActivityState(), {
      commandId: "create", ownerId: "owner-1", activityId: "a", expectedRevision: 0,
      type: "activity.create", payload: { planDraft: { tasks: [] } },
    }, { now }), "INVALID_INPUT");
  }
  const s = session({ tasks: [task("a")] });
  rejects(() => s.run("reminder.schedule", { id: "bad", taskId: "a", dueAt: "2026-02-30T12:00:00Z", timeZone: "Asia/Seoul" }), "INVALID_INPUT");
  s.run("reminder.schedule", { id: "leap", taskId: "a", dueAt: "2024-02-29T12:00:00Z", timeZone: "Asia/Seoul" });
  assert.equal(s.board.reminders[0].id, "leap");
});

test("user artifact edits are preserved from subsequent generated replacements", () => {
  const s = session({ tasks: [task("a")], artifacts: [{ id: "outfit", data: { shoes: "white", coat: "black" } }] });
  s.run("artifact.update", { artifactId: "outfit", data: { shoes: "brown" }, expectedArtifactRevision: 1 });
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "replaceArtifact", artifactId: "outfit", data: { shoes: "white" } }] }), "PROTECTED_FIELD");
  s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "replaceArtifact", artifactId: "outfit", data: { coat: "gray" } }] });
  assert.deepEqual(s.board.artifacts[0].data, { shoes: "brown", coat: "gray" });
  assert.equal(s.board.artifacts[0].history.length, 2);
});

test("cancelled semantic task cannot immediately reappear under a new id", () => {
  const s = session({ tasks: [task("reserve", { semanticKey: "reserve-dinner" })] });
  s.run("task.transition", { taskId: "reserve", to: "canceled" });
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "addTask", task: task("reserve-2", { semanticKey: "reserve-dinner" }) }] }), "INVALID_PLAN");
});

test("source input/dependency history cannot be rewritten after a task starts", () => {
  const s = session({ tasks: [task("a"), task("b")] });
  s.run("task.transition", { taskId: "b", to: "in_progress" });
  rejects(() => s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "addDependency", dependency: { id: "ab", fromTaskId: "a", toTaskId: "b" } }] }), "INVALID_TRANSITION");
});

test("initial draft may populate an empty activity but cannot replace a live plan", () => {
  const s = session();
  s.run("plan.applyDraft", { draft: { tasks: [task("a")] } });
  rejects(() => s.run("plan.applyDraft", { draft: { tasks: [task("b")] } }), "INVALID_TRANSITION");
});

test("activity completion requires required task outcomes and explicit goal confirmation", () => {
  const s = session({ tasks: [task("a")] });
  rejects(() => s.run("activity.complete", { goalConfirmed: true }), "TASK_BLOCKED");
  s.run("task.transition", { taskId: "a", to: "completed" });
  rejects(() => s.run("activity.complete"), "INVALID_TRANSITION");
  s.run("activity.complete", { goalConfirmed: true });
  assert.equal(s.board.lifecycle, "completed");
});

test("external confirmation cannot be synthesized by checking a task", () => {
  const s = session({ tasks: [task("reserve", { completionPolicy: { requiresExternalConfirmation: true } })] });
  rejects(() => s.run("task.transition", { taskId: "reserve", to: "completed" }), "INVALID_TRANSITION");
});

test("recurrence materializes an occurrence once and keeps separate dates independent", () => {
  let state = createActivityState(); let serial = 0;
  const run = (type, payload, expectedRevision = 1, activityId) => {
    const command = { commandId: `r-${++serial}`, ownerId: "owner-1", type, payload, expectedRevision, ...(activityId ? { activityId } : {}) };
    const outcome = applyActivityCommand(state, command, { now: NOW }); state = outcome.state; return outcome.result;
  };
  run("recurrence.create", { id: "night", title: "Night routine", rule: "FREQ=DAILY", timeZone: "Asia/Seoul", planDraft: { tasks: [task("routine")] } }, 0);
  const first = run("recurrence.materialize", { recurrenceId: "night", occurrenceKey: "2026-09-25", scheduledAt: "2026-09-25T22:00:00+09:00" });
  const repeated = run("recurrence.materialize", { recurrenceId: "night", occurrenceKey: "2026-09-25", scheduledAt: "2026-09-25T22:00:00+09:00" });
  assert.equal(first.activityId, repeated.activityId); assert.equal(Object.keys(state.activities).length, 1);
  const second = run("recurrence.materialize", { recurrenceId: "night", occurrenceKey: "2026-09-26", scheduledAt: "2026-09-26T22:00:00+09:00" });
  run("task.transition", { taskId: "routine", to: "completed" }, 1, first.activityId);
  run("activity.complete", { goalConfirmed: true }, 2, first.activityId);
  assert.equal(state.occurrences[first.occurrenceId].status, "completed");
  assert.equal(state.activities[second.activityId].tasks[0].executionStatus, "not_started");
  assert.equal(state.recurrences.night.templateVersion, 1);
});

test("reminder occurrence ownership, due time, revisions and delivery are separate from task completion", () => {
  const s = session({ tasks: [task("a")] });
  rejects(() => s.run("reminder.schedule", { id: "wrong", taskId: "a", occurrenceId: "foreign", dueAt: NOW, timeZone: "Asia/Seoul" }), "INVALID_INPUT");
  s.run("reminder.schedule", { id: "future", taskId: "a", dueAt: "2026-09-26T12:00:00+09:00", timeZone: "Asia/Seoul" });
  rejects(() => s.run("reminder.transition", { reminderId: "future", expectedReminderRevision: 1, to: "delivering" }), "INVALID_TRANSITION");
  s.run("reminder.schedule", { id: "now", taskId: "a", dueAt: NOW, timeZone: "Asia/Seoul" });
  s.run("reminder.transition", { reminderId: "now", expectedReminderRevision: 1, to: "delivering" });
  s.run("reminder.transition", { reminderId: "now", expectedReminderRevision: 2, to: "delivered" });
  assert.equal(s.board.tasks[0].executionStatus, "not_started");
  assert.equal(s.state.reminders.now.deliveryAttempts, 1);
  s.run("task.transition", { taskId: "a", to: "completed" });
  s.run("activity.complete", { goalConfirmed: true });
  assert.equal(s.state.reminders.future.status, "canceled");
});

test("reminder with stale task revision cannot deliver", () => {
  const s = session({ tasks: [task("a")] });
  s.run("reminder.schedule", { id: "now", taskId: "a", dueAt: NOW, timeZone: "Asia/Seoul" });
  s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "updateTaskInput", taskId: "a", inputs: { at: "tomorrow" } }] });
  rejects(() => s.run("reminder.transition", { reminderId: "now", expectedReminderRevision: 1, to: "delivering" }), "REVISION_CONFLICT");
});

test("non-JSON data and unsafe identifiers are rejected", () => {
  rejects(() => validatePlanDraft({ tasks: [task("a", { count: Infinity })] }), "INVALID_INPUT");
  rejects(() => validatePlanDraft({ tasks: [task("__proto__")] }), "INVALID_INPUT");
});

test("review explicitly preserves consumed values and lets the user finish the original action", () => {
  const s = session(linkedPlan());
  s.run("task.transition", { taskId: "observe", to: "completed", output: { missing: ["tofu"] } });
  s.run("task.transition", { taskId: "shop", to: "waiting" });
  s.run("task.transition", { taskId: "shop", to: "in_progress" });
  s.run("task.recordResult", { taskId: "observe", value: { missing: ["mushroom"] } });
  assert.equal(s.board.tasks[1].needsReview, true);
  s.run("task.resolveReview", { taskId: "shop", resolution: "keep_consumed", note: "Already bought the originally requested tofu" });
  assert.deepEqual(s.board.tasks[1].readiness.inputs.list, ["tofu"]);
  s.run("task.transition", { taskId: "shop", to: "completed" });
  assert.equal(s.board.tasks[1].reviewHistory.length, 1);
});

test("conditional dependency output is versioned even without a data binding", () => {
  const s = session({ tasks: [task("choice", { outputSchema: { type: "object", properties: { go: { type: "boolean" } } } }), task("reserve")], dependencyLinks: [{ id: "chosen", fromTaskId: "choice", toTaskId: "reserve", when: { field: "go", operator: "equals", value: true } }] });
  s.run("task.transition", { taskId: "choice", to: "completed", output: { go: true } });
  s.run("task.transition", { taskId: "reserve", to: "in_progress" });
  s.run("task.recordResult", { taskId: "choice", value: { go: false } });
  assert.equal(s.board.tasks[1].needsReview, true);
  s.run("task.resolveReview", { taskId: "reserve", resolution: "keep_consumed" });
  assert.equal(s.board.tasks[1].readiness.status, "ready");
});

test("a delivered reminder can reconcile after its activity has completed", () => {
  const s = session({ tasks: [task("a")] });
  s.run("reminder.schedule", { id: "now", taskId: "a", dueAt: NOW, timeZone: "Asia/Seoul" });
  s.run("reminder.transition", { reminderId: "now", expectedReminderRevision: 1, to: "delivering" });
  s.run("task.transition", { taskId: "a", to: "completed" });
  s.run("activity.complete", { goalConfirmed: true });
  s.run("reminder.transition", { reminderId: "now", expectedReminderRevision: 2, to: "delivered" });
  assert.equal(s.state.reminders.now.status, "delivered");
});

test("rescheduling invalidates the old timer but preserves reminder identity", () => {
  const s = session({ tasks: [task("a")] });
  s.run("reminder.schedule", { id: "now", taskId: "a", dueAt: NOW, timeZone: "Asia/Seoul" });
  s.run("reminder.reschedule", { reminderId: "now", expectedReminderRevision: 1, dueAt: "2026-09-26T12:00:00+09:00" });
  rejects(() => s.run("reminder.transition", { reminderId: "now", expectedReminderRevision: 1, to: "delivering" }), "REVISION_CONFLICT");
  assert.deepEqual(s.board.reminderRefs, ["now"]);
});

test("plan revisions retain their original task inputs", () => {
  const s = session({ tasks: [task("a", { inputBindings: { servings: 2 } })] });
  s.run("plan.applyPatch", { basePlanRevision: 1, operations: [{ type: "updateTaskInput", taskId: "a", inputs: { servings: 4 } }] });
  assert.equal(s.board.planHistory[0].taskSpecs[0].inputBindings.servings, 2);
  assert.equal(s.board.planHistory[1].taskSpecs[0].inputBindings.servings, 4);
});

test("domain hook rejection cannot silently approve tasks or outputs", () => {
  rejects(() => validatePlanDraft({ tasks: [task("a")] }, { validateTask: () => false }), "INVALID_PLAN");
  const s = session({ tasks: [task("a")] }, { validateOutput: () => false });
  rejects(() => s.run("task.transition", { taskId: "a", to: "completed", output: {} }), "INVALID_OUTPUT");
});
