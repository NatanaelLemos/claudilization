import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import type { SettlerTask } from "../shared/types";

/**
 * The visual contract for the whole live world. Keep renderer-facing art
 * choices here so a building, villager, shoreline, vehicle, or HUD accent
 * cannot quietly drift into a different game.
 *
 * All assets remain original procedural geometry/data. The vocabulary is a
 * miniature clay diorama: matte surfaces, softened silhouettes, warm key,
 * cool depth, restrained neutrals, and civilization colors used as trim.
 */
export const ART_DIRECTION = {
  id: "miniature-clay-v1",
  material: {
    roughness: 0.92,
    metalness: 0.015,
    emissiveIntensity: 0.72,
    shadowOpacity: 0.16,
    bevelRatio: 0.09,
  },
  camera: {
    fov: 42,
    start: { x: 0, y: 108, z: 154 },
    landing: { y: 76, z: 118 },
    minDistance: 28,
  },
  lighting: {
    exposure: 1.08,
    key: "#ffd9a0",
    keyIntensity: 2.35,
    sky: "#c8dbe2",
    groundBounce: "#7c694f",
    coolFill: "#7195aa",
    fogNear: 235,
    fogFar: 1120,
  },
  sprites: {
    settlerHeight: 1.72,
    headScale: 1.18,
    creationScale: 3.2,
    motionHz: { normal: 30, dense: 15 },
  },
  density: {
    maxVisibleSettlers: 1_024,
    mobilePropScale: 0.72,
    ambientRadius: 520,
    reducedMotionAmbientScale: 0,
  },
} as const;

/** Shared, deliberately quiet palette. Civilization hues sit on top as trim. */
export const CLAY_PALETTE = {
  ocean: "#24566a",
  oceanDeep: "#173f52",
  foam: "#d9eee9",
  sand: "#dcc79a",
  grass: "#78945b",
  grassLight: "#94aa70",
  stone: "#8b8984",
  stoneDark: "#66645f",
  chalk: "#e9e1d2",
  clay: "#b87958",
  terracotta: "#a9583f",
  wood: "#795a3b",
  woodDark: "#4f3e31",
  leaf: "#50724c",
  leafLight: "#6f8f59",
  ink: "#26343a",
  panel: "rgba(30, 38, 38, 0.82)",
} as const;

export interface ClayMaterialOptions {
  color: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  depthWrite?: boolean;
}

/** A fresh soft-matte material. Callers that batch should cache by palette key. */
export function clayMaterial(options: ClayMaterialOptions): THREE.MeshStandardMaterial {
  const parameters: THREE.MeshStandardMaterialParameters = {
    color: options.color,
    roughness: ART_DIRECTION.material.roughness,
    metalness: ART_DIRECTION.material.metalness,
    flatShading: false,
    emissiveIntensity: options.emissive
      ? (options.emissiveIntensity ?? ART_DIRECTION.material.emissiveIntensity)
      : 0,
  };
  if (options.emissive !== undefined) parameters.emissive = options.emissive;
  if (options.transparent !== undefined) parameters.transparent = options.transparent;
  if (options.opacity !== undefined) parameters.opacity = options.opacity;
  if (options.side !== undefined) parameters.side = options.side;
  if (options.vertexColors !== undefined) parameters.vertexColors = options.vertexColors;
  if (options.depthWrite !== undefined) parameters.depthWrite = options.depthWrite;
  const material = new THREE.MeshStandardMaterial(parameters);
  material.userData.artMaterial = "soft-matte-clay";
  return material;
}

export type SettlerRole = "villager" | "farmer" | "forager" | "mason" | "builder" | "sailor";

/** Role silhouettes are derived from authoritative work, never invented client state. */
export function settlerRole(task: SettlerTask): SettlerRole {
  switch (task.kind) {
    case "build":
      return "builder";
    case "sail":
      return "sailor";
    case "gather":
      if (task.resource === "food") return "farmer";
      if (task.resource === "stone" || task.resource === "marble") return "mason";
      return "forager";
    default:
      return "villager";
  }
}

export const ROLE_ACCENTS: Record<SettlerRole, string> = {
  villager: CLAY_PALETTE.chalk,
  farmer: "#d2b96e",
  forager: CLAY_PALETTE.leafLight,
  mason: "#b8b2a7",
  builder: CLAY_PALETTE.terracotta,
  sailor: "#87afbd",
};

export function effectDensity(reducedMotion: boolean, mobile: boolean): number {
  if (reducedMotion) return ART_DIRECTION.density.reducedMotionAmbientScale;
  return mobile ? ART_DIRECTION.density.mobilePropScale : 1;
}

/**
 * The Scroll World beauty pass: composed groves, sculpted outcrops, meadow
 * clearings, clay footpaths, building yards and a studio-miniature post
 * grade, all reachable from one marker so tests and live bundles can prove
 * which look shipped.
 */
export const BEAUTY_MARKER = "scroll-diorama-v1";

/**
 * One island, one place: a small cohesive palette derived deterministically
 * from the island seed. Every decorative hue on the island — canopies,
 * blooms, shrubs, paths, soil — is drawn from these few pots of clay, so an
 * island reads as a single hand-painted diorama rather than a scatter of
 * unrelated props. The hue drift is deliberately small: islands vary like
 * neighbouring valleys, not like different games.
 */
export interface IslandPalette {
  /** low meadow grass — the brightest green on the island */
  grassLight: string;
  /** the working mid-green of open ground */
  grass: string;
  /** three canopy pots: broadleaf, deep conifer, sun-touched */
  canopy: [string, string, string];
  /** two bloom accents for meadow flowers */
  bloom: [string, string];
  /** footpaths, field rows and bare earth */
  soil: string;
  /** warm sculpted boulder clay */
  rock: string;
}

const BLOOM_POTS: [string, string][] = [
  ["#c96a50", "#e8ddc4"], // poppy + chalk
  ["#d9a24b", "#e8ddc4"], // marigold + chalk
  ["#a06f9e", "#d9a24b"], // heather + marigold
  ["#c96a50", "#d9a24b"], // poppy + marigold
];

function shifted(base: string, hue: number, sat: number, light: number): string {
  const c = new THREE.Color(base);
  c.offsetHSL(hue, sat, light);
  return `#${c.getHexString()}`;
}

export function islandPalette(seed: number): IslandPalette {
  const rng = mulberry32(hashString(`${seed}|palette`));
  // a gentle per-island season: -0.030 leans autumn-warm, +0.035 leans lush
  const hue = (rng() - 0.45) * 0.065;
  const sat = (rng() - 0.5) * 0.08;
  const bloom = BLOOM_POTS[Math.floor(rng() * BLOOM_POTS.length)]!;
  return {
    grassLight: shifted(CLAY_PALETTE.grassLight, hue, sat, 0.015),
    grass: shifted(CLAY_PALETTE.grass, hue, sat, 0),
    canopy: [
      shifted(CLAY_PALETTE.leaf, hue, sat, 0.01),
      shifted("#3f5f45", hue, sat, 0),
      shifted(CLAY_PALETTE.leafLight, hue, sat + 0.04, 0.03),
    ],
    bloom,
    soil: shifted("#a3805c", hue * 0.4, 0, (rng() - 0.5) * 0.03),
    rock: shifted("#8d867b", hue * 0.3, 0, (rng() - 0.5) * 0.04),
  };
}
