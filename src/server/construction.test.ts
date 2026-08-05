import { describe, expect, it } from "vitest";
import { advanceRequirements } from "../shared/ages";
import { buildingSpec } from "../shared/buildings";
import { generateIsland } from "../shared/terrain";
import type { Island, Vec2 } from "../shared/types";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

/** true when the point is a beach tile touching open water */
function onShore(island: Island, p: Vec2): boolean {
  const terrain = generateIsland(island.seed, island.size ?? 64);
  const kindAt = new Map(terrain.tiles.map((t) => [`${t.x},${t.y}`, t.kind]));
  return (
    kindAt.get(`${p.x},${p.y}`) === "sand" &&
    (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const
    ).some(([dx, dy]) => kindAt.get(`${p.x + dx},${p.y + dy}`) === "water")
  );
}

describe("construction", () => {
  it("a build order marks a site, deducts costs, and passes visibly through all three stages", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { stocks: { food: 100, wood: 500, stone: 500 } });

    const spec = buildingSpec("hut")!;
    const before = w.island(r.islandId)!.stocks;
    const woodBefore = before.wood ?? 0;

    const [outcome] = w.applyOrders(r.secret, [
      { kind: "build", building: "hut" },
    ]);
    expect(outcome!.ok).toBe(true);

    const island = () => w.island(r.islandId)!;
    const hut = () => island().buildings.find((b) => b.type === "hut")!;

    expect(hut().stage).toBe("site");
    expect((island().stocks.wood ?? 0)).toBeLessThan(woodBefore);

    const seen = new Set([hut().stage]);
    for (let t = 0; t < spec.buildSeconds + 30 && hut().stage !== "complete"; t++) {
      w.tick(1);
      seen.add(hut().stage);
    }
    expect(hut().stage).toBe("complete");
    expect([...seen]).toEqual(["site", "construction", "complete"]);
  });

  it("refuses a build the island cannot afford, with a reason", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { stocks: { wood: 0, stone: 0 } });
    const [outcome] = w.applyOrders(r.secret, [
      { kind: "build", building: "hut" },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toBeTruthy();
  });

  it("refuses buildings from a future age", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { stocks: { wood: 9999, stone: 9999 } });
    const [outcome] = w.applyOrders(r.secret, [
      { kind: "build", building: "dock" }, // bronze-age, island is stone
    ]);
    expect(outcome!.ok).toBe(false);
  });
});

describe("advancing an age", () => {
  it("advances in the same pulse that earns the final required work", () => {
    const w = World.create({
      seed: 8,
      balance: { ...FAST, bronzeWorkPoints: 1, workPointsPerToken: 1 },
    });
    const r = w.join({ civ: "aztec" });

    const events = w.pulse(r.secret, 1);

    expect(w.island(r.islandId)!.age).toBe("bronze");
    expect(events.filter((e) => e.type === "age-up")).toHaveLength(1);
  });

  it("does not advance below the boundary, then advances automatically at the exact requirement", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "roman" });
    const need = advanceRequirements("bronze", w.law);

    w.debugGrant(r.islandId, { workPoints: need - 0.001 });
    expect(w.tick(1).filter((e) => e.type === "age-up")).toHaveLength(0);
    expect(w.island(r.islandId)!.age).toBe("stone");

    w.debugGrant(r.islandId, { workPoints: need });
    const events = w.tick(1);
    expect(w.island(r.islandId)!.age).toBe("bronze");
    expect(events.filter((e) => e.type === "age-up")).toHaveLength(1);
    expect(events.find((e) => e.type === "age-up")!.world).toBe(true);
    expect(w.tick(1).filter((e) => e.type === "age-up")).toHaveLength(0);
  });

  it("crosses each met threshold once, stops at the age cap, and advances owned colonies", () => {
    const w = World.create({ seed: 10, balance: FAST });
    const r = w.join({ civ: "roman" });
    const home = w.island(r.islandId)!;
    const colony = w.join({ civ: "greek" });
    const colonyIsland = w.island(colony.islandId)!;
    colonyIsland.kind = "colony";
    colonyIsland.ownerId = home.id;

    w.debugGrant(home.id, { workPoints: Number.MAX_SAFE_INTEGER });
    const events = w.tick(1).filter((e) => e.type === "age-up");

    expect(home.age).toBe("future");
    expect(colonyIsland.age).toBe("future");
    expect(events.map((e) => e.text.match(/\((\w+) age\)$/)?.[1])).toEqual([
      "bronze", "iron", "classical", "medieval", "renaissance", "industrial", "modern", "future",
    ]);
    expect(w.tick(2).filter((e) => e.type === "age-up")).toHaveLength(0);
  });

  it("persists an automatic transition and does not announce it again after reload", () => {
    const w = World.create({ seed: 11, balance: FAST });
    const r = w.join({ civ: "norse" });
    w.debugGrant(r.islandId, {
      workPoints: advanceRequirements("bronze", w.law),
    });

    expect(w.tick(1).filter((e) => e.type === "age-up")).toHaveLength(1);
    const revived = World.deserialize(w.serialize());

    expect(revived.island(r.islandId)!.age).toBe("bronze");
    expect(revived.tick(1).filter((e) => e.type === "age-up")).toHaveLength(0);
  });
});

