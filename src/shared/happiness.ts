import { ageIndex } from "./ages";
import type { Balance } from "./balance";
import { buildingSpec } from "./buildings";
import { homeActivity, PERFORM_JOY } from "./creations";
import type { Age, Island } from "./types";

/**
 * The ladder of needs: each age awakens one more thing the people expect of
 * life. A stone-age band only asks for full bellies; an industrial city also
 * wants the lights on. Every awakened, unmet need drags the mood down.
 */
export interface Need {
  id: string;
  /** short phrase for the UI, readable as "the people want …" */
  label: string;
  /** the age this need awakens */
  age: Age;
  met: boolean;
}

export interface HappinessReport {
  /** 0–100 */
  score: number;
  /** every need the island's age has awakened, oldest first */
  needs: Need[];
  /** joy radiating from parks, arenas, and other leisure places (capped) */
  leisure: number;
  /** pride radiating from completed wonders (capped) */
  wonders: number;
}

// the buildings that answer each need, across every age that can build them
const HEARTHS = [
  "campfire", "kiln", "charcoal-burner", "bathhouse", "brewery",
  "blacksmith", "tavern", "thermae", "smokehouse",
];
const FAITH_AND_FORUM = [
  "shrine", "stone-circle", "moot-hall", "temple", "forum", "amphitheater",
  "senate-hall", "cathedral", "monastery", "shaman-tent", "burial-mound",
];
const SAFETY = [
  "palisade", "watchtower", "stone-wall", "keep", "castle-wall",
  "barbican", "barracks",
];
const LEARNING = [
  "library", "scriptorium", "academy", "printing-house", "observatory",
  "university", "research-lab", "storyteller-circle",
];
const POWER = [
  "steam-engine-house", "power-plant", "reactor", "fusion-core",
  "graviton-plant",
];
const MARVELS = [
  "broadcast-tower", "cinema", "research-lab", "university", "hospital",
  "radar-station", "telegraph-office",
];
const TRANSCENDENCE = [
  "ai-nexus", "holo-theater", "quantum-computer", "terraformer",
  "dyson-relay", "space-elevator",
];

const LEISURE_CAP = 20;
const WONDER_CAP = 40;
const NEEDS_WEIGHT = 60;

export function computeHappiness(island: Island, balance: Balance): HappinessReport {
  const complete = island.buildings.filter((b) => b.stage === "complete");
  const has = (types: string[]) => complete.some((b) => types.includes(b.type));
  const pop = Math.max(1, island.settlers.length);
  const beds = complete.reduce(
    (sum, b) => sum + (buildingSpec(b.type)?.houses ?? 0),
    0,
  );
  const hearths = complete.filter((b) => HEARTHS.includes(b.type)).length;

  const ladder: Need[] = [
    {
      id: "fed",
      age: "stone",
      label: "bellies full",
      met:
        island.settlers.every((s) => s.hungerDays === 0) &&
        (island.stocks.food ?? 0) >= pop * balance.foodPerSettlerPerDay,
    },
    {
      id: "warm",
      age: "bronze",
      label: "hearths burning",
      met: hearths >= Math.max(1, Math.ceil(pop / 20)),
    },
    {
      id: "housed",
      age: "iron",
      label: "a bed for everyone",
      met: beds >= pop,
    },
    {
      id: "inspired",
      age: "classical",
      label: "places of spirit and speech",
      met: has(FAITH_AND_FORUM),
    },
    { id: "safe", age: "medieval", label: "walls and watch", met: has(SAFETY) },
    {
      id: "learned",
      age: "renaissance",
      label: "books and study",
      met: has(LEARNING),
    },
    {
      id: "powered",
      age: "industrial",
      label: "the lights are on",
      met: has(POWER),
    },
    {
      id: "connected",
      age: "modern",
      label: "wired to the world",
      met: has(MARVELS),
    },
    {
      id: "transcendent",
      age: "future",
      label: "living in the future",
      met: has(TRANSCENDENCE),
    },
  ];
  const needs = ladder.filter((n) => ageIndex(n.age) <= ageIndex(island.age));
  const met = needs.filter((n) => n.met).length;

  let leisure = 0;
  let wonders = 0;
  for (const b of complete) {
    const spec = buildingSpec(b.type);
    if (!spec?.joy) continue;
    if (spec.wonder) wonders += spec.joy;
    else leisure += spec.joy;
  }
  // performing creations join the leisure pool — a home island can look its
  // own designs up; colony garrisons keep their spec on the ruler's island
  // and simply don't radiate here
  for (const u of island.creations ?? []) {
    const design = (island.creationSpecs ?? []).find((s) => s.id === u.specId);
    if (design && homeActivity(design.verbs) === "perform") leisure += PERFORM_JOY;
  }
  leisure = Math.min(LEISURE_CAP, leisure);
  wonders = Math.min(WONDER_CAP, wonders);

  const base = needs.length ? Math.round((NEEDS_WEIGHT * met) / needs.length) : NEEDS_WEIGHT;
  return {
    score: Math.min(100, base + leisure + wonders),
    needs,
    leisure,
    wonders,
  };
}
