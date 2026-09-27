import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.LUFFI_KERNEL_DATABASE_URL;
if (!connectionString) throw new Error("LUFFI_KERNEL_DATABASE_URL is required");
const migration = await readFile(fileURLToPath(new URL(
  "../migrations/002_kernel_state.sql", import.meta.url)), "utf8");
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
try {
  await pool.query(migration);
  console.log("Kernel state migration 002 applied");
} finally {
  await pool.end();
}