describe("coastal buildings", () => {
  it("a dock rises on the beach at the water's edge, never inland", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { workPoints: 10_000, stocks: { wood: 999, stone: 999 } });
    w.applyOrders(r.secret, [{ kind: "advance_age" }]);

    const [outcome] = w.applyOrders(r.secret, [{ kind: "build", building: "dock" }]);
    expect(outcome!.ok).toBe(true);
    const island = w.island(r.islandId)!;
    const dock = island.buildings.find((b) => b.type === "dock")!;
    expect(onShore(island, dock.pos)).toBe(true);
  });

  it("a fishing hut keeps its feet in the sand too", () => {
    const w = World.create({ seed: 11, balance: FAST });
    const r = w.join({ civ: "norse" });
    w.debugGrant(r.islandId, { stocks: { wood: 999, stone: 999 } });
    const [outcome] = w.applyOrders(r.secret, [{ kind: "build", building: "fishing-hut" }]);
    expect(outcome!.ok).toBe(true);
    const island = w.island(r.islandId)!;
    const hut = island.buildings.find((b) => b.type === "fishing-hut")!;
    expect(onShore(island, hut.pos)).toBe(true);
  });

  it("an inland dock from an old save walks down to the shore on load", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { workPoints: 10_000, stocks: { wood: 999, stone: 999 } });
    w.applyOrders(r.secret, [{ kind: "advance_age" }]);
    w.applyOrders(r.secret, [{ kind: "build", building: "dock" }]);

    // sabotage the position the way pre-coast-rule saves recorded it
    const dock = w.island(r.islandId)!.buildings.find((b) => b.type === "dock")!;
    dock.pos = { x: 32, y: 32 };

    const revived = World.deserialize(w.serialize());
    const island = revived.island(r.islandId)!;
    const moved = island.buildings.find((b) => b.type === "dock")!;
    expect(onShore(island, moved.pos)).toBe(true);
  });
});

describe("islands growing between saves", () => {
  it("an island saved at the old 64-tile size scales up and gains fresh nature on load", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { stocks: { food: 100, wood: 500, stone: 500 } });
    w.applyOrders(r.secret, [{ kind: "build", building: "hut" }]);

    // shrink the save the way pre-growth servers wrote it: no size field,
    // every position in 64-grid coordinates
    const raw = JSON.parse(w.serialize()) as { islands: Island[] };
    const newSize = w.island(r.islandId)!.size!;
    const f = 64 / newSize;
    for (const isle of raw.islands) {
      delete isle.size;
      for (const b of isle.buildings) (b.pos.x *= f), (b.pos.y *= f);
      for (const s of isle.settlers) (s.pos.x *= f), (s.pos.y *= f);
      isle.nodes = isle.nodes.slice(0, 4);
      for (const n of isle.nodes) (n.pos.x *= f), (n.pos.y *= f);
    }

    const revived = World.deserialize(JSON.stringify(raw));
    const island = revived.island(r.islandId)!;
    expect(island.size).toBe(newSize);
    // the surviving nodes were carried over, and the larger island added more
    expect(island.nodes.length).toBeGreaterThan(4);
    // everything scaled back out into the bigger grid — nobody is out of bounds
    for (const s of island.settlers) {
      expect(s.pos.x).toBeGreaterThanOrEqual(0);
      expect(s.pos.x).toBeLessThan(newSize);
    }
    const hut = island.buildings.find((b) => b.type === "hut")!;
    const original = w.island(r.islandId)!.buildings.find((b) => b.type === "hut")!;
    expect(hut.pos.x).toBeCloseTo(original.pos.x, 5);
    expect(hut.pos.y).toBeCloseTo(original.pos.y, 5);
  });
});

describe("construction crews", () => {
  it("with nobody idle, a site recruits from gatherers — but never food gatherers", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "aztec" });
    w.debugGrant(r.islandId, { stocks: { food: 1000, wood: 500, stone: 500 } });

    // occupy every settler: all 10 on wood, then the first 2 retasked to food
    const island = () => w.island(r.islandId)!;
    w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "wood", count: 10 },
      { kind: "assign_gathering", resource: "food", count: 2 },
    ]);
    const idle = island().settlers.filter((s) => s.task.kind === "idle");
    expect(idle).toHaveLength(0);

    const [outcome] = w.applyOrders(r.secret, [
      { kind: "build", building: "hut" },
    ]);
    expect(outcome!.ok).toBe(true);
    const hut = () => island().buildings.find((b) => b.type === "hut")!;

    const spec = buildingSpec("hut")!;
    for (let t = 0; t < spec.buildSeconds + 30 && hut().stage !== "complete"; t++) {
      w.tick(1);
      // food gatherers are never pulled off the fields for a build
      const foodCrew = island().settlers.filter(
        (s) => s.task.kind === "gather" && s.task.resource === "food",
      );
      expect(foodCrew.length).toBeGreaterThanOrEqual(2);
    }
    expect(hut().stage).toBe("complete");
  });
});
