import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import {
  buildingFacing,
  doorPoint,
  nearestStreet,
  townPlan,
  type TownPlan,
} from "../shared/townPlan";
import type { Age, Building, IslandTerrain, Vec2 } from "../shared/types";
import { clayMaterial, islandPalette, type IslandPalette } from "./artDirection";
import { contactRingGeometry, contactShadowMaterial } from "./contactShadows";

/**
 * The roads: the connective tissue that turns a scatter of buildings into a
 * town. Every completed building is joined to its neighbours by a paved
 * ribbon, the tree is rooted at the founding plaza so the network *converges*
 * on the town's heart, and the busier a road is the wider it runs — so a
 * trunk avenue and a garden lane read differently from map height.
 *
 * Each age paves in its own material: trodden earth, gravel, packed setts,
 * flagstone, cobble, dressed stone, macadam, concrete, and finally a pale
 * composite with a luminous seam. The surface is a pure function of the age
 * and the island's own palette, never of the viewer, so two machines watching
 * one island see the same streets.
 *
 * The whole network — every lane, every avenue, and the plaza apron — is one
 * merged mesh with one material: **one draw call per island**, no matter how
 * many buildings the town grows to. Roads belong to the watched island only;
 * distant islands stay the lightweight silhouettes the frame budget assumes.
 */

export const ROADS_GROUP = "island-roads";
/**
 * Roads survive further out than street-level clutter: one merged mesh costs
 * a single draw, and the network is what makes a town read as a town at
 * map height.
 */
export const ROADS_DISTANCE = 620;
/** A town never spends more than this many road cross-sections. */
export const MAX_ROAD_SEGMENTS = 1600;
/** How far the ribbon floats over the terrain it follows. */
export const ROAD_LIFT = 0.085;

/** Display-referred luma floors — a road is never the dark hole in a town. */
export const ROAD_LUMA_FLOOR = 0.42;
/** From the industrial age on, paving reads pale and man-made. */
export const ROAD_LUMA_FLOOR_LATE = 0.56;
/** ...and never bleaches into a white sheet either. */
export const ROAD_LUMA_CEILING = 0.86;
/** The age at which paving turns industrial. */
export const LATE_ROAD_ERA = 6;

export type RoadSurfaceId =
  | "earth"
  | "gravel"
  | "setts"
  | "flagstone"
  | "cobble"
  | "dressed"
  | "macadam"
  | "concrete"
  | "composite";

export interface RoadSurface {
  id: RoadSurfaceId;
  /** what a settler would call it */
  label: string;
  /** the driving surface */
  base: THREE.Color;
  /** the crown or centre seam — the lightest note on the road */
  crown: THREE.Color;
  /** verge and kerb: the road's own contact shadow against the grass */
  edge: THREE.Color;
  /** half-width, in tiles, of the humblest lane */
  lane: number;
  /** how far the surface speckles from stretch to stretch */
  grain: number;
}

interface SurfaceSpec {
  id: RoadSurfaceId;
  label: string;
  base: string;
  crown: string;
  /** how much of the island's own soil the surface takes on */
  soil: number;
  lane: number;
  grain: number;
}

/**
 * Nine ages, nine surfaces. The family walks earth → stone → paved →
 * composite, and the values climb with it: a stone-age track is the same
 * warm earth the island is made of, a future boulevard is pale alloy with a
 * lit seam down the middle.
 */
