import { array, enumeration, object, ref, text } from "./schema.js";
import { artifact, capability, relation, slot, valueRelation } from "./shared.js";

export const diningPack = {
  id: "dining", version: 1, compatibleKernelVersions: [1],
  entityTypes: ["dining.place", "dining.reservation", "dining.visit"],
  types: [
    { id: "dining.place", schema: object({ id: text, name: text, branchName: text, providerId: text, address: text }, ["id", "name"]) },
    { id: "dining.reservation_status", schema: enumeration("unconfirmed", "confirmed", "cancelled", "unknown") },
    { id: "dining.reservation", schema: object({ id: text, placeId: text, scheduledAt: ref("core.timestamp"), partySize: ref("core.revision"), status: ref("dining.reservation_status") }) },
    { id: "dining.visit", schema: object({ id: text, placeId: text, visitedAt: ref("core.timestamp"), reportedBy: text }) },
    { id: "dining.compare_input", schema: object({ placeIds: array(text, 1), constraints: array(text) }) },
    { id: "dining.comparison", schema: object({ candidates: array(object({ placeId: text, reasons: array(text), evidenceIds: ref("core.evidence_ids") }), 1) }) },
    { id: "dining.prepare_input", schema: object({ placeId: text, scheduledAt: ref("core.timestamp"), partySize: ref("core.revision") }) },
    { id: "dining.reservation_preparation", schema: object({ placeId: text, scheduledAt: ref("core.timestamp"), partySize: ref("core.revision"), state: enumeration("prepared"), instructions: array(text) }) },
    { id: "dining.confirm_input", schema: object({ reservationId: text, placeId: text }) },
    { id: "dining.confirmation", schema: object({ reservationId: text, placeId: text, status: enumeration("confirmed"), confirmationReference: text, confirmedAt: ref("core.timestamp"), evidenceIds: ref("core.evidence_ids") }) },
    { id: "dining.visit_input", schema: object({ placeId: text }) },
  ],
  relations: [
    relation("dining.reservation_at", ["dining.reservation"], ["dining.place"], "one"),
    relation("dining.visited", ["dining.visit"], ["dining.place"], "one"),
    { ...valueRelation("dining.reservation_status", ["dining.reservation"], "dining.reservation_status", "confirmed_evidence_required"), allowedValues: ["unconfirmed", "confirmed", "cancelled", "unknown"], unknownValues: ["unknown"] },
  ],
  slots: [
    slot("dining.selected_place", "dining.place", "Resolved branch, not merely a brand or matching name"),
    slot("dining.scheduled_at", "core.timestamp", "Explicit scheduled time for dependent preparation tasks"),
    slot("dining.comparison", "dining.comparison", "Evidence-linked candidate comparison"),
    slot("dining.confirmation", "dining.confirmation", "Reservation proof; opening a link is insufficient"),
  ],
  capabilities: [
    capability({ id: "dining.compare_places", actor: "system", taskKind: "derive", inputType: "dining.compare_input", outputType: "dining.comparison", outputSlots: { "$": "dining.comparison" } }),
    capability({ id: "dining.prepare_reservation", taskKind: "decision", inputType: "dining.prepare_input", outputType: "dining.reservation_preparation", inputSlots: { scheduledAt: "dining.scheduled_at" }, completion: "preparation_only_not_reservation_confirmation" }),
    capability({ id: "dining.confirm_reservation", taskKind: "observe", inputType: "dining.confirm_input", outputType: "dining.confirmation", outputSlots: { "$": "dining.confirmation" }, completion: "confirmation_reference_and_evidence_required" }),
    capability({ id: "dining.record_visit", taskKind: "observe", inputType: "dining.visit_input", outputType: "dining.visit" }),
  ],
  artifacts: [artifact("dining.comparison", "dining.comparison", "dining.comparison"), artifact("dining.reservation_preparation", "dining.reservation_preparation", "dining.reservation"), artifact("dining.confirmation", "dining.confirmation", "dining.confirmation")],
};
