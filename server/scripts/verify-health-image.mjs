import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const imagePath = fileURLToPath(new URL(
  "../test/fixtures/health_home_workout.png", import.meta.url));
const responsePath = fileURLToPath(new URL(
  "../test/fixtures/health_home_workout_live_analysis.json", import.meta.url));
const endpoint = new URL("/v1/analyze",
  process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787");
const image = await readFile(imagePath);
const response = await fetch(endpoint, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: "synthetic-health-home-workout",
      sourceApp: "synthetic.health", locale: "ko-KR" },
  }),
  signal: AbortSignal.timeout(120_000),
});
const result = await response.json();
if (!response.ok) throw new Error(`API ${response.status}: ${result.error?.code ?? "unknown"}`);
const expected = ["제자리 걷기 5분", "스쿼트 10회", "어깨 돌리기 10회"];
if (result.contentKind !== "unknown" || result.completeness !== "complete" ||
    result.title?.value !== "집에서 하는 3단계 홈트" ||
    !result.title?.evidenceIds?.length ||
    !result.tags?.some((tag) => tag.value === "건강·운동" &&
      tag.facet === "field" && tag.evidenceIds?.length) ||
    !result.tags?.some((tag) => tag.value === "운동" &&
      tag.facet === "kind" && tag.evidenceIds?.length) ||
    result.facts?.length !== 3 || result.facts.some((fact, index) =>
      fact.label !== `${index + 1}단계` || fact.value !== expected[index] ||
      !fact.evidenceIds?.length)) {
  throw new Error("live analysis did not preserve the workout steps with evidence");
}
if (process.argv.includes("--record")) {
  await writeFile(responsePath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify({ contentKind: result.contentKind,
  title: result.title.value, facts: result.facts.map((item) => item.value),
  evidence: result.evidence?.length }));
