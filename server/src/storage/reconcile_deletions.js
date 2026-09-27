import { createHash } from "node:crypto";
import { createCommonKernelService } from "../common/kernel_service.js";

const commandId = (kind, ownerId, id) => "ledger-reconcile-" +
  createHash("sha256").update(`${kind}\u0000${ownerId}\u0000${id}`).digest("hex").slice(0, 32);

export async function reconcileDeletionLedger({ store, ledger, apply = false }) {
  const pending = await ledger.pending(await store.snapshot());
  if (apply) {
    for (const item of pending.filter((item) => item.kind === "import")) {
      await createCommonKernelService({ ownerId: item.ownerId, store })
        .deleteReviewedCapture({ importId: item.id,
          commandId: commandId(item.kind, item.ownerId, item.id) });
    }
    const sources = await ledger.pending(await store.snapshot());
    for (const item of sources.filter((record) => record.kind === "source")) {
      await createCommonKernelService({ ownerId: item.ownerId, store })
        .knowledgeCommand({ commandId: commandId(item.kind, item.ownerId, item.id),
          type: "source.delete", payload: { sourceId: item.id } });
    }
    await ledger.assertSafe(await store.snapshot());
  }
  return { pendingImports: pending.filter((item) => item.kind === "import").length,
    pendingSources: pending.filter((item) => item.kind === "source").length,
    applied: apply };
}
