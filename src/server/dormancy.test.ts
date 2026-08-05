import { describe, expect, it } from "vitest";
import { World } from "./world";

// 36 real seconds of silence ⇒ dormant. daySeconds is long so no meal
// boundary lands while the island is still active — dormancy must then
// keep it frozen straight through the boundary that follows.
const SLEEPY = { daySeconds: 1000, dormancyHours: 0.01, daylightShare: 1 };

describe("dormancy — an untended island sleeps, it never rots", () => {
  it("goes dormant after the threshold, freezing stocks and lives across day boundaries", () => {
    const w = World.create({ seed: 13, balance: SLEEPY });
    const r = w.join({ civ: "japanese" });
    w.debugGrant(r.islandId, { stocks: { food: 5 }, clearFoodSources: true });

    for (let t = 0; t < 40; t++) w.tick(1);
    expect(w.island(r.islandId)!.dormant).toBe(true);

    // sleep straight through what would have been a meal boundary at t=1000
    for (let t = 0; t < 1100; t++) w.tick(1);
    const later = w.island(r.islandId)!;
    expect(later.stocks.food).toBe(5);
    expect(later.settlers).toHaveLength(10);
  });

  it("makes no age progress while dormant", () => {
    const w = World.create({ seed: 13, balance: SLEEPY });
    const r = w.join({ civ: "japanese" });
    for (let t = 0; t < 40; t++) w.tick(1);
    const points = w.island(r.islandId)!.workPoints;
    for (let t = 0; t < 100; t++) w.tick(1);
    expect(w.island(r.islandId)!.workPoints).toBe(points);
  });

  it("the next pulse wakes it", () => {
    const w = World.create({ seed: 13, balance: SLEEPY });
    const r = w.join({ civ: "japanese" });
    for (let t = 0; t < 40; t++) w.tick(1);
    expect(w.island(r.islandId)!.dormant).toBe(true);
    w.pulse(r.secret, 1000);
    expect(w.island(r.islandId)!.dormant).toBe(false);
  });
});
