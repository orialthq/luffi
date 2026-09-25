import {
  fail, object, string, integer, oneOf, date, nowIso, timeRange, json, fingerprint,
  unitPolicy, quantityUnits, displayQuantity,
} from "./validation.js";

export function createResourceState() {
  return { schemaVersion: 1, sequence: 0, activities: [], resources: [], claims: [], events: [], receipts: [] };
}

function checkState(state) {
  if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.sequence) || state.sequence < 0 ||
      ["activities", "resources", "claims", "events", "receipts"].some((key) => !Array.isArray(state[key]))) {
    fail("INVALID_RESOURCE_STATE", "Expected a resource state with schemaVersion 1");
  }
}
function findOwned(rows, ownerId, id, label) {
  const value = rows.find((row) => row.ownerId === ownerId && row.id === id);
  if (!value) fail("RESOURCE_NOT_FOUND", `${label} was not found`);
  return value;
}
function unique(rows, ownerId, id, label) {
  if (rows.some((row) => row.ownerId === ownerId && row.id === id)) {
    fail("RESOURCE_ID_EXISTS", `${label} id already exists; use the original commandId to retry`);
  }
}
function checkRevision(resource, expectedRevision) {
  if (expectedRevision != null && expectedRevision !== (resource?.revision ?? 0)) {
    fail("RESOURCE_REVISION_CONFLICT", "The resource changed since it was read");
  }
}
function advanceRevision(resource, now) {
  if (!Number.isSafeInteger(resource.revision) || resource.revision >= Number.MAX_SAFE_INTEGER) {
    fail("INVALID_RESOURCE_STATE", "Resource revision overflow");
  }
  resource.revision += 1;
  resource.updatedAt = now;
}

function parseAvailability(value, resource, now) {
  object(value, "availability", ["status", "quantity", "unit", "observedAt", "freshUntil", "observationId", "reason"]);
  const status = oneOf(value.status, ["known", "unknown", "stale"], "availability.status");
  const observedAt = date(value.observedAt, "availability.observedAt");
  const observationId = string(value.observationId, "availability.observationId");
  if (observedAt > now) fail("INVALID_RESOURCE_INPUT", "Availability cannot be observed in the future");
  if (resource.availability?.observedAt && observedAt < resource.availability.observedAt) {
    fail("RESOURCE_OBSERVATION_OUTDATED", "An older observation cannot replace the current availability");
  }
  const reason = value.reason == null ? null : string(value.reason, "availability.reason");
  if (status === "unknown") {
    if (["quantity", "unit", "freshUntil"].some((key) => Object.hasOwn(value, key))) {
      fail("INVALID_RESOURCE_INPUT", "Unknown availability has no inferred quantity or freshness deadline");
    }
    return { status, observedAt, observationId, reason, quantity: null, quantityUnits: null, unit: resource.unitPolicy.canonicalUnit, freshUntil: null };
  }
  const freshUntil = date(value.freshUntil, "availability.freshUntil");
  if (freshUntil <= observedAt) fail("INVALID_RESOURCE_INPUT", "freshUntil must follow observedAt");
  const units = quantityUnits(value.quantity, value.unit, resource.unitPolicy);
  if (resource.kind === "exclusive" && units > 1) fail("INVALID_RESOURCE_INPUT", "Exclusive availability must be zero or one slot");
  return { status, observedAt, observationId, reason, freshUntil, quantityUnits: units,
    quantity: displayQuantity(units, resource.unitPolicy), unit: resource.unitPolicy.canonicalUnit };
}
function availabilityStatus(resource, now) {
  const value = resource.availability;
  return value.status === "known" && now >= value.freshUntil ? "stale" : value.status;
}
function overlaps(a, b) {
  return !a || !b || (a.start < b.end && b.start < a.end);
}
function heldClaims(state, resource) {
  return state.claims.filter((claim) => claim.ownerId === resource.ownerId && claim.resourceId === resource.id && claim.state === "held");
}
function peakReserved(claims, range) {
  let baseline = 0n;
  const changes = new Map();
  for (const claim of claims) {
    if (!overlaps(claim.timeRange, range)) continue;
    if (!claim.timeRange && !range) { baseline += BigInt(claim.quantityUnits); continue; }
    const start = claim.timeRange && range ? (claim.timeRange.start > range.start ? claim.timeRange.start : range.start) :
      (claim.timeRange ?? range).start;
    const end = claim.timeRange && range ? (claim.timeRange.end < range.end ? claim.timeRange.end : range.end) :
      (claim.timeRange ?? range).end;
    changes.set(start, (changes.get(start) ?? 0n) + BigInt(claim.quantityUnits));
    changes.set(end, (changes.get(end) ?? 0n) - BigInt(claim.quantityUnits));
  }
  let current = baseline;
  let peak = current;
  // Aggregate same-time ends and starts for half-open [start,end) intervals.
  for (const instant of [...changes.keys()].sort()) {
    current += changes.get(instant);
    if (current > peak) peak = current;
  }
  return peak;
}
function projection(state, resource, range, now) {
  const allClaims = heldClaims(state, resource);
  const relevant = resource.allocationMode === "consumable" ? allClaims : allClaims.filter((claim) => overlaps(claim.timeRange, range));
  const peak = resource.allocationMode === "consumable" ? relevant.reduce((sum, claim) => sum + BigInt(claim.quantityUnits), 0n) : peakReserved(relevant, range);
  if (peak > BigInt(Number.MAX_SAFE_INTEGER)) fail("INVALID_RESOURCE_STATE", "Held capacity exceeds supported precision");
  const reservedUnits = Number(peak);
  const status = availabilityStatus(resource, now);
  const known = status === "known";
  const capacityUnits = known ? resource.availability.quantityUnits : null;
  const remainingUnits = known ? Math.max(0, capacityUnits - reservedUnits) : null;
  return {
    resourceId: resource.id, resourceRevision: resource.revision, kind: resource.kind,
    allocationMode: resource.allocationMode, guarantee: "planning_only", status,
    unit: resource.unitPolicy.canonicalUnit, precision: resource.unitPolicy.precision,
    observedAt: resource.availability.observedAt, freshUntil: resource.availability.freshUntil,
    observationId: resource.availability.observationId, timeRange: range,
    capacity: known ? displayQuantity(capacityUnits, resource.unitPolicy) : null,
    lastObservedQuantity: resource.availability.quantity,
    reserved: displayQuantity(reservedUnits, resource.unitPolicy),
    remaining: known ? displayQuantity(remainingUnits, resource.unitPolicy) : null,
    allocationStatus: !known ? "unverified" : reservedUnits > capacityUnits ? "overcommitted" : "within_capacity",
    affectedClaimIds: relevant.map((claim) => claim.id),
  };
}

