import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";

const cases = [
  { name: "variation_recipe_tofu_egg_as_needed", sourceApp: "synthetic.recipe",
    check: (result) => result.contentKind === "recipe" &&
      result.ingredientGroups.flatMap((group) => group.ingredients).some((item) =>
        item.name === "소금" && item.amount === "약간" && item.unit == null) },
  { name: "variation_shopping_tofu_ingredient", sourceApp: "synthetic.shopping",
    check: (result) => result.contentKind === "commerce_product" &&
      result.title.value === "부침용 두부 300g" &&
      result.facts.some((item) => item.label === "가격" && item.value === "2,400원") },
  { name: "variation_shopping_old_current_price", sourceApp: "synthetic.shopping",
    check: (result) => result.contentKind === "commerce_product" &&
      result.facts.some((item) => item.value === "19,900원" && /이전/.test(item.label)) &&
      result.facts.some((item) => item.value === "12,900원" && /표시/.test(item.label)) &&
      !result.facts.some((item) => item.label === "가격") },
  { name: "variation_dining_jeju_noodles", sourceApp: "synthetic.dining",
    check: (result) => result.contentKind === "place" &&
      result.place?.name === "제주 바다국수" &&
      result.place?.category === "restaurant" &&
      result.place?.address?.includes("제주") },
  { name: "variation_life_tip_workout_prep", sourceApp: "synthetic.life_tip",
    check: (result) => result.contentKind === "unknown" &&
      result.tags.some((tag) => tag.value === "생활·팁" && tag.facet === "field") &&
      (result.facts.length === 3 || result.steps.length === 3) },
];
const endpoint = new URL("/v1/analyze",
  process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787");

for (const { name, sourceApp, check } of cases) {
  const imagePath = fileURLToPath(new URL(`../test/fixtures/${name}.png`, import.meta.url));
  const responsePath = fileURLToPath(new URL(
    `../test/fixtures/${name}_live_analysis.json`, import.meta.url));
  const image = await readFile(imagePath);
  const request = { image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: name, sourceApp, locale: "ko-KR" } };
  validateAnalyzeRequest(request);
  const response = await fetch(endpoint, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${name}: API ${response.status}`);
  const result = await response.json();
  validateLegacyAnalysis(result);
  const evidence = new Set(result.evidence.map((item) => item.id));
  const cited = [result.title, ...result.facts, ...result.steps,
    ...result.ingredientGroups.flatMap((group) => group.ingredients)];
  assert.ok(cited.every((item) => item.evidenceIds.length &&
    item.evidenceIds.every((id) => evidence.has(id))), `${name}: missing evidence`);
  assert.ok(check(result), `${name}: safety/meaning regression in live analysis`);
  if (process.argv.includes("--record")) {
    await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(`${name}: ${result.contentKind} · ${result.title.value}`);
}
