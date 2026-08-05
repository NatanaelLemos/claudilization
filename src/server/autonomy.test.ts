import { describe, expect, it } from "vitest";
import { buildingSpec } from "../shared/buildings";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

describe("settlers act on their own judgment", () => {
  it("nobody stands idle — unordered settlers put themselves to work", () => {
    const w = World.create({ seed: 17, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 1000 } });
    w.tick(2);
    const island = w.island(r.islandId)!;
    expect(island.settlers.every((s) => s.task.kind !== "idle")).toBe(true);
    const gathered = new Set(
      island.settlers
        .filter((s) => s.task.kind === "gather")
        .map((s) => (s.task as { resource: string }).resource),
    );
    // with food secure, hands split across the raw materials
    expect(gathered.has("wood")).toBe(true);
    expect(gathered.has("stone")).toBe(true);
  });

  it("hunger pulls a third of the island onto food before anything else", () => {
    const w = World.create({ seed: 17, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 0 } });
    w.tick(2);
    const foodCrew = w
      .island(r.islandId)!
      .settlers.filter(
        (s) => s.task.kind === "gather" && s.task.resource === "food",
      );
    expect(foodCrew.length).toBe(4); // ceil(10 / 3)
  });

  it("settlers raise the buildings the town plainly needs, without orders", () => {
    const w = World.create({ seed: 17, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 1000, wood: 500, stone: 500 } });
    w.tick(FAST.daySeconds + 2);
    const island = w.island(r.islandId)!;
    // ten settlers and no beds: the first judgment call is housing
    expect(
      island.buildings.some((b) => (buildingSpec(b.type)?.houses ?? 0) > 0),
    ).toBe(true);

    w.tick(FAST.daySeconds * 6);
    // day after day the town keeps growing — never a single lonely building
    expect(w.island(r.islandId)!.buildings.length).toBeGreaterThanOrEqual(3);
  });

  it("never starts more sites than the crews can staff", () => {
    const w = World.create({ seed: 17, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 1000, wood: 9999, stone: 9999 } });
    for (let t = 0; t < 50; t++) {
      w.tick(1);
      const island = w.island(r.islandId)!;
      const sites = island.buildings.filter((b) => b.stage !== "complete").length;
      // one site per two full crews of settlers, never more than three
      const cap = Math.max(1, Math.min(3, Math.floor(island.settlers.length / 6)));
      expect(sites).toBeLessThanOrEqual(cap);
    }
  });

  it("never builds the pantry empty — two days of meals stay untouched", () => {
    const w = World.create({ seed: 17, balance: FAST });
    const r = w.join({ civ: "roman" });
    // rich in timber, but the larder is nearly bare and no wild food remains
    w.debugGrant(r.islandId, {
      stocks: { food: 5, wood: 500, stone: 500 },
      clearFoodSources: true,
    });
    w.tick(FAST.daySeconds * 2);
    expect(w.island(r.islandId)!.buildings).toHaveLength(0);
  });

  it("the ruler's orders still override the settlers' own tasking", () => {
    const w = World.create({ seed: 17, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 1000 } });
    w.tick(3); // settlers have already tasked themselves
    const [outcome] = w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "stone", count: 8 },
    ]);
    expect(outcome!.ok).toBe(true);
    const onStone = w
      .island(r.islandId)!
      .settlers.filter(
        (s) => s.task.kind === "gather" && s.task.resource === "stone",
      );
    expect(onStone.length).toBeGreaterThanOrEqual(8);
  });
});
