import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cases = ["a_fabric_box", "b_clear_box"];
const expected = {
  a_fabric_box: { title: "접이식 패브릭 수납함", price: "12,900원",
    color: "베이지", size: "38 × 28 × 24 cm" },
  b_clear_box: { title: "투명 적층 수납함", price: "15,900원",
    color: "투명", size: "35 × 25 × 20 cm" },
};
const endpoint = new URL("/v1/analyze",
  process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787");

for (const name of cases) {
  const imagePath = fileURLToPath(new URL(
    `../test/fixtures/shopping_${name}.png`, import.meta.url));
  const responsePath = fileURLToPath(new URL(
    `../test/fixtures/shopping_${name}_live_analysis.json`, import.meta.url));
  const image = await readFile(imagePath);
  const response = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: `synthetic-shopping-${name}`,
        sourceApp: "synthetic.shopping", locale: "ko-KR" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: API ${response.status}: ${result.error?.code ?? "unknown"}`);
  const observed = expected[name];
  const facts = new Map(result.facts?.map((fact) => [fact.label, fact]));
  if (result.contentKind !== "commerce_product" || result.completeness !== "complete" ||
      result.title?.value !== observed.title || !result.title?.evidenceIds?.length ||
      facts.get("가격")?.value !== observed.price ||
      facts.get("색상")?.value !== observed.color ||
      facts.get("크기")?.value !== observed.size ||
      !["가격", "색상", "크기"].every((label) => facts.get(label)?.evidenceIds?.length) ||
      !result.evidence?.length) {
    throw new Error(`${name}: live analysis did not preserve expected product evidence`);
  }
  if (process.argv.includes("--record")) {
    await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify({ name, contentKind: result.contentKind,
    title: result.title, tags: result.tags, facts: result.facts,
    evidence: result.evidence?.length }));
}
