import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { createCommonKernelState } from "../src/common/kernel_service.js";
import { domainRegistry } from "../src/domains/index.js";
import { applyKnowledgeCommand } from "../src/knowledge/index.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";

const run = promisify(execFile);
const databaseUrl = process.env.LUFFI_TEST_POSTGRES_URL;

function legacySnapshot() {
  const state = createCommonKernelState();
  const now = "2026-09-27T09:00:00Z";
  let sequence = 0;
  const apply = (type, payload) => {
    state.knowledge = applyKnowledgeCommand(state.knowledge, {
      ownerId: "integration-user", commandId: `seed-${++sequence}`,
      type, payload,
    }, { predicates: domainRegistry.listRelations(), now }).state;
  };
  apply("source.create", { id: "legacy-source", kind: "user_note",
    title: "이관할 메모" });
  apply("source.version.add", { id: "legacy-version", sourceId: "legacy-source",
    contentHash: "legacy-hash", content: { title: "이관할 메모" },
    capturedAt: now });
  apply("evidence.add", { id: "legacy-evidence", sourceVersionId: "legacy-version",
    quote: "이관할 메모", locator: { kind: "text" } });
  apply("entity.create", { id: "legacy-recipe", type: "recipe.recipe",
    label: "레시피" });
  apply("entity.create", { id: "legacy-step", type: "recipe.step",
    label: "단계" });
  apply("assertion.add", { id: "legacy-step-link", subjectId: "legacy-recipe",
    predicate: "recipe.has_step", objectEntityId: "legacy-step",
    scope: { type: "activity", id: "legacy-board" }, origin: "user_reported",
    assertedBy: { type: "user", id: "integration-user" },
    evidenceIds: ["legacy-evidence"], observedAt: now });
  return state;
}

test("real PostgreSQL migrates, imports, serializes concurrent writes, and rolls back graph failures",
  { skip: !databaseUrl && "Set LUFFI_TEST_POSTGRES_URL to run against PostgreSQL" },
  async () => {
    const schema = `luffi_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: databaseUrl,
      connectionTimeoutMillis: 5000 });
    const folder = await mkdtemp(join(tmpdir(), "luffi-pg-integration-"));
    const path = join(folder, "legacy.json");
    let pool;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const env = { ...process.env, LUFFI_KERNEL_DATABASE_URL: databaseUrl,
        PGOPTIONS: `-c search_path=${schema}` };
      await run(process.execPath, [fileURLToPath(new URL(
        "../scripts/migrate-kernel-state.mjs", import.meta.url))], { env });
      const legacy = legacySnapshot();
      await writeFile(path, JSON.stringify(legacy));
      await run(process.execPath, [fileURLToPath(new URL(
        "../scripts/import-kernel-json.mjs", import.meta.url)), path], { env });
      pool = new pg.Pool({ connectionString: databaseUrl,
        options: `-c search_path=${schema}`, max: 4 });
      const first = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      await first.ready();
      assert.deepEqual((await first.snapshot()).knowledge, legacy.knowledge);
      const payload = (await pool.query("SELECT payload FROM luffi_kernel_state"))
        .rows[0].payload;
      assert.equal(Object.hasOwn(payload.knowledge, "assertions"), false);
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM luffi_assertion"))
        .rows[0].n, 1);

      const second = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      await Promise.all([first, second].map((store) => store.transact((state) => {
        state.shoppingCommandReceipts["integration:counter"] =
          (state.shoppingCommandReceipts["integration:counter"] ?? 0) + 1;
        return { state, result: null };
      })));
      assert.equal((await second.snapshot()).shoppingCommandReceipts
        ["integration:counter"], 2);

      await assert.rejects(first.transact((state) => {
        state.knowledge.assertions.push({ ...state.knowledge.assertions[0],
          id: "broken-foreign-key", objectEntityId: "missing-entity" });
        state.shoppingCommandReceipts["integration:failed"] = true;
        return { state, result: null };
      }), /foreign key|violates|constraint/i);
      const reopened = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      const restored = await reopened.snapshot();
      assert.equal(restored.knowledge.assertions.length, 1);
      assert.equal(restored.shoppingCommandReceipts["integration:failed"], undefined);
      assert.equal(restored.shoppingCommandReceipts["integration:counter"], 2);
    } finally {
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    }
  });
