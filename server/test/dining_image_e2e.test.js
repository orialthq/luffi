import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

const cases = [
  ["a_seongsu", "모퉁이식당 성수점", "성수", "deb96a44db7455330d1bdff63ff77d21b0b89eaa6e244f145970e4b7b223d11b"],
  ["b_yeonnam", "모퉁이식당 연남점", "연남", "a74f847027b5ed15f66bafafa88de22045776d20538bda497d1ee3e9cda99955"],
  ["c_seongsu", "모퉁이식당 성수점", "성수", "0769efeb768dbf6095ed6a03a337d26e0f96a7c08c32248253ae98820520cbcd"],
  ["d_noodles", "성수국수집", "성수", "eeec1579bc1acf6e7d212629b7f160b9689e3c6cf8f28f62d7fe8ea2db19732e"],
];

test("four generated screenshots and their real API responses create two Seongsu branches", async (t) => {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-dining-images-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const service = createCommonKernelService({ ownerId: "image-tester",
    store: createJsonStateStore({ filePath: join(folder, "state.json"),
      initialState: createCommonKernelState }) });
  const importIds = [];
  for (const [caseName, name, area, expectedHash] of cases) {
    const imagePath = fileURLToPath(new URL(`./fixtures/dining_${caseName}.png`, import.meta.url));
    const responsePath = fileURLToPath(new URL(`./fixtures/dining_${caseName}_live_analysis.json`, import.meta.url));
    const image = await fs.readFile(imagePath);
    assert.equal(createHash("sha256").update(image).digest("hex"), expectedHash);
    validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: caseName, sourceApp: "synthetic.dining", locale: "ko-KR" } });
    const analysis = JSON.parse(await fs.readFile(responsePath, "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, "place");
    assert.equal(analysis.place.name, name);
    assert.equal(analysis.place.searchArea, area);
    const importId = `image-${caseName}`;
    importIds.push(importId);
    await service.importReviewedCapture({ importId, reviewed: true,
      reviewedAt: "2026-09-26T09:00:00+09:00",
      capture: { id: caseName, asset: { status: "unavailable" } }, analysis });
  }
  const created = await service.createDiningScenario({ commandId: "create-images",
    activityId: "dinner-images", confirmed: true, importIds,
    scheduledAt: "2026-09-27T19:00:00+09:00", area: "성수", partySize: 2 });
  assert.equal(created.candidateCount, 2);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-images" });
  const board = await service.getBoard(created.activityId);
  const candidates = board.tasks.find((item) => item.id === "select_place").readiness.inputs.candidates;
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.find((item) => item.name === "모퉁이식당 성수점").importIds,
    ["image-a_seongsu", "image-c_seongsu"]);
  assert.ok(candidates.every((item) => !item.importIds.includes("image-b_yeonnam")));
});
