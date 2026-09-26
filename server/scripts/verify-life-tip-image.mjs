import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const endpoint = new URL("/v1/analyze",
  process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787");
const imagePath = fileURLToPath(new URL("../test/fixtures/life_tip_receipts.png", import.meta.url));
const responsePath = fileURLToPath(new URL(
  "../test/fixtures/life_tip_receipts_live_analysis.json", import.meta.url));
const image = await readFile(imagePath);
const response = await fetch(endpoint, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: "synthetic-life-tip-receipts", sourceApp: "synthetic.life_tip",
      locale: "ko-KR" },
  }),
  signal: AbortSignal.timeout(120_000),
});
const result = await response.json();
if (!response.ok) throw new Error(`API ${response.status}: ${result.error?.code ?? "unknown"}`);
if (process.argv.includes("--record")) {
  await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify({ status: response.status, contentKind: result.contentKind,
  title: result.title, tags: result.tags, facts: result.facts,
  evidence: result.evidence?.length }));
if (result.contentKind !== "unknown" || result.completeness !== "complete" ||
    result.title?.status !== "observed" ||
    result.title?.value !== "영수증 정리 3단계" ||
    !result.tags?.some((item) => item.value === "생활·팁" &&
      item.facet === "field" && item.evidenceIds?.length) ||
    result.facts?.length !== 3 || result.facts.some((item, index) =>
      item.label !== `${index + 1}단계` || !item.value?.trim() ||
      !item.evidenceIds?.length)) {
  throw new Error("Life tip title and ordered actions were not grounded in the image");
}
