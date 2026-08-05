import { describe, expect, it } from "vitest";
import { dayPhase, isNight } from "../shared/daylight";
import { World } from "./world";

/**
 * The world has one sun. It used to have one per island — a counter that only
 * ticked while that island's owner was active, so islands drifted hours apart
 * and a viewer's sky changed with whatever they happened to be watching. The
 * clock is the world's now, and these tests hold it there.
 */

const LAW = { daySeconds: 100, daylightShare: 0.5 };
/** 18 real seconds of silence and an island sleeps. */
const SLEEPY = { ...LAW, dormancyHours: 0.005 };

describe("the world's clock is the only clock", () => {
  it("every island reads the same hour, whoever is watching", () => {
    const w = World.create({ seed: 3, balance: LAW });
    const a = w.join({ civ: "roman" });
    const b = w.join({ civ: "norse" });
    w.tick(37);
    const clocks = w.islands().map((i) => i.dayClock);
    expect(new Set(clocks).size).toBe(1);
    expect(clocks[0]).toBe(37);
  });

  it("an island that slept wakes into the world's hour, not a stale one", () => {
    const w = World.create({ seed: 3, balance: SLEEPY });
    const active = w.join({ civ: "roman" });
    const sleeper = w.join({ civ: "aztec" });
    // 18 real seconds of silence puts both to sleep; the active one keeps
    // pulsing, the other is left alone for a long while
    for (let t = 0; t < 60; t++) {
      w.pulse(active.secret, 10);
      w.tick(1);
    }
    expect(w.island(sleeper.islandId)!.dormant).toBe(true);

    // the sleeper's owner comes back: their island must not be an hour behind
    w.pulse(sleeper.secret, 10);
    w.tick(1);
    const woken = w.island(sleeper.islandId)!;
    expect(woken.dormant).toBe(false);
    expect(woken.dayClock).toBe(w.island(active.islandId)!.dayClock);
    expect(woken.dayClock).toBe(w.time % LAW.daySeconds);
  });

  it("night falls on the whole ocean at once, by world time", () => {
    const w = World.create({ seed: 3, balance: LAW });
    w.join({ civ: "greek" });
    w.tick(49);
    expect(isNight(w.time, LAW.daySeconds, LAW.daylightShare)).toBe(false);
    expect(w.islands().every((i) => i.dayClock < 50)).toBe(true);
    w.tick(1);
    expect(isNight(w.time, LAW.daySeconds, LAW.daylightShare)).toBe(true);
    expect(dayPhase(w.time, LAW.daySeconds)).toBeCloseTo(0.5);
  });

  it("day boundaries still land once a day, on the world's day", () => {
    const w = World.create({ seed: 3, balance: { ...LAW, daylightShare: 1 } });
    const r = w.join({ civ: "mongol" });
    // no harvest and nothing to forage, so the day's meal is the only movement
    w.debugGrant(r.islandId, { stocks: { food: 50 }, clearFoodSources: true });
    const island = w.island(r.islandId)!;
    w.tick(99);
    expect(island.stocks.food).toBe(50); // no meal before the boundary
    w.tick(1); // t = 100: the day turns and the town eats
    expect(island.stocks.food).toBeLessThan(50);
    expect(island.dayClock).toBe(0);
    const afterFirst = island.stocks.food ?? 0;
    w.tick(99);
    expect(island.stocks.food).toBe(afterFirst); // exactly one meal per day
  });

  it("an island born mid-day joins the world's day in progress", () => {
    const w = World.create({ seed: 3, balance: LAW });
    w.tick(30);
    const late = w.join({ civ: "egyptian" });
    expect(w.island(late.islandId)!.dayClock).toBe(30);
    w.tick(1);
    expect(w.island(late.islandId)!.dayClock).toBe(31);
  });

  it("a town landed at dusk keeps its stores until it has seen a full day", () => {
    const w = World.create({ seed: 3, balance: { ...LAW, daylightShare: 1 } });
    w.tick(90);
    const late = w.join({ civ: "egyptian" });
    w.debugGrant(late.islandId, { stocks: { food: 50 }, clearFoodSources: true });
    const island = w.island(late.islandId)!;
    w.tick(10); // the world's day turns ten seconds after they land
    expect(island.stocks.food).toBe(50); // spared their first dawn
    w.tick(100); // the next dawn, a full day ashore
    expect(island.stocks.food).toBeLessThan(50);
  });
});
