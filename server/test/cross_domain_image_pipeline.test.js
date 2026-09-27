import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCommonKernelService } from "../src/common/kernel_service.js";
import { createHttpServer } from "../src/http_app.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { createScenarioTestStore } from "./relational_fixture.js";

const cases = [
  { importId: "shop-tofu", name: "variation_shopping_tofu_ingredient",
    hash: "7a87bb882a641e8a344ce59750f7b34d9c4842d659f6ed91898b856d8602c442",
    sourceApp: "synthetic.shopping", kind: "commerce_product" },
  { importId: "fashion-blazer", name: "fashion_a_blazer",
    hash: "33a5db2639a0125196de6ccfb64cd668c8d5066eceeffe8676303a14e423643d",
    sourceApp: "synthetic.fashion", kind: "commerce_product" },
  { importId: "travel-viewpoint", name: "travel_a_viewpoint",
    hash: "07ddb947d3d725a1cd0737346f8a5817a7bd63e67301a88277cad4cbce483099",
    sourceApp: "synthetic.travel", kind: "place" },
  { importId: "dining-noodles", name: "variation_dining_jeju_noodles",
    hash: "207ca5abbbfa507fade08f353f744d407be4f780266ca37f0b94329fe5a166d3",
    sourceApp: "synthetic.dining", kind: "place" },
];

async function approve(service, created, commandId) {
  await service.acceptProposal({ proposalId: created.proposalId, commandId });
  return service.getBoard(created.activityId);
}

