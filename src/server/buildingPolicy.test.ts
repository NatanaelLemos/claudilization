import { describe, expect, it } from "vitest";
import type { Building, Island } from "../shared/types";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

function rich(w: World, islandId: string): void {
  w.debugGrant(islandId, {
    stocks: {
      food: 50_000,
      wood: 50_000,
      stone: 50_000,
      copper: 50_000,
      tin: 50_000,
      iron: 50_000,
      steel: 50_000,
      marble: 50_000,
      gold: 50_000,
      silver: 50_000,
      preciousMetals: 50_000,
      gems: 50_000,
      coal: 50_000,
      oil: 50_000,
      gas: 50_000,
      plutonium: 50_000,
      antimatter: 50_000,
    },
  });
}

function minimumDistance(buildings: Building[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let a = 0; a < buildings.length; a++) {
    for (let b = a + 1; b < buildings.length; b++) {
      minimum = Math.min(
        minimum,
        Math.hypot(
          buildings[a]!.pos.x - buildings[b]!.pos.x,
          buildings[a]!.pos.y - buildings[b]!.pos.y,
        ),
      );
    }
  }
  return minimum;
}

describe("building placement policy", () => {
  it("keeps ordinary structures at visibly meaningful full clearance", () => {
    const w = World.create({ seed: 91, balance: FAST });
    const joined = w.join({ civ: "roman" });
    rich(w, joined.islandId);

    for (let index = 0; index < 6; index++) {
      const [outcome] = w.applyOrders(joined.secret, [{ kind: "build", building: "hut" }]);
      expect(outcome!.ok).toBe(true);
    }

    const huts = w.island(joined.islandId)!.buildings.filter((building) => building.type === "hut");
    expect(huts).toHaveLength(6);
    expect(minimumDistance(huts)).toBeGreaterThanOrEqual(9.5);
  });

  it("relaxes deterministically on a small island without making construction impossible", () => {
    const w = World.create({ seed: 92, balance: { ...FAST, islandSize: 18 } });
    const joined = w.join({ civ: "norse" });
    rich(w, joined.islandId);

    for (let index = 0; index < 6; index++) {
      const [outcome] = w.applyOrders(joined.secret, [{ kind: "build", building: "hut" }]);
      expect(outcome!.ok).toBe(true);
    }

    const island = w.island(joined.islandId)!;
    expect(new Set(island.buildings.map((building) => `${building.pos.x},${building.pos.y}`)).size)
      .toBe(island.buildings.length);
    expect(minimumDistance(island.buildings)).toBeGreaterThanOrEqual(3);
    for (const building of island.buildings) {
      expect(building.pos.x).toBeGreaterThanOrEqual(0);
      expect(building.pos.y).toBeGreaterThanOrEqual(0);
      expect(building.pos.x).toBeLessThan(island.size!);
      expect(building.pos.y).toBeLessThan(island.size!);
    }
  });

  it("loads legacy clustered buildings without moving or deleting them", () => {
    const w = World.create({ seed: 93, balance: FAST });
    const joined = w.join({ civ: "greek" });
    w.debugGrant(joined.islandId, { age: "iron" });
    const raw = JSON.parse(w.serialize()) as { islands: Island[] };
    const island = raw.islands.find((entry) => entry.id === joined.islandId)!;
    island.buildings.push(
      { id: "legacy-forge-a", type: "blacksmith", stage: "complete", progress: 60, pos: { x: 50, y: 50 } },
      { id: "legacy-forge-b", type: "blacksmith", stage: "complete", progress: 60, pos: { x: 51, y: 50 } },
    );

    const revived = World.deserialize(JSON.stringify(raw));
    const forges = revived.island(joined.islandId)!.buildings.filter(
      (building) => building.type === "blacksmith",
    );
    expect(forges.map((building) => building.pos)).toEqual([
      { x: 50, y: 50 },
      { x: 51, y: 50 },
    ]);
  });
});

