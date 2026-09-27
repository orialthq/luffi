import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import pg from "pg";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createDeletionLedger } from "../src/storage/deletion_ledger.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";
import { reconcileDeletionLedger } from "../src/storage/reconcile_deletions.js";
import { makeValidAnalysis } from "./fixtures.js";

const run = promisify(execFile);
const databaseUrl = process.env.LUFFI_TEST_POSTGRES_URL;
const container = process.env.LUFFI_TEST_POSTGRES_CONTAINER;

async function pgTool(name, args, database, dumpPath) {
  if (container) {
    await run("docker", ["exec", container, name, "-U", "postgres", "-d", database,
      ...args, dumpPath]);
  } else {
    await run(name, ["--dbname", databaseUrl, ...args, dumpPath]);
  }
}

test("real pg_dump/pg_restore rejects an old deletion state and accepts a current one",
  { skip: !databaseUrl && "Set LUFFI_TEST_POSTGRES_URL" }, async () => {
    const schema = `luffi_restore_${randomUUID().replaceAll("-", "")}`;
    const folder = await mkdtemp(join(tmpdir(), "luffi-real-pg-restore-"));
    const ledger = createDeletionLedger({ filePath: join(folder, "deletions.ndjson") });
    await ledger.bootstrap(createCommonKernelState());
    const oldDump = `/tmp/${schema}_old.dump`;
    const currentDump = `/tmp/${schema}_current.dump`;
    const database = new URL(databaseUrl).pathname.slice(1);
    const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    const pool = new pg.Pool({ connectionString: databaseUrl,
      options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    const makeStore = () => createPostgresRelationalStore({ pool,
      initialState: createCommonKernelState, deletionLedger: ledger });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      for (const version of ["001_common_kernel", "002_kernel_state", "003_relational_knowledge"]) {
        const sql = await readFile(new URL(`../migrations/${version}.sql`, import.meta.url), "utf8");
        await pool.query(sql);
      }
      const store = makeStore();
      await store.ready();
      const service = createCommonKernelService({ ownerId: "restore-test-owner", store });
      const input = (id) => ({ importId: id, reviewed: true,
        reviewedAt: "2026-09-27T09:00:00Z",
        capture: { id, asset: { status: "unavailable" } },
        analysis: makeValidAnalysis() });
      const deleted = await service.importReviewedCapture(input("pg-restore-deleted"));
      const retained = await service.importReviewedCapture(input("pg-restore-retained"));
      await pgTool("pg_dump", ["-n", schema, "-Fc", "-f"], database, oldDump);
      await service.deleteReviewedCapture({ importId: "pg-restore-deleted",
        commandId: "pg-restore-delete" });
      await pgTool("pg_dump", ["-n", schema, "-Fc", "-f"], database, currentDump);

      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pgTool("pg_restore", ["--no-owner", "--no-privileges"], database, oldDump);
      await assert.rejects(makeStore().ready(), /DELETION_LEDGER_RESTORE_UNSAFE/);
      const quarantined = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      assert.deepEqual(await reconcileDeletionLedger({ store: quarantined,
        ledger, apply: true }), { pendingImports: 1, pendingSources: 1,
        applied: true });
      await makeStore().ready();

      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pgTool("pg_restore", ["--no-owner", "--no-privileges"], database, currentDump);
      const recovered = createCommonKernelService({ ownerId: "restore-test-owner",
        store: makeStore() });
      const statuses = await recovered.checkReviewedCaptureImports({
        importIds: ["pg-restore-deleted", "pg-restore-retained"] });
      assert.deepEqual(statuses.imports, [
        { importId: "pg-restore-deleted", status: "deleted" },
        { importId: "pg-restore-retained", status: "active", sourceId: retained.sourceId },
      ]);
      assert.equal((await recovered.queryKnowledge({ subjectId: deleted.materialId })).length, 0);
      assert.ok((await recovered.queryKnowledge({ subjectId: retained.materialId })).length > 0);
      await assert.rejects(recovered.importReviewedCapture(input("pg-restore-deleted")),
        (error) => error.code === "IMPORT_DELETED");
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      if (container) {
        await run("docker", ["exec", container, "rm", "-f", oldDump, currentDump]).catch(() => {});
      } else {
        await rm(oldDump, { force: true });
        await rm(currentDump, { force: true });
      }
      await rm(folder, { recursive: true, force: true });
    }
  });
