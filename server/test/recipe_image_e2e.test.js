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

const imagePath = fileURLToPath(new URL("./fixtures/recipe_tomato_egg_generated.png", import.meta.url));
const responsePath = fileURLToPath(new URL("./fixtures/recipe_tomato_egg_live_analysis.json", import.meta.url));

test("generated image and recorded live API response reach a confirmed recipe board", async (t) => {
  const image = await fs.readFile(imagePath);
  assert.equal(createHash("sha256").update(image).digest("hex"),
    "4344034d26aeab2e3d42316b08d0f24fa3894e5a61f7536b0dedb3cf33d65106");
  validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: "generated-tomato-egg-recipe", sourceApp: "synthetic.recipe",
      locale: "ko-KR" } });

  // Captured from a successful /v1/analyze call on this PNG. The default test
  // suite replays the real result without making another paid provider call.
  const analysis = JSON.parse(await fs.readFile(responsePath, "utf8"));
  validateLegacyAnalysis(analysis);
  assert.equal(analysis.contentKind, "recipe");
  assert.equal(analysis.title.value, "토마토 달걀 볶음");
  assert.deepEqual(analysis.ingredientGroups.flatMap((group) => group.ingredients)
    .map(({ name, amount, unit }) => [name, amount, unit]), [
    ["달걀", "2", "개"], ["토마토", "200", "g"], ["식용유", "1", "큰술"],
  ]);
  assert.equal(analysis.steps.length, 3);

  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-recipe-image-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const service = createCommonKernelService({ ownerId: "fixture-user",
    store: createJsonStateStore({ filePath: join(folder, "state.json"),
      initialState: createCommonKernelState }) });
  const imported = await service.importReviewedCapture({ importId: "image-backed-import",
    reviewed: true, reviewedAt: "2026-09-25T12:00:00Z",
    capture: { id: "generated-tomato-egg-recipe", asset: { status: "unavailable" } },
    analysis });
  const titleFact = (await service.queryKnowledge({ subjectId: imported.materialId,
    predicate: "ingestion.extracted_field" })).find((item) =>
    item.typedValue?.value.path === "/title/value");
  assert.equal(titleFact.typedValue.value.value, "토마토 달걀 볶음");

  // Image-derived amounts remain strings until a user confirms the typed
  // quantity/unit mapping. This fixture represents that explicit review.
  const created = await service.createRecipeScenario({ commandId: "confirm-image-recipe",
    activityId: "cook-image-recipe", confirmed: true, importId: "image-backed-import",
    recipe: { id: "reviewed-tomato-egg", revision: 1, title: analysis.title.value,
      baseServings: 2, ingredients: [
        { id: "egg", ingredientId: "egg", name: "달걀",
          quantity: { status: "known", amount: 2, unit: "count" }, scaling: "linear" },
        { id: "tomato", ingredientId: "tomato", name: "토마토",
          quantity: { status: "known", amount: 200, unit: "g" }, scaling: "linear" },
        { id: "oil", ingredientId: "oil", name: "식용유",
          quantity: { status: "known", amount: 1, unit: "tbsp" }, scaling: "linear" },
      ] }, targetServings: 4, inventory: [] });
  assert.equal((await service.getBoard(created.activityId)).pendingProposals.length, 1);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "accept-image-recipe" });
  const board = await service.getBoard(created.activityId);
  const scaled = await service.runTask({ activityId: created.activityId,
    taskId: "scale_servings", expectedRevision: board.revision, commandId: "scale-image-recipe" });
  assert.deepEqual(scaled.output.ingredients.map((item) => item.quantity.amount), [4, 400, 2]);
});
