import { array, enumeration, fail, integer, object, ref, text } from "./schema.js";
import { artifact, capability, relation, valueRelation } from "./shared.js";

const choice = object({ id: text, productId: text, offerId: text,
  importId: text, title: text, quantity: ref("shopping.quantity_count"),
  displayedPriceText: text });

export const shoppingPack = {
  id: "shopping", version: 1, compatibleKernelVersions: [1],
  entityTypes: ["core.product", "shopping.offer_snapshot", "shopping.purchase_choice",
    "shopping.purchase_report"],
  types: [
    { id: "shopping.quantity_count", schema: integer,
      validate: (value) => { if (value > 20) fail("quantity exceeds 20"); } },
    { id: "shopping.krw_amount", schema: integer,
      validate: (value) => { if (value > 1_000_000_000) fail("amount exceeds limit"); } },
    { id: "shopping.offer_snapshot", schema: object({ id: text,
      title: text, displayedPriceText: text }) },
    { id: "shopping.purchase_choice", schema: choice },
    { id: "shopping.purchase_report", schema: object({ id: text,
      choiceId: text, actualPaidKrw: ref("shopping.krw_amount"),
      reportedAt: ref("core.timestamp") }) },
    { id: "shopping.capture_detail", schema: object({ label: text,
      value: text, evidenceIds: ref("core.evidence_ids") }) },
    { id: "shopping.capture_candidate", schema: object({ importId: text,
      title: text, displayedPriceText: text, mentionId: text,
      titleEvidenceIds: ref("core.evidence_ids"),
      priceEvidenceIds: ref("core.evidence_ids"),
      details: array(ref("shopping.capture_detail")) }) },
    { id: "shopping.confirm_input", schema: object({ purpose: text,
      candidates: array(ref("shopping.capture_candidate"), 1) }) },
    { id: "shopping.confirm_result", schema: object({ choice: ref("shopping.purchase_choice"),
      confirmedAt: ref("core.timestamp") }) },
    { id: "shopping.outcome_input", schema: object({
      choice: ref("shopping.purchase_choice") }) },
    { id: "shopping.purchase_outcome", schema: object({ choiceId: text,
      status: enumeration("purchased", "not_purchased", "unknown"),
      actualPaidKrw: ref("shopping.krw_amount"),
      reportedAt: ref("core.timestamp") },
      ["choiceId", "status", "reportedAt"]),
      validate: (value) => {
        if ((value.status === "purchased") !==
            Object.hasOwn(value, "actualPaidKrw")) {
          fail("actual paid amount is required only for a reported purchase");
        }
      } },
  ],
  relations: [
    relation("shopping.offer_of_product", ["shopping.offer_snapshot"],
      ["core.product"], "one"),
    { ...valueRelation("shopping.displayed_price", ["shopping.offer_snapshot"],
      "core.text"), temporalSemantics: "source_snapshot_only" },
    relation("shopping.choice_product", ["shopping.purchase_choice"],
      ["core.product"], "one"),
    relation("shopping.choice_offer", ["shopping.purchase_choice"],
      ["shopping.offer_snapshot"], "one"),
    valueRelation("shopping.quantity", ["shopping.purchase_choice"],
      "shopping.quantity_count", "explicit_user_confirmation"),
    relation("shopping.purchase_for_choice", ["shopping.purchase_report"],
      ["shopping.purchase_choice"], "one"),
    valueRelation("shopping.actual_paid_krw", ["shopping.purchase_report"],
      "shopping.krw_amount", "explicit_user_observation"),
  ],
  capabilities: [
    capability({ id: "shopping.confirm_choice", taskKind: "decision",
      inputType: "shopping.confirm_input", outputType: "shopping.confirm_result" }),
    capability({ id: "shopping.record_purchase_outcome", taskKind: "observe",
      inputType: "shopping.outcome_input", outputType: "shopping.purchase_outcome" }),
  ],
  slots: [],
  artifacts: [artifact("shopping.purchase_choice", "shopping.purchase_choice",
    "shopping.choice")],
};
