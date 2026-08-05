import type { Balance } from "./balance";
import type { Age, ResourceId } from "./types";

/** The nine ages, in order. */
export const AGES: readonly Age[] = [
  "stone",
  "bronze",
  "iron",
  "classical",
  "medieval",
  "renaissance",
  "industrial",
  "modern",
  "future",
];

const CLASSICAL: ResourceId[] = [
  "food", "wood", "stone", "copper", "tin", "iron", "steel",
  "marble", "gold", "silver", "preciousMetals", "gems",
];

/** Resources available in each age — exactly the manager plan's lists. */
export const AGE_RESOURCES: Record<Age, ResourceId[]> = {
  stone: ["food", "wood", "stone"],
  bronze: ["food", "wood", "stone", "copper", "tin"],
  iron: ["food", "wood", "stone", "copper", "tin", "iron", "steel"],
  classical: CLASSICAL,
  medieval: CLASSICAL,
  renaissance: [...CLASSICAL, "coal"],
  industrial: [...CLASSICAL, "coal", "oil", "gas"],
  modern: [...CLASSICAL, "coal", "oil", "gas", "plutonium"],
  future: [...CLASSICAL, "coal", "oil", "gas", "plutonium", "antimatter"],
};

/** Work points required to advance INTO the given age. Strictly ×2 monotonic. */
export function advanceRequirements(age: Age, balance: Balance): number {
  const i = AGES.indexOf(age);
  if (i <= 0) return 0;
  return balance.bronzeWorkPoints * balance.ageCostMultiplier ** (i - 1);
}

export function nextAge(age: Age): Age | null {
  const i = AGES.indexOf(age);
  return i >= 0 && i < AGES.length - 1 ? AGES[i + 1]! : null;
}

export function ageIndex(age: Age): number {
  return AGES.indexOf(age);
}
