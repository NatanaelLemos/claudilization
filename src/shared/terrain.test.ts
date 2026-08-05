import { describe, expect, it } from "vitest";
import { AGE_RESOURCES } from "./ages";
import { DEFAULT_BALANCE } from "./balance";
import { generateIsland } from "./terrain";

describe("generateIsland", () => {
  it("is deterministic: same seed, identical island", () => {
    expect(generateIsland(1234)).toEqual(generateIsland(1234));
  });

  it("differs across seeds", () => {
    const a = generateIsland(1);
    const b = generateIsland(2);
    expect(a).not.toEqual(b);
  });

  it("uses the balance island size by default", () => {
    const island = generateIsland(7);
    expect(island.size).toBe(DEFAULT_BALANCE.islandSize);
    expect(island.tiles).toHaveLength(island.size * island.size);
  });

  it("is an island: every border tile is water", () => {
    const { size, tiles } = generateIsland(99);
    for (const t of tiles) {
      if (t.x === 0 || t.y === 0 || t.x === size - 1 || t.y === size - 1) {
        expect(t.kind).toBe("water");
      }
    }
  });

  it("has land to live on", () => {
    const { tiles } = generateIsland(42);
    expect(tiles.some((t) => t.kind === "grass")).toBe(true);
  });

  it("spawns Stone Age nature: trees, rock deposits, wild food", () => {
    const { nodes } = generateIsland(42);
    for (const resource of ["wood", "stone", "food"] as const) {
      expect(nodes.some((n) => n.resource === resource && n.remaining > 0)).toBe(
        true,
      );
    }
  });

  it("places every node on land", () => {
    const { size, tiles, nodes } = generateIsland(42);
    const kindAt = new Map(tiles.map((t) => [`${t.x},${t.y}`, t.kind]));
    for (const n of nodes) {
      const kind = kindAt.get(`${Math.round(n.pos.x)},${Math.round(n.pos.y)}`);
      expect(kind, `node ${n.id} on water`).not.toBe("water");
    }
  });

  it("every food node is a named wild source; all four kinds appear", () => {
    const { nodes } = generateIsland(42);
    const food = nodes.filter((n) => n.resource === "food");
    for (const n of food) expect(n.source, `node ${n.id} has no source`).toBeTruthy();
    const kinds = new Set(food.map((n) => n.source));
    expect(kinds).toEqual(
      new Set(["animals", "fish", "apple-trees", "berry-bushes"]),
    );
  });

  it("fishing grounds sit on the beach at the water's edge", () => {
    const { tiles, nodes } = generateIsland(42);
    const kindAt = new Map(tiles.map((t) => [`${t.x},${t.y}`, t.kind]));
    for (const n of nodes.filter((x) => x.source === "fish")) {
      expect(kindAt.get(`${n.pos.x},${n.pos.y}`)).toBe("sand");
      const touchesWater = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => kindAt.get(`${n.pos.x + dx!},${n.pos.y + dy!}`) === "water");
      expect(touchesWater, `fish node ${n.id} is not at the shore`).toBe(true);
    }
  });

  it("wood and stone nodes carry no food source label", () => {
    const { nodes } = generateIsland(42);
    for (const n of nodes.filter((x) => x.resource !== "food")) {
      expect(n.source).toBeUndefined();
    }
  });

  it("holds every later age's minerals from birth — all but steel, which is smelted", () => {
    const { nodes } = generateIsland(42);
    const inGround = new Set(nodes.map((n) => n.resource));
    for (const r of AGE_RESOURCES.future) {
      if (r === "steel") continue;
      expect(inGround.has(r), `no ${r} deposit in the ground`).toBe(true);
    }
    expect(inGround.has("steel")).toBe(false);
  });
});
