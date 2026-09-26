import { domainRegistry } from "../domains/index.js";

/** User confirmation and reporting are fixed DAG steps; analysis cannot add tasks. */
export function buildFashionPlanDraft({ candidates, occasion }, { registry = domainRegistry } = {}) {
  const confirmation = { candidates, occasion };
  registry.validateCapabilityInput("fashion.confirm_outfit", confirmation);
  const task = (id, title, capabilityId, inputBindings) => ({ id, title, capabilityId,
    kind: registry.getCapability(capabilityId).taskKind, inputBindings });
  return { tasks: [
    task("confirm_outfit", "옷과 옵션·소유 상태 확인", "fashion.confirm_outfit", confirmation),
    task("record_wear", "실제 착용 여부 기록", "fashion.record_wear_outcome", {}),
  ], dependencyLinks: [
    { id: "outfit_before_wear", fromTaskId: "confirm_outfit", toTaskId: "record_wear" },
  ], dataBindings: [
    { id: "confirmed_outfit_for_wear", sourceTaskId: "confirm_outfit",
      targetTaskId: "record_wear", inputKey: "outfitId", outputKey: "outfitId" },
  ], artifacts: [] };
}
