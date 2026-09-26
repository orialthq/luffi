import { beautyPack } from "./beauty.js";
import { diningPack } from "./dining.js";
import { fashionPack } from "./fashion.js";
import { recipePack } from "./recipe.js";
import { travelPack } from "./travel.js";
import { lifeTipPack } from "./life_tip.js";
import { createDomainRegistry as createRegistry } from "./registry.js";

export { DomainContractError } from "./schema.js";
export const DOMAIN_PACKS = Object.freeze([recipePack, diningPack, fashionPack, beautyPack,
  travelPack, lifeTipPack]);
export function createDomainRegistry(packs = DOMAIN_PACKS) { return createRegistry(packs); }
export const domainRegistry = createDomainRegistry();