const ROAD_SPECS: Record<Age, SurfaceSpec> = {
  stone: {
    id: "earth",
    label: "trodden earth",
    base: "#b39169",
    crown: "#c3a37c",
    soil: 0.45,
    lane: 0.5,
    grain: 0.09,
  },
  bronze: {
    id: "gravel",
    label: "gravel track",
    base: "#b8aa8c",
    crown: "#c9bda2",
    soil: 0.24,
    lane: 0.54,
    grain: 0.08,
  },
  iron: {
    id: "setts",
    label: "packed setts",
    base: "#ab9f90",
    crown: "#bcb2a3",
    soil: 0.16,
    lane: 0.56,
    grain: 0.075,
  },
  classical: {
    id: "flagstone",
    label: "flagstone way",
    base: "#c7bea9",
    crown: "#d8d1bf",
    soil: 0.1,
    lane: 0.62,
    grain: 0.06,
  },
  medieval: {
    id: "cobble",
    label: "cobblestone",
    base: "#a99f92",
    crown: "#bcb3a5",
    soil: 0.14,
    lane: 0.58,
    grain: 0.085,
  },
  renaissance: {
    id: "dressed",
    label: "dressed stone",
    base: "#c3b9a3",
    crown: "#d5cdb9",
    soil: 0.08,
    lane: 0.64,
    grain: 0.055,
  },
  industrial: {
    id: "macadam",
    label: "macadam",
    base: "#9d9488",
    crown: "#aea69a",
    soil: 0.06,
    lane: 0.68,
    grain: 0.05,
  },
  modern: {
    id: "concrete",
    label: "poured concrete",
    base: "#b6b4ac",
    crown: "#e3dfd0",
    soil: 0.03,
    lane: 0.72,
    grain: 0.035,
  },
  future: {
    id: "composite",
    label: "composite deck",
    base: "#ccd1cd",
    crown: "#a9ecdf",
    soil: 0,
    lane: 0.76,
    grain: 0.03,
  },
};

const AGE_ERA: Record<Age, number> = {
  stone: 0,
  bronze: 1,
  iron: 2,
  classical: 3,
  medieval: 4,
  renaissance: 5,
  industrial: 6,
  modern: 7,
  future: 8,
};

/** Display-referred luma — the value a viewer reads, not the linear one. */
export function roadLuma(color: THREE.Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

/** The floor this age's paving may never fall below. */
export function roadLumaFloor(age: Age): number {
  return AGE_ERA[age] >= LATE_ROAD_ERA ? ROAD_LUMA_FLOOR_LATE : ROAD_LUMA_FLOOR;
}

/** Hold a colour inside its value band by scaling, so the hue never shifts. */
function holdValue(color: THREE.Color, floor: number, ceiling: number): THREE.Color {
  const luma = roadLuma(color);
  if (luma <= 0.0001) return color.setScalar(floor);
  if (luma < floor) color.multiplyScalar(floor / luma);
  else if (luma > ceiling) color.multiplyScalar(ceiling / luma);
  return color;
}

/**
 * The paving for one age on one island. The island's soil pulls the earthy
 * ages toward its own ground so a track belongs to the place it crosses;
 * the late ages are manufactured and keep their own colour.
 */
export function roadSurface(age: Age, palette: IslandPalette): RoadSurface {
  const spec = ROAD_SPECS[age];
  const soil = new THREE.Color(palette.soil);
  const floor = roadLumaFloor(age);
  const base = new THREE.Color(spec.base).lerp(soil, spec.soil);
  holdValue(base, floor, ROAD_LUMA_CEILING);
  const crown = new THREE.Color(spec.crown).lerp(soil, spec.soil * 0.5);
  holdValue(crown, Math.max(floor, roadLuma(base)), ROAD_LUMA_CEILING);
  // the verge is the same paving in shadow: a value step, never a new hue
  const edge = base.clone().multiplyScalar(0.76);
  return { id: spec.id, label: spec.label, base, crown, edge, lane: spec.lane, grain: spec.grain };
}

// ── the network ─────────────────────────────────────────────────────────────

export interface RoadPath {
  points: Vec2[];
  /** half-width in tiles */
  half: number;
  /** how many buildings this stretch carries — trunks survive the cap first */
  traffic: number;
}

/**
 * Minimum spanning tree over the town's doorsteps, rooted at whatever sits at
 * index 0. Prim's algorithm always attaches a new node to one already in the
 * tree, so every edge reads parent → child from the root outward.
 */
export function spanningTree(points: Vec2[]): [number, number][] {
  if (points.length < 2) return [];
  const edges: [number, number][] = [];
  const inTree = new Set<number>([0]);
  const dist = points.map((p) => Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y));
  const from = points.map(() => 0);
  while (inTree.size < points.length) {
    let best = -1;
    for (let i = 0; i < points.length; i++) {
      if (inTree.has(i)) continue;
      if (best === -1 || dist[i]! < dist[best]!) best = i;
    }
    if (best === -1) break;
    inTree.add(best);
    edges.push([from[best]!, best]);
    for (let i = 0; i < points.length; i++) {
      if (inTree.has(i)) continue;
      const d = Math.hypot(points[i]!.x - points[best]!.x, points[i]!.y - points[best]!.y);
      if (d < dist[i]!) {
        dist[i] = d;
        from[i] = best;
      }
    }
  }
  return edges;
}

