import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cases = [
  ["a_seongsu", "모퉁이식당 성수점", "성수"],
  ["b_yeonnam", "모퉁이식당 연남점", "연남"],
  ["c_seongsu", "모퉁이식당 성수점", "성수"],
  ["d_noodles", "성수국수집", "성수"],
];
const base = process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787";
const endpoint = new URL("/v1/analyze", base);
const record = process.argv.includes("--record");
const onlyCase = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7) ?? null;

for (const [caseName, name, area] of cases.filter(([name]) => onlyCase == null || name === onlyCase)) {
  const imagePath = fileURLToPath(new URL(`../test/fixtures/dining_${caseName}.png`, import.meta.url));
  const responsePath = fileURLToPath(new URL(`../test/fixtures/dining_${caseName}_live_analysis.json`, import.meta.url));
  const image = await readFile(imagePath);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: `synthetic-dining-${caseName}`, sourceApp: "synthetic.dining",
        capturedAt: "2026-09-26T09:00:00+09:00", locale: "ko-KR" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`${caseName}: API ${response.status}: ${result.error?.code ?? "unknown"}`);
  }
  if (result.contentKind !== "place" || result.place?.category !== "restaurant" ||
      result.place.name !== name || result.place.searchArea !== area ||
      (result.place.evidenceIds?.length ?? 0) === 0 ||
      (result.evidence?.length ?? 0) === 0) {
    throw new Error(`${caseName}: missing visible restaurant identity: ${JSON.stringify({
      contentKind: result.contentKind, place: result.place,
    })}`);
  }
  if (record) await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ caseName, status: response.status, model: result.model,
    name: result.place.name, area: result.place.searchArea,
    evidence: result.evidence.length, recorded: record }));
}