describe("necessity-gated construction", () => {
  it("allows one forge for an unmet warmth service, then rejects surplus and unrelated industry", () => {
    const w = World.create({ seed: 94, balance: FAST });
    const joined = w.join({ civ: "aztec" });
    w.debugGrant(joined.islandId, { age: "iron" });
    rich(w, joined.islandId);

    const [first] = w.applyOrders(joined.secret, [{ kind: "build", building: "blacksmith" }]);
    const [duplicate] = w.applyOrders(joined.secret, [{ kind: "build", building: "blacksmith" }]);
    const [surplus] = w.applyOrders(joined.secret, [{ kind: "build", building: "arsenal" }]);

    expect(first!.ok).toBe(true);
    expect(duplicate).toMatchObject({ ok: false });
    expect(duplicate!.reason).toMatch(/not needed|capacity/);
    expect(surplus).toMatchObject({ ok: false });
  });

  it("counts queued food capacity and does not create a duplicate queue", () => {
    const w = World.create({ seed: 95, balance: FAST });
    const joined = w.join({ civ: "roman" });
    const island = w.island(joined.islandId)!;
    island.settlers.splice(5);
    w.debugGrant(joined.islandId, { age: "bronze", addBuilding: { type: "farm", stage: "site" } });

    expect(w.buildingNeed(joined.islandId, "livestock-pen")).toBeUndefined();
    rich(w, joined.islandId);
    const [outcome] = w.applyOrders(joined.secret, [
      { kind: "build", building: "livestock-pen" },
    ]);
    expect(outcome).toMatchObject({ ok: false });
  });

  it("treats a large refining backlog as days of work, not demand for duplicate furnaces", () => {
    const w = World.create({ seed: 951, balance: FAST });
    const joined = w.join({ civ: "roman" });
    w.debugGrant(joined.islandId, {
      age: "iron",
      stocks: { food: 1_000, iron: 50_000, steel: 0, stone: 1_000 },
    });

    const [first] = w.applyOrders(joined.secret, [{ kind: "build", building: "steelworks" }]);
    const [duplicate] = w.applyOrders(joined.secret, [{ kind: "build", building: "steelworks" }]);

    expect(first!.ok).toBe(true);
    expect(duplicate).toMatchObject({ ok: false });
    expect(w.island(joined.islandId)!.buildings.filter((building) => building.type === "steelworks"))
      .toHaveLength(1);
  });

  it("raises an urgent missing dock before optional civic construction", () => {
    const w = World.create({ seed: 96, balance: FAST });
    const joined = w.join({ civ: "japanese" });
    w.debugGrant(joined.islandId, { age: "bronze" });
    rich(w, joined.islandId);
    const island = w.island(joined.islandId)!;
    for (const node of island.nodes) {
      if (node.resource === "food" || node.resource === "wood" || node.resource === "stone")
        node.remaining = 0;
    }
    // Food and housing supply already cover the settlement, so the transport
    // prerequisite is the urgent missing capacity at the next council.
    w.debugGrant(joined.islandId, { addBuilding: { type: "farm", stage: "complete" } });
    w.debugGrant(joined.islandId, { addBuilding: { type: "livestock-pen", stage: "complete" } });
    for (let index = 0; index < 4; index++)
      w.debugGrant(joined.islandId, { addBuilding: { type: "elder-lodge", stage: "complete" } });

    const events = w.tick(FAST.daySeconds);
    expect(island.buildings.some((building) => building.type === "dock")).toBe(true);
    expect(events.some((event) => event.type === "ground-broken" && event.text.includes("dock")))
      .toBe(true);
  });

  it("does not sweep the catalog when all measurable demand is covered", () => {
    const w = World.create({ seed: 97, balance: { ...FAST, birthChancePerDay: 0 } });
    const joined = w.join({ civ: "norse" });
    w.debugGrant(joined.islandId, { age: "iron" });
    rich(w, joined.islandId);
    for (const type of ["farm", "livestock-pen", "campfire", "roundhouse", "roundhouse", "roundhouse", "dancing-ground"])
      w.debugGrant(joined.islandId, { addBuilding: { type, stage: "complete" } });
    const island = w.island(joined.islandId)!;
    const before = island.buildings.length;

    w.tick(FAST.daySeconds);

    expect(island.buildings).toHaveLength(before);
    expect(island.buildings.some((building) => building.type === "arsenal")).toBe(false);
    expect(island.buildings.some((building) => building.type === "steelworks")).toBe(false);
  });
});
