import { checkLabeledInputs, loadVerifiedLabeledImage } from "./labeled_inputs.js";
import { evaluateLabeledBatch, validateLabelManifest } from "./labeled_analysis.js";
import { validateLegacyAnalysis } from "../ingestion/index.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function localBaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("INVALID_EVALUATION_ENDPOINT"); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("INVALID_EVALUATION_ENDPOINT");
  }
  return url;
}

async function readJsonResponse(response) {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
      !response.body) throw new Error("EVALUATION_BACKEND_FAILED");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_RESPONSE_BYTES) throw new Error("EVALUATION_BACKEND_FAILED");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("EVALUATION_BACKEND_FAILED"); }
}

export async function recordLabeledPredictions({ manifest, imageDirectory, endpoint,
  serverCommit, fetchImpl = fetch, now = () => new Date() }) {
  validateLabelManifest(manifest);
  const baseUrl = localBaseUrl(endpoint);
  if (typeof serverCommit !== "string" || !/^[a-f0-9]{40}$/.test(serverCommit)) {
    throw new Error("INVALID_EVALUATION_COMMIT");
  }
  const verified = await checkLabeledInputs(manifest, imageDirectory);
  if (verified.verified !== verified.cases) throw new Error("INVALID_EVALUATION_IMAGE");

  const health = await readJsonResponse(await fetchImpl(new URL("/health", baseUrl), {
    redirect: "error", signal: AbortSignal.timeout(10_000),
  }));
  if (health.status !== "ok" ||
      ![health.model, health.schemaVersion, health.promptVersion].every((value) =>
        typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))) {
    throw new Error("EVALUATION_BACKEND_VERSION_UNAVAILABLE");
  }
  const run = { modelId: health.model, promptVersion: health.promptVersion,
    analysisSchemaVersion: health.schemaVersion, serverCommit,
    executedAt: now().toISOString() };
  const predictions = {};
  for (const entry of manifest.entries) {
    // Recheck the bytes immediately before each upload, including their hash.
    const { bytes, mimeType } = await loadVerifiedLabeledImage(imageDirectory, entry);
    const response = await fetchImpl(new URL("/v1/analyze", baseUrl), {
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: { mimeType, base64: bytes.toString("base64") },
        capture: { id: entry.id, sourceApp: "luffi-evaluation", sourceUrl: null,
          capturedAt: null, locale: "ko-KR" } }),
      signal: AbortSignal.timeout(120_000),
    });
    const analysis = await readJsonResponse(response);
    validateLegacyAnalysis(analysis);
    if (analysis.model !== run.modelId || analysis.schemaVersion !== run.analysisSchemaVersion) {
      throw new Error("EVALUATION_BACKEND_VERSION_CHANGED");
    }
    predictions[entry.id] = { inputSha256: entry.inputSha256, analysis };
  }
  const finalHealth = await readJsonResponse(await fetchImpl(new URL("/health", baseUrl), {
    redirect: "error", signal: AbortSignal.timeout(10_000),
  }));
  if (finalHealth.model !== run.modelId || finalHealth.schemaVersion !== run.analysisSchemaVersion ||
      finalHealth.promptVersion !== run.promptVersion) {
    throw new Error("EVALUATION_BACKEND_VERSION_CHANGED");
  }
  const bundle = { schemaVersion: 1, run, predictions };
  evaluateLabeledBatch(manifest, bundle);
  return bundle;
}
