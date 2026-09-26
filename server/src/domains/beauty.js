import { array, assertUnique, enumeration, object, ref, text } from "./schema.js";
import { artifact, capability, relation, slot, valueRelation } from "./shared.js";

const step = object({ id: text, title: text, variantId: text }, ["id", "title"]);
const template = object({ id: text, revision: ref("core.revision"), title: text, steps: array(ref("beauty.routine_step"), 1) });
const occurrence = object({
  id: text, templateId: text, templateRevision: ref("core.revision"), scheduledAt: ref("core.timestamp"),
  steps: array(object({ templateStepId: text, title: text, variantId: text, status: enumeration("pending", "completed", "skipped") }, ["templateStepId", "title", "status"]), 1),
});

export const beautyPack = {
  id: "beauty", version: 2, compatibleKernelVersions: [1],
  entityTypes: ["core.product", "core.product_variant", "beauty.routine_template", "beauty.routine_step", "beauty.routine_occurrence", "beauty.use_experience"],
  types: [
    { id: "beauty.routine_step", schema: step },
    { id: "beauty.routine_template", schema: template, validate: (value) => assertUnique(value.steps, "id", "$.steps") },
    { id: "beauty.routine_occurrence", schema: occurrence, validate: (value) => assertUnique(value.steps, "templateStepId", "$.steps") },
    { id: "beauty.instantiate_input", schema: object({ template: ref("beauty.routine_template"), occurrenceId: text, scheduledAt: ref("core.timestamp") }) },
    { id: "beauty.use_input", schema: object({ occurrenceId: text, templateStepId: text, variantId: text }, ["occurrenceId", "templateStepId"]) },
    { id: "beauty.use_experience", schema: object({ id: text, occurrenceId: text, templateStepId: text, status: enumeration("completed", "skipped"), recordedAt: ref("core.timestamp"), reportedBy: text, note: text }, ["id", "occurrenceId", "templateStepId", "status", "recordedAt", "reportedBy"]) },
    { id: "beauty.capture_candidate", schema: object({ importId: text, name: text,
      mentionId: text, evidenceIds: ref("core.evidence_ids") }) },
    { id: "beauty.confirm_input", schema: object({ occasion: text,
      candidates: array(ref("beauty.capture_candidate"), 1) }) },
    { id: "beauty.confirm_result", schema: object({ templateId: text, occurrenceId: text,
      template: ref("beauty.routine_template"), confirmedAt: ref("core.timestamp") }) },
    { id: "beauty.outcome_input", schema: object({ occurrence: ref("beauty.routine_occurrence") }) },
    { id: "beauty.outcome_step", schema: object({ templateStepId: text,
      status: enumeration("completed", "skipped", "unknown") }) },
    { id: "beauty.routine_outcome", schema: object({ occurrenceId: text,
      steps: array(ref("beauty.outcome_step"), 1), recordedAt: ref("core.timestamp") }),
      validate: (value) => assertUnique(value.steps, "templateStepId", "$.steps") },
  ],
  relations: [
    relation("beauty.variant_of", ["core.product_variant"], ["core.product"], "one"),
    valueRelation("beauty.variant_label", ["core.product_variant"], "core.text", "explicit_user_confirmation"),
    relation("beauty.has_step", ["beauty.routine_template"], ["beauty.routine_step"]),
    valueRelation("beauty.step_title", ["beauty.routine_step"], "core.text", "explicit_user_confirmation"),
    valueRelation("beauty.step_order", ["beauty.routine_step"], "core.revision", "explicit_user_confirmation"),
    relation("beauty.uses_variant", ["beauty.routine_step"], ["core.product_variant"], "one"),
    relation("beauty.occurrence_of", ["beauty.routine_occurrence"], ["beauty.routine_template"], "one"),
    relation("beauty.experience_in", ["beauty.use_experience"], ["beauty.routine_occurrence"], "one"),
    relation("beauty.experience_for_step", ["beauty.use_experience"], ["beauty.routine_step"], "one"),
    relation("beauty.experience_uses_variant", ["beauty.use_experience"], ["core.product_variant"], "one"),
  ],
  slots: [
    slot("beauty.template", "beauty.routine_template", "Versioned template; completion belongs to an occurrence"),
    slot("beauty.scheduled_at", "core.timestamp", "Concrete occurrence time, including timezone"),
    slot("beauty.occurrence", "beauty.routine_occurrence", "Independent routine occurrence with stable step references"),
  ],
  capabilities: [
    capability({ id: "beauty.instantiate_routine", actor: "system", taskKind: "derive", inputType: "beauty.instantiate_input", outputType: "beauty.routine_occurrence", inputSlots: { template: "beauty.template", scheduledAt: "beauty.scheduled_at" }, outputSlots: { "$": "beauty.occurrence" }, validateInput(input) { assertUnique(input.template.steps, "id", "$.template.steps"); }, validateOutput(output) { assertUnique(output.steps, "templateStepId", "$.steps"); }, run(input) {
      return { id: input.occurrenceId, templateId: input.template.id, templateRevision: input.template.revision, scheduledAt: input.scheduledAt, steps: input.template.steps.map(({ id, ...rest }) => ({ ...rest, templateStepId: id, status: "pending" })) };
    } }),
    capability({ id: "beauty.confirm_routine", taskKind: "decision",
      inputType: "beauty.confirm_input", outputType: "beauty.confirm_result" }),
    capability({ id: "beauty.record_routine_outcome", taskKind: "observe",
      inputType: "beauty.outcome_input", outputType: "beauty.routine_outcome" }),
    capability({ id: "beauty.record_use", taskKind: "observe", inputType: "beauty.use_input", outputType: "beauty.use_experience", completion: "user_reported_occurrence_step_only" }),
  ],
  artifacts: [artifact("beauty.routine_occurrence", "beauty.routine_occurrence", "beauty.routine")],
};
