import { createNoise2D } from "simplex-noise";
import { DEFAULT_BALANCE } from "./balance";
import { mulberry32 } from "./rng";
import type { FoodSource, IslandTerrain, ResourceId, Tile, TileKind } from "./types";

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
    remaining: number,
    source?: FoodSource,
  ) => {
    const pool = from.length > 0 ? from : land;
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
  place("wood", grass, density, 500);
  place("stone", rock, Math.max(3, Math.floor(density / 2)), 400);
  // wild food, one flavor per node: the sea is richest, then herds, then trees
  const perSource = Math.max(1, Math.floor(density / 4));
  place("food", shore, perSource, 500, "fish");
  place("food", grass, perSource, 450, "animals");
  place("food", grass, perSource, 350, "apple-trees");
  place("food", sandOrGrass, perSource, 300, "berry-bushes");

  // the deeper ages dig deeper: every island is born with its ores and
  // minerals already in the ground, waiting for an age that can work them.
  // placed after the wilds so the rng stream — and every existing island's
  // node order — never shifts
  const lode = Math.max(2, Math.floor(density / 8));
  const vein = Math.max(1, Math.floor(density / 16));
  const trace = Math.max(1, Math.floor(density / 24));
  place("copper", rock, lode, 350);
  place("tin", rock, lode, 320);
  place("iron", rock, lode, 380);
  place("marble", rock, vein, 260);
  place("gold", rock, vein, 200);
  place("silver", rock, vein, 220);
  place("preciousMetals", rock, trace, 150);
  place("gems", rock, trace, 140);
  place("coal", rock, lode, 400);
  place("oil", sandOrGrass, vein, 320);
  place("gas", sandOrGrass, vein, 300);
  place("plutonium", rock, trace, 120);
  place("antimatter", rock, trace, 90);

  return { size, tiles, nodes };
}
