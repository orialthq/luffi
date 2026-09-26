import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cases = [["a_blazer", "차콜 싱글 재킷"], ["b_trousers", "베이지 슬랙스"]];
const endpoint = new URL("/v1/analyze", process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787");
const record = process.argv.includes("--record");

for (const [name, title] of cases) {
  const imagePath = fileURLToPath(new URL(`../test/fixtures/fashion_${name}.png`, import.meta.url));
  const responsePath = fileURLToPath(new URL(`../test/fixtures/fashion_${name}_live_analysis.json`, import.meta.url));
  const image = await readFile(imagePath);
  const response = await fetch(endpoint, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: `synthetic-fashion-${name}`, sourceApp: "synthetic.fashion",
        capturedAt: "2026-09-26T09:00:00+09:00", locale: "ko-KR" } }),
    signal: AbortSignal.timeout(120_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: API ${response.status}: ${result.error?.code ?? "unknown"}`);
  if (result.contentKind !== "commerce_product" || result.title?.status !== "observed" ||
      result.title.value !== title || !result.tags?.some((tag) =>
        tag.facet === "kind" && tag.value === "패션") || !result.evidence?.length) {
    throw new Error(`${name}: fashion product identity was not grounded in the image`);
  }
  if (record) await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ name, status: response.status, model: result.model,
    contentKind: result.contentKind, title: result.title.value,
    evidence: result.evidence?.length, recorded: record }));
}
