import { createHash } from "node:crypto";

const KINDS = new Set(["observation", "decision", "action", "wait", "milestone"]);
const TERMINAL = new Set(["completed", "skipped", "canceled"]);
const TRANSITIONS = {
  not_started: ["in_progress", "waiting", "completed", "skipped", "canceled"],
  in_progress: ["waiting", "completed", "skipped", "canceled"],
  waiting: ["in_progress", "completed", "skipped", "canceled"],
  completed: [], skipped: [], canceled: [],
};

export class ActivityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ActivityError";
    this.code = code;
    this.details = details;
    this.httpStatus = code === "FORBIDDEN" ? 403 : ["REVISION_CONFLICT", "COMMAND_CONFLICT", "INVALID_TRANSITION", "TASK_BLOCKED", "PROTECTED_FIELD"].includes(code) ? 409 : code === "NOT_FOUND" ? 404 : 400;
  }
}
const fail = (code, message, details) => { throw new ActivityError(code, message, details); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function id(value, label = "id") {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || ["__proto__", "prototype", "constructor"].includes(value)) fail("INVALID_INPUT", `${label} must be a non-empty safe string`);
  return value;
}
function json(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("INVALID_INPUT", `${path} must be JSON serializable`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) fail("INVALID_INPUT", `${path} has an unsafe key`);
    json(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function timestamp(value, label) {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_INPUT", `${label} must be an ISO timestamp with timezone`);
  return value;
}
function zone(value) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); } catch { fail("INVALID_INPUT", "Invalid timeZone"); }
  return id(value, "timeZone");
}
function revision(actual, expected, label) {
  if (!Number.isInteger(expected) || expected !== actual) fail("REVISION_CONFLICT", `${label} revision changed`, { expected, actual });
}
function unique(items, label) {
  const seen = new Set();
  for (const item of items) {
    id(item.id, `${label}.id`);
    if (seen.has(item.id)) fail("INVALID_PLAN", `Duplicate ${label} id: ${item.id}`);
    seen.add(item.id);
  }
}
function array(value, label) {
  if (!Array.isArray(value)) fail("INVALID_INPUT", `${label} must be an array`);
  return value;
}
function lookup(list, target, label) {
  const item = list.find((entry) => entry.id === target);
  if (!item) fail("NOT_FOUND", `${label} not found: ${target}`);
  return item;
}
function validateHook(callback, args, code, message) {
  if (!callback) return;
  const outcome = callback(...args);
  if (outcome && typeof outcome.then === "function") fail("INVALID_INPUT", "Kernel validators must be synchronous");
  if (outcome === false) fail(code, message);
}
function registered(registry, key, version, label) {
  if (!registry) return;
  const found = registry instanceof Map ? registry.get(key) : registry[key];
  if (!found || (found.version && found.version !== version)) fail("INVALID_PLAN", `Unknown ${label}: ${key}@${version}`);
}

/** Small JSON-schema subset for kernel values; domain validators may impose stricter rules. */
function validateValue(value, schema, path = "output") {
  if (!schema) return;
  if (schema.enum && !schema.enum.some((entry) => canonical(entry) === canonical(value))) fail("INVALID_OUTPUT", `${path} is not an allowed value`);
  const type = schema.type;
  const matches = type === undefined || (type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : type === "integer" ? Number.isInteger(value) : typeof value === type);
  if (!matches) fail("INVALID_OUTPUT", `${path} must be ${type}`);
  if (type === "object") {
    for (const key of schema.required ?? []) if (!own(value, key)) fail("INVALID_OUTPUT", `${path}.${key} is required`);
    for (const [key, entry] of Object.entries(value)) {
      if (schema.additionalProperties === false && !own(schema.properties ?? {}, key)) fail("INVALID_OUTPUT", `${path}.${key} is not allowed`);
      if (schema.properties?.[key]) validateValue(entry, schema.properties[key], `${path}.${key}`);
    }
  }
  if (type === "array" && schema.items) value.forEach((entry, i) => validateValue(entry, schema.items, `${path}[${i}]`));
}

