import { describe, expect, it } from "vitest";
import { generateIsland } from "../shared/terrain";
import { buildingFacing, districtFor, foundingSite, townPlan } from "../shared/townPlan";
import type { Island } from "../shared/types";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

function rich(w: World, islandId: string): void {
  w.debugGrant(islandId, {
    stocks: {
      food: 90_000,
      wood: 90_000,
      stone: 90_000,
      copper: 90_000,
      tin: 90_000,
      iron: 90_000,
      steel: 90_000,
      marble: 90_000,
      gold: 90_000,
      silver: 90_000,
      preciousMetals: 90_000,
      gems: 90_000,
      coal: 90_000,
      oil: 90_000,
      gas: 90_000,
      plutonium: 90_000,
      antimatter: 90_000,
    },
  });
}

function terrainOf(island: Island) {
  return generateIsland(island.seed, island.size!);
}

describe("the town plan", () => {
  it("is a pure function of seed and size — never of buildings", () => {
    const terrain = generateIsland(1234, 96);
    const a = townPlan(terrain, 1234);
    const b = townPlan(generateIsland(1234, 96), 1234);
    expect(b.plaza).toEqual(a.plaza);
    expect(b.streets).toEqual(a.streets);
    // the plaza anchors on the historic first-building tile, so old towns
    // already stand around their own plaza
    expect(a.plaza).toEqual(foundingSite(terrain));
  });

  it("keeps the founding plaza open — new buildings ring it, never squat it", () => {
    const w = World.create({ seed: 501, balance: FAST });
    const joined = w.join({ civ: "roman" });
    rich(w, joined.islandId);
    for (let i = 0; i < 5; i++) {
      const [outcome] = w.applyOrders(joined.secret, [{ kind: "build", building: "hut" }]);
      expect(outcome!.ok).toBe(true);
    }
    const island = w.island(joined.islandId)!;
    const plan = townPlan(terrainOf(island), island.seed);
    for (const building of island.buildings) {
      const d = Math.hypot(
        building.pos.x - plan.plaza.x,
        building.pos.y - plan.plaza.y,
      );
      expect(d).toBeGreaterThanOrEqual(plan.plazaRadius);
    }
  });

  it("lines housing up along the street skeleton", () => {
    const w = World.create({ seed: 502, balance: FAST });
    const joined = w.join({ civ: "greek" });
    rich(w, joined.islandId);
    for (let i = 0; i < 6; i++) {
      const [outcome] = w.applyOrders(joined.secret, [{ kind: "build", building: "hut" }]);
      expect(outcome!.ok).toBe(true);
    }
    const island = w.island(joined.islandId)!;
    const plan = townPlan(terrainOf(island), island.seed);
    const size = island.size!;
    for (const hut of island.buildings.filter((b) => b.type === "hut")) {
      const streetD = plan.streetDist[Math.round(hut.pos.y) * size + Math.round(hut.pos.x)]!;
      expect(streetD).toBeLessThanOrEqual(4.5);
    }
  });

  it("never builds inside a grove, an outcrop, or on a lode when ground is free", () => {
    const w = World.create({ seed: 503, balance: FAST });
    const joined = w.join({ civ: "norse" });
    rich(w, joined.islandId);
    for (const type of ["hut", "granary", "toolmaker", "hut", "campfire"]) {
      w.debugGrant(joined.islandId, { addBuilding: { type, stage: "complete" } });
    }
    const island = w.island(joined.islandId)!;
    const terrain = terrainOf(island);
    for (const building of island.buildings) {
      for (const node of terrain.nodes) {
        const d = Math.hypot(node.pos.x - building.pos.x, node.pos.y - building.pos.y);
        const keepOut = node.resource === "wood" || node.resource === "stone" ? 2.0 : 1.4;
        expect(d).toBeGreaterThanOrEqual(keepOut);
      }
    }
  });

  it("sites the mine by its ore and the watchtower on the sea-facing perimeter", () => {
    const w = World.create({ seed: 504, balance: FAST });
    const joined = w.join({ civ: "japanese" });
    w.debugGrant(joined.islandId, { age: "iron" });
    rich(w, joined.islandId);
    w.debugGrant(joined.islandId, { addBuilding: { type: "iron-mine", stage: "complete" } });
    w.debugGrant(joined.islandId, { addBuilding: { type: "watchtower", stage: "complete" } });
    const island = w.island(joined.islandId)!;
    const plan = townPlan(terrainOf(island), island.seed);
    const size = island.size!;

    const mine = island.buildings.find((b) => b.type === "iron-mine")!;
    const oreD = Math.min(
      ...island.nodes
        .filter((n) => n.resource === "iron")
        .map((n) => Math.hypot(n.pos.x - mine.pos.x, n.pos.y - mine.pos.y)),
    );
    expect(oreD).toBeLessThanOrEqual(8);

    const tower = island.buildings.find((b) => b.type === "watchtower")!;
    const shoreD =
      plan.shoreDist[Math.round(tower.pos.y) * size + Math.round(tower.pos.x)]!;
    expect(shoreD).toBeLessThanOrEqual(6);
    // the perimeter stands farther out than the founding core
    const towerFromPlaza = Math.hypot(
      tower.pos.x - plan.plaza.x,
      tower.pos.y - plan.plaza.y,
    );
    expect(towerFromPlaza).toBeGreaterThan(plan.plazaRadius + 2);
  });

  it("raises the wonder on commanding ground", () => {
    const w = World.create({ seed: 505, balance: FAST });
    const joined = w.join({ civ: "roman" });
    rich(w, joined.islandId);
    w.debugGrant(joined.islandId, {
      addBuilding: { type: "saturn-stones", stage: "complete" },
    });
    const island = w.island(joined.islandId)!;
    const terrain = terrainOf(island);
    const size = island.size!;
    const wonder = island.buildings.find((b) => b.type === "saturn-stones")!;
    const wonderHeight =
      terrain.tiles[Math.round(wonder.pos.y) * size + Math.round(wonder.pos.x)]!.height;
    const buildable = terrain.tiles
      .filter((t) => t.kind === "grass" || t.kind === "sand")
      .map((t) => t.height)
      .sort((a, b) => a - b);
    const p60 = buildable[Math.floor(buildable.length * 0.6)]!;
    expect(wonderHeight).toBeGreaterThanOrEqual(p60);
  });

  it("facing derives from save data alone and round-trips a serialize cycle", () => {
    const w = World.create({ seed: 506, balance: FAST });
    const joined = w.join({ civ: "aztec" });
    rich(w, joined.islandId);
    for (const type of ["hut", "granary", "hut"]) {
      w.applyOrders(joined.secret, [{ kind: "build", building: type }]);
    }
    const island = w.island(joined.islandId)!;
    const terrain = terrainOf(island);
    const plan = townPlan(terrain, island.seed);
    const before = island.buildings.map((b) => buildingFacing(plan, terrain, b));

    const revived = World.deserialize(w.serialize());
    const rIsland = revived.island(joined.islandId)!;
    const rTerrain = terrainOf(rIsland);
    const rPlan = townPlan(rTerrain, rIsland.seed);
    const after = rIsland.buildings.map((b) => buildingFacing(rPlan, rTerrain, b));
    expect(after).toEqual(before);
    // and the world itself restores byte-identically
    expect(revived.serialize()).toBe(w.serialize());
  });

  it("classifies the catalog into the districts the placer reasons with", () => {
    expect(districtFor("farm")).toBe("farmland");
    expect(districtFor("livestock-pen")).toBe("farmland");
    expect(districtFor("granary")).toBe("storehouse");
    expect(districtFor("iron-mine")).toBe("industry");
    expect(districtFor("marble-quarry")).toBe("industry");
    expect(districtFor("charcoal-burner")).toBe("grove");
    expect(districtFor("watchtower")).toBe("defense");
    expect(districtFor("palisade")).toBe("defense");
    expect(districtFor("temple")).toBe("civic");
    expect(districtFor("market-hall")).toBe("service");
    expect(districtFor("tavern")).toBe("service");
    expect(districtFor("hut")).toBe("housing");
    expect(districtFor("blacksmith")).toBe("workshop");
    expect(districtFor("dock")).toBe("harbor");
    expect(districtFor("saturn-stones")).toBe("wonder");
  });
});
