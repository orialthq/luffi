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
  const ledger = createDeletionLedger({ filePath: ledgerPath });
  const store = databaseUrl
    ? createPostgresRelationalStore({
        pool: pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 }),
        initialState: createCommonKernelState,
        deletionLedger: ledger,
      })
    : createJsonStateStore({ filePath: statePath, initialState: createCommonKernelState,
        deletionLedger: ledger });
  if (databaseUrl) await store.ready();
  await store.snapshot();
  console.log(JSON.stringify({ status: "safe", ledgerEntries: (await ledger.read()).length }));
} finally {
  if (pool) await pool.end();
}
