import { describe, expect, it } from "vitest";
import { World } from "./world";

/** Fast clock, regen off: these tests measure the works, not the land. */
const FAST = {
  daySeconds: 10,
  daylightShare: 1,
  nodeRegenOrganicShare: 0,
  nodeRegenMineralShare: 0,
};

describe("production buildings — the works that outlive the wild veins", () => {
  it("a completed mine yields its resource at each dawn", () => {
    const w = World.create({ seed: 61, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, {
      age: "iron",
      stocks: { food: 1_000 },
      addBuilding: { type: "iron-mine", stage: "complete" },
    });
    const island = w.island(r.islandId)!;
    const before = island.stocks.iron ?? 0;
    w.tick(FAST.daySeconds);
    expect(island.stocks.iron).toBeCloseTo(before + 6);
    w.tick(FAST.daySeconds);
    expect(island.stocks.iron).toBeCloseTo(before + 12);
  });

  it("an unfinished producer yields nothing", () => {
    const w = World.create({ seed: 62, balance: FAST });
    const r = w.join({ civ: "greek" });
    w.debugGrant(r.islandId, {
      stocks: { food: 1_000 },
      addBuilding: { type: "quarry", stage: "site" },
    });
    const island = w.island(r.islandId)!;
    const before = island.stocks.stone ?? 0;
    const crewless = island.settlers.length === 0; // never — but freeze builds anyway
    for (const s of island.settlers) s.task = { kind: "sail", boatId: "none" };
    w.tick(FAST.daySeconds);
    expect(crewless).toBe(false);
    const quarry = island.buildings.find((b) => b.type === "quarry")!;
    expect(quarry.stage).not.toBe("complete");
    expect(island.stocks.stone ?? 0).toBeCloseTo(before);
  });

  it("settlers demand a producer only when the ground runs thin", () => {
    const w = World.create({ seed: 63, balance: FAST });
    const r = w.join({ civ: "japanese" });
    // a virgin island gathers; it does not pave itself with works
    expect(w.buildingNeed(r.islandId, "lumber-camp")).toBeUndefined();
    const island = w.island(r.islandId)!;
    for (const n of island.nodes) if (n.resource === "wood") n.remaining = 0;
    expect(w.buildingNeed(r.islandId, "lumber-camp")).toContain("wood production");
    // and one planned camp answers the scarcity — no duplicate works
    island.buildings.push({
      id: "camp-1",
      type: "lumber-camp",
      stage: "site",
      progress: 0,
      pos: { x: 30, y: 30 },
    });
    expect(w.buildingNeed(r.islandId, "lumber-camp")).toBeUndefined();
  });

  it("idle hands tend the works before the parks, two to a post", () => {
    const w = World.create({ seed: 64, balance: FAST });
    const r = w.join({ civ: "roman" });
    const island = w.island(r.islandId)!;
    island.stocks.food = 100_000;
    for (const n of island.nodes) n.remaining = 0;
    w.debugGrant(r.islandId, { addBuilding: { type: "hut", stage: "complete" } });
    w.debugGrant(r.islandId, {
      age: "bronze",
      addBuilding: { type: "farm", stage: "complete" },
    });
    w.tick(2);
    const tending = island.settlers.filter((s) => s.task.kind === "work");
    expect(tending.length).toBeGreaterThan(0);
    expect(tending.length).toBeLessThanOrEqual(2);
    expect(island.settlers.some((s) => s.task.kind === "idle")).toBe(false);
  });

  it("a construction site drafts its crew from the works-tenders", () => {
    const w = World.create({ seed: 65, balance: FAST });
    const r = w.join({ civ: "roman" });
    const island = w.island(r.islandId)!;
    island.stocks.food = 100_000;
    for (const n of island.nodes) n.remaining = 0;
    w.debugGrant(r.islandId, {
      age: "bronze",
      addBuilding: { type: "farm", stage: "complete" },
    });
    w.tick(2); // hands settle at the farm
    island.buildings.push({
      id: "b-site",
      type: "hut",
      stage: "site",
      progress: 0,
      pos: { x: 30, y: 30 },
    });
    w.tick(1);
    expect(island.settlers.filter((s) => s.task.kind === "build")).toHaveLength(3);
  });
});
