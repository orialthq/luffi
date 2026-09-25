import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import {
  applyActivityCommand, createActivityState, getActivityBoard,
} from "../activities/index.js";
import { domainRegistry } from "../domains/index.js";
import {
  buildReviewedCaptureImport, INGESTION_PREDICATES, INGESTION_TYPES,
  validateImportedValue,
} from "../ingestion/index.js";
import {
  applyKnowledgeCommand, buildKnowledgeContext, createKnowledgeState,
  getAffectedKnowledgeConsumers, queryKnowledge, registerKnowledgeWatch,
  resolveKnowledge, validateKnowledgeContext,
} from "../knowledge/index.js";
import { retrieveKnowledge, validateRetrievalResult } from "../retrieval/index.js";
import {
  applyResourceCommand, createResourceState,
  getResourceAvailability as projectResourceAvailability,
} from "../composition/index.js";

const VERSION = 1;

export function createCommonKernelState() {
  return {
    schemaVersion: VERSION,
    knowledge: createKnowledgeState(),
    activities: createActivityState(),
    resources: createResourceState(),
    reviewEvents: [],
    executionReceipts: {},
    issuedContexts: {},
    retrievalWatches: {},
    resourceWatches: {},
    proposals: {},
    importReceipts: {},
  };
}

function assertState(state) {
  if (state?.schemaVersion !== VERSION || !state.knowledge || !state.activities || !state.resources ||
      !Array.isArray(state.reviewEvents) || !state.executionReceipts || !state.issuedContexts ||
      !state.proposals || !state.importReceipts || !state.retrievalWatches || !state.resourceWatches) {
    throw new AppError("KERNEL_SCHEMA_MISMATCH", "공통 데이터 버전이 맞지 않아요.", { httpStatus: 500 });
  }
}

function injectOwner(command, ownerId) {
  if (!command || typeof command !== "object" || Array.isArray(command) ||
      (command.ownerId != null && command.ownerId !== ownerId)) {
    throw new AppError("INVALID_REQUEST", "요청 소유자 형식이 올바르지 않아요.", { httpStatus: 400 });
  }
  return { ...command, ownerId };
}

function toHttpError(error) {
  if (error instanceof AppError) return error;
  if (typeof error?.code === "string" && Number.isInteger(error.httpStatus)) {
    return new AppError(error.code, error.message, { httpStatus: error.httpStatus, cause: error });
  }
  throw error;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeId(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 512 ||
      ["__proto__", "constructor", "prototype"].includes(value)) {
    throw new AppError("INVALID_REQUEST", `${name} 형식이 올바르지 않아요.`, { httpStatus: 400 });
  }
  return value;
}

/** Coordinates pure domain kernels within one durable state-store transaction.
 * The JSON adapter is single-process development storage. A production adapter
 * must provide the same atomic snapshot/transact contract backed by SQL. */
