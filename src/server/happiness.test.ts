import { describe, expect, it } from "vitest";
import { wonderFor } from "../shared/wonders";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

describe("wonders in the world", () => {
  it("a people may only raise their own wonder, and only once", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "japanese" });
    w.debugGrant(r.islandId, { stocks: { food: 9999, wood: 9999, stone: 9999 } });

    const [foreign] = w.applyOrders(r.secret, [
      { kind: "build", building: wonderFor("aztec", "stone").type },
    ]);
    expect(foreign!.ok).toBe(false);
    expect(foreign!.reason).toMatch(/another people/);

    const own = wonderFor("japanese", "stone").type;
    const [first] = w.applyOrders(r.secret, [{ kind: "build", building: own }]);
    expect(first!.ok).toBe(true);

    const [second] = w.applyOrders(r.secret, [{ kind: "build", building: own }]);
    expect(second!.ok).toBe(false);
    expect(second!.reason).toMatch(/already stands/);
  });

  it("a finished wonder is a world moment and lifts the daily mood", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "japanese" });
    w.debugGrant(r.islandId, {
      addBuilding: { type: wonderFor("japanese", "stone").type, stage: "complete" },
    });
    w.tick(11); // cross a day boundary so happiness is recomputed
    const island = w.island(r.islandId)!;
    expect(island.happiness!).toBeGreaterThanOrEqual(80);
  });
});

describe("leisure and the working day", () => {
  it("a park draws settlers off their labors for the day", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "greek" });
    w.debugGrant(r.islandId, {
      stocks: { food: 500 },
      addBuilding: { type: "dancing-ground", stage: "complete" },
    });
    w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "wood", count: 8 },
    ]);
    w.tick(11); // through a day boundary — the rotation runs at dawn
    const island = w.island(r.islandId)!;
    const idlersAway = island.settlers.filter((s) => s.task.kind === "relax");
    expect(idlersAway.length).toBeGreaterThan(0);
    expect(idlersAway.length).toBeLessThanOrEqual(2); // two to a place
  });
});

describe("the town sleeps at night", () => {
  it("after sundown nothing is gathered and everyone heads for a bed", () => {
    const w = World.create({ seed: 9, balance: { daySeconds: 100, daylightShare: 0.5 } });
    const r = w.join({ civ: "norse" });
    w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "wood", count: 5 },
    ]);
    w.tick(40); // full daylight — work happens
    const dayWood = w.island(r.islandId)!.stocks.wood ?? 0;
    expect(dayWood).toBeGreaterThan(0);

    w.tick(20); // dayClock 60 of 100 — the sun is down
    const duskWood = w.island(r.islandId)!.stocks.wood ?? 0;
    w.tick(30); // deep night
    const nightIsland = w.island(r.islandId)!;
    expect((nightIsland.stocks.wood ?? 0) - duskWood).toBeLessThanOrEqual(1);
    // tasks keep through the night; only the bodies rest
    expect(nightIsland.settlers.some((s) => s.task.kind === "gather")).toBe(true);
  });
});
