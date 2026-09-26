import { domainRegistry } from "../domains/index.js";

export function buildLifeTipPlanDraft({ candidate },
  { registry = domainRegistry } = {}) {
  registry.validateCapabilityInput("life_tip.confirm_actions", candidate);
  const task = (id, title, capabilityId, inputBindings) => ({
    id, title, capabilityId, kind: registry.getCapability(capabilityId).taskKind,
    inputBindings,
  });
  return {
    tasks: [
      task("confirm_actions", "실천할 꿀팁 단계 확인",
        "life_tip.confirm_actions", candidate),
      task("record_outcomes", "단계별 실행 결과 기록",
        "life_tip.record_outcomes", {}),
    ],
    dependencyLinks: [{ id: "confirmed_actions_before_outcomes",
      fromTaskId: "confirm_actions", toTaskId: "record_outcomes" }],
    dataBindings: [{ id: "confirmed_tip_plan", sourceTaskId: "confirm_actions",
      targetTaskId: "record_outcomes", inputKey: "plan", outputKey: "plan" }],
    artifacts: [],
  };
}
