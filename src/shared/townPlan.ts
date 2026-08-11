import { buildingSpec } from "./buildings";
import { hashString, mulberry32 } from "./rng";
import type { IslandTerrain, ResourceId, Vec2 } from "./types";

/**
 * The town plan: why a settlement looks like it grew for reasons.
 *
 * Everything here is a pure function of an island's terrain (seed + size) and
 * nothing else — never of its buildings — so the plan is identical on every
 * machine, every replay, and every save vintage. The server reads it to choose
 * building sites (plaza ring, streets, districts); the client reads the same
 * plan to orient buildings toward their street and to lay footpaths that
 * reinforce the avenues. No RNG stream shared with terrain, nature, or any
 * prior pass is touched: the plan draws from its own `seed|town` stream.
 */

export interface StreetPoint {
  x: number;
  y: number;
}

export interface TownPlan {
  size: number;
  /** The founding plaza — the exact tile the historic first-building law chose. */
  plaza: Vec2;
  /** Open ground around the plaza; strict placement keeps it clear. */
  plazaRadius: number;
  /** Sampled street skeleton: avenues marching out of the plaza plus a ring road. */
  streets: StreetPoint[];
  /** Per-tile distance (world units, exact within 8, else 999) to the nearest street. */
  streetDist: Float32Array;
  /** Per-tile 4-neighbour BFS distance in tiles to the nearest water tile. */
  shoreDist: Float32Array;
}

const FAR = 999;
const STREET_FIELD_RADIUS = 8;

/**
 * The historic first-building tile: the closest grass/sand tile to the island
 * centre, ties broken by y then x — a byte-exact replay of the placement law
 * every existing island's founding hall was placed under. Anchoring the plaza
 * here means old towns already stand around their own plaza.
 */
export function foundingSite(terrain: IslandTerrain): Vec2 {
  const half = (terrain.size - 1) / 2;
  let best: { x: number; y: number } | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const tile of terrain.tiles) {
    if (tile.kind !== "grass" && tile.kind !== "sand") continue;
    const d = Math.hypot(tile.x - half, tile.y - half);
    if (
      d < bestD ||
      (d === bestD && best && (tile.y < best.y || (tile.y === best.y && tile.x < best.x)))
    ) {
      bestD = d;
      best = { x: tile.x, y: tile.y };
    }
  }
  return best ?? { x: half, y: half };
}

function passScore(kind: string | undefined, heightGap: number): number {
  if (kind === "grass") return 2 - heightGap * 14;
  if (kind === "sand") return 0.8 - heightGap * 14;
  return Number.NEGATIVE_INFINITY; // water, rock, or off the map — streets stop
}

function computeStreets(
  terrain: IslandTerrain,
  seed: number,
  plaza: Vec2,
  plazaRadius: number,
): StreetPoint[] {
  const size = terrain.size;
  const tileAt = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size
      ? terrain.tiles[Math.round(y) * size + Math.round(x)]
      : undefined;
  const rng = mulberry32(hashString(`${seed}|town`));
  const streets: StreetPoint[] = [];

  // avenues: seeded spokes that march over passable land, bending around
  // water and rock, until they run out of island
  const avenues = 6;
  const maxSteps = Math.max(8, Math.round(size * 0.45));
  for (let i = 0; i < avenues; i++) {
    let heading = (i / avenues) * Math.PI * 2 + (rng() - 0.5) * 0.7;
    let px = plaza.x + Math.sin(heading) * plazaRadius;
    let py = plaza.y + Math.cos(heading) * plazaRadius;
    for (let step = 0; step < maxSteps; step++) {
      let bestTurn = Number.NEGATIVE_INFINITY;
      let bestScore = Number.NEGATIVE_INFINITY;
      const here = tileAt(px, py);
      for (const turn of [-0.42, -0.21, 0, 0.21, 0.42]) {
        const h = heading + turn;
        const nx = px + Math.sin(h) * 1.25;
        const ny = py + Math.cos(h) * 1.25;
        const tile = tileAt(nx, ny);
        const gap = tile && here ? Math.abs(tile.height - here.height) : 1;
        const score = passScore(tile?.kind, gap) - Math.abs(turn) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestTurn = turn;
        }
      }
      if (bestScore === Number.NEGATIVE_INFINITY) break;
      heading += bestTurn;
      px += Math.sin(heading) * 1.25;
      py += Math.cos(heading) * 1.25;
      streets.push({ x: px, y: py });
    }
  }

  // the ring road around the plaza, kept where there is land to carry it
  const ringR = plazaRadius + 2.4;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const x = plaza.x + Math.sin(a) * ringR;
    const y = plaza.y + Math.cos(a) * ringR;
    const kind = tileAt(x, y)?.kind;
    if (kind === "grass" || kind === "sand") streets.push({ x, y });
  }
  return streets;
}

