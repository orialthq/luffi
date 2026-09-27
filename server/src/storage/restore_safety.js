import { createCommonKernelState } from "../common/kernel_service.js";
import { assertSerializableState } from "./json_state_store.js";

const validState = (state) => {
  assertSerializableState(state);
  if (state?.schemaVersion !== createCommonKernelState().schemaVersion ||
      !state.importReceipts || !Array.isArray(state.knowledge?.sources)) {
    throw new Error("INVALID_KERNEL_SNAPSHOT");
  }
};

/// Checks deletion monotonicity against the most recent trusted state. This
/// does not replace an independently retained deletion ledger after total loss.
export function checkRestoreDeletionSafety(trusted, candidate) {
  validState(trusted);
  validState(candidate);
  const currentDeletedImports = Object.entries(trusted.importReceipts)
    .filter(([, receipt]) => receipt?.deleted);
  let missingImportTombstones = 0;
  for (const [id, receipt] of currentDeletedImports) {
    const restored = candidate.importReceipts[id];
    if (!restored?.deleted || restored.ownerId !== receipt.ownerId ||
        restored.sourceId !== receipt.sourceId) missingImportTombstones += 1;
  }
  const sourceKey = (source) => `${source.ownerId}\u0000${source.id}`;
  const restoredSources = new Map(candidate.knowledge.sources.map((source) => [sourceKey(source), source]));
  const currentDeletedSources = trusted.knowledge.sources.filter((source) => source.status === "deleted");
  const reactivatedSources = currentDeletedSources.filter((source) =>
    restoredSources.get(sourceKey(source))?.status === "active").length;
  return { safe: missingImportTombstones === 0 && reactivatedSources === 0,
    checkedDeletedImports: currentDeletedImports.length,
    checkedDeletedSources: currentDeletedSources.length,
    missingImportTombstones, reactivatedSources };
}
