import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cases = [
  ["a_viewpoint", "바람언덕 전망대"],
  ["b_coastwalk", "푸른곶 해안길"],
];
const endpoint = new URL(
  "/v1/analyze",
  process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787",
);
const record = process.argv.includes("--record");

for (const [name, placeName] of cases) {
  const imagePath = fileURLToPath(new URL(`../test/fixtures/travel_${name}.png`, import.meta.url));
  const responsePath = fileURLToPath(new URL(`../test/fixtures/travel_${name}_live_analysis.json`, import.meta.url));
  const image = await readFile(imagePath);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: {
        id: `synthetic-travel-${name}`,
        sourceApp: "synthetic.travel",
        capturedAt: "2026-09-27T09:00:00+09:00",
        locale: "ko-KR",
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: API ${response.status}: ${result.error?.code ?? "unknown"}`);
  if (record) await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ name, status: response.status, model: result.model,
    contentKind: result.contentKind, place: result.place, evidence: result.evidence?.length,
    recorded: record }));
  if (result.contentKind !== "place" || result.place?.name !== placeName ||
      result.place?.searchArea !== "제주" || result.place?.category !== "activity" ||
      !result.place?.evidenceIds?.length) {
    throw new Error(`${name}: travel place identity was not grounded in the image`);
  }
}