function computeStreetField(size: number, streets: StreetPoint[]): Float32Array {
  const field = new Float32Array(size * size).fill(FAR);
  for (const p of streets) {
    const x0 = Math.max(0, Math.floor(p.x - STREET_FIELD_RADIUS));
    const x1 = Math.min(size - 1, Math.ceil(p.x + STREET_FIELD_RADIUS));
    const y0 = Math.max(0, Math.floor(p.y - STREET_FIELD_RADIUS));
    const y1 = Math.min(size - 1, Math.ceil(p.y + STREET_FIELD_RADIUS));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - p.x, y - p.y);
        const i = y * size + x;
        if (d < field[i]!) field[i] = d;
      }
    }
  }
  return field;
}

function computeShoreField(terrain: IslandTerrain): Float32Array {
  const size = terrain.size;
  const field = new Float32Array(size * size).fill(FAR);
  const queue: number[] = [];
  for (const tile of terrain.tiles) {
    if (tile.kind !== "water") continue;
    const i = tile.y * size + tile.x;
    field[i] = 0;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % size;
    const y = (i - x) / size;
    const next = field[i]! + 1;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (next < field[ni]!) {
        field[ni] = next;
        queue.push(ni);
      }
    }
  }
  return field;
}

const planCache = new Map<string, TownPlan>();
const PLAN_CACHE_CAP = 96;

/** The deterministic town plan for one island, cached per seed and size. */
export function townPlan(terrain: IslandTerrain, seed: number): TownPlan {
  const key = `${seed}|${terrain.size}`;
  const cached = planCache.get(key);
  if (cached) return cached;
  const plazaRadius = Math.max(3, Math.round(terrain.size * 0.022));
  const plaza = foundingSite(terrain);
  const streets = computeStreets(terrain, seed, plaza, plazaRadius);
  const plan: TownPlan = {
    size: terrain.size,
    plaza,
    plazaRadius,
    streets,
    streetDist: computeStreetField(terrain.size, streets),
    shoreDist: computeShoreField(terrain),
  };
  if (planCache.size >= PLAN_CACHE_CAP) {
    const oldest = planCache.keys().next().value;
    if (oldest !== undefined) planCache.delete(oldest);
  }
  planCache.set(key, plan);
  return plan;
}

/** Distance from a point to the nearest street sample, and that sample. */
export function nearestStreet(
  plan: TownPlan,
  x: number,
  y: number,
): { point: StreetPoint; distance: number } | undefined {
  let best: StreetPoint | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of plan.streets) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { point: best, distance: bestD } : undefined;
}

// ── districts ───────────────────────────────────────────────────────────────

export type District =
  | "harbor"
  | "farmland"
  | "storehouse"
  | "industry"
  | "grove"
  | "civic"
  | "service"
  | "defense"
  | "wonder"
  | "workshop"
  | "housing";

/** Extractors that belong beside the ground they work. */
export const INDUSTRY_NODE: Record<string, ResourceId> = {
  "copper-mine": "copper",
  "tin-mine": "tin",
  "iron-mine": "iron",
  "silver-mine": "silver",
  "coal-mine": "coal",
  "marble-quarry": "marble",
  "oil-derrick": "oil",
};

