import { hashString, mulberry32 } from "./rng";

export const CATASTROPHE_IDS = [
  "earthquake",
  "volcano",
  "tsunami",
  "godzilla",
] as const;

export type CatastropheId = (typeof CATASTROPHE_IDS)[number];
type CatastropheBuildingScope = "widespread" | "productive" | "coastal" | "path";

/**
 * Server-owned catastrophe law. Adding another disaster is a catalog entry;
 * the scheduler, wire state, warning UI, persistence, and result accounting
 * do not need another branch.
 */
export interface CatastropheDefinition {
  id: CatastropheId;
  label: string;
  icon: string;
  startText: string;
  endText: string;
  resourceLossFraction: number;
  workPointLossFraction: number;
  nodeDepletionFraction?: number;
  buildingDamageFraction?: number;
  buildingScope?: CatastropheBuildingScope;
  /** Progress left on a damaged building, as a fraction of its build time. */
  repairProgressFraction?: number;
  dockedBoatLossFraction?: number;
  creationLossFraction?: number;
}

const CATASTROPHE_CATALOG: readonly CatastropheDefinition[] = [
  {
    id: "earthquake",
    label: "Earthquake",
    icon: "◫",
    startText: "The ocean floor convulses. An earthquake tears across every island!",
    endText: "The earthquake subsides. Repair crews move into the shattered streets.",
    resourceLossFraction: 0.12,
    workPointLossFraction: 0.08,
    buildingDamageFraction: 0.35,
    buildingScope: "widespread",
    repairProgressFraction: 0.45,
  },
  {
    id: "volcano",
    label: "Volcanic eruption",
    icon: "▲",
    startText: "Volcanoes erupt across the world. Lava and ash choke every horizon!",
    endText: "The eruptions quiet, leaving scorched ground and ash-heavy skies.",
    resourceLossFraction: 0.16,
    workPointLossFraction: 0.1,
    nodeDepletionFraction: 0.12,
    buildingDamageFraction: 0.25,
    buildingScope: "productive",
    repairProgressFraction: 0.35,
  },
  {
    id: "tsunami",
    label: "Tsunami",
    icon: "≈",
    startText: "A wall of water races around the globe. Every coast braces for impact!",
    endText: "The tsunami withdraws, leaving wrecked harbors and flooded stores.",
    resourceLossFraction: 0.18,
    workPointLossFraction: 0.12,
    buildingDamageFraction: 1,
    buildingScope: "coastal",
    repairProgressFraction: 0.3,
    dockedBoatLossFraction: 0.35,
  },
  {
    id: "godzilla",
    label: "Godzilla attack",
    icon: "◆",
    startText: "Godzilla rises from the sea and rampages from island to island!",
    endText: "Godzilla vanishes beneath the waves. The rebuilding begins.",
    resourceLossFraction: 0.25,
    workPointLossFraction: 0.2,
    buildingDamageFraction: 0.5,
    buildingScope: "path",
    repairProgressFraction: 0.15,
    creationLossFraction: 0.2,
  },
] as const;

export interface CatastropheImpact {
  inhabitedIslands: number;
  mapIslands: number;
  resourcesLost: number;
  workPointsLost: number;
  reservesLost: number;
  buildingsDamaged: number;
  boatsDestroyed: number;
  creationsLost: number;
}

export interface ActiveCatastrophe {
  id: CatastropheId;
  sequence: number;
  scheduledAt: number;
  startedAt: number;
  endsAt: number;
  impact: CatastropheImpact;
}

/** Canonical scheduler state sent on every world frame, including late joins. */
export interface CatastropheStatus {
  nextAt: number;
  intervalSeconds: number;
  warningSeconds: number;
  active?: ActiveCatastrophe;
}

export function catastropheDefinition(id: CatastropheId): CatastropheDefinition {
  return CATASTROPHE_CATALOG.find((entry) => entry.id === id)!;
}

/**
 * The world keeps no schedule: each strike rolls the gap to the NEXT one as a
 * multiple of the base interval — an hour, five hours, or a full real day at
 * production balance. Deterministic off (seed, sequence, boundary), so replay
 * and restart land every disaster on the same second.
 */
export const CATASTROPHE_GAP_MULTIPLIERS = [1, 5, 24] as const;

export function selectCatastropheGap(
  worldSeed: number,
  sequence: number,
  fromAt: number,
  baseIntervalSeconds: number,
): number {
  const random = mulberry32(
    hashString(`${worldSeed}|catastrophe-gap|${sequence}|${fromAt}`),
  )();
  const multiplier =
    CATASTROPHE_GAP_MULTIPLIERS[
      Math.floor(random * CATASTROPHE_GAP_MULTIPLIERS.length)
    ]!;
  return Math.max(1, Math.floor(baseIntervalSeconds)) * multiplier;
}

/** Deterministic, replay-safe choice with immediate repeats removed. */
export function selectCatastrophe(
  worldSeed: number,
  sequence: number,
  scheduledAt: number,
  previous?: CatastropheId,
): CatastropheDefinition {
  const choices = previous
    ? CATASTROPHE_CATALOG.filter((entry) => entry.id !== previous)
    : [...CATASTROPHE_CATALOG];
  const random = mulberry32(
    hashString(`${worldSeed}|catastrophe|${sequence}|${scheduledAt}`),
  )();
  return choices[Math.floor(random * choices.length)]!;
}