for (const backend of ["json", "postgres"]) {
test(`real image bytes pass through local API into independent shopping, fashion and travel decisions (${backend})`, async (t) => {
  const fixtures = new Map();
  for (const item of cases) {
    const image = await readFile(fileURLToPath(new URL(
      `./fixtures/${item.name}.png`, import.meta.url)));
    assert.equal(createHash("sha256").update(image).digest("hex"), item.hash);
    const analysis = JSON.parse(await readFile(fileURLToPath(new URL(
      `./fixtures/${item.name}_live_analysis.json`, import.meta.url)), "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, item.kind);
    fixtures.set(item.name, { image, analysis, item });
  }
  const received = [];
  const api = createHttpServer({ analysisService: { async analyze(input) {
    const fixture = fixtures.get(input.capture.id);
    assert.ok(fixture);
    assert.equal(createHash("sha256").update(Buffer.from(input.imageBase64, "base64"))
      .digest("hex"), fixture.item.hash);
    received.push(input.capture.id);
    return fixture.analysis;
  } } });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => new Promise((resolve) => api.close(resolve)));

  const { store } = await createScenarioTestStore(t, backend, "cross-image-pipeline");
  const service = createCommonKernelService({ ownerId: "cross-image-user", store });
  for (const item of cases) {
    const fixture = fixtures.get(item.name);
    const response = await fetch(`http://127.0.0.1:${api.address().port}/v1/analyze`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: { mimeType: "image/png",
        base64: fixture.image.toString("base64") },
      capture: { id: item.name, sourceApp: item.sourceApp, locale: "ko-KR" } }),
    });
    assert.equal(response.status, 200);
    const analysis = await response.json();
    assert.deepEqual(analysis, fixture.analysis);
    await service.importReviewedCapture({ importId: item.importId, reviewed: true,
      reviewedAt: "2026-09-27T09:00:00+09:00",
      capture: { id: item.name, asset: { status: "unavailable" } }, analysis });
  }
  assert.deepEqual(received, cases.map((item) => item.name));

  const shopping = await service.createShoppingScenario({ commandId: "create-shop",
    activityId: "shop", confirmed: true, importIds: ["shop-tofu"],
    purpose: "장보기" });
  let shoppingBoard = await approve(service, shopping, "approve-shop");
  await service.confirmShoppingChoice({ commandId: "choose-shop", activityId: "shop",
    expectedRevision: shoppingBoard.revision, selectedImportId: "shop-tofu",
    quantity: 1 });
  await assert.rejects(service.createShoppingScenario({ commandId: "price-free-fashion",
    activityId: "invalid-shop", confirmed: true, importIds: ["fashion-blazer"],
    purpose: "재킷 구입" }), (error) => error.code === "IMPORT_NOT_SHOPPING");

  const fashion = await service.createFashionScenario({ commandId: "create-fashion",
    activityId: "outfit", confirmed: true, importIds: ["fashion-blazer"],
    occasion: "주말", scheduledAt: "2026-09-28T18:00:00+09:00" });
  let fashionBoard = await approve(service, fashion, "approve-fashion");
  await service.confirmFashionOutfit({ commandId: "confirm-outfit", activityId: "outfit",
    expectedRevision: fashionBoard.revision,
    selections: [{ importId: "fashion-blazer", slot: "outerwear",
      color: "차콜", size: "M", ownership: "candidate" }] });

  const travel = await service.createTravelScenario({ commandId: "create-trip",
    activityId: "trip", confirmed: true, importIds: ["travel-viewpoint"],
    area: "제주", startAt: "2026-09-28T09:00:00+09:00" });
  let travelBoard = await approve(service, travel, "approve-trip");
  await service.confirmTravelItinerary({ commandId: "confirm-trip", activityId: "trip",
    expectedRevision: travelBoard.revision,
    selections: [{ importId: "travel-viewpoint",
      plannedAt: "2026-09-28T10:00:00+09:00" }] });
  const dining = await service.createDiningScenario({ commandId: "create-dining",
    activityId: "dining", confirmed: true, importIds: ["dining-noodles"],
    scheduledAt: "2026-09-28T12:00:00+09:00", area: "성산읍", partySize: 2 });
  let diningBoard = await approve(service, dining, "approve-dining");
  await service.selectDiningPlace({ commandId: "choose-dining", activityId: "dining",
    expectedRevision: diningBoard.revision,
    candidateId: diningBoard.tasks.find((task) => task.id === "select_place")
      .readiness.inputs.candidates[0].id });
  travelBoard = await service.getBoard("trip");
  diningBoard = await service.getBoard("dining");
  await service.createScenarioConnection({ commandId: "link-trip-dining",
    fromActivityId: "trip", toActivityId: "dining", kind: "travel_dining",
    confirmed: true, expectedFromRevision: travelBoard.revision,
    expectedToRevision: diningBoard.revision });

  const before = await store.snapshot();
  const active = (predicate) => before.knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === predicate);
  assert.equal(active("shopping.purchase_for_choice").length, 0);
  assert.equal(active("fashion.wore_outfit").length, 0);
  assert.equal(active("travel.visit_of_stop").length, 0);
  assert.equal(active("scenario.connection_to_subject").length, 1);
  shoppingBoard = await service.getBoard("shop");
  fashionBoard = await service.getBoard("outfit");
  travelBoard = await service.getBoard("trip");
  await service.recordShoppingPurchaseOutcome({ commandId: "not-bought",
    activityId: "shop", expectedRevision: shoppingBoard.revision,
    status: "not_purchased" });
  await service.recordFashionWearOutcome({ commandId: "not-worn",
    activityId: "outfit", expectedRevision: fashionBoard.revision,
    status: "not_worn" });
  const itinerary = travelBoard.tasks.find((task) => task.id === "record_stop_outcomes")
    .readiness.inputs.itinerary;
  await service.recordTravelStopOutcomes({ commandId: "visit-unknown",
    activityId: "trip", expectedRevision: travelBoard.revision,
    stops: itinerary.stops.map((stop) => ({ stopId: stop.id, status: "unknown" })) });
  const after = await store.snapshot();
  assert.equal(after.knowledge.assertions.filter((item) => item.status === "active" &&
    ["shopping.purchase_for_choice", "fashion.wore_outfit",
      "travel.visit_of_stop"].includes(item.predicate)).length, 0);
});
}