const COASTAL_TYPES = new Set(["dock", "fishing-hut", "boat"]);
const FARMLAND = /^(farm|livestock-pen|gristmill|windmill|watermill|skyfarm)$/;
const GROVE = /^(charcoal-burner)$/;
const DEFENSE = /^(palisade|stone-wall|castle-wall|watchtower|barbican|radar-station)$/;
const CIVIC =
  /^(temple|shrine|cathedral|monastery|stone-circle|burial-mound|forum|senate-hall|library|academy|university|observatory|moot-hall|elder-lodge|keep|bell-tower|town-hall|hospital)$/;
const SERVICE =
  /^(market-hall|trading-post|exchange|bank|tavern|campfire|storyteller-circle|well|bathhouse|thermae|mint|goldsmith|gem-cutter)$/;

/** Which quarter of town a building type belongs to. */
export function districtFor(type: string): District {
  const spec = buildingSpec(type);
  if (spec?.wonder) return "wonder";
  if (COASTAL_TYPES.has(type)) return "harbor";
  if (FARMLAND.test(type)) return "farmland";
  if (type === "granary") return "storehouse";
  if (INDUSTRY_NODE[type]) return "industry";
  if (GROVE.test(type)) return "grove";
  if (DEFENSE.test(type)) return "defense";
  if (CIVIC.test(type)) return "civic";
  if (SERVICE.test(type) || (spec?.joy ?? 0) > 0) return "service";
  if ((spec?.houses ?? 0) > 0) return "housing";
  return "workshop";
}

// ── facing ──────────────────────────────────────────────────────────────────

/** Building models author their door on local +z; rotation.y = facing points
 * that door at the target. Docks and boat yards run their pier along local +x,
 * so they take an extra quarter turn. */
function faceToward(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toX - fromX, toY - fromY);
}

/** Direction of open water from a shore position — where a pier should point. */
function waterFacing(terrain: IslandTerrain, x: number, y: number): number | undefined {
  const size = terrain.size;
  let best: { x: number; y: number } | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  const r = 6;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = Math.round(x) + dx;
      const ty = Math.round(y) + dy;
      if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
      if (terrain.tiles[ty * size + tx]!.kind !== "water") continue;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  }
  return best ? faceToward(x, y, best.x, best.y) : undefined;
}

/**
 * Deterministic facing for a building: piers point to sea, buildings on the
 * plaza ring address the plaza, everything else faces its nearest street.
 * A per-building jitter keeps streets from reading machine-ruled. Pure
 * function of save data (id, type, pos) + terrain, so it round-trips saves
 * byte-exactly — nothing new is persisted.
 */
export function buildingFacing(
  plan: TownPlan,
  terrain: IslandTerrain,
  building: { id: string; type: string; pos: Vec2 },
): number {
  const jitter = (mulberry32(hashString(`${building.id}|facing`))() - 0.5) * 0.14;
  const { x, y } = building.pos;
  if (COASTAL_TYPES.has(building.type)) {
    const toSea = waterFacing(terrain, x, y);
    if (toSea !== undefined) {
      // dock platforms and boat hulls lie along local +x; swing it seaward
      const pierAligned = building.type === "dock" || building.type === "boat";
      return toSea - (pierAligned ? Math.PI / 2 : 0) + jitter;
    }
  }
  const plazaD = Math.hypot(x - plan.plaza.x, y - plan.plaza.y);
  if (plazaD <= plan.plazaRadius + 4.5 && plazaD > 0.6) {
    return faceToward(x, y, plan.plaza.x, plan.plaza.y) + jitter;
  }
  const street = nearestStreet(plan, x, y);
  if (street && street.distance <= 10 && street.distance > 0.4) {
    return faceToward(x, y, street.point.x, street.point.y) + jitter;
  }
  if (plazaD > 0.6) return faceToward(x, y, plan.plaza.x, plan.plaza.y) + jitter;
  return jitter * 3;
}

/** Where the door meets the ground, one stride out — footpaths aim here. */
export function doorPoint(
  pos: Vec2,
  facing: number,
  stride = 1.5,
): Vec2 {
  return { x: pos.x + Math.sin(facing) * stride, y: pos.y + Math.cos(facing) * stride };
}