function normalizeTask(task, activityId) {
  id(task.id, "task.id");
  id(task.capabilityId, "task.capabilityId");
  if (!KINDS.has(task.kind)) fail("INVALID_PLAN", `Unknown task kind: ${task.kind}`);
  if (task.effectStatus && task.effectStatus !== "pending") fail("INVALID_PLAN", "New tasks cannot claim an external effect");
  if (task.executionStatus && task.executionStatus !== "not_started") fail("INVALID_PLAN", "New tasks must start not_started");
  return {
    ...clone(task), activityId, revision: 1,
    capabilityVersion: task.capabilityVersion ?? 1,
    executionStatus: "not_started", inputBindings: clone(task.inputBindings ?? {}),
    pinnedFields: clone(task.pinnedFields ?? []), userOverrides: clone(task.userOverrides ?? {}),
    latestOutputRef: null, resultHistoryRefs: [], consumedBindings: [], consumedDependencies: [], inputsPinned: false, reviewHistory: [], needsReview: false,
  };
}
function normalizeDraft(draft, activityId) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) fail("INVALID_PLAN", "A plan draft is required");
  return {
    tasks: array(draft.tasks ?? [], "tasks").map((task) => normalizeTask(task, activityId)),
    dependencyLinks: clone(array(draft.dependencyLinks ?? draft.dependencies ?? [], "dependencyLinks")),
    dataBindings: clone(array(draft.dataBindings ?? [], "dataBindings")),
    artifacts: array(draft.artifacts ?? [], "artifacts").map((artifact) => ({ ...clone(artifact), revision: 1, history: [], userOverrides: clone(artifact.userOverrides ?? {}), pinnedFields: clone(artifact.pinnedFields ?? []) })),
  };
}
function validateGraph(plan, options = {}) {
  unique(plan.tasks, "task"); unique(plan.artifacts, "artifact"); unique(plan.dependencyLinks, "dependency"); unique(plan.dataBindings, "binding");
  const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
  const edges = new Map(plan.tasks.map((task) => [task.id, new Set()]));
  for (const task of plan.tasks) {
    if (!KINDS.has(task.kind)) fail("INVALID_PLAN", `Unknown task kind: ${task.kind}`);
    registered(options.capabilities, task.capabilityId, task.capabilityVersion, "capability");
    if (task.rendererKey) registered(options.renderers, task.rendererKey, task.rendererVersion, "renderer");
    validateHook(options.validateTask, [clone(task)], "INVALID_PLAN", "Domain task validation failed");
    if (task.supersedesTaskId && !tasks.has(task.supersedesTaskId)) fail("INVALID_PLAN", "supersedesTaskId must reference an existing task");
  }
  for (const edge of [...plan.dependencyLinks, ...plan.dataBindings]) {
    const from = edge.fromTaskId ?? edge.sourceTaskId;
    const to = edge.toTaskId ?? edge.targetTaskId;
    if (!tasks.has(from) || !tasks.has(to) || from === to) fail("INVALID_PLAN", `Invalid dependency endpoints: ${edge.id}`);
    edges.get(from).add(to);
  }
  for (const edge of [...plan.dependencyLinks, ...plan.dataBindings]) {
    if (edge.acceptedStatuses && (!Array.isArray(edge.acceptedStatuses) || edge.acceptedStatuses.length === 0 || edge.acceptedStatuses.some((status) => !TERMINAL.has(status)))) fail("INVALID_PLAN", "acceptedStatuses must contain terminal task statuses");
    if (edge.when) {
      if (!["equals", "not_equals", "exists"].includes(edge.when.operator) || typeof edge.when.field !== "string") fail("INVALID_PLAN", "Unsupported dependency condition");
    }
  }
  const bindingSlots = new Set();
  for (const binding of plan.dataBindings) {
    id(binding.inputKey, "binding.inputKey");
    const key = `${binding.targetTaskId}:${binding.inputKey}`;
    if (bindingSlots.has(key)) fail("INVALID_PLAN", "Multiple bindings write the same input slot");
    bindingSlots.add(key);
    const source = tasks.get(binding.sourceTaskId);
    const target = tasks.get(binding.targetTaskId);
    const outputSchema = binding.outputKey ? source.outputSchema?.properties?.[binding.outputKey] : source.outputSchema;
    const inputSchema = target.inputSchema?.properties?.[binding.inputKey];
    if (outputSchema?.type && inputSchema?.type && outputSchema.type !== inputSchema.type) fail("INVALID_PLAN", "Binding input/output types are incompatible");
    if (binding.policy && !["latest_until_started", "fixed"].includes(binding.policy)) fail("INVALID_PLAN", "Unknown binding policy");
    if (binding.policy === "fixed" && !binding.resultId) fail("INVALID_PLAN", "Fixed binding requires resultId");
    if (binding.resultId && !(plan.results ?? []).some((result) => result.id === binding.resultId && result.taskId === binding.sourceTaskId)) fail("INVALID_PLAN", "Binding references an unavailable result");
  }
  const visited = new Set(); const visiting = new Set(); const order = [];
  function visit(taskId) {
    if (visiting.has(taskId)) fail("INVALID_PLAN", "Task dependencies contain a cycle");
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const next of edges.get(taskId)) visit(next);
    visiting.delete(taskId); visited.add(taskId); order.push(taskId);
  }
  for (const taskId of tasks.keys()) visit(taskId);
  return order.reverse();
}

