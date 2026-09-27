import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";

const name = "variation_shopping_egg_pack";
const imagePath = fileURLToPath(new URL(`../test/fixtures/${name}.png`, import.meta.url));
const responsePath = fileURLToPath(new URL(
  `../test/fixtures/${name}_live_analysis.json`, import.meta.url));
const image = await readFile(imagePath);
const request = { image: { mimeType: "image/png", base64: image.toString("base64") },
  capture: { id: name, sourceApp: "synthetic.shopping", locale: "ko-KR" } };
validateAnalyzeRequest(request);
const endpoint = new URL("/v1/analyze",
  process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787");
const response = await fetch(endpoint, { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request), signal: AbortSignal.timeout(120_000) });
const result = await response.json();
if (!response.ok) throw new Error(`analysis API ${response.status}: ${result.error?.code ?? "unknown"}`);
validateLegacyAnalysis(result);
assert.equal(result.contentKind, "commerce_product");
assert.equal(result.completeness, "complete");
assert.match(result.title.value, /달걀/);
assert.ok(result.facts.some((fact) => fact.label === "가격" &&
  fact.value === "4,900원"));
const evidence = new Set(result.evidence.map((item) => item.id));
assert.ok([result.title, ...result.facts].every((item) =>
  item.evidenceIds.length && item.evidenceIds.every((id) => evidence.has(id))));
if (process.argv.includes("--record")) {
  await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(`${name}: ${result.title.value} · price evidence verified`);
