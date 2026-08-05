import { describe, expect, it } from "vitest";
import { World } from "./world";

/** Fast clock: 10-second in-game days. */
const FAST = { daySeconds: 10, tickSeconds: 1, daylightShare: 1 };

describe("the food invariant", () => {
  it("food below one day's need pulls at least one settler to food gathering within a day — even against orders", () => {
    const w = World.create({ seed: 3, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 1, wood: 0 } });
    w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "wood", count: 10 },
    ]);
    w.tick(10); // one in-game day
    const island = w.island(r.islandId)!;
    expect(
      island.settlers.some(
        (s) => s.task.kind === "gather" && s.task.resource === "food",
      ),
    ).toBe(true);
  });
});

describe("gathering crews fan out", () => {
  it("a big crew spreads across every open node of the resource instead of mobbing one", () => {
    const w = World.create({ seed: 3, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 1000 } });
    w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "wood", count: 10 },
    ]);
    const island = w.island(r.islandId)!;
    const woodNodes = island.nodes.filter(
      (n) => n.resource === "wood" && n.remaining > 0,
    ).length;
    const workedNodes = new Set(
      island.settlers
        .filter((s) => s.task.kind === "gather")
        .map((s) => (s.task as { nodeId: string }).nodeId),
    );
    expect(workedNodes.size).toBe(Math.min(10, woodNodes));
  });

  it("when a node runs dry, its gatherer moves to the least-crowded remaining node", () => {
    const w = World.create({ seed: 3, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { stocks: { food: 1000 } });
    const island = w.island(r.islandId)!;
    w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "wood", count: 2 },
    ]);
    const gatherer = island.settlers.find((s) => s.task.kind === "gather")!;
    const first = (gatherer.task as { nodeId: string }).nodeId;
    island.nodes.find((n) => n.id === first)!.remaining = 0;
    w.tick(2);
    const moved = (gatherer.task as { nodeId: string }).nodeId;
    expect(gatherer.task.kind).toBe("gather");
    expect(moved).not.toBe(first);
  });
});

describe("starvation", () => {
  it("a settler dies after exactly 3 consecutive food-less in-game days — named in the feed", () => {
    const w = World.create({ seed: 3, balance: FAST });
    const r = w.join({ civ: "norse" });
    w.debugGrant(r.islandId, { stocks: { food: 0 }, clearFoodSources: true });

    let deathEvents = [];
    for (let t = 0; t < 25; t++) deathEvents.push(...w.tick(1));
    // < 3 days: nobody dead yet
    expect(w.island(r.islandId)!.settlers).toHaveLength(10);

    for (let t = 0; t < 15; t++) deathEvents.push(...w.tick(1));
    // > 3 days without food: deaths have begun, called out by name
    const island = w.island(r.islandId)!;
    expect(island.settlers.length).toBeLessThan(10);
    const deaths = deathEvents.filter((e) => e.type === "death");
    expect(deaths.length).toBeGreaterThan(0);
    expect(deaths[0]!.settler).toBeTruthy();
    expect(deaths[0]!.text).toContain(deaths[0]!.settler!);
  });

  it("with food available, nobody dies", () => {
    const w = World.create({ seed: 3, balance: FAST });
    const r = w.join({ civ: "norse" });
    w.debugGrant(r.islandId, { stocks: { food: 1000 } });
    const events = [];
    for (let t = 0; t < 60; t++) events.push(...w.tick(1));
    // settlers may be born (they house themselves now) but none may die
    expect(events.filter((e) => e.type === "death")).toHaveLength(0);
    expect(w.island(r.islandId)!.settlers.length).toBeGreaterThanOrEqual(10);
  });
});

describe("reproduction", () => {
  const EAGER = { ...FAST, birthChancePerDay: 1, childGrowsDays: 2 };

  it("a completed house with two adults and food yields a named child", () => {
    const w = World.create({ seed: 5, balance: EAGER });
    const r = w.join({ civ: "greek" });
    w.debugGrant(r.islandId, {
      stocks: { food: 1000 },
      addBuilding: { type: "hut", stage: "complete" },
    });
    let events = [];
    for (let t = 0; t < 15; t++) events.push(...w.tick(1));
    const island = w.island(r.islandId)!;
    expect(island.settlers.length).toBeGreaterThan(10);
    const child = island.settlers.find((s) => !s.adult)!;
    expect(child).toBeDefined();
    expect(child.name).toBeTruthy();
    const births = events.filter((e) => e.type === "birth");
    expect(births.length).toBeGreaterThan(0);
    expect(births[0]!.text).toContain(births[0]!.settler!);
  });

  it("no completed house, no children — however much food", () => {
    const w = World.create({ seed: 5, balance: EAGER });
    const r = w.join({ civ: "greek" });
    w.debugGrant(r.islandId, { stocks: { food: 1000 } });
    // pin everyone to sea duty: with no gatherers there is no wood, and with
    // no wood the settlers' own judgment cannot raise housing either
    for (const s of w.island(r.islandId)!.settlers) s.task = { kind: "sail", boatId: "x" };
    for (let t = 0; t < 30; t++) w.tick(1);
    expect(w.island(r.islandId)!.settlers).toHaveLength(10);
  });

  it("children grow up", () => {
    const w = World.create({ seed: 5, balance: EAGER });
    const r = w.join({ civ: "greek" });
    w.debugGrant(r.islandId, {
      stocks: { food: 1000 },
      addBuilding: { type: "hut", stage: "complete" },
    });
    for (let t = 0; t < 12; t++) w.tick(1); // a child is born
    const childId = w.island(r.islandId)!.settlers.find((s) => !s.adult)?.id;
    expect(childId).toBeDefined();
    for (let t = 0; t < 25; t++) w.tick(1); // childGrowsDays pass
    const grown = w.island(r.islandId)!.settlers.find((s) => s.id === childId);
    expect(grown?.adult).toBe(true);
  });
});