export function validatePlanDraft(draft, options = {}) {
  json(draft);
  const normalized = normalizeDraft(draft, options.activityId ?? "draft");
  return { valid: true, topologicalOrder: validateGraph(normalized, options), draft: normalized };
}
export function createActivityState() {
  return { schemaVersion: 1, activities: {}, recurrences: {}, occurrences: {}, reminders: {}, commandReceipts: {}, events: [] };
}
function activityFor(state, activityId, ownerId) {
  id(activityId, "activityId");
  if (!own(state.activities, activityId)) fail("NOT_FOUND", `Activity not found: ${activityId}`);
  const activity = state.activities[activityId];
  if (ownerId !== undefined && activity.ownerId !== ownerId) fail("FORBIDDEN", "Activity belongs to another owner");
  return activity;
}
function taskResult(activity, resultId) { return activity.results.find((entry) => entry.id === resultId); }
function boundResult(activity, binding) {
  const source = lookup(activity.tasks, binding.sourceTaskId, "Task");
  const result = taskResult(activity, binding.resultId ?? source.latestOutputRef);
  if (result && result.taskId !== source.id) fail("INVALID_PLAN", "Binding result belongs to another task");
  return result;
}
function field(value, key) { return key === undefined ? value : value && typeof value === "object" && own(value, key) ? value[key] : undefined; }
function readiness(activity, task) {
  if (task.needsReview) return { status: "needs_review", reasons: ["Inputs or consumed results require review"] };
  const reasons = [];
  for (const edge of activity.dependencyLinks.filter((entry) => entry.toTaskId === task.id)) {
    const source = lookup(activity.tasks, edge.fromTaskId, "Task");
    const consumed = task.consumedDependencies?.find((entry) => entry.dependencyId === edge.id);
    if (!(edge.acceptedStatuses ?? ["completed"]).includes(consumed?.executionStatus ?? source.executionStatus)) reasons.push(`Dependency ${source.id} is not satisfied`);
    if (edge.when) {
      const value = field(taskResult(activity, consumed?.resultId ?? source.latestOutputRef)?.value, edge.when.field);
      const equals = value !== undefined && canonical(value) === canonical(edge.when.value ?? null);
      if (!(edge.when.operator === "exists" ? value !== undefined : edge.when.operator === "equals" ? equals : value !== undefined && !equals)) reasons.push(`Condition ${edge.id} is not satisfied`);
    }
  }
  const inputs = { ...task.inputBindings };
  for (const binding of activity.dataBindings.filter((entry) => entry.targetTaskId === task.id)) {
    const consumed = task.consumedBindings.find((entry) => entry.bindingId === binding.id);
    const result = consumed ? taskResult(activity, consumed.resultId) : boundResult(activity, binding);
    const source = lookup(activity.tasks, binding.sourceTaskId, "Task");
    if (!(binding.acceptedStatuses ?? ["completed"]).includes(source.executionStatus)) reasons.push(`Source ${source.id} is not complete`);
    const value = field(result?.value, binding.outputKey);
    if (value === undefined) reasons.push(`Input ${binding.inputKey} is missing`);
    else inputs[binding.inputKey] = value;
  }
  for (const key of task.requiredInputs ?? task.inputSchema?.required ?? []) if (!own(inputs, key)) reasons.push(`Input ${key} is missing`);
  if (!reasons.length && task.inputSchema) {
    try { validateValue(inputs, task.inputSchema, "input"); } catch (error) { reasons.push(error.message); }
  }
  return { status: reasons.length ? "blocked" : "ready", reasons, inputs };
}
function pinInputs(activity, task) {
  if (task.inputsPinned) return;
  task.inputsPinned = true;
  task.consumedDependencies = activity.dependencyLinks.filter((edge) => edge.toTaskId === task.id).map((edge) => {
    const source = lookup(activity.tasks, edge.fromTaskId, "Task");
    return { dependencyId: edge.id, sourceTaskId: source.id, executionStatus: source.executionStatus, resultId: source.latestOutputRef };
  });
  task.consumedBindings = activity.dataBindings.filter((binding) => binding.targetTaskId === task.id).map((binding) => ({ bindingId: binding.id, sourceTaskId: binding.sourceTaskId, resultId: boundResult(activity, binding).id, inputKey: binding.inputKey }));
}
function planSnapshot(activity, reasons = []) {
  activity.currentPlanRevision += 1;
  activity.planHistory.push({ revision: activity.currentPlanRevision, taskIds: activity.tasks.map((task) => task.id), taskSpecs: clone(activity.tasks), dependencyLinks: clone(activity.dependencyLinks), dataBindings: clone(activity.dataBindings), artifactRevisions: activity.artifacts.map(({ id: artifactId, revision: artifactRevision }) => ({ id: artifactId, revision: artifactRevision })), reasons: clone(reasons) });
}
function createActivity(state, activityId, payload, now, options) {
  id(activityId, "activityId");
  if (own(state.activities, activityId)) fail("REVISION_CONFLICT", "Activity already exists");
  const draft = normalizeDraft(payload.planDraft ?? { tasks: payload.tasks ?? [], artifacts: payload.artifacts ?? [], dependencyLinks: payload.dependencyLinks ?? [], dataBindings: payload.dataBindings ?? [] }, activityId);
  validateGraph(draft, options);
  const activity = {
    id: activityId, ownerId: options.ownerId, title: payload.title ?? "", goal: clone(payload.goal ?? {}), constraints: clone(payload.constraints ?? []),
    revision: 1, lifecycle: "active", currentPlanRevision: 0,
    completionPolicy: clone(payload.completionPolicy ?? {}), ...draft,
    results: [], planHistory: [], suppressions: [], reminderRefs: [], occurrenceId: payload.occurrenceId ?? null,
    createdAt: now, updatedAt: now,
  };
  if (draft.tasks.length) planSnapshot(activity);
  state.activities[activityId] = activity;
  return activity;
}
function recordResult(activity, task, payload, commandId, now, options) {
  if (["skipped", "canceled"].includes(task.executionStatus)) fail("INVALID_TRANSITION", "Cannot record results for skipped or canceled tasks");
  if (!own(payload, "value")) fail("INVALID_OUTPUT", "Result value is required");
  validateValue(payload.value, task.outputSchema);
  validateHook(options.validateOutput, [clone(task), clone(payload.value)], "INVALID_OUTPUT", "Domain output validation failed");
  const resultId = payload.resultId ?? `${commandId}:result`;
  id(resultId, "resultId");
  if (activity.results.some((entry) => entry.id === resultId)) fail("INVALID_OUTPUT", "Result id already exists");
  const result = { id: resultId, taskId: task.id, activityId: activity.id, revision: task.resultHistoryRefs.length + 1, value: clone(payload.value), evidenceRefs: clone(payload.evidenceRefs ?? []), recordedAt: now, commandId, supersedesResultId: task.latestOutputRef };
  activity.results.push(result); task.latestOutputRef = result.id; task.resultHistoryRefs.push(result.id);
  for (const consumer of activity.tasks) {
    if ([...consumer.consumedBindings, ...(consumer.consumedDependencies ?? [])].some((binding) => binding.sourceTaskId === task.id && binding.resultId !== result.id)) { consumer.needsReview = true; consumer.revision += 1; }
  }
  return result;
}
function protectedUpdate(target, changes) {
  for (const key of Object.keys(changes)) if ((target.pinnedFields ?? []).some((pinned) => pinned === key || pinned === `inputBindings.${key}` || pinned === `data.${key}`) || own(target.userOverrides ?? {}, key)) fail("PROTECTED_FIELD", `User field is protected: ${key}`);
}
function updateArtifact(activity, artifactId, data, options = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("INVALID_INPUT", "Artifact data must be an object");
  const artifact = lookup(activity.artifacts, artifactId, "Artifact");
  if (options.expectedRevision !== undefined) revision(artifact.revision, options.expectedRevision, "Artifact");
  if (!options.userEdit) protectedUpdate(artifact, data);
  else {
    artifact.userOverrides = { ...artifact.userOverrides, ...clone(data) };
    artifact.pinnedFields = [...new Set([...artifact.pinnedFields, ...Object.keys(data)])];
  }
  artifact.history.push({ revision: artifact.revision, data: clone(artifact.data ?? null) });
  artifact.data = { ...(artifact.data ?? {}), ...clone(data) }; artifact.revision += 1;
  return artifact;
}
function applyPatch(activity, patch, options) {
  revision(activity.currentPlanRevision, patch.basePlanRevision, "Plan");
  for (const [taskId, expected] of Object.entries(patch.expectedTaskRevisions ?? {})) revision(lookup(activity.tasks, taskId, "Task").revision, expected, "Task");
  if (patch.expectedKnowledgeDependencies && Object.keys(patch.expectedKnowledgeDependencies).length && !options.validateKnowledgeDependencies) fail("INVALID_PLAN", "Knowledge dependency validator is required");
  validateHook(options.validateKnowledgeDependencies, [clone(patch.expectedKnowledgeDependencies ?? [])], "REVISION_CONFLICT", "Knowledge dependencies changed");
  for (const operation of array(patch.operations, "operations")) {
    const type = operation.type ?? operation.op;
    if (type === "addTask") {
      const task = normalizeTask(operation.task, activity.id);
      if (task.semanticKey && activity.suppressions.includes(`${task.occurrenceId ?? ""}:${task.semanticKey}`)) fail("INVALID_PLAN", "Task was explicitly suppressed");
      activity.tasks.push(task);
    } else if (type === "updateTaskInput") {
      const task = lookup(activity.tasks, operation.taskId, "Task");
      if (task.executionStatus !== "not_started") fail("INVALID_TRANSITION", "Started task inputs are immutable; create a successor task");
      protectedUpdate(task, operation.inputs);
      task.inputBindings = { ...task.inputBindings, ...clone(operation.inputs) }; task.revision += 1;
    } else if (type === "addDependency") {
      if (lookup(activity.tasks, operation.dependency.toTaskId, "Task").executionStatus !== "not_started") fail("INVALID_TRANSITION", "Cannot rewrite dependencies of a started task");
      activity.dependencyLinks.push(clone(operation.dependency));
      lookup(activity.tasks, operation.dependency.toTaskId, "Task").revision += 1;
    } else if (type === "addDataBinding") {
      if (lookup(activity.tasks, operation.binding.targetTaskId, "Task").executionStatus !== "not_started") fail("INVALID_TRANSITION", "Cannot rewrite bindings of a started task");
      activity.dataBindings.push(clone(operation.binding));
      lookup(activity.tasks, operation.binding.targetTaskId, "Task").revision += 1;
    } else if (type === "removeDataBinding") {
      const binding = lookup(activity.dataBindings, operation.bindingId, "Binding");
      if (lookup(activity.tasks, binding.targetTaskId, "Task").executionStatus !== "not_started") fail("INVALID_TRANSITION", "Cannot rewrite bindings of a started task");
      activity.dataBindings = activity.dataBindings.filter((entry) => entry.id !== binding.id);
    }
    else if (type === "removeDependency") {
      const edge = lookup(activity.dependencyLinks, operation.dependencyId, "Dependency");
      if (lookup(activity.tasks, edge.toTaskId, "Task").executionStatus !== "not_started") fail("INVALID_TRANSITION", "Cannot rewrite dependencies of a started task");
      activity.dependencyLinks = activity.dependencyLinks.filter((entry) => entry.id !== edge.id);
    } else if (type === "replaceArtifact") updateArtifact(activity, operation.artifactId, operation.data, { expectedRevision: operation.expectedRevision });
    else if (type === "addArtifact") activity.artifacts.push({ ...clone(operation.artifact), revision: 1, history: [], userOverrides: {}, pinnedFields: [] });
    else if (type === "cancelPendingTask") {
      const task = lookup(activity.tasks, operation.taskId, "Task");
      if (task.executionStatus !== "not_started" || ["running", "unknown", "succeeded"].includes(task.effectStatus)) fail("INVALID_TRANSITION", "Only pending tasks without an external effect may be canceled");
      task.executionStatus = "canceled"; task.revision += 1;
      if (task.semanticKey) activity.suppressions.push(`${task.occurrenceId ?? ""}:${task.semanticKey}`);
    } else if (type === "markTaskNeedsReview") {
      const task = lookup(activity.tasks, operation.taskId, "Task"); task.needsReview = true; task.revision += 1;
    } else fail("INVALID_PLAN", `Unsupported patch operation: ${type}`);
  }
  validateGraph(activity, options); planSnapshot(activity, patch.reasons ?? []);
}

