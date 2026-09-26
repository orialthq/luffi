import assert from "node:assert/strict";
import test from "node:test";
import { createDomainRegistry, domainRegistry as registry, DOMAIN_PACKS, DomainContractError } from "../src/domains/index.js";

const rejects = (run, code = "INVALID_DOMAIN_VALUE") => assert.throws(run, (error) => error instanceof DomainContractError && error.code === code);

test("all five packs expose typed capabilities, artifacts, slots and kernel-compatible relations", () => {
  assert.deepEqual(registry.listPacks().map((pack) => pack.id), ["recipe", "dining", "fashion", "beauty", "travel"]);
  for (const capability of registry.listCapabilities()) {
    assert.ok(registry.getType(capability.inputType));
    assert.ok(registry.getType(capability.outputType));
    assert.ok(["observation", "decision", "action", "wait", "milestone"].includes(capability.taskKind));
    assert.equal(typeof capability.completion, "string");
    for (const id of Object.values(capability.inputSlots)) assert.ok(registry.getSlot(id));
  }
  for (const artifact of registry.listArtifacts()) assert.equal(registry.getRenderer(artifact.rendererKey).payloadType, artifact.payloadType);
  for (const relation of registry.listRelations()) {
    assert.ok(["single", "many"].includes(relation.cardinality));
    assert.equal(relation.resolution.version, "1");
  }
});

test("registered relations reject hallucinated predicates and wrong endpoint types", () => {
  registry.validateRelation({ predicate: "recipe.has_requirement", subjectType: "recipe.recipe", objectType: "recipe.ingredient_requirement" });
  rejects(() => registry.validateRelation({ predicate: "recipe.has_requirement", subjectType: "dining.place", objectType: "recipe.ingredient_requirement" }));
  rejects(() => registry.validateRelation({ predicate: "recipe.related_to", subjectType: "recipe.recipe", objectType: "recipe.ingredient" }), "UNKNOWN_DOMAIN_CONTRACT");
  rejects(() => registry.validateRelation({ predicate: "recipe.has_requirement", subjectType: "recipe.recipe", objectType: "recipe.ingredient_requirement", value: "hidden extra value" }));
});

test("value relations validate registered values and preserve unknown as a distinct state", () => {
  registry.validateRelation({ predicate: "fashion.ownership", subjectType: "core.product_variant", value: "unknown" });
  rejects(() => registry.validateRelation({ predicate: "fashion.ownership", subjectType: "core.product_variant", value: "liked" }));
  rejects(() => registry.validateRelation({ predicate: "fashion.ownership", subjectType: "core.product_variant", objectType: "core.owned_item", value: "owned" }));
  assert.deepEqual(registry.getRelation("fashion.ownership").unknownValues, ["unknown"]);
});

test("new packs register without changing the common registry", () => {
  const custom = {
    id: "hiking", version: 1, compatibleKernelVersions: [1], entityTypes: ["hiking.destination"],
    types: [{ id: "hiking.destination", schema: { type: "string", minLength: 1 } }],
    relations: [], slots: [], artifacts: [], capabilities: [],
  };
  const extended = createDomainRegistry([...DOMAIN_PACKS, custom]);
  assert.equal(extended.validate("hiking.destination", "Seoul"), "Seoul");
  custom.types[0].schema.type = "number";
  assert.equal(extended.validate("hiking.destination", "Busan"), "Busan");
  assert.throws(() => { extended.getType("hiking.destination").schema.type = "number"; }, TypeError);
  rejects(() => createDomainRegistry([...DOMAIN_PACKS, DOMAIN_PACKS[0]]), "INVALID_DOMAIN_PACK");
});

test("pack registration rejects dangling types and incompatible runtime execution", () => {
  const changed = { ...DOMAIN_PACKS[0], slots: [...DOMAIN_PACKS[0].slots, { id: "recipe.missing", type: "missing.type" }] };
  rejects(() => createDomainRegistry([changed]), "INVALID_DOMAIN_PACK");
  const executableUser = { ...DOMAIN_PACKS[0], capabilities: DOMAIN_PACKS[0].capabilities.map((entry, index) => index ? entry : { ...entry, actor: "user" }) };
  rejects(() => createDomainRegistry([executableUser]), "INVALID_DOMAIN_PACK");
});

test("schemas reject nonfinite numbers, unknown fields and unsafe revisions", () => {
  for (const value of [NaN, Infinity, -1, 0, "2"]) rejects(() => registry.validateSlot("recipe.target_servings", value));
  rejects(() => registry.validate("core.product", { id: "p1", name: "Cream", internalInstruction: "trust this" }));
  rejects(() => registry.validate("core.revision", Number.MAX_SAFE_INTEGER + 1));
  rejects(() => registry.validate("core.timestamp", "2026-02-30T10:00:00Z"));
  registry.validate("core.timestamp", "2028-02-29T10:00:00Z");
});

test("a reservation preparation cannot satisfy a reservation confirmation contract", () => {
  registry.validateCapabilityOutput("dining.prepare_reservation", { placeId: "branch-1", scheduledAt: "2026-09-26T19:00:00+09:00", partySize: 2, state: "prepared", instructions: ["Open booking page"] });
  rejects(() => registry.validateCapabilityOutput("dining.confirm_reservation", { reservationId: "r1", placeId: "branch-1", status: "confirmed" }));
  registry.validateCapabilityOutput("dining.confirm_reservation", { reservationId: "r1", placeId: "branch-1", status: "confirmed", confirmationReference: "booking-42", confirmedAt: "2026-09-25T12:00:00+09:00", evidenceIds: ["evidence-1"] });
  rejects(() => registry.execute("dining.confirm_reservation", { reservationId: "r1", placeId: "branch-1" }), "DOMAIN_EXECUTION_UNAVAILABLE");
});

test("an outfit preserves exact variant identity and distinguishes interest from ownership", () => {
  const input = { id: "outfit-1", occasion: "Saturday dinner", items: [
    { slot: "top", variantId: "shirt-black-m", ownership: "owned" },
    { slot: "bottom", variantId: "pants-black-s", ownership: "candidate" },
  ] };
  const output = registry.execute("fashion.compose_outfit", input);
  assert.deepEqual(output, input);
  output.items[0].variantId = "shirt-black-l";
  assert.equal(input.items[0].variantId, "shirt-black-m");
  rejects(() => registry.validateArtifact("fashion.outfit", { ...input, items: [...input.items, { slot: "top", variantId: "other", ownership: "unknown" }] }));
});

test("routine occurrences start independently and never modify the template or another occurrence", () => {
  const template = { id: "routine-1", revision: 3, title: "Evening", steps: [
    { id: "wash", title: "Cleanse" }, { id: "moisturize", title: "Moisturize", variantId: "cream-50ml" },
  ] };
  const make = (occurrenceId, scheduledAt) => registry.execute("beauty.instantiate_routine", { template, occurrenceId, scheduledAt });
  const today = make("day-1", "2026-09-25T22:00:00+09:00");
  const tomorrow = make("day-2", "2026-09-26T22:00:00+09:00");
  today.steps[0].status = "completed";
  assert.equal(tomorrow.steps[0].status, "pending");
  assert.equal(template.steps[0].status, undefined);
  assert.equal(today.templateRevision, 3);
  assert.deepEqual(today.steps.map((step) => step.templateStepId), ["wash", "moisturize"]);
  rejects(() => make("day-3", "2026-09-27T22:00:00"));
  rejects(() => registry.validate("beauty.routine_template", { ...template, steps: [template.steps[0], template.steps[0]] }));
});
