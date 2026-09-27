import pg from "pg";
import { createCommonKernelState } from "../src/common/kernel_service.js";
import { createDeletionLedger } from "../src/storage/deletion_ledger.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";

const [ledgerPath] = process.argv.slice(2);
const databaseUrl = process.env.LUFFI_KERNEL_DATABASE_URL;
const statePath = process.env.LUFFI_KERNEL_STATE_PATH;
if (!ledgerPath || process.argv.length !== 3 || Boolean(databaseUrl) === Boolean(statePath)) {
  throw new Error("Usage: set exactly one of LUFFI_KERNEL_DATABASE_URL or LUFFI_KERNEL_STATE_PATH, then pass LEDGER_PATH");
}
let pool;
try {
  const store = databaseUrl
    ? createPostgresRelationalStore({
        pool: pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 }),
        initialState: createCommonKernelState,
      })
    : createJsonStateStore({ filePath: statePath, initialState: createCommonKernelState });
  if (databaseUrl) await store.ready();
  const snapshot = await store.snapshot();
  const count = await createDeletionLedger({ filePath: ledgerPath }).bootstrap(snapshot);
  console.log(`Deletion ledger initialized from trusted current state (${count} tombstones)`);
} finally {
  if (pool) await pool.end();
}