/**
 * How many doorsteps drain through each edge. Prim emits parents before
 * children, so one reverse pass accumulates every subtree at once — the
 * street outside the plaza carries the whole town, the spur to the last
 * cottage carries one house.
 */
export function roadTraffic(count: number, edges: [number, number][]): number[] {
  const carried = new Array<number>(count).fill(1);
  for (let i = edges.length - 1; i >= 0; i--) {
    const [parent, child] = edges[i]!;
    carried[parent] = carried[parent]! + carried[child]!;
  }
  return edges.map(([, child]) => carried[child]!);
}

/** A lane widens with its traffic, and stops widening — never a runway. */
export function roadHalfWidth(lane: number, traffic: number): number {
  const swell = Math.min(1.15, Math.log2(Math.max(1, traffic)) * 0.3);
  return lane * (1 + swell);
}

export interface RoadNetworkOptions {
  /** doorsteps, in tile space, in a stable order */
  doors: Vec2[];
  /** the founding plaza — the tree is rooted here when it is known */
  plaza?: Vec2;
  /** the authored street skeleton; roads bundle onto its avenues */
  plan?: TownPlan;
  seed: number;
  lane: number;
}

/**
 * The road network as polylines in tile space. Endpoints stay exactly on the
 * doorsteps and junctions they join — sway and street-pull both fade to zero
 * at the ends — so the network welds instead of fraying.
 */
export function roadNetwork({
  doors,
  plaza,
  plan,
  seed,
  lane,
}: RoadNetworkOptions): RoadPath[] {
  const nodes: Vec2[] = plaza ? [plaza, ...doors] : doors;
  if (nodes.length < 2) return [];
  const edges = spanningTree(nodes);
  const traffic = roadTraffic(nodes.length, edges);
  const paths: RoadPath[] = [];
  edges.forEach(([a, b], index) => {
    const start = nodes[a]!;
    const end = nodes[b]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 0.35) return;
    const carried = traffic[index]!;
    const half = roadHalfWidth(lane, carried);
    const steps = Math.max(2, Math.round(length / 1.15));
    const wobble = mulberry32(hashString(`${seed}|road|${a}|${b}`));
    const bend = (wobble() - 0.5) * 1.15;
    const dx = (end.x - start.x) / length;
    const dy = (end.y - start.y) / length;
    const points: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ease = Math.sin(t * Math.PI); // zero at both ends: junctions weld
      const sway = ease * bend;
      let px = start.x + (end.x - start.x) * t - dy * sway;
      let py = start.y + (end.y - start.y) * t + dx * sway;
      if (plan && ease > 0.001) {
        // roads drift onto the avenue the placer built along, so the network
        // reinforces the town plan instead of cutting across it
        const street = nearestStreet(plan, px, py);
        if (street && street.distance > 0.001 && street.distance < 3.5) {
          const pull = 0.55 * ease * (1 - street.distance / 3.5);
          px += (street.point.x - px) * pull;
          py += (street.point.y - py) * pull;
        }
      }
      points.push({ x: px, y: py });
    }
    paths.push({ points, half, traffic: carried });
  });
  // trunks first: when a metropolis runs past the segment cap the avenues
  // survive and the last garden spur is what goes missing
  paths.sort((p, q) => q.traffic - p.traffic);
  return paths;
}

// ── the mesh ────────────────────────────────────────────────────────────────

/** Where the road sits across its width, and what colour it is there. */
const COLUMNS = [-1, -0.55, 0, 0.55, 1];
const CAMBER = [-0.012, 0.012, 0.03, 0.012, -0.012];

export interface RoadsOptions {
  buildings: Building[];
  age: Age;
  islandSeed: number;
  heightAt: (x: number, y: number) => number;
  half: number;
  terrain?: IslandTerrain;
}

