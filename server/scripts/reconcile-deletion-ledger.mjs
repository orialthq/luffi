import pg from "pg";
import { createCommonKernelState } from "../src/common/kernel_service.js";
import { createDeletionLedger } from "../src/storage/deletion_ledger.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";
import { reconcileDeletionLedger } from "../src/storage/reconcile_deletions.js";

const [ledgerPath, action] = process.argv.slice(2);
const databaseUrl = process.env.LUFFI_KERNEL_DATABASE_URL;
const statePath = process.env.LUFFI_KERNEL_STATE_PATH;
if (!ledgerPath || (action !== undefined && action !== "--apply") ||
    Boolean(databaseUrl) === Boolean(statePath)) {
  throw new Error("Usage: set exactly one of LUFFI_KERNEL_DATABASE_URL or LUFFI_KERNEL_STATE_PATH, then pass LEDGER_PATH [--apply]");
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
  const report = await reconcileDeletionLedger({ store,
    ledger: createDeletionLedger({ filePath: ledgerPath }), apply: action === "--apply" });
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (pool) await pool.end();
}
