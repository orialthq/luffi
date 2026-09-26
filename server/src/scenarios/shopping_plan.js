import { domainRegistry } from "../domains/index.js";

export function buildShoppingPlanDraft({ candidates, purpose },
  { registry = domainRegistry } = {}) {
  const confirmation = { candidates, purpose };
  registry.validateCapabilityInput("shopping.confirm_choice", confirmation);
  const task = (id, title, capabilityId, inputBindings) => ({
    id, title, capabilityId, kind: registry.getCapability(capabilityId).taskKind,
    inputBindings,
  });
  return {
    tasks: [
      task("confirm_choice", "상품과 수량 선택", "shopping.confirm_choice",
        confirmation),
      task("record_purchase_outcome", "실제 구매 결과 기록",
        "shopping.record_purchase_outcome", {}),
    ],
    dependencyLinks: [{ id: "choice_before_purchase",
      fromTaskId: "confirm_choice", toTaskId: "record_purchase_outcome" }],
    dataBindings: [{ id: "selected_choice", sourceTaskId: "confirm_choice",
      targetTaskId: "record_purchase_outcome", inputKey: "choice",
      outputKey: "choice" }],
    artifacts: [],
  };
}
