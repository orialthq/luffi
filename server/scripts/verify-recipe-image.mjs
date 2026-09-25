import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Explicit live check: start `npm run dev` first. This invokes the configured
// image-analysis provider and is intentionally excluded from `npm test`.
const imagePath = fileURLToPath(new URL("../test/fixtures/recipe_tomato_egg_generated.png", import.meta.url));
const endpoint = new URL("/v1/analyze", process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787");
const image = await readFile(imagePath);
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: "generated-tomato-egg-recipe", sourceApp: "synthetic.recipe",
      capturedAt: new Date().toISOString(), locale: "ko-KR" },
  }),
  signal: AbortSignal.timeout(90_000),
});
const result = await response.json();
if (!response.ok) throw new Error(`Analysis API returned ${response.status}: ${result.error?.code ?? "unknown"}`);

const ingredients = result.ingredientGroups?.flatMap((group) => group.ingredients ?? []) ?? [];
const byName = new Map(ingredients.map((item) => [item.name, item]));
const expected = [
  ["달걀", "2", "개"],
  ["토마토", "200", "g"],
  ["식용유", "1", "큰술"],
];
if (result.schemaVersion !== "2.1" || result.contentKind !== "recipe" ||
    result.title?.value !== "토마토 달걀 볶음" ||
    !expected.every(([name, amount, unit]) =>
      byName.get(name)?.amount === amount && byName.get(name)?.unit === unit) ||
    (result.steps?.length ?? 0) < 3 || (result.evidence?.length ?? 0) < 3) {
  throw new Error("The live image analysis missed a visible recipe field; inspect the API response.");
}
console.log(JSON.stringify({ status: response.status, model: result.model,
  contentKind: result.contentKind, title: result.title.value,
  ingredients: expected.map(([name]) => ({ name, amount: byName.get(name).amount,
    unit: byName.get(name).unit })), steps: result.steps.length,
  evidence: result.evidence.length }, null, 2));