/** Pure transaction: callers must atomically persist returned state with its command receipt. */
export function applyActivityCommand(state, command, options = {}) {
  json(state, "state"); json(command, "command");
  id(command.commandId, "commandId"); id(command.type, "command.type"); id(command.ownerId, "ownerId");
  options = { ...options, ownerId: command.ownerId };
  const fingerprint = createHash("sha256").update(canonical(command)).digest("hex");
  const receiptKey = canonical([command.ownerId, command.commandId]);
  const previous = state.commandReceipts[receiptKey];
  if (previous) {
    if (previous.fingerprint !== fingerprint) fail("COMMAND_CONFLICT", "commandId was reused with different content");
    return { state: clone(state), result: clone(previous.result), replayed: true };
  }
  const next = clone(state);
  const payload = command.payload ?? {};
  const now = timestamp(typeof options.now === "function" ? options.now() : options.now ?? new Date().toISOString(), "now");
  let result; let activity;
  if (command.type === "activity.create") {
    revision(0, command.expectedRevision, "New activity");
    activity = createActivity(next, command.activityId ?? payload.id, payload, now, options);
    result = { activityId: activity.id, revision: activity.revision };
  } else if (command.type === "recurrence.create") {
    revision(0, command.expectedRevision, "New recurrence"); id(payload.id);
    if (own(next.recurrences, payload.id)) fail("REVISION_CONFLICT", "Recurrence already exists");
    zone(payload.timeZone); id(payload.rule, "rule");
    validatePlanDraft(payload.planDraft, options);
    next.recurrences[payload.id] = { ...clone(payload), ownerId: command.ownerId, revision: 1, templateVersion: payload.templateVersion ?? 1 };
    result = { recurrenceId: payload.id, revision: 1 };
  } else if (command.type === "recurrence.materialize") {
    const recurrence = next.recurrences[id(payload.recurrenceId)];
    if (!recurrence) fail("NOT_FOUND", "Recurrence not found");
    if (recurrence.ownerId !== command.ownerId) fail("FORBIDDEN", "Recurrence belongs to another owner");
    revision(recurrence.revision, command.expectedRevision, "Recurrence");
    id(payload.occurrenceKey); timestamp(payload.scheduledAt, "scheduledAt");
    const occurrenceId = `${recurrence.id}:${recurrence.templateVersion}:${payload.occurrenceKey}`;
    if (own(next.occurrences, occurrenceId)) {
      const occurrence = next.occurrences[occurrenceId];
      if (occurrence.scheduledAt !== payload.scheduledAt || (payload.activityId && occurrence.activityId !== payload.activityId)) fail("COMMAND_CONFLICT", "Occurrence key already refers to another schedule or activity");
      result = { occurrenceId, activityId: occurrence.activityId, revision: next.activities[occurrence.activityId].revision };
    } else {
      const activityId = payload.activityId ?? occurrenceId;
      activity = createActivity(next, activityId, { title: recurrence.title, goal: recurrence.goal, planDraft: recurrence.planDraft, occurrenceId }, now, options);
      const occurrence = { id: occurrenceId, recurrenceId: recurrence.id, templateVersion: recurrence.templateVersion, occurrenceKey: payload.occurrenceKey, activityId, scheduledAt: payload.scheduledAt, timeZone: recurrence.timeZone, status: "pending" };
      next.occurrences[occurrenceId] = occurrence;
      result = { occurrenceId, activityId, revision: activity.revision };
    }
  } else {
    activity = activityFor(next, command.activityId, command.ownerId);
    revision(activity.revision, command.expectedRevision, "Activity");
    if (activity.lifecycle !== "active" && command.type !== "reminder.transition") fail("INVALID_TRANSITION", "Activity is terminal");
    if (command.type === "plan.applyDraft") {
      if (activity.tasks.length || activity.currentPlanRevision) fail("INVALID_TRANSITION", "Use a patch after the initial draft");
      const draft = normalizeDraft(payload.draft ?? payload, activity.id); validateGraph(draft, options);
      Object.assign(activity, draft); planSnapshot(activity); result = { planRevision: activity.currentPlanRevision };
    } else if (command.type === "plan.applyPatch") {
      applyPatch(activity, payload.patch ?? payload, options); result = { planRevision: activity.currentPlanRevision };
    } else if (command.type === "task.transition" || command.type === "task.recordResult") {
      const task = lookup(activity.tasks, payload.taskId, "Task");
      if (payload.expectedTaskRevision !== undefined) revision(task.revision, payload.expectedTaskRevision, "Task");
      if (command.type === "task.recordResult") result = { resultId: recordResult(activity, task, payload, command.commandId, now, options).id };
      else {
        if (!TRANSITIONS[task.executionStatus]?.includes(payload.to)) fail("INVALID_TRANSITION", `Cannot move ${task.executionStatus} to ${payload.to}`);
        if (["canceled", "skipped"].includes(payload.to) && ["running", "unknown", "succeeded"].includes(task.effectStatus)) fail("INVALID_TRANSITION", "External effects require reconciliation or a separate compensation");
        if (["in_progress", "completed"].includes(payload.to)) {
          const ready = readiness(activity, task);
          if (ready.status !== "ready") fail("TASK_BLOCKED", "Task is not ready", ready);
          pinInputs(activity, task);
        }
        if (own(payload, "output")) recordResult(activity, task, { value: payload.output, evidenceRefs: payload.evidenceRefs ?? [] }, command.commandId, now, options);
        if (payload.to === "completed") {
          if ((task.outputSchema || task.completionPolicy?.requiresOutput) && !task.latestOutputRef) fail("INVALID_OUTPUT", "Task completion requires an output");
          if (task.completionPolicy?.requiresExternalConfirmation && !options.validateTaskCompletion) fail("INVALID_TRANSITION", "External completion validator is required");
          validateHook(options.validateTaskCompletion, [clone(task), clone(activity)], "INVALID_TRANSITION", "Completion conditions are not satisfied");
        }
        task.executionStatus = payload.to;
        if (["skipped", "canceled"].includes(payload.to) && task.semanticKey) activity.suppressions.push(`${task.occurrenceId ?? ""}:${task.semanticKey}`);
        result = { taskId: task.id, executionStatus: task.executionStatus, resultId: task.latestOutputRef };
      }
      task.revision += 1;
    } else if (command.type === "task.resolveReview") {
      const task = lookup(activity.tasks, payload.taskId, "Task");
      if (payload.expectedTaskRevision !== undefined) revision(task.revision, payload.expectedTaskRevision, "Task");
      if (!task.needsReview || payload.resolution !== "keep_consumed") fail("INVALID_TRANSITION", "Review must explicitly retain the consumed result versions; use a successor task for new inputs");
      task.reviewHistory.push({ commandId: command.commandId, resolution: payload.resolution, note: payload.note ?? "", recordedAt: now, consumedBindings: clone(task.consumedBindings), consumedDependencies: clone(task.consumedDependencies) });
      task.needsReview = false; task.revision += 1;
      result = { taskId: task.id, needsReview: false };
    } else if (command.type === "artifact.update") {
      const artifact = updateArtifact(activity, payload.artifactId, payload.data, { expectedRevision: payload.expectedArtifactRevision, userEdit: true }); result = { artifactId: artifact.id, artifactRevision: artifact.revision };
    } else if (command.type === "activity.complete") {
      const required = activity.tasks.filter((task) => task.required !== false);
      if (required.some((task) => !((task.completionPolicy?.allowedTerminalStatuses ?? ["completed"]).includes(task.executionStatus)) || task.needsReview)) fail("TASK_BLOCKED", "Required tasks are not complete");
      if (payload.goalConfirmed !== true) fail("INVALID_TRANSITION", "Explicit goal confirmation is required");
      activity.lifecycle = "completed"; result = { lifecycle: "completed" };
    } else if (command.type === "activity.cancel") {
      if (activity.tasks.some((task) => ["running", "unknown"].includes(task.effectStatus))) fail("INVALID_TRANSITION", "Reconcile external operations before cancellation");
      activity.lifecycle = "canceled";
      for (const task of activity.tasks) if (!TERMINAL.has(task.executionStatus)) { task.executionStatus = "canceled"; task.revision += 1; }
      result = { lifecycle: "canceled" };
    } else if (command.type === "reminder.schedule") {
      id(payload.id); lookup(activity.tasks, payload.taskId, "Task"); timestamp(payload.dueAt, "dueAt"); zone(payload.timeZone);
      if (own(next.reminders, payload.id)) fail("REVISION_CONFLICT", "Reminder already exists");
      if (payload.occurrenceId && payload.occurrenceId !== activity.occurrenceId) fail("INVALID_INPUT", "Reminder occurrence must belong to its activity");
      next.reminders[payload.id] = { ...clone(payload), activityId: activity.id, revision: 1, targetTaskRevision: lookup(activity.tasks, payload.taskId, "Task").revision, status: "scheduled", deliveryAttempts: 0 };
      activity.reminderRefs.push(payload.id); result = { reminderId: payload.id, reminderRevision: 1 };
    } else if (command.type === "reminder.reschedule") {
      const reminder = next.reminders[id(payload.reminderId)];
      if (!reminder || reminder.activityId !== activity.id) fail("NOT_FOUND", "Reminder not found in activity");
      revision(reminder.revision, payload.expectedReminderRevision, "Reminder");
      if (!["scheduled", "failed"].includes(reminder.status)) fail("INVALID_TRANSITION", "Only an undelivered reminder may be rescheduled");
      timestamp(payload.dueAt, "dueAt");
      if (payload.timeZone) zone(payload.timeZone);
      reminder.dueAt = payload.dueAt; reminder.timeZone = payload.timeZone ?? reminder.timeZone;
      reminder.targetTaskRevision = lookup(activity.tasks, reminder.taskId, "Task").revision;
      reminder.revision += 1; reminder.status = "scheduled";
      result = { reminderId: reminder.id, reminderRevision: reminder.revision, status: reminder.status };
    } else if (command.type === "reminder.transition") {
      const reminder = next.reminders[id(payload.reminderId)];
      if (!reminder || reminder.activityId !== activity.id) fail("NOT_FOUND", "Reminder not found in activity");
      revision(reminder.revision, payload.expectedReminderRevision, "Reminder");
      const allowed = { scheduled: ["delivering", "canceled"], delivering: ["delivered", "failed", "unknown"], failed: ["scheduled", "canceled"], unknown: ["delivered", "canceled"], delivered: [], canceled: [] };
      if (!allowed[reminder.status].includes(payload.to)) fail("INVALID_TRANSITION", "Invalid reminder transition");
      if (payload.to === "delivering") {
        if (Date.parse(now) < Date.parse(reminder.dueAt)) fail("INVALID_TRANSITION", "Reminder is not due");
        if (activity.lifecycle !== "active") fail("INVALID_TRANSITION", "Activity is terminal");
        if (reminder.targetTaskRevision !== lookup(activity.tasks, reminder.taskId, "Task").revision) fail("REVISION_CONFLICT", "Reminder refers to a stale task revision");
        if (TERMINAL.has(lookup(activity.tasks, reminder.taskId, "Task").executionStatus)) fail("INVALID_TRANSITION", "Reminder task is terminal");
        reminder.deliveryAttempts += 1;
      }
      reminder.status = payload.to; reminder.revision += 1; result = { reminderId: reminder.id, reminderRevision: reminder.revision, status: reminder.status };
    } else fail("INVALID_INPUT", `Unknown command: ${command.type}`);
    activity.revision += 1; activity.updatedAt = now;
    if (activity.lifecycle !== "active") {
      if (activity.occurrenceId) next.occurrences[activity.occurrenceId].status = activity.lifecycle;
      for (const reminderId of activity.reminderRefs) {
        const reminder = next.reminders[reminderId];
        if (["scheduled", "failed"].includes(reminder.status)) { reminder.status = "canceled"; reminder.revision += 1; }
      }
    }
    result = { ...result, activityId: activity.id, revision: activity.revision };
  }
  next.events.push({ id: command.commandId, sequence: next.events.length + 1, type: command.type, ownerId: command.ownerId, activityId: activity?.id ?? null, occurredAt: now, result: clone(result) });
  next.commandReceipts[receiptKey] = { fingerprint, result: clone(result) };
  return { state: next, result: clone(result), replayed: false };
}

export function getActivityBoard(state, activityId, options = {}) {
  const activity = activityFor(state, activityId, options.ownerId);
  const tasks = activity.tasks.map((task) => ({ ...clone(task), readiness: readiness(activity, task) }));
  return {
    ...clone(activity), tasks,
    nextActions: tasks.filter((task) => !TERMINAL.has(task.executionStatus) && task.readiness.status === "ready").map((task) => task.id),
    reminders: activity.reminderRefs.map((reminderId) => clone(state.reminders[reminderId])),
    occurrence: activity.occurrenceId ? clone(state.occurrences[activity.occurrenceId]) : null,
  };
}
