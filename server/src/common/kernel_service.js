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
  resolveKnowledge, unregisterKnowledgeWatch, validateKnowledgeContext,
} from "../knowledge/index.js";
import { retrieveKnowledge, validateRetrievalResult } from "../retrieval/index.js";
import { buildRecipePlanDraft } from "../scenarios/recipe_plan.js";
import { buildDiningPlanDraft } from "../scenarios/dining_plan.js";
import { buildFashionPlanDraft } from "../scenarios/fashion_plan.js";
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
    recipeScenarioReceipts: {},
    diningScenarioReceipts: {},
    diningCommandReceipts: {},
    fashionScenarioReceipts: {},
    fashionCommandReceipts: {},
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

function canonicalRequest(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalRequest).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalRequest(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint(value) {
  return createHash("sha256").update(canonicalRequest(value)).digest("hex");
}

function safeId(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 512 ||
      ["__proto__", "constructor", "prototype"].includes(value)) {
    throw new AppError("INVALID_REQUEST", `${name} 형식이 올바르지 않아요.`, { httpStatus: 400 });
  }
  return value;
}

function requestObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("INVALID_REQUEST", "요청 형식이 올바르지 않아요.", { httpStatus: 400 });
  }
  return value;
}

function placeKey(value) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, "").toLowerCase() : "";
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
      validateKnowledgeDependencies(dependencies, activityId) {
        if (!Array.isArray(dependencies)) return false;
        return dependencies.every((item) => {
          if (typeof item?.contextId !== "string") return false;
          try {
            const context = issuedContext(state, item.contextId);
            validateContext(state, context, { activityId, requireActivityBinding: true });
            return true;
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
    if (hasStaleResourceReads(state, context.resourceReads)) {
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

  function hasStaleResourceReads(state, reads = []) {
    return reads.some(({ resourceId, revision, status }) => {
      const resource = state.resources.resources.find((item) => item.ownerId === ownerId && item.id === resourceId);
      return !resource || resource.revision !== revision ||
        projectResourceAvailability(state.resources, { ownerId, resourceId }).status !== status;
    });
  }

  function activityContextIsStale(state, activityId, current = board(state, activityId)) {
    const watched = state.knowledge.subscriptions.find((item) =>
      item.ownerId === ownerId && item.consumerId === activityId);
    return current.pendingChanges.length > 0 ||
      (watched && !validateKnowledgeContext(state.knowledge, watched.context, { predicates }).valid) ||
      (state.retrievalWatches[activityId] && !validateRetrievalResult(state.knowledge,
        state.retrievalWatches[activityId], { registry: predicates }).valid) ||
      hasStaleResourceReads(state, state.resourceWatches[activityId]);
  }

  function assertActivityContextCurrent(state, activityId, current) {
    if (activityContextIsStale(state, activityId, current)) {
      throw new AppError("CONTEXT_STALE", "근거가 변경돼 작업을 재검토해야 해요.", { httpStatus: 409 });
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

  // A confirmed recipe is a derivative of its confirmation source. The KG
  // redacts source values; the activity kernel has separate copies in plans,
  // task results and issued contexts, so erase those in the same transaction.
  function redactScenarioReceipts(state, receipts, sourceId) {
    for (const receipt of receipts) {
      const { activityId } = receipt.result;
      for (const claim of state.resources.claims.filter((item) => item.ownerId === ownerId &&
          item.activityId === activityId && item.state === "held")) {
        const resource = state.resources.resources.find((item) => item.ownerId === ownerId &&
          item.id === claim.resourceId);
        state.resources = applyResourceCommand(state.resources, {
          ownerId, commandId: `kernel:scenario-redact:${sourceId}:${claim.id}`,
          type: "claim.release", expectedRevision: resource.revision,
          payload: { activityId, resourceId: claim.resourceId, claimId: claim.id },
        }).state;
        recordResourceChange(state, claim.resourceId);
      }
      delete state.activities.activities[activityId];
      state.activities.events = state.activities.events.filter((item) => item.activityId !== activityId);
      for (const [key, item] of Object.entries(state.activities.commandReceipts)) {
        if (item.result?.activityId === activityId) delete state.activities.commandReceipts[key];
      }
      for (const [key, item] of Object.entries(state.activities.reminders)) {
        if (item.activityId === activityId) delete state.activities.reminders[key];
      }
      for (const [key, item] of Object.entries(state.activities.occurrences)) {
        if (item.activityId === activityId) delete state.activities.occurrences[key];
      }
      state.resources.claims = state.resources.claims.filter((item) => item.ownerId !== ownerId ||
        item.activityId !== activityId);
      state.resources.activities = state.resources.activities.filter((item) => item.ownerId !== ownerId ||
        item.id !== activityId);
      state.resources.events = state.resources.events.filter((item) => item.activityId !== activityId);
      state.resources.receipts = state.resources.receipts.filter((item) =>
        item.result?.activity?.id !== activityId && item.result?.claim?.activityId !== activityId);
      for (const [key, item] of Object.entries(state.proposals)) {
        if (item.activityId === activityId) delete state.proposals[key];
      }
      for (const [key, item] of Object.entries(state.issuedContexts)) {
        if (item.context?.activityId === activityId) delete state.issuedContexts[key];
      }
      for (const [key, item] of Object.entries(state.executionReceipts)) {
        if (item.result?.activityId === activityId) delete state.executionReceipts[key];
      }
      state.reviewEvents = state.reviewEvents.filter((item) => item.activityId !== activityId);
      state.knowledge = unregisterKnowledgeWatch(state.knowledge, { ownerId, consumerId: activityId });
      delete state.retrievalWatches[activityId];
      delete state.resourceWatches[activityId];
      for (const receipts of [state.diningCommandReceipts, state.fashionCommandReceipts]) {
        for (const item of Object.values(receipts ?? {})) {
          if (item.activityId === activityId) {
            item.deleted = true;
            item.result = { activityId };
          }
        }
      }
      receipt.deleted = true;
      receipt.result = { activityId, ...(receipt.result.confirmationSourceId
        ? { confirmationSourceId: sourceId } : {}) };
    }
  }

  function redactRecipeScenario(state, sourceId) {
    redactScenarioReceipts(state, Object.values(state.recipeScenarioReceipts ?? {}).filter((entry) =>
      entry.result?.confirmationSourceId === sourceId && !entry.deleted), sourceId);
  }

  function redactDiningScenario(state, sourceId, activityId = null) {
    redactScenarioReceipts(state, Object.values(state.diningScenarioReceipts ?? {}).filter((entry) =>
      !entry.deleted && (entry.result?.activityId === activityId || entry.importIds?.some((id) =>
        state.importReceipts[id]?.sourceId === sourceId))), sourceId);
  }

  function redactFashionScenario(state, sourceId, activityId = null) {
    redactScenarioReceipts(state, Object.values(state.fashionScenarioReceipts ?? {}).filter((entry) =>
      !entry.deleted && (entry.result?.activityId === activityId ||
        entry.result?.confirmationSourceId === sourceId || entry.importIds?.some((id) =>
          state.importReceipts[id]?.sourceId === sourceId))), sourceId);
  }

  function redactImportedCapture(state, sourceId) {
    const versions = new Set(state.knowledge.sourceVersions.filter((item) => item.ownerId === ownerId &&
      item.sourceId === sourceId).map((item) => item.id));
    for (const entity of state.knowledge.entities.filter((item) => item.ownerId === ownerId &&
      item.type === "ingestion.material" && versions.has(item.externalIds?.sourceVersionId))) {
      entity.externalIds = {};
      entity.revision += 1;
    }
    for (const receipt of Object.values(state.importReceipts)) {
      if (receipt.ownerId === ownerId && receipt.sourceId === sourceId) {
        receipt.deleted = true;
        delete receipt.legacyCaptureId;
      }
    }
  }

  function purgeIssuedContextsFromSource(state, sourceId) {
    const versionIds = new Set(state.knowledge.sourceVersions.filter((item) =>
      item.ownerId === ownerId && item.sourceId === sourceId).map((item) => item.id));
    const evidenceIds = new Set(state.knowledge.evidence.filter((item) =>
      item.ownerId === ownerId && versionIds.has(item.sourceVersionId)).map((item) => item.id));
    const removed = new Set();
    for (const [contextId, issued] of Object.entries(state.issuedContexts)) {
      if (issued.ownerId !== ownerId) continue;
      const context = issued.context;
      const cited = context.assertions?.some((item) => item.evidenceIds?.some((id) => evidenceIds.has(id))) ||
        context.evidenceFragments?.some((item) => versionIds.has(item.sourceVersionId)) ||
        context.retrieval?.candidates?.some((item) => item.evidenceIds?.some((id) => evidenceIds.has(id)));
      if (cited) {
        delete state.issuedContexts[contextId];
        removed.add(contextId);
      }
    }
    for (const [proposalId, proposal] of Object.entries(state.proposals)) {
      if (proposal.ownerId === ownerId && removed.has(proposal.contextId)) delete state.proposals[proposalId];
    }
  }

  function sourceDeletionContext(state, sourceId) {
    const source = state.knowledge.sources.find((item) => item.ownerId === ownerId &&
      item.id === sourceId && item.status === "active");
    const fashionActivityIds = source?.kind === "capture_analysis"
      ? new Set(Object.values(state.fashionScenarioReceipts ?? {}).filter((item) =>
        !item.deleted && item.importIds?.some((id) =>
          state.importReceipts[id]?.sourceId === source.id)).map((item) => item.result.activityId))
      : new Set(source?.provenance?.scenario === "fashion" && source.provenance.activityId
        ? [source.provenance.activityId] : []);
    const linkedConfirmations = source?.kind === "capture_analysis"
      ? state.knowledge.sources.filter((item) => item.ownerId === ownerId &&
        item.status === "active" && item.kind === "user_confirmation" &&
        ((item.provenance?.scenario === "recipe" &&
          item.provenance?.importedSourceId === source.id) ||
          (item.provenance?.scenario === "fashion" &&
            fashionActivityIds.has(item.provenance.activityId)))).map((item) => item.id) : [];
    const linkedFashionSources = state.knowledge.sources.filter((item) =>
      item.ownerId === ownerId && item.status === "active" && item.id !== sourceId &&
      item.provenance?.scenario === "fashion" &&
      fashionActivityIds.has(item.provenance.activityId) &&
      (item.kind === "user_confirmation" || item.kind === "user_report"))
      .map((item) => item.id);
    return { source, linkedConfirmations, linkedFashionSources };
  }

  function finishSourceDeletion(state, { source, linkedConfirmations, linkedFashionSources }) {
    if (source) purgeIssuedContextsFromSource(state, source.id);
    if (source?.kind === "user_confirmation" && source.provenance?.scenario === "recipe") {
      redactRecipeScenario(state, source.id);
    }
    if (source?.kind === "user_confirmation" && source.provenance?.scenario === "fashion") {
      redactFashionScenario(state, source.id, source.provenance.activityId);
    }
    if (source?.kind === "user_report" && source.provenance?.scenario === "dining") {
      redactDiningScenario(state, source.id, source.provenance.activityId);
    }
    if (source?.kind === "user_report" && source.provenance?.scenario === "fashion") {
      redactFashionScenario(state, source.id, source.provenance.activityId);
    }
    if (source?.kind === "capture_analysis") {
      redactImportedCapture(state, source.id);
      redactDiningScenario(state, source.id);
      redactFashionScenario(state, source.id);
      for (const sourceId of linkedConfirmations) {
        state.knowledge = applyKnowledgeCommand(state.knowledge, {
          ownerId, commandId: `kernel:source-cascade:${sourceId}`,
          type: "source.delete", payload: { sourceId },
        }, { predicates }).state;
        purgeIssuedContextsFromSource(state, sourceId);
        redactRecipeScenario(state, sourceId);
        redactFashionScenario(state, sourceId);
      }
    }
    for (const sourceId of linkedFashionSources) {
      const linked = state.knowledge.sources.find((item) => item.id === sourceId);
      if (linked?.status !== "active") continue;
      state.knowledge = applyKnowledgeCommand(state.knowledge, {
        ownerId, commandId: `kernel:source-cascade:${sourceId}`,
        type: "source.delete", payload: { sourceId },
      }, { predicates }).state;
      purgeIssuedContextsFromSource(state, sourceId);
      redactFashionScenario(state, sourceId);
    }
  }

  function issueContext(state, request) {
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
    return { contextId, ...context };
  }

  function diningCandidates(state, importIds, area) {
    const groups = new Map();
    const contextQueries = [];
    for (const importId of importIds) {
      const receipt = state.importReceipts[importId];
      if (receipt?.ownerId !== ownerId || receipt.deleted) {
        throw new AppError("IMPORT_NOT_FOUND", "연결할 확인 자료를 찾을 수 없어요.", { httpStatus: 404 });
      }
      const version = state.knowledge.sourceVersions.find((item) =>
        item.ownerId === ownerId && item.id === receipt.sourceVersionId && item.status === "active");
      const analysis = version?.content?.analysis;
      const place = analysis?.place;
      if (analysis?.contentKind !== "place" ||
          !["restaurant", "cafe"].includes(place?.category) || !place?.name?.trim()) {
        throw new AppError("IMPORT_NOT_DINING", "식당·카페로 확인한 자료만 사용할 수 있어요.",
          { httpStatus: 400 });
      }
      const searchArea = place.searchArea?.trim() || "";
      const address = place.address?.trim() || "";
      if (searchArea && placeKey(searchArea) !== placeKey(area) &&
          !placeKey(address).includes(placeKey(area))) continue;
      if (!searchArea && address && !placeKey(address).includes(placeKey(area))) continue;
      const mention = state.knowledge.entityMentions.find((item) =>
        item.ownerId === ownerId && item.sourceVersionId === version.id &&
        item.entityType === "dining.place" && item.status === "active");
      if (!mention) continue;
      const key = [placeKey(place.name), placeKey(searchArea), placeKey(address)].join("|");
      const id = `dining-candidate:${fingerprint([ownerId, key]).slice(0, 24)}`;
      const group = groups.get(key) ?? { id, name: place.name.trim(),
        searchArea: searchArea || area, importIds: [], mentionIds: [], evidenceIds: [] };
      group.importIds.push(importId);
      group.mentionIds.push(mention.id);
      group.evidenceIds.push(...mention.evidenceIds);
      groups.set(key, group);
      const field = state.knowledge.assertions.find((item) => item.ownerId === ownerId &&
        item.subjectId === receipt.result?.materialId &&
        item.predicate === "ingestion.extracted_field" &&
        item.typedValue?.value?.path === "/place/name" && item.status === "active");
      if (field) contextQueries.push({ subjectId: field.subjectId,
        predicate: field.predicate, scope: field.scope });
    }
    const candidates = [...groups.values()].map((item) => ({ ...item,
      evidenceIds: [...new Set(item.evidenceIds)] }));
    if (candidates.length === 0) {
      throw new AppError("NO_DINING_CANDIDATES", "이 지역에서 확인한 식당을 찾지 못했어요.",
        { httpStatus: 400 });
    }
    return { candidates, contextQueries };
  }

  function fashionCandidates(state, importIds) {
    const candidates = [];
    const contextQueries = [];
    for (const importId of importIds) {
      const receipt = state.importReceipts[importId];
      if (receipt?.ownerId !== ownerId || receipt.deleted) {
        throw new AppError("IMPORT_NOT_FOUND", "연결할 확인 자료를 찾을 수 없어요.", { httpStatus: 404 });
      }
      const version = state.knowledge.sourceVersions.find((item) =>
        item.ownerId === ownerId && item.id === receipt.sourceVersionId && item.status === "active");
      const analysis = version?.content?.analysis;
      if (!analysis || analysis.contentKind !== "commerce_product" ||
          !analysis.tags?.some((item) => item.facet === "kind" && item.value === "패션") ||
          analysis.title?.status !== "observed" || !analysis.title.value?.trim()) {
        throw new AppError("IMPORT_NOT_FASHION", "상품명이 보이는 패션 자료만 사용할 수 있어요.",
          { httpStatus: 400 });
      }
      const mention = state.knowledge.entityMentions.find((item) =>
        item.ownerId === ownerId && item.sourceVersionId === version.id &&
        item.entityType === "core.product" && item.status === "active");
      if (!mention) throw new AppError("IMPORT_NOT_FASHION", "상품 근거를 확인할 수 없어요.",
        { httpStatus: 400 });
      candidates.push({ importId, name: analysis.title.value.trim(), mentionId: mention.id,
        evidenceIds: [...mention.evidenceIds] });
      const field = state.knowledge.assertions.find((item) => item.ownerId === ownerId &&
        item.subjectId === receipt.result?.materialId &&
        item.predicate === "ingestion.extracted_field" &&
        item.typedValue?.value?.path === "/title/value" && item.status === "active");
      if (!field) throw new AppError("CONTEXT_STALE", "상품명 근거가 변경됐어요.", { httpStatus: 409 });
      contextQueries.push({ subjectId: field.subjectId, predicate: field.predicate,
        scope: field.scope });
    }
    return { candidates, contextQueries };
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
    async listBoardSummaries(options = {}) {
      try {
        const { limit = 20, cursor = null } = requestObject(options);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
            (cursor !== null && (typeof cursor !== "string" || !cursor.trim()))) {
          throw new AppError("INVALID_REQUEST", "목록 조회 범위가 올바르지 않아요.", { httpStatus: 400 });
        }
        return await read((state) => {
          const ids = Object.values(state.activities.activities)
            .filter((activity) => activity.ownerId === ownerId && (cursor === null || activity.id > cursor))
            .map((activity) => activity.id).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
          const pageIds = ids.slice(0, limit);
          const pageSet = new Set(pageIds);
          const pendingChanges = new Map();
          const pendingProposals = new Map();
          for (const event of state.reviewEvents) {
            if (pageSet.has(event.activityId)) {
              pendingChanges.set(event.activityId, (pendingChanges.get(event.activityId) ?? 0) + 1);
            }
          }
          for (const proposal of Object.values(state.proposals)) {
            if (proposal.ownerId === ownerId && proposal.status === "pending" && pageSet.has(proposal.activityId)) {
              pendingProposals.set(proposal.activityId, (pendingProposals.get(proposal.activityId) ?? 0) + 1);
            }
          }
          const boards = pageIds.map((id) => {
            const activity = state.activities.activities[id];
            const readyTaskCount = getActivityBoard(state.activities, id, { ownerId }).nextActions.length;
            return { id, title: activity.title, goal: activity.goal, lifecycle: activity.lifecycle,
              revision: activity.revision, currentPlanRevision: activity.currentPlanRevision,
              taskCount: activity.tasks.length, readyTaskCount,
              pendingChangeCount: pendingChanges.get(id) ?? 0,
              pendingProposalCount: pendingProposals.get(id) ?? 0 };
          });
          return { boards, nextCursor: ids.length > limit ? pageIds.at(-1) : null };
        });
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
            if (["dining.select_place", "dining.record_visit_outcome",
              "fashion.confirm_outfit", "fashion.record_wear_outcome"].includes(spec.id) &&
                (command.type === "task.recordResult" || command.payload?.to === "completed" ||
                  Object.hasOwn(command.payload ?? {}, "output"))) {
              throw new AppError("TASK_EXECUTION_RESTRICTED", "확인·결과 작업은 전용 경로로 기록해 주세요.",
                { httpStatus: 403 });
            }
            const writesOutput = command.type === "task.recordResult" ||
              Object.hasOwn(command.payload ?? {}, "output");
            if ((writesOutput || command.payload?.to === "completed") &&
                (spec.actor === "system" || spec.effect === "external_write")) {
              throw new AppError("TASK_EXECUTION_RESTRICTED", "이 작업은 등록된 실행기를 통해서만 완료할 수 있어요.", { httpStatus: 403 });
            }
            if (writesOutput ||
                ["in_progress", "completed"].includes(command.payload?.to)) {
              assertActivityContextCurrent(state, command.activityId, current);
            }
          }
          if (!applied.replayed && command.type === "activity.complete") {
            assertActivityContextCurrent(state, command.activityId, board(state, command.activityId));
          }
          if (!applied.replayed && command.contextId) {
            const context = issuedContext(state, command.contextId);
            const activityId = command.activityId ?? applied.result.activityId;
            const createsActivity = ["activity.create", "recurrence.materialize"].includes(command.type);
            if (createsActivity && context.activityId != null) {
              throw new AppError("CONTEXT_STALE", "다른 활동의 맥락을 새 활동에 사용할 수 없어요.", { httpStatus: 409 });
            }
            validateContext(state, context, { activityId: createsActivity ? null : activityId });
            registerContextWatch(state, activityId, context);
            if (["plan.applyDraft", "plan.applyPatch"].includes(command.type)) {
              state.reviewEvents = state.reviewEvents.filter((item) => item.activityId !== activityId);
            }
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
    async proposePlan(request) {
      try {
        const { activityId, contextId, kind, plan, run = {} } = requestObject(request);
        safeId(activityId, "activityId");
        safeId(contextId, "contextId");
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
    async acceptProposal(request) {
      try {
        const { proposalId, commandId } = requestObject(request);
        safeId(proposalId, "proposalId");
        safeId(commandId, "commandId");
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
          const deletion = command.type === "source.delete"
            ? sourceDeletionContext(state, command.payload?.sourceId) : null;
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
            if (deletion) finishSourceDeletion(state, deletion);
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
          if (previous?.deleted) {
            throw new AppError("IMPORT_DELETED", "삭제한 자료는 다시 가져올 수 없어요.", { httpStatus: 410 });
          }
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
    async deleteReviewedCapture(raw) {
      try {
        const input = requestObject(raw);
        if (Object.keys(input).some((key) => !["importId", "commandId"].includes(key))) {
          throw new AppError("INVALID_REQUEST", "삭제 요청 형식이 올바르지 않아요.", { httpStatus: 400 });
        }
        const importId = safeId(input.importId, "importId");
        const commandId = safeId(input.commandId, "commandId");
        return await store.transact((state) => {
          assertState(state);
          const conflict = Object.values(state.importReceipts).some((entry) =>
            entry.ownerId === ownerId && entry.importId !== importId &&
            entry.deletedByCommandId === commandId);
          if (conflict) {
            throw new AppError("COMMAND_CONFLICT", "삭제 명령 ID가 다른 자료에 사용됐어요.", { httpStatus: 409 });
          }
          const receipt = state.importReceipts[importId];
          if (receipt && receipt.ownerId !== ownerId) {
            throw new AppError("IMPORT_NOT_FOUND", "삭제할 자료를 찾을 수 없어요.", { httpStatus: 404 });
          }
          if (receipt?.deleted) {
            return { state, result: { importId, sourceId: receipt.sourceId ?? null,
              deleted: true, replayed: true } };
          }
          const sourceId = receipt?.sourceId ?? null;
          if (sourceId) {
            const before = state.knowledge.sequence;
            const deletion = sourceDeletionContext(state, sourceId);
            if (deletion.source) {
              state.knowledge = applyKnowledgeCommand(state.knowledge, {
                ownerId, commandId: `kernel:import-delete:${requestFingerprint([ownerId, importId]).slice(0,32)}`,
                type: "source.delete", payload: { sourceId },
              }, { predicates }).state;
              finishSourceDeletion(state, deletion);
              recordAffectedConsumers(state, before);
            }
          }
          state.importReceipts[importId] ??= { ownerId, importId, sourceId };
          state.importReceipts[importId].deleted = true;
          state.importReceipts[importId].deletedByCommandId = commandId;
          delete state.importReceipts[importId].legacyCaptureId;
          return { state, result: { importId, sourceId, deleted: true, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async createRecipeScenario(raw) {
      try {
        const input = requestObject(raw);
        const allowed = new Set(["commandId", "activityId", "confirmed", "recipe", "targetServings",
          "inventory", "includeOptionalIngredientIds", "collectInventory", "includeCookTask", "importId", "synthetic"]);
        if (Object.keys(input).some((key) => !allowed.has(key)) || input.confirmed !== true ||
            (input.synthetic !== undefined && input.synthetic !== true) ||
            (input.synthetic === true && input.importId != null)) {
          throw new AppError("INVALID_REQUEST", "확인한 레시피 요청 형식이 올바르지 않아요.", { httpStatus: 400 });
        }
        const commandId = safeId(input.commandId, "commandId");
        const activityId = safeId(input.activityId, "activityId");
        const importId = input.importId == null ? null : safeId(input.importId, "importId");
        const rawRecipe = requestObject(input.recipe);
        if (!Array.isArray(rawRecipe.ingredients) || rawRecipe.ingredients.length > 25 ||
            typeof rawRecipe.title !== "string" || rawRecipe.title.length > 200 ||
            !Number.isInteger(rawRecipe.baseServings) || rawRecipe.baseServings < 1 ||
            rawRecipe.baseServings > 50 || !Number.isInteger(input.targetServings) ||
            input.targetServings < 1 || input.targetServings > 50 ||
            rawRecipe.ingredients.some((item) => !item || typeof item !== "object" ||
              typeof item.name !== "string" || item.name.length > 100 ||
              typeof item.id !== "string" || item.id.length > 512 ||
              typeof item.ingredientId !== "string" || item.ingredientId.length > 512 ||
              (item.quantity?.status === "known" && item.quantity.amount > 1e9)) ||
            (input.inventory != null && (!Array.isArray(input.inventory) || input.inventory.length > 0)) ||
            input.collectInventory === false) {
          throw new AppError("INVALID_REQUEST", "레시피 크기 또는 재고 확인 형식이 올바르지 않아요.", { httpStatus: 400 });
        }
        const requestHash = requestFingerprint({ activityId, confirmed: input.confirmed, recipe: input.recipe,
          targetServings: input.targetServings, inventory: input.inventory ?? [],
          includeOptionalIngredientIds: input.includeOptionalIngredientIds ?? [],
          collectInventory: input.collectInventory ?? null, includeCookTask: input.includeCookTask ?? true,
          importId, synthetic: input.synthetic === true });
        return await store.transact((state) => {
          assertState(state);
          state.recipeScenarioReceipts ??= {};
          const receiptKey = `${ownerId}:${commandId}`;
          const previous = state.recipeScenarioReceipts[receiptKey];
          if (previous) {
            if (previous.hash !== requestHash) {
              throw new AppError("COMMAND_CONFLICT", "명령 ID가 다른 레시피 요청에 사용됐어요.", { httpStatus: 409 });
            }
            if (previous.deleted) {
              throw new AppError("SCENARIO_DELETED", "삭제한 레시피 활동은 다시 만들 수 없어요.", { httpStatus: 410 });
            }
            return { state, result: { ...previous.result, replayed: true } };
          }
          const imported = importId === null ? null : state.importReceipts[importId];
          if (importId !== null && (imported?.ownerId !== ownerId ||
              !state.knowledge.sources.some((item) => item.ownerId === ownerId &&
                item.id === imported.sourceId && item.status === "active"))) {
            throw new AppError("IMPORT_NOT_FOUND", "연결할 확인 자료를 찾을 수 없어요.", { httpStatus: 404 });
          }
          if (imported) {
            const importedVersion = state.knowledge.sourceVersions.find((item) =>
              item.ownerId === ownerId && item.id === imported.sourceVersionId &&
              item.status === "active");
            if (!["recipe", "sauce_recipe"].includes(importedVersion?.content?.analysis?.contentKind)) {
              throw new AppError("IMPORT_NOT_RECIPE", "레시피로 확인한 자료만 연결할 수 있어요.",
                { httpStatus: 400 });
            }
          }
          const stem = `recipe:${fingerprint([ownerId, activityId]).slice(0,32)}`;
          const recipeEntityId = `${stem}:entity`;
          const confirmationSourceId = `${stem}:source`;
          const confirmationVersionId = `${stem}:version`;
          const confirmationEvidenceId = `${stem}:evidence`;
          const recipe = { ...rawRecipe, id: recipeEntityId, revision: 1 };
          const inventory = input.inventory ?? [];
          const collectInventory = true;
          const plan = buildRecipePlanDraft({ confirmed: true, recipe,
            targetServings: input.targetServings, inventory,
            includeOptionalIngredientIds: input.includeOptionalIngredientIds ?? [],
            collectInventory, includeCookTask: input.includeCookTask ?? true,
            evidenceIds: [confirmationEvidenceId] }, { registry });
          const now = new Date().toISOString();
          const content = { recipe, targetServings: input.targetServings, inventory,
            includeOptionalIngredientIds: input.includeOptionalIngredientIds ?? [],
            ...(imported ? { importedSourceId: imported.sourceId } : {}) };
          const applyKnowledge = (role, type, payload) => {
            if (type === "assertion.add") validateAssertionRelation(state, payload);
            state.knowledge = applyKnowledgeCommand(state.knowledge, {
              ownerId, commandId: `${stem}:${role}`, type, payload,
            }, { predicates }).state;
          };
          const beforeSequence = state.knowledge.sequence;
          applyKnowledge("source", "source.create", { id: confirmationSourceId,
            kind: "user_confirmation", title: recipe.title,
            provenance: { scenario: "recipe", activityId, synthetic: input.synthetic === true,
              ...(imported ? { importedSourceId: imported.sourceId } : {}) } });
          applyKnowledge("version", "source.version.add", { id: confirmationVersionId,
            sourceId: confirmationSourceId, contentHash: fingerprint(content), content, capturedAt: now });
          applyKnowledge("evidence", "evidence.add", { id: confirmationEvidenceId,
            sourceVersionId: confirmationVersionId,
            locator: { kind: "user_confirmation", jsonPointer: "/recipe" }, quote: recipe.title });
          applyKnowledge("recipe", "entity.create", { id: recipeEntityId,
            type: "recipe.recipe", label: "확인한 레시피" });
          const scope = { type: "activity", id: activityId };
          const contextQueries = [];
          const assertion = (role, subjectId, predicate, value, valueType = "recipe.recipe") => {
            const payload = { id: `${stem}:${role}`, subjectId, predicate, scope,
              origin: "user_reported", assertedBy: { type: "user", id: ownerId },
              evidenceIds: [confirmationEvidenceId], observedAt: now,
              ...(typeof value === "string" ? { objectEntityId: value } :
                { typedValue: { type: valueType, value } }) };
            applyKnowledge(role, "assertion.add", payload);
            if (!contextQueries.some((query) => query.subjectId === subjectId &&
                query.predicate === predicate)) {
              contextQueries.push({ subjectId, predicate, scope });
            }
          };
          assertion("confirmed", recipeEntityId, "recipe.confirmed_recipe", recipe);
          const ingredientIds = new Map();
          for (const item of recipe.ingredients) {
            let ingredientEntityId = ingredientIds.get(item.ingredientId);
            if (!ingredientEntityId) {
              ingredientEntityId = `${stem}:ingredient:${fingerprint(item.ingredientId).slice(0,16)}`;
              ingredientIds.set(item.ingredientId, ingredientEntityId);
              applyKnowledge(`ingredient:${item.ingredientId}`, "entity.create", {
                id: ingredientEntityId, type: "recipe.ingredient", label: "재료" });
            }
            const requirementId = `${stem}:requirement:${fingerprint(item.id).slice(0,16)}`;
            applyKnowledge(`requirement:${item.id}`, "entity.create", {
              id: requirementId, type: "recipe.ingredient_requirement", label: "재료 항목" });
            assertion(`has:${item.id}`, recipeEntityId, "recipe.has_requirement", requirementId);
            assertion(`requires:${item.id}`, requirementId, "recipe.requires_ingredient", ingredientEntityId);
            assertion(`value:${item.id}`, requirementId, "recipe.requirement_value", item,
              "recipe.ingredient_requirement");
          }
          recordAffectedConsumers(state, beforeSequence);
          const created = applyActivityCommand(state.activities, {
            ownerId, commandId: `${stem}:activity`, type: "activity.create", activityId,
            expectedRevision: 0,
            payload: { title: recipe.title,
              goal: { description: `${input.targetServings}인분 ${recipe.title} 만들기` } },
          }, activityOptions(state));
          state.activities = created.state;
          state.resources = applyResourceCommand(state.resources, {
            ownerId, commandId: `${stem}:resource-activity`, type: "activity.register",
            expectedRevision: 0, payload: { activityId },
          }).state;
          const issued = issueContext(state, { activityId, queries: contextQueries });
          if (issued.resolutions.some((item) => item.status !== "resolved")) {
            throw new AppError("CONTEXT_STALE", "확인한 레시피 사실을 계획에 연결할 수 없어요.", { httpStatus: 409 });
          }
          const enriched = enrichPlan("draft", plan);
          applyActivityCommand(state.activities, { ownerId,
            commandId: `${stem}:proposal-check`, type: "plan.applyDraft", activityId,
            expectedRevision: created.result.revision, payload: { draft: enriched },
          }, activityOptions(state));
          const proposalId = randomUUID();
          state.proposals[proposalId] = { id: proposalId, ownerId, activityId,
            contextId: issued.contextId, kind: "draft", plan: structuredClone(enriched),
            run: { scenario: "recipe", synthetic: input.synthetic === true, confirmationSourceId,
              ...(importId ? { importId } : {}) },
            baseActivityRevision: created.result.revision, basePlanRevision: 0,
            status: "pending", createdAt: now };
          const result = { activityId, revision: created.result.revision, proposalId,
            contextId: issued.contextId, recipeEntityId, confirmationSourceId };
          state.recipeScenarioReceipts[receiptKey] = { hash: requestHash, result };
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async createDiningScenario(raw) {
      try {
        const input = requestObject(raw);
        const allowed = new Set(["commandId", "activityId", "confirmed", "importIds",
          "scheduledAt", "area", "partySize"]);
        if (Object.keys(input).some((key) => !allowed.has(key)) || input.confirmed !== true ||
            !Array.isArray(input.importIds) || input.importIds.length < 1 ||
            input.importIds.length > 20 || !Number.isInteger(input.partySize) ||
            input.partySize < 1 || input.partySize > 20 ||
            typeof input.area !== "string" || !input.area.trim() || input.area.length > 80) {
          throw new AppError("INVALID_REQUEST", "맛집 활동 입력을 확인해 주세요.", { httpStatus: 400 });
        }
        const commandId = safeId(input.commandId, "commandId");
        const activityId = safeId(input.activityId, "activityId");
        const importIds = input.importIds.map((id) => safeId(id, "importId"));
        if (new Set(importIds).size !== importIds.length) {
          throw new AppError("INVALID_REQUEST", "같은 캡처를 중복 선택했어요.", { httpStatus: 400 });
        }
        registry.validate("core.timestamp", input.scheduledAt);
        const area = input.area.trim();
        const requestHash = requestFingerprint({ activityId, importIds, scheduledAt: input.scheduledAt,
          area, partySize: input.partySize });
        return await store.transact((state) => {
          assertState(state);
          state.diningScenarioReceipts ??= {};
          const receiptKey = `${ownerId}:${commandId}`;
          const previous = state.diningScenarioReceipts[receiptKey];
          if (previous) {
            if (previous.hash !== requestHash) {
              throw new AppError("COMMAND_CONFLICT", "명령 ID가 다른 맛집 요청에 사용됐어요.",
                { httpStatus: 409 });
            }
            if (previous.deleted) {
              throw new AppError("SCENARIO_DELETED", "삭제한 맛집 활동은 다시 만들 수 없어요.",
                { httpStatus: 410 });
            }
            return { state, result: { ...previous.result, replayed: true } };
          }
          const { candidates, contextQueries } = diningCandidates(state, importIds, area);
          const plan = buildDiningPlanDraft({ candidates, scheduledAt: input.scheduledAt,
            partySize: input.partySize }, { registry });
          const stem = `dining:${fingerprint([ownerId, activityId]).slice(0, 32)}`;
          const created = applyActivityCommand(state.activities, {
            ownerId, commandId: `${stem}:activity`, type: "activity.create", activityId,
            expectedRevision: 0,
            payload: { title: `${area} 식사`, goal: {
              description: `${input.scheduledAt} · ${area} · ${input.partySize}명 식사` } },
          }, activityOptions(state));
          state.activities = created.state;
          state.resources = applyResourceCommand(state.resources, {
            ownerId, commandId: `${stem}:resource-activity`, type: "activity.register",
            expectedRevision: 0, payload: { activityId },
          }).state;
          const issued = issueContext(state, { activityId, queries: contextQueries });
          if (issued.resolutions.some((item) => item.status !== "resolved")) {
            throw new AppError("CONTEXT_STALE", "식당 캡처의 근거를 확인할 수 없어요.",
              { httpStatus: 409 });
          }
          const enriched = enrichPlan("draft", plan);
          applyActivityCommand(state.activities, { ownerId,
            commandId: `${stem}:proposal-check`, type: "plan.applyDraft", activityId,
            expectedRevision: created.result.revision, payload: { draft: enriched },
          }, activityOptions(state));
          const proposalId = randomUUID();
          state.proposals[proposalId] = { id: proposalId, ownerId, activityId,
            contextId: issued.contextId, kind: "draft", plan: structuredClone(enriched),
            run: { scenario: "dining", importIds: [...importIds] },
            baseActivityRevision: created.result.revision, basePlanRevision: 0,
            status: "pending", createdAt: new Date().toISOString() };
          const result = { activityId, revision: created.result.revision, proposalId,
            contextId: issued.contextId, candidateCount: candidates.length };
          state.diningScenarioReceipts[receiptKey] = { hash: requestHash,
            importIds: [...importIds], result };
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async selectDiningPlace(raw) {
      try {
        const input = requestObject(raw);
        if (Object.keys(input).some((key) => !["commandId", "activityId", "expectedRevision",
          "candidateId"].includes(key))) {
          throw new AppError("INVALID_REQUEST", "식당 선택 요청 형식이 올바르지 않아요.", { httpStatus: 400 });
        }
        const commandId = safeId(input.commandId, "commandId");
        const activityId = safeId(input.activityId, "activityId");
        const candidateId = safeId(input.candidateId, "candidateId");
        const requestHash = requestFingerprint({ activityId, candidateId,
          expectedRevision: input.expectedRevision });
        return await store.transact((state) => {
          assertState(state);
          state.diningCommandReceipts ??= {};
          const receiptKey = `${ownerId}:${commandId}`;
          const previous = state.diningCommandReceipts[receiptKey];
          if (previous) {
            if (previous.hash !== requestHash) {
              throw new AppError("COMMAND_CONFLICT", "명령 ID가 다른 식당 선택에 사용됐어요.",
                { httpStatus: 409 });
            }
            if (previous.deleted) throw new AppError("SCENARIO_DELETED", "삭제한 활동이에요.", { httpStatus: 410 });
            return { state, result: { ...previous.result, replayed: true } };
          }
          const scenario = Object.values(state.diningScenarioReceipts ?? {}).find((item) =>
            item.result?.activityId === activityId && !item.deleted);
          if (!scenario) throw new AppError("NOT_FOUND", "맛집 활동을 찾지 못했어요.", { httpStatus: 404 });
          const current = board(state, activityId);
          if (current.revision !== input.expectedRevision) {
            throw new AppError("REVISION_CONFLICT", "활동이 변경됐어요.", { httpStatus: 409 });
          }
          assertActivityContextCurrent(state, activityId, current);
          const task = current.tasks.find((item) => item.id === "select_place" &&
            item.capabilityId === "dining.select_place");
          if (task?.readiness?.status !== "ready") {
            throw new AppError("TASK_BLOCKED", "지금은 식당을 선택할 수 없어요.", { httpStatus: 409 });
          }
          const candidate = task.readiness.inputs.candidates.find((item) => item.id === candidateId);
          if (!candidate) throw new AppError("INVALID_REQUEST", "제안된 식당 후보가 아니에요.", { httpStatus: 400 });
          const mentions = candidate.mentionIds.map((id) => state.knowledge.entityMentions.find((item) =>
            item.ownerId === ownerId && item.id === id && item.status === "active"));
          if (mentions.some((item) => !item)) {
            throw new AppError("CONTEXT_STALE", "식당 캡처 근거가 변경됐어요.", { httpStatus: 409 });
          }
          const stem = `dining:${fingerprint([ownerId, activityId]).slice(0, 32)}`;
          const accepted = mentions.map((mention) => state.knowledge.identityDecisions.find((item) =>
            item.ownerId === ownerId && item.mentionId === mention.id && item.status === "accepted"));
          const existingPlaceIds = new Set(accepted.filter(Boolean).map((item) => item.entityId));
          if (existingPlaceIds.size > 1) {
            throw new AppError("IDENTITY_CONFLICT", "선택한 캡처들이 서로 다른 지점에 연결돼 있어요.",
              { httpStatus: 409 });
          }
          const placeId = [...existingPlaceIds][0] ??
            `${stem}:place:${fingerprint(candidateId).slice(0, 16)}`;
          const beforeSequence = state.knowledge.sequence;
          const applyKnowledge = (role, type, payload) => {
            state.knowledge = applyKnowledgeCommand(state.knowledge, { ownerId,
              commandId: `${stem}:select:${role}`, type, payload }, { predicates }).state;
          };
          if (existingPlaceIds.size === 0) {
            applyKnowledge("place", "entity.create", { id: placeId,
              type: "dining.place", label: "사용자가 선택한 식당 지점" });
          }
          for (const mention of mentions) {
            if (accepted.some((item) => item?.mentionId === mention.id)) continue;
            const role = fingerprint(mention.id).slice(0, 16);
            const decisionId = `${stem}:identity:${role}`;
            applyKnowledge(`identity-propose:${role}`, "identity.propose", {
              id: decisionId, mentionId: mention.id, entityId: placeId,
              evidenceIds: mention.evidenceIds, reason: "사용자가 이 식당 지점 후보를 선택함",
            });
            applyKnowledge(`identity-accept:${role}`, "identity.accept", {
              decisionId, expectedRevision: 1,
            });
          }
          recordAffectedConsumers(state, beforeSequence);
          const output = { candidateId, placeId, selectedAt: new Date().toISOString() };
          const applied = applyActivityCommand(state.activities, {
            ownerId, commandId: `${stem}:selected`, type: "task.transition", activityId,
            expectedRevision: input.expectedRevision,
            payload: { taskId: "select_place", expectedTaskRevision: task.revision,
              to: "completed", output },
          }, activityOptions(state));
          state.activities = applied.state;
          const result = { activityId, placeId, candidateId, revision: applied.result.revision };
          state.diningCommandReceipts[receiptKey] = { hash: requestHash, result, activityId };
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async recordDiningVisitOutcome(raw) {
      try {
        const input = requestObject(raw);
        if (Object.keys(input).some((key) => !["commandId", "activityId", "expectedRevision",
          "status"].includes(key)) ||
          !["visited", "not_visited", "unknown"].includes(input.status)) {
          throw new AppError("INVALID_REQUEST", "방문 결과를 확인해 주세요.", { httpStatus: 400 });
        }
        const commandId = safeId(input.commandId, "commandId");
        const activityId = safeId(input.activityId, "activityId");
        const requestHash = requestFingerprint({ activityId, status: input.status,
          expectedRevision: input.expectedRevision });
        return await store.transact((state) => {
          assertState(state);
          state.diningCommandReceipts ??= {};
          const receiptKey = `${ownerId}:${commandId}`;
          const previous = state.diningCommandReceipts[receiptKey];
          if (previous) {
            if (previous.hash !== requestHash) {
              throw new AppError("COMMAND_CONFLICT", "명령 ID가 다른 방문 결과에 사용됐어요.",
                { httpStatus: 409 });
            }
            if (previous.deleted) throw new AppError("SCENARIO_DELETED", "삭제한 활동이에요.", { httpStatus: 410 });
            return { state, result: { ...previous.result, replayed: true } };
          }
          const current = board(state, activityId);
          if (current.revision !== input.expectedRevision) {
            throw new AppError("REVISION_CONFLICT", "활동이 변경됐어요.", { httpStatus: 409 });
          }
          assertActivityContextCurrent(state, activityId, current);
          const task = current.tasks.find((item) => item.id === "record_visit_outcome" &&
            item.capabilityId === "dining.record_visit_outcome");
          if (task?.readiness?.status !== "ready") {
            throw new AppError("TASK_BLOCKED", "방문 결과를 기록할 수 없어요.", { httpStatus: 409 });
          }
          const placeId = task.readiness.inputs.placeId;
          const place = state.knowledge.entities.find((item) => item.ownerId === ownerId &&
            item.id === placeId && item.type === "dining.place" && item.status === "active");
          if (!place) throw new AppError("CONTEXT_STALE", "선택한 식당을 찾지 못했어요.", { httpStatus: 409 });
          const stem = `dining:${fingerprint([ownerId, activityId]).slice(0, 32)}`;
          const reportedAt = new Date().toISOString();
          const output = { placeId, status: input.status, reportedAt };
          const applied = applyActivityCommand(state.activities, {
            ownerId, commandId: `${stem}:visit-outcome`, type: "task.transition", activityId,
            expectedRevision: input.expectedRevision,
            payload: { taskId: "record_visit_outcome", expectedTaskRevision: task.revision,
              to: "completed", output },
          }, activityOptions(state));
          state.activities = applied.state;
          let visitId = null;
          if (input.status === "visited") {
            const sourceId = `${stem}:visit-source`;
            const versionId = `${stem}:visit-version`;
            const evidenceId = `${stem}:visit-evidence`;
            visitId = `${stem}:visit`;
            const content = { placeId, reportedAt, status: "visited" };
            const applyKnowledge = (role, type, payload) => {
              if (type === "assertion.add") validateAssertionRelation(state, payload);
              state.knowledge = applyKnowledgeCommand(state.knowledge, { ownerId,
                commandId: `${stem}:visit:${role}`, type, payload }, { predicates }).state;
            };
            const beforeSequence = state.knowledge.sequence;
            applyKnowledge("source", "source.create", { id: sourceId, kind: "user_report",
              title: "방문 기록", provenance: { scenario: "dining", activityId } });
            applyKnowledge("version", "source.version.add", { id: versionId,
              sourceId, contentHash: fingerprint(content), content, capturedAt: reportedAt });
            applyKnowledge("evidence", "evidence.add", { id: evidenceId,
              sourceVersionId: versionId, quote: "다녀왔어요",
              locator: { kind: "user_report", jsonPointer: "/status" } });
            applyKnowledge("entity", "entity.create", { id: visitId,
              type: "dining.visit", label: "사용자 방문 기록" });
            applyKnowledge("visited", "assertion.add", { id: `${stem}:visited`,
              subjectId: visitId, predicate: "dining.visited", objectEntityId: placeId,
              scope: { type: "activity", id: activityId }, origin: "user_reported",
              assertedBy: { type: "user", id: ownerId }, evidenceIds: [evidenceId],
              observedAt: reportedAt });
            recordAffectedConsumers(state, beforeSequence);
          }
          const result = { activityId, placeId, status: input.status, visitId,
            revision: applied.result.revision };
          state.diningCommandReceipts[receiptKey] = { hash: requestHash, result, activityId };
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async createFashionScenario(raw) {
      try {
        const input = requestObject(raw);
        if (Object.keys(input).some((key) => !["commandId", "activityId", "confirmed",
          "importIds", "occasion", "scheduledAt"].includes(key)) || input.confirmed !== true ||
          !Array.isArray(input.importIds) || input.importIds.length < 1 ||
          input.importIds.length > 5 || typeof input.occasion !== "string" ||
          !input.occasion.trim() || input.occasion.length > 120) {
          throw new AppError("INVALID_REQUEST", "패션 활동 입력을 확인해 주세요.", { httpStatus: 400 });
        }
        const commandId = safeId(input.commandId, "commandId");
        const activityId = safeId(input.activityId, "activityId");
        const importIds = input.importIds.map((id) => safeId(id, "importId"));
        if (new Set(importIds).size !== importIds.length) {
          throw new AppError("INVALID_REQUEST", "같은 캡처를 중복 선택했어요.", { httpStatus: 400 });
        }
        registry.validate("core.timestamp", input.scheduledAt);
        const occasion = input.occasion.trim();
        const requestHash = requestFingerprint({ activityId, importIds, occasion,
          scheduledAt: input.scheduledAt });
        return await store.transact((state) => {
          assertState(state);
          state.fashionScenarioReceipts ??= {};
          const receiptKey = `${ownerId}:${commandId}`;
          const previous = state.fashionScenarioReceipts[receiptKey];
          if (previous) {
            if (previous.hash !== requestHash) throw new AppError("COMMAND_CONFLICT",
              "명령 ID가 다른 패션 요청에 사용됐어요.", { httpStatus: 409 });
            if (previous.deleted) throw new AppError("SCENARIO_DELETED",
              "삭제한 패션 활동이에요.", { httpStatus: 410 });
            return { state, result: { ...previous.result, replayed: true } };
          }
          const { candidates, contextQueries } = fashionCandidates(state, importIds);
          const plan = buildFashionPlanDraft({ candidates, occasion }, { registry });
          const stem = `fashion:${fingerprint([ownerId, activityId]).slice(0, 32)}`;
          const created = applyActivityCommand(state.activities, { ownerId,
            commandId: `${stem}:activity`, type: "activity.create", activityId,
            expectedRevision: 0, payload: { title: `${occasion} 코디`,
              goal: { description: `${input.scheduledAt} · ${occasion}에 입을 옷 정하기` } } },
          activityOptions(state));
          state.activities = created.state;
          state.resources = applyResourceCommand(state.resources, { ownerId,
            commandId: `${stem}:resource-activity`, type: "activity.register",
            expectedRevision: 0, payload: { activityId } }).state;
          const issued = issueContext(state, { activityId, queries: contextQueries });
          if (issued.resolutions.some((item) => item.status !== "resolved")) {
            throw new AppError("CONTEXT_STALE", "패션 캡처 근거를 확인할 수 없어요.",
              { httpStatus: 409 });
          }
          const enriched = enrichPlan("draft", plan);
          applyActivityCommand(state.activities, { ownerId,
            commandId: `${stem}:proposal-check`, type: "plan.applyDraft", activityId,
            expectedRevision: created.result.revision, payload: { draft: enriched } },
          activityOptions(state));
          const proposalId = randomUUID();
          state.proposals[proposalId] = { id: proposalId, ownerId, activityId,
            contextId: issued.contextId, kind: "draft", plan: structuredClone(enriched),
            run: { scenario: "fashion", importIds: [...importIds] },
            baseActivityRevision: created.result.revision, basePlanRevision: 0,
            status: "pending", createdAt: new Date().toISOString() };
          const result = { activityId, revision: created.result.revision, proposalId,
            contextId: issued.contextId, candidateCount: candidates.length };
          state.fashionScenarioReceipts[receiptKey] = { hash: requestHash,
            importIds: [...importIds], result };
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async confirmFashionOutfit(raw) {
      try {
        const input = requestObject(raw);
        if (Object.keys(input).some((key) => !["commandId", "activityId", "expectedRevision",
          "selections"].includes(key)) || !Array.isArray(input.selections) ||
          input.selections.length < 1 || input.selections.length > 5 ||
          input.selections.some((item) => !item || typeof item !== "object" ||
            Array.isArray(item) || Object.keys(item).some((key) =>
              !["importId", "slot", "color", "size", "ownership"].includes(key)) ||
            !["outerwear", "top", "bottom", "shoes", "accessory"].includes(item.slot) ||
            !["owned", "candidate", "unknown"].includes(item.ownership) ||
            !["importId", "color", "size"].every((key) =>
              typeof item[key] === "string" && item[key].trim() && item[key].length <= 80))) {
          throw new AppError("INVALID_REQUEST", "코디 항목·색상·사이즈를 확인해 주세요.",
            { httpStatus: 400 });
        }
        const commandId = safeId(input.commandId, "commandId");
        const activityId = safeId(input.activityId, "activityId");
        const selections = input.selections.map((item) => ({ importId: safeId(item.importId, "importId"),
          slot: item.slot, color: item.color.trim(), size: item.size.trim(),
          ownership: item.ownership }));
        if (new Set(selections.map((item) => item.importId)).size !== selections.length ||
            new Set(selections.map((item) => item.slot)).size !== selections.length) {
          throw new AppError("INVALID_REQUEST", "같은 캡처나 코디 자리를 중복 사용할 수 없어요.",
            { httpStatus: 400 });
        }
        const requestHash = requestFingerprint({ activityId, expectedRevision: input.expectedRevision,
          selections });
        return await store.transact((state) => {
          assertState(state);
          state.fashionCommandReceipts ??= {};
          const receiptKey = `${ownerId}:${commandId}`;
          const previous = state.fashionCommandReceipts[receiptKey];
          if (previous) {
            if (previous.hash !== requestHash) throw new AppError("COMMAND_CONFLICT",
              "명령 ID가 다른 코디 확인에 사용됐어요.", { httpStatus: 409 });
            if (previous.deleted) throw new AppError("SCENARIO_DELETED", "삭제한 활동이에요.",
              { httpStatus: 410 });
            return { state, result: { ...previous.result, replayed: true } };
          }
          const scenario = Object.values(state.fashionScenarioReceipts ?? {}).find((item) =>
            item.result?.activityId === activityId && !item.deleted);
          if (!scenario) throw new AppError("NOT_FOUND", "패션 활동을 찾지 못했어요.",
            { httpStatus: 404 });
          const current = board(state, activityId);
          if (current.revision !== input.expectedRevision) throw new AppError("REVISION_CONFLICT",
            "활동이 변경됐어요.", { httpStatus: 409 });
          assertActivityContextCurrent(state, activityId, current);
          const task = current.tasks.find((item) => item.id === "confirm_outfit" &&
            item.capabilityId === "fashion.confirm_outfit");
          if (task?.readiness?.status !== "ready") throw new AppError("TASK_BLOCKED",
            "지금은 코디를 확정할 수 없어요.", { httpStatus: 409 });
          const candidates = new Map(task.readiness.inputs.candidates.map((item) =>
            [item.importId, item]));
          if (selections.some((item) => !candidates.has(item.importId))) {
            throw new AppError("INVALID_REQUEST", "활동에 제안된 캡처만 사용할 수 있어요.",
              { httpStatus: 400 });
          }
          const stem = `fashion:${fingerprint([ownerId, activityId]).slice(0, 32)}`;
          const outfitId = `${stem}:outfit`;
          const sourceId = `${stem}:confirmation-source`;
          const versionId = `${stem}:confirmation-version`;
          const confirmedAt = new Date().toISOString();
          const content = { occasion: task.readiness.inputs.occasion, selections };
          const beforeSequence = state.knowledge.sequence;
          const applyKnowledge = (role, type, payload) => {
            if (type === "assertion.add") validateAssertionRelation(state, payload);
            state.knowledge = applyKnowledgeCommand(state.knowledge, { ownerId,
              commandId: `${stem}:confirm:${role}`, type, payload }, { predicates }).state;
          };
          applyKnowledge("source", "source.create", { id: sourceId, kind: "user_confirmation",
            title: "사용자가 확인한 코디", provenance: { scenario: "fashion", activityId,
              importedSourceIds: selections.map((item) =>
                state.importReceipts[item.importId].sourceId) } });
          applyKnowledge("version", "source.version.add", { id: versionId,
            sourceId, contentHash: fingerprint(content), content, capturedAt: confirmedAt });
          applyKnowledge("outfit", "entity.create", { id: outfitId,
            type: "fashion.outfit", label: "사용자가 확정한 코디" });
          const items = [];
          for (const selection of selections) {
            const candidate = candidates.get(selection.importId);
            const mention = state.knowledge.entityMentions.find((item) =>
              item.ownerId === ownerId && item.id === candidate.mentionId && item.status === "active");
            if (!mention) throw new AppError("CONTEXT_STALE", "상품 캡처 근거가 변경됐어요.",
              { httpStatus: 409 });
            const role = fingerprint(selection.importId).slice(0, 16);
            const evidenceId = `${stem}:confirmation-evidence:${role}`;
            applyKnowledge(`evidence:${role}`, "evidence.add", { id: evidenceId,
              sourceVersionId: versionId,
              quote: `${candidate.name} · ${selection.slot} · ${selection.color} · ${selection.size} · ${selection.ownership}`,
              locator: { kind: "user_confirmation", jsonPointer: `/selections/${items.length}` } });
            const accepted = state.knowledge.identityDecisions.find((item) =>
              item.ownerId === ownerId && item.mentionId === mention.id && item.status === "accepted");
            const productId = accepted?.entityId ?? `${stem}:product:${role}`;
            if (!accepted) {
              applyKnowledge(`product:${role}`, "entity.create", { id: productId,
                type: "core.product", label: "사용자가 확인한 패션 상품" });
              const decisionId = `${stem}:identity:${role}`;
              applyKnowledge(`identity-propose:${role}`, "identity.propose", { id: decisionId,
                mentionId: mention.id, entityId: productId,
                evidenceIds: mention.evidenceIds,
                reason: "사용자가 코디 항목의 상품 캡처를 확인함" });
              applyKnowledge(`identity-accept:${role}`, "identity.accept", {
                decisionId, expectedRevision: 1 });
            }
            const variantId = `fashion:variant:${fingerprint([ownerId, productId,
              selection.color, selection.size]).slice(0, 32)}`;
            if (!state.knowledge.entities.some((item) => item.ownerId === ownerId &&
                item.id === variantId && item.status === "active")) {
              applyKnowledge(`variant:${role}`, "entity.create", { id: variantId,
                type: "core.product_variant", label: "사용자가 선택한 색상·사이즈" });
            }
            const assertion = (name, subjectId, predicate, objectEntityId = null,
              typedValue = null) => applyKnowledge(`${name}:${role}`, "assertion.add", {
              id: `${stem}:${name}:${role}`, subjectId, predicate,
              scope: { type: "activity", id: activityId }, origin: "user_reported",
              assertedBy: { type: "user", id: ownerId }, evidenceIds: [evidenceId],
              observedAt: confirmedAt,
              ...(objectEntityId ? { objectEntityId } : { typedValue }),
            });
            assertion("variant-of", variantId, "fashion.variant_of", productId);
            assertion("variant-options", variantId, "fashion.variant_options", null,
              { type: "fashion.variant_options", value: {
                color: selection.color, size: selection.size } });
            assertion("has-item", outfitId, "fashion.has_item", variantId);
            if (selection.ownership !== "unknown") {
              assertion("ownership", variantId, "fashion.ownership", null,
                { type: "fashion.ownership", value: selection.ownership });
            }
            items.push({ slot: selection.slot, variantId, ownership: selection.ownership,
              importId: selection.importId, color: selection.color, size: selection.size });
          }
          const outfit = { id: outfitId, occasion: task.readiness.inputs.occasion, items };
          registry.validate("fashion.outfit", outfit);
          recordAffectedConsumers(state, beforeSequence);
          const applied = applyActivityCommand(state.activities, { ownerId,
            commandId: `${stem}:confirmed`, type: "task.transition", activityId,
            expectedRevision: input.expectedRevision,
            payload: { taskId: "confirm_outfit", expectedTaskRevision: task.revision,
              to: "completed", output: { outfitId, outfit, confirmedAt } } }, activityOptions(state));
          state.activities = applied.state;
          const result = { activityId, outfitId, revision: applied.result.revision };
          state.fashionCommandReceipts[receiptKey] = { hash: requestHash, result, activityId };
          scenario.result.confirmationSourceId = sourceId;
          return { state, result: { ...result, replayed: false } };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async recordFashionWearOutcome(raw) {
      try {
        const input = requestObject(raw);
        if (Object.keys(input).some((key) => !["commandId", "activityId", "expectedRevision",
          "status"].includes(key)) || !["worn", "not_worn", "unknown"].includes(input.status)) {
          throw new AppError("INVALID_REQUEST", "착용 결과를 확인해 주세요.", { httpStatus: 400 });
        }
        const commandId = safeId(input.commandId, "commandId");
        const activityId = safeId(input.activityId, "activityId");
        const requestHash = requestFingerprint({ activityId, expectedRevision: input.expectedRevision,
          status: input.status });
        return await store.transact((state) => {
          assertState(state);
          state.fashionCommandReceipts ??= {};
          const receiptKey = `${ownerId}:${commandId}`;
          const previous = state.fashionCommandReceipts[receiptKey];
          if (previous) {
            if (previous.hash !== requestHash) throw new AppError("COMMAND_CONFLICT",
              "명령 ID가 다른 착용 결과에 사용됐어요.", { httpStatus: 409 });
            if (previous.deleted) throw new AppError("SCENARIO_DELETED", "삭제한 활동이에요.",
              { httpStatus: 410 });
            return { state, result: { ...previous.result, replayed: true } };
          }
          const scenario = Object.values(state.fashionScenarioReceipts ?? {}).find((item) =>
            item.result?.activityId === activityId && !item.deleted);
          if (!scenario) throw new AppError("NOT_FOUND", "패션 활동을 찾지 못했어요.",
            { httpStatus: 404 });
          const current = board(state, activityId);
          if (current.revision !== input.expectedRevision) throw new AppError("REVISION_CONFLICT",
            "활동이 변경됐어요.", { httpStatus: 409 });
          assertActivityContextCurrent(state, activityId, current);
          const task = current.tasks.find((item) => item.id === "record_wear" &&
            item.capabilityId === "fashion.record_wear_outcome");
          if (task?.readiness?.status !== "ready") throw new AppError("TASK_BLOCKED",
            "착용 결과를 기록할 수 없어요.", { httpStatus: 409 });
          const outfitId = task.readiness.inputs.outfitId;
          if (!state.knowledge.entities.some((item) => item.ownerId === ownerId &&
              item.id === outfitId && item.type === "fashion.outfit" && item.status === "active")) {
            throw new AppError("CONTEXT_STALE", "확정한 코디를 찾지 못했어요.",
              { httpStatus: 409 });
          }
          const stem = `fashion:${fingerprint([ownerId, activityId]).slice(0, 32)}`;
          const reportedAt = new Date().toISOString();
          const applied = applyActivityCommand(state.activities, { ownerId,
            commandId: `${stem}:wear-outcome`, type: "task.transition", activityId,
            expectedRevision: input.expectedRevision,
            payload: { taskId: "record_wear", expectedTaskRevision: task.revision,
              to: "completed", output: { outfitId, status: input.status, reportedAt } } },
          activityOptions(state));
          state.activities = applied.state;
          let experienceId = null;
          if (input.status === "worn") {
            const beforeSequence = state.knowledge.sequence;
            const sourceId = `${stem}:wear-source`;
            const versionId = `${stem}:wear-version`;
            const evidenceId = `${stem}:wear-evidence`;
            experienceId = `${stem}:wear-experience`;
            const content = { outfitId, status: "worn", reportedAt };
            const applyKnowledge = (role, type, payload) => {
              if (type === "assertion.add") validateAssertionRelation(state, payload);
              state.knowledge = applyKnowledgeCommand(state.knowledge, { ownerId,
                commandId: `${stem}:wear:${role}`, type, payload }, { predicates }).state;
            };
            applyKnowledge("source", "source.create", { id: sourceId, kind: "user_report",
              title: "코디 착용 기록", provenance: { scenario: "fashion", activityId } });
            applyKnowledge("version", "source.version.add", { id: versionId,
              sourceId, contentHash: fingerprint(content), content, capturedAt: reportedAt });
            applyKnowledge("evidence", "evidence.add", { id: evidenceId,
              sourceVersionId: versionId, quote: "입었어요",
              locator: { kind: "user_report", jsonPointer: "/status" } });
            applyKnowledge("experience", "entity.create", { id: experienceId,
              type: "fashion.wear_experience", label: "사용자 착용 기록" });
            applyKnowledge("wore", "assertion.add", { id: `${stem}:wore`,
              subjectId: experienceId, predicate: "fashion.wore_outfit",
              objectEntityId: outfitId, scope: { type: "activity", id: activityId },
              origin: "user_reported", assertedBy: { type: "user", id: ownerId },
              evidenceIds: [evidenceId], observedAt: reportedAt });
            recordAffectedConsumers(state, beforeSequence);
          }
          const result = { activityId, outfitId, status: input.status, experienceId,
            revision: applied.result.revision };
          state.fashionCommandReceipts[receiptKey] = { hash: requestHash, result, activityId };
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
          return { state, result: issueContext(state, request) };
        });
      } catch (error) { throw toHttpError(error); }
    },
    async watchContext(request) {
      try {
        const { activityId, contextId } = requestObject(request);
        safeId(activityId, "activityId");
        safeId(contextId, "contextId");
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
    async executeCapability(request) {
      try {
        const { id, input } = requestObject(request);
        safeId(id, "id");
        return { output: registry.execute(id, input) };
      }
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
          assertActivityContextCurrent(state, activityId, current);
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