export function createCommonKernelService({ store, ownerId, registry = domainRegistry }) {
  if (!store || typeof store.snapshot !== "function" || typeof store.transact !== "function") {
    throw new TypeError("A transactional state store is required");
  }
  if (typeof ownerId !== "string" || !ownerId.trim()) {
    throw new TypeError("A nonempty authenticated ownerId is required");
  }
  const predicates = Object.fromEntries([...registry.listRelations(), ...INGESTION_PREDICATES]
    .map((spec) => [spec.id, spec]));
  const capabilities = Object.fromEntries(registry.listCapabilities().map((spec) => [spec.id, spec]));
  const renderers = Object.fromEntries(registry.listRenderers().map((spec) => [spec.id, spec]));
  const entityTypes = new Set(registry.listPacks().flatMap((pack) => pack.entityTypes));
  for (const type of INGESTION_TYPES) entityTypes.add(type.id);

  function enrichTask(task) {
    let spec;
    try { spec = registry.getCapability(task.capabilityId); }
    catch { throw new AppError("INVALID_PLAN", "등록되지 않은 작업 기능이에요.", { httpStatus: 400 }); }
    const inputSchema = registry.getType(spec.inputType).schema;
    const outputSchema = registry.getType(spec.outputType).schema;
    return {
      ...task,
      capabilityVersion: spec.version,
      inputSchema,
      outputSchema,
      requiredInputs: inputSchema.type === "object" ? inputSchema.required : [],
      completionPolicy: {
        ...(task.completionPolicy ?? {}),
        requiresOutput: true,
        requiresExternalConfirmation: spec.actor === "user" || spec.effect === "external_write",
      },
    };
  }

  const enrichDraft = (draft) => ({ ...draft,
    tasks: (draft.tasks ?? []).map(enrichTask),
  });
  function enrichPlan(kind, plan) {
    if (kind === "draft") return enrichDraft(plan);
    return { ...plan, operations: (plan.operations ?? []).map((operation) =>
      (operation.type ?? operation.op) === "addTask"
        ? { ...operation, task: enrichTask(operation.task) } : operation) };
  }

  function enrichActivityCommand(command) {
    if (command.type === "activity.create") {
      const payload = command.payload ?? {};
      return { ...command, payload: {
        ...payload,
        ...(payload.planDraft ? { planDraft: enrichDraft(payload.planDraft) } :
          payload.tasks ? { tasks: payload.tasks.map(enrichTask) } : {}),
      } };
    }
    if (command.type === "plan.applyDraft") {
      const payload = command.payload ?? {};
      return { ...command, payload: payload.draft
        ? { ...payload, draft: enrichDraft(payload.draft) } : enrichDraft(payload) };
    }
    if (command.type === "plan.applyPatch") {
      const payload = command.payload ?? {};
      return { ...command, payload: payload.patch
        ? { ...payload, patch: enrichPlan("patch", payload.patch) } : enrichPlan("patch", payload) };
    }
    return command;
  }

  const read = async (select) => {
    const state = await store.snapshot();
    assertState(state);
    return select(state);
  };

  function validateAssertionRelation(state, raw) {
    const subject = state.knowledge.entities.find((item) =>
      item.ownerId === ownerId && item.id === raw.subjectId && item.status === "active");
    if (!subject) return; // The knowledge kernel reports the precise missing reference.
    const target = raw.objectEntityId == null ? null : state.knowledge.entities.find((item) =>
      item.ownerId === ownerId && item.id === raw.objectEntityId && item.status === "active");
    if (raw.predicate === "ingestion.extracted_field") {
      if (subject.type !== "ingestion.material" || raw.typedValue?.type !== "ingestion.field") {
        throw new AppError("INVALID_DOMAIN_VALUE", "수집 필드의 대상·값 종류가 맞지 않아요.", { httpStatus: 400 });
      }
      validateImportedValue("ingestion.field", raw.typedValue.value);
      return;
    }
    registry.validateRelation({
      predicate: raw.predicate,
      subjectType: subject.type,
      ...(target ? { objectType: target.type } : { value: raw.typedValue?.value }),
    });
  }

  function validateEvidenceReferences(state, value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry) => validateEvidenceReferences(state, entry));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (["evidenceIds", "evidenceRefs"].includes(key)) {
        if (!Array.isArray(child) || child.some((id) => typeof id !== "string" ||
          !state.knowledge.evidence.some((item) => item.ownerId === ownerId && item.id === id && item.status === "active"))) {
          throw new AppError("INVALID_EVIDENCE_REFERENCE", "접근할 수 없는 근거가 결과에 있어요.", { httpStatus: 400 });
        }
      } else validateEvidenceReferences(state, child);
    }
  }

  function activityOptions(state) {
    return {
      capabilities,
      renderers,
      validateTask(task) {
        const spec = registry.getCapability(task.capabilityId);
        if (spec.taskKind !== task.kind) {
          throw new AppError("INVALID_PLAN", "작업 종류와 기능 계약이 맞지 않아요.", { httpStatus: 400 });
        }
        if (task.capabilityVersion !== spec.version || task.completionPolicy?.requiresOutput !== true) {
          throw new AppError("INVALID_PLAN", "작업의 등록된 버전·완료 조건이 맞지 않아요.", { httpStatus: 400 });
        }
        if (!Array.isArray(task.evidenceBindings ?? []) ||
            (task.evidenceBindings ?? []).some((item) => typeof item !== "string")) {
          throw new AppError("INVALID_PLAN", "작업 근거 형식이 올바르지 않아요.", { httpStatus: 400 });
        }
        for (const evidenceId of task.evidenceBindings ?? []) {
          if (!state.knowledge.evidence.some((item) => item.ownerId === ownerId && item.id === evidenceId && item.status === "active")) {
            throw new AppError("INVALID_PLAN", "접근할 수 없는 근거가 연결되어 있어요.", { httpStatus: 400 });
          }
        }
      },
      validateOutput(task, value) {
        registry.validateCapabilityOutput(task.capabilityId, value);
        validateEvidenceReferences(state, value);
      },
      validateTaskCompletion(task, activity) {
        const spec = registry.getCapability(task.capabilityId);
        const current = getActivityBoard({
          activities: { [activity.id]: activity },
          reminders: state.activities.reminders,
          occurrences: state.activities.occurrences,
        }, activity.id, { ownerId });
        const ready = current.tasks.find((item) => item.id === task.id)?.readiness;
        if (!ready || ready.status !== "ready") return false;
        registry.validateCapabilityInput(spec.id, ready.inputs);
        const result = activity.results.find((item) => item.id === task.latestOutputRef);
        if (!result) return false;
        registry.validateCapabilityOutput(spec.id, result.value);
        validateEvidenceReferences(state, result.value);
        return true;
      },
      validateKnowledgeDependencies(dependencies) {
        return dependencies.every((item) => {
          if (typeof item?.contextId !== "string") return false;
          try {
            const context = issuedContext(state, item.contextId);
            return validateKnowledgeContext(state.knowledge, context, { predicates }).valid;
          } catch { return false; }
        });
      },
    };
  }

  function board(state, activityId) {
    const value = getActivityBoard(state.activities, activityId, { ownerId });
    const resourceClaims = state.resources.claims.filter((claim) =>
      claim.ownerId === ownerId && claim.activityId === activityId);
    return {
      ...value,
      resourceClaims,
      pendingChanges: state.reviewEvents.filter((event) => event.activityId === activityId),
      pendingProposals: Object.values(state.proposals).filter((proposal) =>
        proposal.ownerId === ownerId && proposal.activityId === activityId && proposal.status === "pending"),
    };
  }

  function issuedContext(state, contextId) {
    if (typeof contextId !== "string") {
      throw new AppError("INVALID_REQUEST", "서버가 발급한 맥락 ID가 필요해요.", { httpStatus: 400 });
    }
    const issued = state.issuedContexts[contextId];
    if (!issued || issued.ownerId !== ownerId) {
      throw new AppError("CONTEXT_NOT_FOUND", "계획 근거를 찾을 수 없어요.", { httpStatus: 404 });
    }
    if (Date.parse(issued.expiresAt) <= Date.now()) {
      throw new AppError("CONTEXT_STALE", "계획 근거의 사용 시간이 지났어요.", { httpStatus: 409 });
    }
    return issued.context;
  }

  function validateContext(state, context, { activityId = null, requireActivityBinding = false } = {}) {
    if (context.ownerId !== ownerId ||
        !validateKnowledgeContext(state.knowledge, context, { predicates }).valid ||
        (context.retrieval && !validateRetrievalResult(state.knowledge, context.retrieval, { registry: predicates }).valid)) {
      throw new AppError("CONTEXT_STALE", "계획의 근거가 변경됐어요.", { httpStatus: 409 });
    }
    if ((context.resourceReads ?? []).some(({ resourceId, revision, status }) => {
      const resource = state.resources.resources.find((item) => item.ownerId === ownerId && item.id === resourceId);
      return !resource || resource.revision !== revision ||
        projectResourceAvailability(state.resources, { ownerId, resourceId }).status !== status;
    })) {
      throw new AppError("CONTEXT_STALE", "자원 상태가 변경돼 맥락을 새로 확인해야 해요.", { httpStatus: 409 });
    }
    if (activityId != null) {
      if ((requireActivityBinding && context.activityId !== activityId) ||
          (context.activityId != null && context.activityId !== activityId) ||
          (context.activityId != null && context.activityRevision !== board(state, activityId).revision)) {
        throw new AppError("CONTEXT_STALE", "활동이 변경돼 맥락을 새로 확인해야 해요.", { httpStatus: 409 });
      }
    }
  }

  function registerContextWatch(state, activityId, context) {
    const watch = registerKnowledgeWatch(state.knowledge, { ownerId, consumerId: activityId, context });
    state.knowledge = watch.state;
    if (context.retrieval) state.retrievalWatches[activityId] = structuredClone(context.retrieval);
    else delete state.retrievalWatches[activityId];
    state.resourceWatches[activityId] = structuredClone(context.resourceReads ?? []);
    return watch;
  }

  function recordAffectedConsumers(state, afterSequence) {
    const affected = getAffectedKnowledgeConsumers(state.knowledge, { ownerId, afterSequence }, { predicates });
    for (const change of affected) {
      const key = `${change.consumerId}:${change.eventIds.join(",") || "time"}`;
      if (!state.reviewEvents.some((entry) => entry.key === key)) {
        state.reviewEvents.push({ key, activityId: change.consumerId,
          eventIds: change.eventIds, timeDue: change.timeDue });
      }
    }
    for (const [activityId, retrieval] of Object.entries(state.retrievalWatches)) {
      const check = validateRetrievalResult(state.knowledge, retrieval, { registry: predicates });
      if (!check.valid) {
        const key = `${activityId}:retrieval`;
        if (!state.reviewEvents.some((entry) => entry.key === key)) {
          state.reviewEvents.push({ key, activityId, eventIds: [],
            retrievalReasons: check.reasons, timeDue: false });
        }
      }
    }
  }

  function recordResourceChange(state, resourceId, { includeHolders = false } = {}) {
    const affected = new Set([
      ...state.resources.claims.filter((claim) => includeHolders && claim.ownerId === ownerId &&
        claim.resourceId === resourceId && claim.state === "held").map((claim) => claim.activityId),
      ...Object.entries(state.resourceWatches).filter(([, reads]) =>
        reads.some((read) => read.resourceId === resourceId)).map(([activityId]) => activityId),
    ]);
    for (const activityId of affected) {
      if (state.activities.activities[activityId]?.lifecycle !== "active") continue;
      const key = `${activityId}:resource:${resourceId}:${state.resources.sequence}`;
      if (!state.reviewEvents.some((entry) => entry.key === key)) {
        state.reviewEvents.push({ key, activityId, eventIds: [], resourceId, timeDue: false });
      }
    }
  }

  return {
    async contracts() {
      return {
        kernelVersion: VERSION,
        packs: registry.listPacks().map((pack) => ({ id: pack.id, version: pack.version })),
        capabilities: registry.listCapabilities().map(({ id, version, actor, taskKind, effect, inputType, outputType }) =>
          ({ id, version, actor, taskKind, effect, inputType, outputType })),
        renderers: registry.listRenderers(),
      };
    },
    async listBoards() {
      try {
        return await read((state) => Object.values(state.activities.activities)
          .filter((activity) => activity.ownerId === ownerId)
          .map((activity) => board(state, activity.id)));
      } catch (error) { throw toHttpError(error); }
    },
    async getBoard(activityId) {
      try { return await read((state) => board(state, activityId)); }
      catch (error) { throw toHttpError(error); }
    },
    async activityCommand(raw) {
      const command = injectOwner(raw, ownerId);
      try {
        return await store.transact((state) => {
          assertState(state);
          if (Object.hasOwn(command, "context")) {
            throw new AppError("INVALID_REQUEST", "서버가 발급한 contextId를 사용해 주세요.", { httpStatus: 400 });
          }
          const applied = applyActivityCommand(state.activities, enrichActivityCommand(command), activityOptions(state));
          // The activity reducer checks receipts before touching a command. A
          // replay remains valid even when its once-live evidence was deleted.
          if (!applied.replayed && ["task.recordResult", "task.transition"].includes(command.type)) {
            validateEvidenceReferences(state, command.payload ?? {});
            const current = board(state, command.activityId);
            const task = current.tasks.find((item) => item.id === command.payload?.taskId);
            if (!task) throw new AppError("TASK_NOT_FOUND", "작업을 찾을 수 없어요.", { httpStatus: 404 });
            const spec = registry.getCapability(task.capabilityId);
            if ((command.type === "task.recordResult" || command.payload?.to === "completed") &&
                (spec.actor === "system" || spec.effect === "external_write")) {
              throw new AppError("TASK_EXECUTION_RESTRICTED", "이 작업은 등록된 실행기를 통해서만 완료할 수 있어요.", { httpStatus: 403 });
            }
          }
          if (!applied.replayed && command.contextId) {
            const context = issuedContext(state, command.contextId);
            const activityId = command.activityId ?? applied.result.activityId;
            validateContext(state, context, { activityId: command.type === "activity.create" ? null : activityId });
            registerContextWatch(state, activityId, context);
            state.reviewEvents = state.reviewEvents.filter((item) => item.activityId !== activityId);
          }
          state.activities = applied.state;
          if (!applied.replayed && ["activity.create", "recurrence.materialize"].includes(command.type)) {
            const activityId = applied.result.activityId;
            if (!state.resources.activities.some((item) => item.ownerId === ownerId && item.id === activityId)) {
              state.resources = applyResourceCommand(state.resources, {
                ownerId, commandId: `kernel:activity-register:${activityId}`,
                type: "activity.register", expectedRevision: 0, payload: { activityId },
              }).state;
            }
          }
          if (!applied.replayed && ["activity.cancel", "activity.complete"].includes(command.type)) {
            const held = state.resources.claims.filter((claim) => claim.ownerId === ownerId &&
              claim.activityId === command.activityId && claim.state === "held");
            for (const claim of held) {
              const resource = state.resources.resources.find((item) => item.ownerId === ownerId && item.id === claim.resourceId);
              state.resources = applyResourceCommand(state.resources, {
                ownerId, commandId: `kernel:activity-terminal:${command.commandId}:${claim.id}`,
                type: "claim.release", expectedRevision: resource.revision,
                payload: { activityId: claim.activityId, resourceId: claim.resourceId, claimId: claim.id },
              }).state;
              recordResourceChange(state, claim.resourceId);
            }
            delete state.resourceWatches[command.activityId];
            delete state.retrievalWatches[command.activityId];
          }
          return { state, result: { ...applied.result, replayed: applied.replayed } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async proposePlan({ activityId, contextId, kind, plan, run = {} }) {
      try {
        return await store.transact((state) => {
          assertState(state);
          if (!["draft", "patch"].includes(kind) || !plan || typeof plan !== "object" || Array.isArray(plan)) {
            throw new AppError("INVALID_PLAN", "계획 변경안 형식이 올바르지 않아요.", { httpStatus: 400 });
          }
          const current = board(state, activityId);
          const context = issuedContext(state, contextId);
          validateContext(state, context, { activityId, requireActivityBinding: true });
          const type = kind === "draft" ? "plan.applyDraft" : "plan.applyPatch";
          const enrichedPlan = enrichPlan(kind, plan);
          const payload = kind === "draft" ? { draft: enrichedPlan } : { patch: enrichedPlan };
          // Compile on a discarded state: unknown capabilities, cycles, missing
          // bindings and protected fields fail before a proposal is visible.
          applyActivityCommand(state.activities, {
            ownerId, commandId: `proposal-check:${randomUUID()}`, type,
            activityId, expectedRevision: current.revision, payload,
          }, activityOptions(state));
          const proposalId = randomUUID();
          const proposal = { id: proposalId, ownerId, activityId, contextId,
            kind, plan: structuredClone(enrichedPlan), run: structuredClone(run),
            baseActivityRevision: current.revision, basePlanRevision: current.currentPlanRevision,
            status: "pending", createdAt: new Date().toISOString() };
          state.proposals[proposalId] = proposal;
          return { state, result: proposal };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async acceptProposal({ proposalId, commandId }) {
      try {
        return await store.transact((state) => {
          assertState(state);
          const proposal = state.proposals[proposalId];
          if (!proposal || proposal.ownerId !== ownerId) {
            throw new AppError("PROPOSAL_NOT_FOUND", "변경안을 찾을 수 없어요.", { httpStatus: 404 });
          }
          if (proposal.status === "accepted" && proposal.acceptedCommandId === commandId) {
            return { state, result: { ...proposal.acceptResult, replayed: true } };
          }
          if (proposal.status !== "pending") {
            throw new AppError("PROPOSAL_CONFLICT", "이미 처리한 변경안이에요.", { httpStatus: 409 });
          }
          const context = issuedContext(state, proposal.contextId);
          validateContext(state, context, { activityId: proposal.activityId, requireActivityBinding: true });
          const type = proposal.kind === "draft" ? "plan.applyDraft" : "plan.applyPatch";
          const payload = proposal.kind === "draft" ? { draft: proposal.plan } : { patch: proposal.plan };
          const applied = applyActivityCommand(state.activities, {
            ownerId, commandId, type, activityId: proposal.activityId,
            expectedRevision: proposal.baseActivityRevision, payload,
          }, activityOptions(state));
          state.activities = applied.state;
          registerContextWatch(state, proposal.activityId, context);
          state.reviewEvents = state.reviewEvents.filter((item) => item.activityId !== proposal.activityId);
          proposal.status = "accepted";
          proposal.acceptedCommandId = commandId;
          proposal.acceptedAt = new Date().toISOString();
          proposal.acceptResult = { ...applied.result, proposalId };
          return { state, result: { ...proposal.acceptResult, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async knowledgeCommand(raw) {
      const command = injectOwner(raw, ownerId);
      try {
        return await store.transact((state) => {
          assertState(state);
          const before = state.knowledge.sequence;
          const applied = applyKnowledgeCommand(state.knowledge, command, { predicates });
          if (!applied.replayed) {
            if (command.type === "entity.create" && !entityTypes.has(command.payload?.type)) {
              throw new AppError("UNKNOWN_ENTITY_TYPE", "등록되지 않은 대상 종류예요.", { httpStatus: 400 });
            }
            if (command.type === "mention.create" && !entityTypes.has(command.payload?.entityType)) {
              throw new AppError("UNKNOWN_ENTITY_TYPE", "등록되지 않은 언급 대상 종류예요.", { httpStatus: 400 });
            }
            if (["assertion.add", "assertion.correct"].includes(command.type)) {
              validateAssertionRelation(state, command.type === "assertion.correct" ? command.payload?.assertion : command.payload);
            }
          }
          state.knowledge = applied.state;
          if (!applied.replayed) {
            recordAffectedConsumers(state, before);
          }
          return { state, result: { ...applied.result, replayed: applied.replayed,
            knowledgeSequence: state.knowledge.sequence } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async importReviewedCapture(raw) {
      const input = injectOwner(raw, ownerId);
      try {
        return await store.transact((state) => {
          assertState(state);
          const previous = state.importReceipts[input.importId];
          const prepared = buildReviewedCaptureImport(input, { previousImport: previous });
          if (previous) {
            return { state, result: { ...previous.result, replayed: true } };
          }
          const before = state.knowledge.sequence;
          for (const command of prepared.commands) {
            if (command.type === "entity.create" && !entityTypes.has(command.payload.type)) {
              throw new AppError("UNKNOWN_ENTITY_TYPE", "등록되지 않은 수집 대상 종류예요.", { httpStatus: 400 });
            }
            if (command.type === "mention.create" && !entityTypes.has(command.payload.entityType)) {
              throw new AppError("UNKNOWN_ENTITY_TYPE", "등록되지 않은 언급 대상 종류예요.", { httpStatus: 400 });
            }
            if (command.type === "assertion.add") validateAssertionRelation(state, command.payload);
            state.knowledge = applyKnowledgeCommand(state.knowledge, command, { predicates }).state;
          }
          recordAffectedConsumers(state, before);
          const result = { importId: prepared.importId, sourceId: prepared.sourceId,
            sourceVersionId: prepared.sourceVersionId, materialId: prepared.materialId,
            unresolvedMentions: prepared.unresolvedMentions, omissions: prepared.omissions,
            knowledgeSequence: state.knowledge.sequence };
          state.importReceipts[input.importId] = { ...prepared.importReceipt, result };
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async queryKnowledge(query) {
      try { return await read((state) => queryKnowledge(state.knowledge, injectOwner(query, ownerId))); }
      catch (error) { throw toHttpError(error); }
    },
    async resolveKnowledge(query) {
      try { return await read((state) => resolveKnowledge(state.knowledge, injectOwner(query, ownerId), { predicates })); }
      catch (error) { throw toHttpError(error); }
    },
    async searchKnowledge(query) {
      try { return await read((state) => retrieveKnowledge(state.knowledge,
        injectOwner(query, ownerId), { registry: predicates })); }
      catch (error) { throw toHttpError(error); }
    },
    async listResources() {
      try { return await read((state) => state.resources.resources
        .filter((item) => item.ownerId === ownerId)
        .map((item) => projectResourceAvailability(state.resources,
          { ownerId, resourceId: item.id }))); }
      catch (error) { throw toHttpError(error); }
    },
    async resourceAvailability(request) {
      try { return await read((state) => projectResourceAvailability(state.resources,
        injectOwner(request, ownerId))); }
      catch (error) { throw toHttpError(error); }
    },
    async resourceCommand(raw) {
      const command = injectOwner(raw, ownerId);
      try {
        return await store.transact((state) => {
          assertState(state);
          if (!["resource.create", "resource.observe", "claim.acquire", "claim.release"].includes(command.type) ||
              command.commandId?.startsWith("kernel:")) {
            throw new AppError("INVALID_REQUEST", "지원하지 않는 자원 명령이에요.", { httpStatus: 400 });
          }
          const applied = applyResourceCommand(state.resources, command);
          if (["claim.acquire", "claim.release"].includes(command.type)) {
            const activity = board(state, command.payload?.activityId);
            if (!applied.replayed && command.type === "claim.acquire" && activity.lifecycle !== "active") {
              throw new AppError("INVALID_TRANSITION", "종료된 활동에는 자원을 배정할 수 없어요.", { httpStatus: 409 });
            }
          }
          state.resources = applied.state;
          if (!applied.replayed && ["resource.observe", "claim.acquire", "claim.release"].includes(command.type)) {
            recordResourceChange(state, command.payload.resourceId,
              { includeHolders: command.type === "resource.observe" });
          }
          return { state, result: { ...applied.result, replayed: applied.replayed } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async createContext(request) {
      try {
        return await store.transact((state) => {
          assertState(state);
          const input = injectOwner(request, ownerId);
          if (!Array.isArray(input.queries) || input.queries.length > 100) {
            throw new AppError("INVALID_REQUEST", "조회 조건은 최대 100개예요.", { httpStatus: 400 });
          }
          if (input.atTime != null && input.retrievalQuery?.atTime != null &&
              Date.parse(input.atTime) !== Date.parse(input.retrievalQuery.atTime)) {
            throw new AppError("INVALID_REQUEST", "검색과 맥락의 기준 시간이 달라요.", { httpStatus: 400 });
          }
          const atTime = input.atTime ?? input.retrievalQuery?.atTime ?? new Date().toISOString();
          const context = buildKnowledgeContext(state.knowledge, { ...input, atTime }, { predicates });
          const activity = input.activityId == null ? null : board(state, input.activityId);
          context.activityId = input.activityId ?? null;
          if (input.resourceIds != null && (!Array.isArray(input.resourceIds) || input.resourceIds.length > 100)) {
            throw new AppError("INVALID_REQUEST", "자원 조회 조건은 최대 100개예요.", { httpStatus: 400 });
          }
          const resourceIds = new Set((input.resourceIds ?? []).map((id) => safeId(id, "resourceId")));
          for (const claim of activity?.resourceClaims ?? []) {
            if (claim.state === "held") resourceIds.add(claim.resourceId);
          }
          context.resourceAvailability = [...resourceIds].map((resourceId) =>
            projectResourceAvailability(state.resources, { ownerId, resourceId }));
          context.resourceReads = context.resourceAvailability.map((item) =>
            ({ resourceId: item.resourceId, revision: item.resourceRevision,
              status: item.status, freshUntil: item.freshUntil }));
          if (input.retrievalQuery != null) {
            context.retrieval = retrieveKnowledge(state.knowledge,
              { ...injectOwner(input.retrievalQuery, ownerId), atTime }, { registry: predicates });
          }
          const assertionIds = new Set(context.resolutions.flatMap((resolution) => [
            ...resolution.selectedAssertionIds, ...resolution.alternativeAssertionIds,
            ...resolution.staleAssertionIds,
          ]));
          for (const candidate of context.retrieval?.candidates ?? []) {
            for (const support of candidate.supports) {
              for (const id of support.assertionIds ?? []) assertionIds.add(id);
            }
          }
          const assertions = state.knowledge.assertions.filter((item) =>
            item.ownerId === ownerId && assertionIds.has(item.id));
          const evidenceIds = new Set(assertions.flatMap((item) => item.evidenceIds));
          for (const candidate of context.retrieval?.candidates ?? []) {
            for (const id of candidate.evidenceIds) evidenceIds.add(id);
          }
          context.goal = activity?.goal ?? structuredClone(input.goal ?? null);
          context.explicitConstraints = activity?.constraints ?? structuredClone(input.explicitConstraints ?? []);
          context.activityRevision = activity?.revision ?? null;
          context.activePlanRevision = activity?.currentPlanRevision ?? null;
          context.taskStates = activity?.tasks.map(({ id, executionStatus, revision, latestOutputRef, needsReview }) =>
            ({ id, executionStatus, revision, latestOutputRef, needsReview })) ?? [];
          const selectedIds = new Set([
            ...input.queries.map((query) => query.subjectId),
            ...(context.retrieval?.candidates ?? []).map((candidate) => candidate.entityId),
          ]);
          context.selectedEntities = [...selectedIds].map((id) => state.knowledge.entities.find((item) =>
            item.ownerId === ownerId && item.id === id && item.status === "active"))
            .filter(Boolean).map(({ id, type, label, revision }) => ({ id, type, label, revision }));
          context.assertions = structuredClone(assertions);
          context.evidenceFragments = state.knowledge.evidence.filter((item) =>
            item.ownerId === ownerId && item.status === "active" && evidenceIds.has(item.id))
            .map((item) => ({ id: item.id, sourceVersionId: item.sourceVersionId,
              locator: item.locator, quote: item.quote.slice(0, 500) }));
          context.missingFacts = context.resolutions.filter((item) => item.status === "unknown");
          context.conflicts = context.resolutions.filter((item) => item.status === "disputed");
          context.staleFacts = context.resolutions.filter((item) => item.status === "stale");
          context.retrievalVersion = context.retrieval ? "graph-v1" : "direct-query-v1";
          const contextId = randomUUID();
          for (const [id, issued] of Object.entries(state.issuedContexts)) {
            if (Date.parse(issued.expiresAt) <= Date.now()) delete state.issuedContexts[id];
          }
          state.issuedContexts[contextId] = { ownerId, context,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
          return { state, result: { contextId, ...context } };
        });
      }
      catch (error) { throw toHttpError(error); }
    },
    async watchContext({ activityId, contextId }) {
      try {
        return await store.transact((state) => {
          assertState(state);
          board(state, activityId); // Checks ownership before saving a watch.
          const context = issuedContext(state, contextId);
          validateContext(state, context, { activityId });
          const watch = registerContextWatch(state, activityId, context);
          for (const event of watch.catchUpEvents) {
            const key = `${activityId}:${event.id}`;
            if (!state.reviewEvents.some((item) => item.key === key)) {
              state.reviewEvents.push({ key, activityId, eventIds: [event.id], timeDue: false });
            }
          }
          return { state, result: { registeredAtSequence: watch.registeredAtSequence,
            catchUpEventIds: watch.catchUpEvents.map((event) => event.id) } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async executeCapability({ id, input }) {
      try { return { output: registry.execute(id, input) }; }
      catch (error) { throw toHttpError(error); }
    },
    async runTask(input) {
      try {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new AppError("INVALID_REQUEST", "작업 실행 요청 형식이 올바르지 않아요.", { httpStatus: 400 });
        }
        const activityId = safeId(input.activityId, "activityId");
        const taskId = safeId(input.taskId, "taskId");
        const commandId = safeId(input.commandId, "commandId");
        const { expectedRevision } = input;
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new AppError("INVALID_REQUEST", "expectedRevision 형식이 올바르지 않아요.", { httpStatus: 400 });
        }
        return await store.transact((state) => {
          assertState(state);
          const key = `${ownerId}:${commandId}`;
          const hash = fingerprint({ activityId, taskId, expectedRevision });
          const previous = state.executionReceipts[key];
          if (previous) {
            if (previous.hash !== hash) throw new AppError("COMMAND_CONFLICT", "명령 ID가 다른 실행에 사용됐어요.", { httpStatus: 409 });
            return { state, result: { ...previous.result, replayed: true } };
          }
          const current = board(state, activityId);
          if (current.revision !== expectedRevision) throw new AppError("REVISION_CONFLICT", "활동이 변경됐어요.", { httpStatus: 409 });
          const watched = state.knowledge.subscriptions.find((item) =>
            item.ownerId === ownerId && item.consumerId === activityId);
          if (current.pendingChanges.length ||
              (watched && !validateKnowledgeContext(state.knowledge, watched.context, { predicates }).valid) ||
              (state.retrievalWatches[activityId] && !validateRetrievalResult(state.knowledge,
                state.retrievalWatches[activityId], { registry: predicates }).valid) ||
              (state.resourceWatches[activityId] ?? []).some(({ resourceId, revision, status }) => {
                const resource = state.resources.resources.find((item) => item.ownerId === ownerId && item.id === resourceId);
                return !resource || resource.revision !== revision ||
                  projectResourceAvailability(state.resources, { ownerId, resourceId }).status !== status;
              })) {
            throw new AppError("CONTEXT_STALE", "지식 근거가 변경돼 작업을 재검토해야 해요.", { httpStatus: 409 });
          }
          const task = current.tasks.find((item) => item.id === taskId);
          if (!task) throw new AppError("TASK_NOT_FOUND", "작업을 찾을 수 없어요.", { httpStatus: 404 });
          if (task.readiness.status !== "ready" || task.executionStatus !== "not_started") {
            throw new AppError("TASK_BLOCKED", "실행 가능한 작업이 아니에요.", { httpStatus: 409 });
          }
          const spec = registry.getCapability(task.capabilityId);
          if (spec.actor !== "system" || spec.effect !== "none") {
            throw new AppError("DOMAIN_EXECUTION_UNAVAILABLE", "자동 실행할 수 없는 작업이에요.", { httpStatus: 400 });
          }
          const output = registry.execute(spec.id, task.readiness.inputs);
          const recorded = applyActivityCommand(state.activities, {
            ownerId, commandId: `${commandId}:result`, type: "task.recordResult",
            activityId, expectedRevision,
            payload: { taskId, value: output },
          }, activityOptions(state));
          const completed = applyActivityCommand(recorded.state, {
            ownerId, commandId: `${commandId}:complete`, type: "task.transition",
            activityId, expectedRevision: recorded.result.revision,
            payload: { taskId, to: "completed" },
          }, activityOptions(state));
          state.activities = completed.state;
          const result = { activityId, taskId, resultId: recorded.result.resultId,
            revision: completed.result.revision, output };
          state.executionReceipts[key] = { hash, result };
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
  };
}
