import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.LUFFI_KERNEL_DATABASE_URL;
if (!connectionString) throw new Error("LUFFI_KERNEL_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
try {
  for (const version of ["001_common_kernel", "002_kernel_state",
    "003_relational_knowledge"]) {
    const migration = await readFile(fileURLToPath(new URL(
      `../migrations/${version}.sql`, import.meta.url)), "utf8");
    await pool.query(migration);
    console.log(`Kernel migration ${version} applied`);
  }
} finally {
  await pool.end();
}
