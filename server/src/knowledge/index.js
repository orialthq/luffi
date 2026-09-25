export { KnowledgeError } from "./validation.js";
export {
  createKnowledgeState,
  applyKnowledgeCommand,
  queryKnowledge,
  resolveKnowledge,
  resolveEntityMention,
  buildKnowledgeContext,
  validateKnowledgeContext,
  getKnowledgeChanges,
  registerKnowledgeWatch,
  unregisterKnowledgeWatch,
  getAffectedKnowledgeConsumers,
} from "./kernel.js";