export function getResourceAvailability(state, request, options = {}) {
  checkState(state);
  object(request, "request", ["ownerId", "resourceId", "timeRange"]);
  const ownerId = string(request.ownerId, "ownerId");
  const resource = findOwned(state.resources, ownerId, string(request.resourceId, "resourceId"), "Resource");
  return json(projection(state, resource, timeRange(request.timeRange), nowIso(options.now)));
}

function apply(next, command, now) {
  const { ownerId, type, payload: p, expectedRevision } = command;
  if (type === "activity.register") {
    object(p, "payload", ["activityId"]);
    const id = string(p.activityId, "activityId");
    unique(next.activities, ownerId, id, "Activity");
    checkRevision(null, expectedRevision);
    const activity = { id, ownerId, revision: 1, registeredAt: now };
    next.activities.push(activity);
    return { activity };
  }
  if (type === "resource.create") {
    object(p, "payload", ["resourceId", "kind", "allocationMode", "unitPolicy", "availability"]);
    const id = string(p.resourceId, "resourceId");
    unique(next.resources, ownerId, id, "Resource");
    checkRevision(null, expectedRevision);
    const kind = oneOf(p.kind, ["quantity", "exclusive"], "kind");
    let policy;
    let allocationMode;
    if (kind === "exclusive") {
      if (p.unitPolicy != null || (p.allocationMode != null && p.allocationMode !== "concurrent")) {
        fail("INVALID_RESOURCE_INPUT", "Exclusive resources have fixed slot units and concurrent allocation");
      }
      policy = { canonicalUnit: "slot", precision: 0, conversions: [] };
      allocationMode = "concurrent";
    } else {
      policy = unitPolicy(p.unitPolicy);
      allocationMode = oneOf(p.allocationMode, ["consumable", "concurrent"], "allocationMode");
    }
    const resource = { id, ownerId, kind, allocationMode, unitPolicy: policy, revision: 1, createdAt: now, updatedAt: now,
      availability: { status: "unknown", quantity: null, quantityUnits: null, unit: policy.canonicalUnit,
        observedAt: null, freshUntil: null, observationId: null, reason: null } };
    if (p.availability != null) resource.availability = parseAvailability(p.availability, resource, now);
    next.resources.push(resource);
    return { resource, availability: projection(next, resource, null, now) };
  }
  if (type === "resource.observe") {
    object(p, "payload", ["resourceId", "availability"]);
    const resource = findOwned(next.resources, ownerId, string(p.resourceId, "resourceId"), "Resource");
    checkRevision(resource, expectedRevision);
    resource.availability = parseAvailability(p.availability, resource, now);
    advanceRevision(resource, now);
    // Truthful observations may invalidate allocations. Never discard claims to
    // make a lower observation look consistent: expose overcommitment to callers.
    return { resource, availability: projection(next, resource, null, now) };
  }
  if (type === "claim.acquire") {
    object(p, "payload", ["claimId", "resourceId", "activityId", "quantity", "unit", "timeRange"]);
    const id = string(p.claimId, "claimId");
    unique(next.claims, ownerId, id, "Claim");
    const activityId = string(p.activityId, "activityId");
    findOwned(next.activities, ownerId, activityId, "Activity");
    const resource = findOwned(next.resources, ownerId, string(p.resourceId, "resourceId"), "Resource");
    checkRevision(resource, expectedRevision);
    if (availabilityStatus(resource, now) !== "known") fail("RESOURCE_UNAVAILABLE", "Only known, fresh availability supports a planning claim");
    const range = timeRange(p.timeRange);
    const units = quantityUnits(p.quantity, p.unit, resource.unitPolicy, { positive: true });
    if (resource.kind === "exclusive" && units !== 1) fail("INVALID_RESOURCE_INPUT", "An exclusive claim must acquire exactly one slot");
    const claims = heldClaims(next, resource);
    const reserved = resource.allocationMode === "consumable" ? claims.reduce((sum, claim) => sum + BigInt(claim.quantityUnits), 0n) : peakReserved(claims, range);
    if (reserved + BigInt(units) > BigInt(resource.availability.quantityUnits)) {
      fail("RESOURCE_CAPACITY_CONFLICT", "The requested planning quantity is already allocated or unavailable");
    }
    advanceRevision(resource, now);
    const claim = { id, ownerId, activityId, resourceId: resource.id, state: "held", revision: 1,
      quantity: displayQuantity(units, resource.unitPolicy), quantityUnits: units, unit: resource.unitPolicy.canonicalUnit,
      requestedQuantity: p.quantity, requestedUnit: p.unit, timeRange: range,
      acquiredAt: now, releasedAt: null, acquisitionObservationId: resource.availability.observationId,
      acquisitionResourceRevision: resource.revision - 1, guarantee: "planning_only" };
    next.claims.push(claim);
    return { claim, resourceRevision: resource.revision, availability: projection(next, resource, range, now) };
  }
  if (type === "claim.release") {
    object(p, "payload", ["claimId", "resourceId", "activityId"]);
    const activityId = string(p.activityId, "activityId");
    findOwned(next.activities, ownerId, activityId, "Activity");
    const resource = findOwned(next.resources, ownerId, string(p.resourceId, "resourceId"), "Resource");
    const claim = findOwned(next.claims, ownerId, string(p.claimId, "claimId"), "Claim");
    if (claim.resourceId !== resource.id || claim.activityId !== activityId) {
      fail("RESOURCE_NOT_FOUND", "Claim was not found for that resource and activity");
    }
    checkRevision(resource, expectedRevision);
    if (claim.state === "released") fail("RESOURCE_CLAIM_RELEASED", "Claim is already released; use the original commandId to retry");
    claim.state = "released";
    claim.revision += 1;
    claim.releasedAt = now;
    advanceRevision(resource, now);
    return { claim, resourceRevision: resource.revision, availability: projection(next, resource, claim.timeRange, now) };
  }
  fail("INVALID_RESOURCE_INPUT", `Unsupported resource command: ${type}`);
}

