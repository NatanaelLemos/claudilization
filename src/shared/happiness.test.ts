import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "./balance";
import { computeHappiness } from "./happiness";
import type { Building, Island, Settler } from "./types";

function isle(overrides: Partial<Island> = {}): Island {
  return {
    id: "island-1",
    name: "Testholm",
    civ: "japanese",
    seed: 1,
    age: "stone",
    kind: "home",
    position: { x: 0, y: 0 },
    settlers: [],
    buildings: [],
    boats: [],
    nodes: [],
    stocks: {},
    workPoints: 0,
    ruins: false,
    dormant: false,
    lastPulseAt: 0,
    lastPulseSeq: 0,
    dayClock: 0,
    ...overrides,
  };
}

function fed(name: string): Settler {
  return {
    id: `s-${name}`,
    name,
    adult: true,
    bornAt: 0,
    task: { kind: "idle" },
    pos: { x: 0, y: 0 },
    hungerDays: 0,
  };
}

function done(type: string, n = 0): Building {
  return { id: `b-${type}-${n}`, type, stage: "complete", progress: 0, pos: { x: 0, y: 0 } };
}

describe("the ladder of needs", () => {
  it("a stone-age band only asks for full bellies", () => {
    const island = isle({ settlers: [fed("A")], stocks: { food: 10 } });
    const mood = computeHappiness(island, DEFAULT_BALANCE);
    expect(mood.needs.map((n) => n.id)).toEqual(["fed"]);
    expect(mood.score).toBe(60);
  });

  it("hunger drags a stone-age band to the floor", () => {
    const hungry = { ...fed("A"), hungerDays: 2 };
    const island = isle({ settlers: [hungry], stocks: { food: 10 } });
    expect(computeHappiness(island, DEFAULT_BALANCE).score).toBe(0);
  });

  it("each age awakens one more need, up to nine in the future", () => {
    expect(computeHappiness(isle({ age: "bronze" }), DEFAULT_BALANCE).needs).toHaveLength(2);
    expect(computeHappiness(isle({ age: "industrial" }), DEFAULT_BALANCE).needs).toHaveLength(7);
    expect(computeHappiness(isle({ age: "future" }), DEFAULT_BALANCE).needs).toHaveLength(9);
  });

  it("an industrial city without electricity is an unhappy one", () => {
    const base = isle({
      age: "industrial",
      settlers: [fed("A")],
      stocks: { food: 100 },
      buildings: [
        done("hut"),
        done("campfire"),
        done("shrine"),
        done("watchtower"),
        done("library"),
        done("broadcast-tower"),
      ],
    });
    const dark = computeHappiness(base, DEFAULT_BALANCE);
    expect(dark.needs.find((n) => n.id === "powered")!.met).toBe(false);
    const lit = computeHappiness(
      { ...base, buildings: [...base.buildings, done("power-plant")] },
      DEFAULT_BALANCE,
    );
    expect(lit.needs.find((n) => n.id === "powered")!.met).toBe(true);
    expect(lit.score).toBeGreaterThan(dark.score);
  });

  it("leisure places add joy, capped so parks alone cannot buy paradise", () => {
    const island = isle({
      settlers: [fed("A")],
      stocks: { food: 10 },
      buildings: [0, 1, 2, 3, 4, 5, 6].map((n) => done("dancing-ground", n)),
    });
    const mood = computeHappiness(island, DEFAULT_BALANCE);
    expect(mood.leisure).toBe(20); // 7 × 3 joy, capped at 20
    expect(mood.score).toBe(80);
  });

  it("a wonder lifts the island like nothing else", () => {
    const island = isle({
      settlers: [fed("A")],
      stocks: { food: 10 },
      buildings: [done("great-torii")],
    });
    const mood = computeHappiness(island, DEFAULT_BALANCE);
    expect(mood.wonders).toBe(30);
    expect(mood.score).toBe(90);
  });
});
