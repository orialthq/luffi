import { readFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";

export async function createRelationalTestPool(t) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create();
  t.after(() => db.close());
  for (const name of ["001_common_kernel", "002_kernel_state",
    "003_relational_knowledge"]) {
    await db.exec(await readFile(new URL(
      `../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  const query = (sql, params) => db.query(sql, params);
  return { db, pool: { query,
    connect: async () => ({ query, release() {} }) } };
}

export async function createScenarioTestStore(t, backend, name) {
  let reopenStore;
  if (backend === "postgres") {
    const { pool } = await createRelationalTestPool(t);
    reopenStore = () => createPostgresRelationalStore({ pool,
      initialState: createCommonKernelState });
  } else {
    const folder = await fs.mkdtemp(join(tmpdir(), `luffi-${name}-`));
    t.after(() => fs.rm(folder, { recursive: true, force: true }));
    const filePath = join(folder, "state.json");
    reopenStore = () => createJsonStateStore({ filePath,
      initialState: createCommonKernelState });
  }
  const store = reopenStore();
  if (backend === "postgres") await store.ready();
  return { store, reopenStore };
}
