import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cases = [
  ["a_cleanser", "데일리 클렌징 젤"],
  ["b_moisturizer", "수분 장벽 크림"],
];
const endpoint = new URL(
  "/v1/analyze",
  process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787",
);
const record = process.argv.includes("--record");

for (const [name, title] of cases) {
  const imagePath = fileURLToPath(new URL(`../test/fixtures/beauty_${name}.png`, import.meta.url));
  const responsePath = fileURLToPath(new URL(`../test/fixtures/beauty_${name}_live_analysis.json`, import.meta.url));
  const image = await readFile(imagePath);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: {
        id: `synthetic-beauty-${name}`,
        sourceApp: "synthetic.beauty",
        capturedAt: "2026-09-26T09:00:00+09:00",
        locale: "ko-KR",
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: API ${response.status}: ${result.error?.code ?? "unknown"}`);
  if (record) await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
  const summary = {
    name,
    status: response.status,
    model: result.model,
    contentKind: result.contentKind,
    title: result.title,
    evidence: result.evidence?.length,
    recorded: record,
  };
  console.log(JSON.stringify(summary));
  if (result.contentKind !== "beauty_product" || result.title?.status !== "observed" ||
      result.title.value !== title || !result.evidence?.length) {
    throw new Error(`${name}: beauty product identity was not grounded in the image`);
  }
}
