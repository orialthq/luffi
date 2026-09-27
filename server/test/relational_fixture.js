import { readFile } from "node:fs/promises";

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
