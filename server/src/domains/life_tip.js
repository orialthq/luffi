import { array, assertUnique, enumeration, object, ref, text } from "./schema.js";
import { artifact, capability, relation, valueRelation } from "./shared.js";

const action = object({ id: text, factIndex: ref("core.revision"),
  text, order: ref("core.revision") });
const plan = object({ id: text, revision: ref("core.revision"),
  tipId: text, title: text, actions: array(ref("life_tip.action"), 1) });

export const lifeTipPack = {
  id: "life_tip", version: 1, compatibleKernelVersions: [1],
  entityTypes: ["life_tip.tip", "life_tip.action_plan", "life_tip.action",
    "life_tip.execution"],
  types: [
    { id: "life_tip.tip", schema: object({ id: text, title: text }) },
    { id: "life_tip.action", schema: action },
    { id: "life_tip.action_plan", schema: plan,
      validate: (value) => {
        assertUnique(value.actions, "id", "$.actions");
        assertUnique(value.actions, "factIndex", "$.actions");
      } },
    { id: "life_tip.execution", schema: object({ id: text, planId: text,
      actionId: text, reportedAt: ref("core.timestamp") }) },
    { id: "life_tip.fact_candidate", schema: object({
      factIndex: ref("core.revision"), text,
      evidenceIds: ref("core.evidence_ids") }) },
    { id: "life_tip.confirm_input", schema: object({ importId: text,
      title: text, mentionId: text,
      candidates: array(ref("life_tip.fact_candidate"), 1) }) },
    { id: "life_tip.confirm_result", schema: object({ planId: text,
      plan: ref("life_tip.action_plan"), confirmedAt: ref("core.timestamp") }) },
    { id: "life_tip.outcome_input", schema: object({
      plan: ref("life_tip.action_plan") }) },
    { id: "life_tip.action_outcome", schema: object({ actionId: text,
      status: enumeration("done", "skipped", "unknown") }) },
    { id: "life_tip.plan_outcome", schema: object({ planId: text,
      actions: array(ref("life_tip.action_outcome"), 1),
      reportedAt: ref("core.timestamp") }),
      validate: (value) => assertUnique(value.actions, "actionId", "$.actions") },
  ],
  relations: [
    valueRelation("life_tip.tip_title", ["life_tip.tip"], "core.text"),
    relation("life_tip.plan_uses_tip", ["life_tip.action_plan"],
      ["life_tip.tip"], "one"),
    relation("life_tip.plan_has_action", ["life_tip.action_plan"],
      ["life_tip.action"]),
    valueRelation("life_tip.action_order", ["life_tip.action"],
      "core.revision", "explicit_user_confirmation"),
    valueRelation("life_tip.action_text", ["life_tip.action"],
      "core.text", "explicit_user_confirmation"),
    relation("life_tip.execution_for_action", ["life_tip.execution"],
      ["life_tip.action"], "one"),
  ],
  capabilities: [
    capability({ id: "life_tip.confirm_actions", taskKind: "decision",
      inputType: "life_tip.confirm_input", outputType: "life_tip.confirm_result" }),
    capability({ id: "life_tip.record_outcomes", taskKind: "observe",
      inputType: "life_tip.outcome_input", outputType: "life_tip.plan_outcome" }),
  ],
  slots: [],
  artifacts: [artifact("life_tip.action_plan", "life_tip.action_plan",
    "life_tip.plan")],
};