export function applyResourceCommand(state, rawCommand, options = {}) {
  checkState(state);
  const command = json(rawCommand);
  object(command, "command", ["ownerId", "commandId", "type", "payload", "expectedRevision"]);
  string(command.ownerId, "ownerId");
  string(command.commandId, "commandId");
  string(command.type, "type");
  object(command.payload, "payload");
  if (command.expectedRevision != null) integer(command.expectedRevision, "expectedRevision");
  const payloadHash = fingerprint(command);
  const receipt = state.receipts.find((row) => row.ownerId === command.ownerId && row.commandId === command.commandId);
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) fail("RESOURCE_COMMAND_CONFLICT", "commandId was already used with different input");
    return { state: json(state), result: json(receipt.result), replayed: true };
  }
  const now = nowIso(options.now);
  const next = json(state);
  const result = json(apply(next, command, now));
  if (next.sequence === Number.MAX_SAFE_INTEGER) fail("INVALID_RESOURCE_STATE", "Resource sequence overflow");
  next.sequence += 1;
  next.events.push({ sequence: next.sequence, ownerId: command.ownerId, commandId: command.commandId,
    type: command.type, resourceId: command.payload.resourceId ?? null, activityId: command.payload.activityId ?? null,
    claimId: command.payload.claimId ?? null, resourceRevision: result.resourceRevision ?? result.resource?.revision ?? null, occurredAt: now });
  next.receipts.push({ ownerId: command.ownerId, commandId: command.commandId, payloadHash, sequence: next.sequence, result: json(result) });
  return { state: next, result, replayed: false };
}
