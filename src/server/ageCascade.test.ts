import { describe, expect, it } from "vitest";
import type { Island } from "../shared/types";
import { World } from "./world";

// Fast clock and sea lanes so voyages land inside the test budget.
const FAST = { daySeconds: 30, boatSpeed: 40, wildSpawnIntervalSeconds: 5, daylightShare: 1 };

function sailUntilDone(w: World, islandId: string, max = 600) {
  for (let t = 0; t < max; t++) {
    w.tick(1);
    if (w.island(islandId)!.boats.every((b) => b.state === "docked")) break;
  }
}

/** A bronze player with a docked boat and full stores, ready to sail. */
function seafarer(w: World, civ: "norse" | "roman" | "greek" | "japanese") {
  const r = w.join({ civ });
  w.debugGrant(r.islandId, {
    age: "bronze",
    addBoat: true,
    stocks: { food: 5000, wood: 200, stone: 200 },
  });
  return r;
}

/** A home island with a colony — the shape the cascade must cover whole. */
function homeWithColony(w: World) {
  const a = seafarer(w, "norse");
  w.tick(5); // let a wild island rise
  const wild = w.islands().find((i) => i.kind === "wild")!;
  w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
  sailUntilDone(w, a.islandId);
  expect(w.island(wild.id)!.kind).toBe("colony");
  return { a, colonyId: wild.id };
}

describe("advancing an age retrofits every building the civilization owns", () => {
  it("advance age → all pre-existing buildings across home and colony report the new age", () => {
    const w = World.create({ seed: 61, balance: FAST });
    const { a, colonyId } = homeWithColony(w);
    // buildings in every stage on the home island, one on the colony —
    // all stamped bronze (the civilization's age when ground broke)
    w.debugGrant(a.islandId, { addBuilding: { type: "hut", stage: "complete" } });
    w.debugGrant(a.islandId, { addBuilding: { type: "farm", stage: "construction" } });
    w.debugGrant(a.islandId, { addBuilding: { type: "granary", stage: "site" } });
    w.debugGrant(colonyId, { addBuilding: { type: "hut", stage: "complete" } });
    for (const b of w.island(a.islandId)!.buildings) expect(b.age).toBe("bronze");

    // bronze → iron needs 1800 cumulative work points (900 × 2)
    w.debugGrant(a.islandId, { workPoints: 1800 });
    const [outcome] = w.applyOrders(a.secret, [{ kind: "advance_age" }]);
    expect(outcome!.ok).toBe(true);
    expect(w.island(a.islandId)!.age).toBe("iron");
    expect(w.island(colonyId)!.age).toBe("iron");
    for (const island of [w.island(a.islandId)!, w.island(colonyId)!]) {
      expect(island.buildings.length).toBeGreaterThan(0);
      for (const b of island.buildings) expect(b.age).toBe("iron");
    }
  });

  it("buildings raised after the advance stamp the civilization's current age", () => {
    const w = World.create({ seed: 62, balance: FAST });
    const a = seafarer(w, "greek");
    w.debugGrant(a.islandId, { workPoints: 1800 });
    w.applyOrders(a.secret, [{ kind: "advance_age" }]);
    const [built] = w.applyOrders(a.secret, [{ kind: "build", building: "hut" }]);
    expect(built!.ok).toBe(true);
    const hut = w.island(a.islandId)!.buildings.find((b) => b.type === "hut")!;
    expect(hut.age).toBe("iron");
  });

  it("stamped ages survive serialize → deserialize; old saves backfill from the island", () => {
    const w = World.create({ seed: 63, balance: FAST });
    const { a, colonyId } = homeWithColony(w);
    w.debugGrant(a.islandId, { addBuilding: { type: "hut", stage: "complete" } });
    w.debugGrant(colonyId, { addBuilding: { type: "farm", stage: "construction" } });
    w.debugGrant(a.islandId, { workPoints: 1800 });
    w.applyOrders(a.secret, [{ kind: "advance_age" }]);

    // a faithful save keeps the stamps
    const kept = World.deserialize(w.serialize());
    for (const id of [a.islandId, colonyId]) {
      for (const b of kept.island(id)!.buildings) expect(b.age).toBe("iron");
    }

    // a save from before the field existed backfills every building from its island
    const s = JSON.parse(w.serialize()) as { islands: Island[] };
    for (const i of s.islands) for (const b of i.buildings) delete b.age;
    const back = World.deserialize(JSON.stringify(s));
    for (const id of [a.islandId, colonyId]) {
      const island = back.island(id)!;
      for (const b of island.buildings) expect(b.age).toBe(island.age);
    }
  });

  it("a conquered colony joins the conqueror's civilization — age, colors, and skyline", () => {
    const w = World.create({ seed: 64, balance: FAST });
    const { a, colonyId } = homeWithColony(w);
    w.debugGrant(colonyId, { addBuilding: { type: "hut", stage: "complete" } });
    const b = seafarer(w, "roman");
    w.debugGrant(b.islandId, { age: "classical" });
    // outmuscle the garrison: raiders must strictly outnumber the defense
    (w as unknown as { balance: { raidCrew: number } }).balance.raidCrew = 12;
    for (let i = 0; i < 12; i++) {
      w.island(b.islandId)!.settlers.push({
        id: `${b.islandId}-extra${i}`,
        name: `Extra ${i}`,
        adult: true,
        bornAt: 0,
        task: { kind: "idle" },
        pos: { x: 10, y: 10 },
        hungerDays: 0,
      });
    }
    const [attack] = w.applyOrders(b.secret, [
      { kind: "voyage", dest: colonyId, intent: "attack" },
    ]);
    expect(attack!.ok).toBe(true);
    sailUntilDone(w, b.islandId);
    const colony = w.island(colonyId)!;
    expect(colony.ownerId).toBe(b.islandId);
    expect(colony.civ).toBe("roman");
    expect(colony.age).toBe("classical");
    for (const bld of colony.buildings) expect(bld.age).toBe("classical");
  });
});