/**
 * The terrain plane spans `size` world units across `size - 1` cells, so a
 * tile coordinate and the vertex that renders it drift apart by one cell
 * across an island. Roads are flat ribbons pressed against that surface, so
 * they sample it with the drift taken out — the ribbon follows the hill the
 * viewer can actually see.
 */
function groundSampler(
  heightAt: (x: number, y: number) => number,
  size: number,
): (x: number, y: number) => number {
  const k = size > 1 ? (size - 1) / size : 1;
  return (x, y) => {
    const gx = x * k;
    const gy = y * k;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const h00 = heightAt(x0, y0);
    const h10 = heightAt(x0 + 1, y0);
    const h01 = heightAt(x0, y0 + 1);
    const h11 = heightAt(x0 + 1, y0 + 1);
    return (
      h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy
    );
  };
}

/** Below this the ground is sea: roads stop at the water, never wade in. */
const WATERLINE = 0.12;

export function buildRoadsGroup({
  buildings,
  age,
  islandSeed,
  heightAt,
  half,
  terrain,
}: RoadsOptions): THREE.Group {
  const holder = new THREE.Group();
  holder.name = ROADS_GROUP;
  const complete = buildings
    .filter((b) => b.stage === "complete")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (complete.length < 2) return holder;

  const palette = islandPalette(islandSeed);
  const surface = roadSurface(age, palette);
  const plan: TownPlan | undefined = terrain ? townPlan(terrain, islandSeed) : undefined;
  const size = terrain?.size ?? half * 2;
  const ground = groundSampler(heightAt, size);

  const doors = complete.map((b) => {
    if (!plan || !terrain) return { x: b.pos.x, y: b.pos.y };
    return doorPoint(b.pos, buildingFacing(plan, terrain, b));
  });
  const paths = roadNetwork({
    doors,
    plaza: plan?.plaza,
    plan,
    seed: islandSeed,
    lane: surface.lane,
  });
  if (!paths.length) return holder;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const shade = new THREE.Color();
  let segments = 0;

  const columnColor = (column: number, grain: number, out: THREE.Color): THREE.Color => {
    if (column === 0 || column === COLUMNS.length - 1) out.copy(surface.edge);
    else if (column === 2) out.copy(surface.crown);
    else out.copy(surface.base);
    return out.multiplyScalar(grain);
  };

  /** One cross-section: five vertices across the road, cambered and graded. */
  const pushSection = (
    x: number,
    y: number,
    nx: number,
    ny: number,
    width: number,
    grain: number,
  ): number => {
    const first = positions.length / 3;
    const base = ground(x, y);
    for (let c = 0; c < COLUMNS.length; c++) {
      const px = x + nx * COLUMNS[c]! * width;
      const py = y + ny * COLUMNS[c]! * width;
      positions.push(px - half, base + ROAD_LIFT + CAMBER[c]!, py - half);
      columnColor(c, grain, shade);
      colors.push(shade.r, shade.g, shade.b);
    }
    return first;
  };

  for (const path of paths) {
    if (segments >= MAX_ROAD_SEGMENTS) break;
    const grainRng = mulberry32(hashString(`${islandSeed}|grain|${path.points[0]!.x.toFixed(2)}|${path.points[0]!.y.toFixed(2)}`));
    let previous: number | undefined;
    for (let i = 0; i < path.points.length; i++) {
      const point = path.points[i]!;
      const before = path.points[Math.max(0, i - 1)]!;
      const after = path.points[Math.min(path.points.length - 1, i + 1)]!;
      const tx = after.x - before.x;
      const ty = after.y - before.y;
      const len = Math.hypot(tx, ty) || 1;
      // the normal across the road, from its own direction of travel
      const nx = -ty / len;
      const ny = tx / len;
      if (ground(point.x, point.y) < WATERLINE) {
        previous = undefined; // the road stops at the water and picks up after
        continue;
      }
      const grain = 1 + (grainRng() - 0.5) * surface.grain;
      const start = pushSection(point.x, point.y, nx, ny, path.half, grain);
      if (previous !== undefined) {
        for (let c = 0; c < COLUMNS.length - 1; c++) {
          const a = previous + c;
          const b = previous + c + 1;
          const d = start + c;
          const e = start + c + 1;
          // wound so the paving faces the sky: a ribbon with its back turned
          // is front-face culled, and the town keeps a road nobody can see
          indices.push(a, e, d, a, b, e);
        }
        segments += 1;
        if (segments >= MAX_ROAD_SEGMENTS) break;
      }
      previous = start;
    }
  }

  // ── the plaza apron ──────────────────────────────────────────────────────
  // The founding plaza is kept clear of buildings by law, which left a bare
  // brown disc at the heart of every town. It is paved now, in the age's own
  // material, so the place the roads converge on is the brightest floor in
  // the settlement rather than its darkest hole.
  if (plan && ground(plan.plaza.x, plan.plaza.y) >= WATERLINE) {
    const rim = plan.plazaRadius + 1.1;
    const spokes = 30;
    const centre = positions.length / 3;
    const centreY = ground(plan.plaza.x, plan.plaza.y);
    positions.push(plan.plaza.x - half, centreY + ROAD_LIFT + 0.04, plan.plaza.y - half);
    shade.copy(surface.crown);
    colors.push(shade.r, shade.g, shade.b);
    const ringStart = positions.length / 3;
    const ok: boolean[] = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      for (const [radius, tone, lift] of [
        [rim * 0.58, surface.base, 0.02],
        [rim, surface.edge, 0],
      ] as const) {
        const px = plan.plaza.x + Math.cos(a) * radius;
        const py = plan.plaza.y + Math.sin(a) * radius;
        const y = ground(px, py);
        positions.push(px - half, y + ROAD_LIFT + lift, py - half);
        shade.copy(tone);
        colors.push(shade.r, shade.g, shade.b);
        if (radius === rim) ok.push(y >= WATERLINE);
      }
    }
    for (let i = 0; i < spokes; i++) {
      const j = (i + 1) % spokes;
      if (!ok[i] || !ok[j]) continue; // a bay eats that wedge of the apron
      const innerA = ringStart + i * 2;
      const outerA = innerA + 1;
      const innerB = ringStart + j * 2;
      const outerB = innerB + 1;
      // the apron is wound sky-side too — the angle runs clockwise in world
      // space, so the fan reverses to keep its face up
      indices.push(centre, innerB, innerA);
      indices.push(innerA, outerB, outerA, innerA, innerB, outerB);
    }
  }

  // ── where the paving stops ───────────────────────────────────────────────
  // A town's floor met the meadow at a painted edge and nothing else: no
  // trodden margin, no shade, dirt and grass simply swapping pixels. One
  // annulus of contact darkening on the *grass* side settles the plaza into
  // the hill it was cut from.
  if (plan && ground(plan.plaza.x, plan.plaza.y) >= WATERLINE) {
    const rim = plan.plazaRadius + 1.1;
    const reach = rim + 2.4;
    const skirt = new THREE.Mesh(
      contactRingGeometry(rim / reach, 36),
      contactShadowMaterial(0.34),
    );
    skirt.name = "plaza-contact";
    skirt.scale.set(reach, 1, reach);
    skirt.position.set(
      plan.plaza.x - half,
      ground(plan.plaza.x, plan.plaza.y) + 0.06,
      plan.plaza.y - half,
    );
    skirt.renderOrder = -1;
    holder.add(skirt);
  }

  if (!indices.length) return holder;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = clayMaterial({ color: "#ffffff", vertexColors: true });
  // a flat sheet pressed onto a sculpted hill: bias it out of the terrain's
  // own depth so a slope can never claw through the paving
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "roads";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.roadSurface = surface.id;
  mesh.userData.smallBuildingBatch = true;
  holder.add(mesh);
  return holder;
}

/**
 * The network owns its geometry and its material outright — one mesh, built
 * per town — so replacing a town releases both. Nothing shared is touched.
 */
export function disposeRoadsGroup(holder: THREE.Group): void {
  const roads = holder.getObjectByName(ROADS_GROUP) as THREE.Group | undefined;
  if (!roads) return;
  roads.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
  roads.parent?.remove(roads);
}
