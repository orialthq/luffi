import { readFile } from "node:fs/promises";
import pg from "pg";
import { createCommonKernelState } from "../src/common/kernel_service.js";
import { assertSerializableState } from "../src/storage/json_state_store.js";

const connectionString = process.env.LUFFI_KERNEL_DATABASE_URL;
const filePath = process.argv[2];
if (!connectionString || !filePath) throw new Error(
  "Usage: LUFFI_KERNEL_DATABASE_URL=... npm run import:kernel-json -- /absolute/path/state.json");
const parsed = JSON.parse(await readFile(filePath, "utf8"));
assertSerializableState(parsed);
const graphKeys = ["sources", "sourceVersions", "evidence", "entities",
  "entityMentions", "identityDecisions", "assertions"];
if (parsed.schemaVersion !== createCommonKernelState().schemaVersion ||
    !parsed.knowledge || !parsed.activities || !parsed.resources ||
    graphKeys.some((key) => !Array.isArray(parsed.knowledge[key]))) {
  throw new Error("Input is not a compatible kernel snapshot");
}
// A hydrated export from the relational store contains graph arrays again.
// Re-import it as legacy state so the next startup inserts those graph rows.
delete parsed.graphStorageVersion;
delete parsed.graphDigest;
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
try {
  const result = await pool.query(
    `INSERT INTO luffi_kernel_state (id, revision, payload)
     VALUES ($1, 1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
    ["common-kernel", JSON.stringify(parsed)]);
  if (result.rowCount !== 1) throw new Error(
    "Database already contains kernel state; import refused without overwriting it");
  console.log("Kernel JSON snapshot imported into PostgreSQL");
} finally {
  await pool.end();
}
