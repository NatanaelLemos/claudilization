import { createNoise2D } from "simplex-noise";
import { DEFAULT_BALANCE } from "./balance";
import { mulberry32 } from "./rng";
import type {
  FoodSource,
  IslandTerrain,
  ResourceId,
  ResourceNode,
  Tile,
  TileKind,
} from "./types";

/**
 * How much a full node of each resource holds — the birth value at terrain
 * generation and the ceiling regeneration grows back toward. One table, so
 * the land's wealth and its recovery can never drift apart. Steel is only
 * ever refined, never mined: no node, no capacity.
 */
export const NODE_CAPACITY: Record<ResourceId, number> = {
  wood: 500,
  stone: 400,
  food: 500,
  copper: 350,
  tin: 320,
  iron: 380,
  steel: 0,
  marble: 260,
  gold: 200,
  silver: 220,
  preciousMetals: 150,
  gems: 140,
  coal: 400,
  oil: 320,
  gas: 300,
  plutonium: 120,
  antimatter: 90,
};

/** Wild food by flavor: the sea is richest, then herds, then trees. */
export const FOOD_SOURCE_CAPACITY: Record<FoodSource, number> = {
  fish: 500,
  animals: 450,
  "apple-trees": 350,
  "berry-bushes": 300,
};

/** A node's full measure — food reads its flavor, everything else the table. */
export function nodeCapacity(node: Pick<ResourceNode, "resource" | "source">): number {
  if (node.resource === "food")
    return FOOD_SOURCE_CAPACITY[node.source ?? "berry-bushes"];
  return NODE_CAPACITY[node.resource];
}

const WATER = 0.2;
const SAND = 0.28;
const GRASS = 0.7;

function kindOf(height: number): TileKind {
  if (height < WATER) return "water";
  if (height < SAND) return "sand";
  if (height < GRASS) return "grass";
  return "rock";
}

/** Deterministic island: simplex fBM heightmap × radial falloff, plus resource nodes. */
export function generateIsland(
  seed: number,
  size = DEFAULT_BALANCE.islandSize,
): IslandTerrain {
  const rng = mulberry32(seed);
  const noise = createNoise2D(rng);
  const half = (size - 1) / 2;

  const tiles: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let fbm = 0;
      let amp = 0.5;
      let freq = 1.6 / size;
      for (let o = 0; o < 4; o++) {
        fbm += amp * (noise(x * freq, y * freq) * 0.5 + 0.5);
        amp *= 0.5;
        freq *= 2;
      }
      const r = Math.hypot(x - half, y - half) / half;
      const falloff = Math.max(0, 1 - r * r);
      // centre floor of 0.35 guarantees livable grass for every seed
      const height = (0.35 + 0.65 * fbm) * falloff;
      tiles.push({ x, y, height, kind: kindOf(height) });
    }
  }

  const nodeRng = mulberry32(seed ^ 0x9e3779b9);
  const land = tiles.filter((t) => t.kind !== "water");
  const grass = land.filter((t) => t.kind === "grass");
  const rock = land.filter((t) => t.kind === "rock");
  const sandOrGrass = land.filter((t) => t.kind !== "rock");
  // fishing spots: beach tiles at the water's edge — settlers fish from shore
  const kindAt = new Map(tiles.map((t) => [`${t.x},${t.y}`, t.kind]));
  const shore = land.filter(
    (t) =>
      t.kind === "sand" &&
      (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const
      ).some(([dx, dy]) => kindAt.get(`${t.x + dx},${t.y + dy}`) === "water"),
  );

  const nodes: IslandTerrain["nodes"] = [];
  const used = new Set<string>();
  const place = (
    resource: ResourceId,
    from: Tile[],
    count: number,
    source?: FoodSource,
  ) => {
    const pool = from.length > 0 ? from : land;
    const remaining = source ? FOOD_SOURCE_CAPACITY[source] : NODE_CAPACITY[resource];
    for (let i = 0; i < count && nodes.length < land.length; i++) {
      let tile = pool[Math.floor(nodeRng() * pool.length)]!;
      for (let tries = 0; used.has(`${tile.x},${tile.y}`) && tries < 40; tries++) {
        tile = pool[Math.floor(nodeRng() * pool.length)]!;
      }
      used.add(`${tile.x},${tile.y}`);
      nodes.push({
        id: `node-${nodes.length}`,
        resource,
        pos: { x: tile.x, y: tile.y },
        remaining,
        ...(source ? { source } : {}),
      });
    }
  };

  const density = Math.max(3, Math.floor(land.length / 60));
  place("wood", grass, density);
  place("stone", rock, Math.max(3, Math.floor(density / 2)));
  // wild food, one flavor per node: the sea is richest, then herds, then trees
  const perSource = Math.max(1, Math.floor(density / 4));
  place("food", shore, perSource, "fish");
  place("food", grass, perSource, "animals");
  place("food", grass, perSource, "apple-trees");
  place("food", sandOrGrass, perSource, "berry-bushes");

  // the deeper ages dig deeper: every island is born with its ores and
  // minerals already in the ground, waiting for an age that can work them.
  // placed after the wilds so the rng stream — and every existing island's
  // node order — never shifts
  const lode = Math.max(2, Math.floor(density / 8));
  const vein = Math.max(1, Math.floor(density / 16));
  const trace = Math.max(1, Math.floor(density / 24));
  place("copper", rock, lode);
  place("tin", rock, lode);
  place("iron", rock, lode);
  place("marble", rock, vein);
  place("gold", rock, vein);
  place("silver", rock, vein);
  place("preciousMetals", rock, trace);
  place("gems", rock, trace);
  place("coal", rock, lode);
  place("oil", sandOrGrass, vein);
  place("gas", sandOrGrass, vein);
  place("plutonium", rock, trace);
  place("antimatter", rock, trace);

  return { size, tiles, nodes };
}
