import { describe, expect, it } from "vitest";
import type { IslandSummary } from "./net";
import {
  AMBIENT_CAPS,
  detectSkirmishes,
  planFishing,
  planSeaLanes,
  SKIRMISH_RANGE,
  walkerBudget,
  walkerPose,
  walkerTrack,
} from "./ambientLife";

function isle(over: Partial<IslandSummary>): IslandSummary {
  return {
    id: "island-1",
    name: "Test",
    civ: "roman",
    age: "bronze",
    kind: "home",
    seed: 1,
    size: 166,
    position: { x: 0, y: 0 },
    ruins: false,
    dormant: false,
    lastPulseAt: 0,
    lastPulseSeq: 0,
    population: 10,
    buildings: [],
    boats: [],
    time: 0,
    ...over,
  } as IslandSummary;
}

function town(id: string, x: number, y: number, over: Partial<IslandSummary> = {}) {
  return isle({
    id,
    position: { x, y },
    buildings: [
      { id: `${id}-b1`, type: "hut", stage: "complete", progress: 1, pos: { x: 80, y: 80 } },
      { id: `${id}-b2`, type: "farm", stage: "complete", progress: 1, pos: { x: 90, y: 84 } },
      { id: `${id}-b3`, type: "dock", stage: "complete", progress: 1, pos: { x: 60, y: 100 } },
    ],
    ...over,
  });
}

describe("sea lanes", () => {
  it("settled seafaring neighbours get a lane; wild and stone-age islands do not", () => {
    const lanes = planSeaLanes([
      town("a", 0, 0),
      town("b", 260, 0),
      town("c", 0, 260, { age: "stone" }),
      town("d", 260, 260, { kind: "wild", population: 0 }),
    ]);
    expect(lanes.length).toBe(1);
    expect(lanes[0]!.id).toBe("a~b");
    expect(lanes[0]!.boats).toBeGreaterThanOrEqual(1);
  });

  it("later ages put more sails on the water, capped world-wide", () => {
    const old = planSeaLanes([town("a", 0, 0), town("b", 260, 0)]);
    const grand = planSeaLanes([
      town("a", 0, 0, { age: "future" }),
      town("b", 260, 0, { age: "future" }),
    ]);
    expect(grand[0]!.boats).toBeGreaterThan(old[0]!.boats);
    // a crowded late-age ocean never exceeds the ambient budget
    const many = planSeaLanes(
      Array.from({ length: 40 }, (_, i) =>
        town(`i${i}`, (i % 8) * 300, Math.floor(i / 8) * 300, { age: "future" }),
      ),
    );
    const total = many.reduce((sum, lane) => sum + lane.boats, 0);
    expect(total).toBeLessThanOrEqual(AMBIENT_CAPS.tradeBoats);
  });

  it("fishing skiffs are capped world-wide too", () => {
    const spots = planFishing(
      Array.from({ length: 30 }, (_, i) => town(`i${i}`, i * 300, 0, { age: "iron" })),
    );
    const total = spots.reduce((sum, spot) => sum + spot.skiffs, 0);
    expect(total).toBeLessThanOrEqual(AMBIENT_CAPS.fishingBoats);
  });
});

describe("walkers", () => {
  it("budget scales with people, buildings, and age, and respects the cap", () => {
    const small = walkerBudget(town("a", 0, 0, { population: 3, age: "stone" }));
    const big = walkerBudget(
      town("a", 0, 0, {
        population: 60,
        age: "future",
        buildings: Array.from({ length: 30 }, (_, i) => ({
          id: `b${i}`,
          type: "hut",
          stage: "complete" as const,
          progress: 1,
          pos: { x: 50 + i, y: 50 },
        })),
      }),
    );
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(AMBIENT_CAPS.walkersPerIsland);
  });

  it("empty, dormant, ruined, and unbuilt islands stay still", () => {
    expect(walkerBudget(town("a", 0, 0, { population: 0 }))).toBe(0);
    expect(walkerBudget(town("a", 0, 0, { dormant: true }))).toBe(0);
    expect(walkerBudget(town("a", 0, 0, { ruins: true }))).toBe(0);
    expect(walkerBudget(isle({ buildings: [] }))).toBe(0);
  });

  it("a walker's position is a pure function of world time — no reseeding, ever", () => {
    const places = [
      { x: 80, y: 80 },
      { x: 90, y: 84 },
      { x: 60, y: 100 },
    ];
    const a = walkerTrack("island-1|walker|0", places)!;
    const b = walkerTrack("island-1|walker|0", places)!;
    // identical seeds build identical tracks…
    expect(a).toEqual(b);
    // …and any evaluation order gives the same answer at the same instant
    const t1 = walkerPose(a, 1234.5);
    walkerPose(a, 99999);
    walkerPose(a, 3);
    const t2 = walkerPose(a, 1234.5);
    expect(t2).toEqual(t1);
    // over a stroll the walker actually moves
    const later = walkerPose(a, 1234.5 + a.totalSeconds / 2);
    expect(Math.hypot(later.x - t1.x, later.y - t1.y)).toBeGreaterThan(0.01);
  });
});

describe("skirmishes", () => {
  it("an attack boat near its target lights a clash at the defender's shore", () => {
    const attacker = town("a", 0, 0, {
      civ: "norse",
      boats: [
        {
          id: "a-boat",
          pos: { x: 500 - SKIRMISH_RANGE + 4, y: 0 },
          state: "sailing",
          dest: "b",
          intent: "attack",
        },
      ],
    });
    const defender = town("b", 500, 0, { civ: "roman", kind: "colony" });
    const hits = detectSkirmishes([attacker, defender]);
    expect(hits.length).toBe(1);
    expect(hits[0]!.islandId).toBe("b");
    expect(hits[0]!.attackerCiv).toBe("norse");
    expect(hits[0]!.defenderCiv).toBe("roman");
    // the clash burns on the water just off the shore, not at the island's heart
    const d = Math.hypot(hits[0]!.at.x - 500, hits[0]!.at.y - 0);
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(120);
  });

  it("peaceful traffic and distant raiders stage nothing", () => {
    const trader = town("a", 0, 0, {
      boats: [
        { id: "t", pos: { x: 250, y: 0 }, state: "sailing", dest: "b", intent: "trade" },
        { id: "far", pos: { x: 100, y: 0 }, state: "sailing", dest: "b", intent: "attack" },
      ],
    });
    const defender = town("b", 500, 0, { kind: "colony" });
    expect(detectSkirmishes([trader, defender]).length).toBe(0);
  });

  it("a raid band outbound within range counts like a hostile boat", () => {
    const attacker = town("a", 0, 0, {
      civ: "aztec",
      creationBands: [
        {
          id: "band",
          specId: "spec",
          pos: { x: 480, y: 0 },
          state: "outbound",
          units: 4,
          dest: "b",
          intent: "raid",
        },
      ],
    });
    const defender = town("b", 500, 0, { civ: "greek", kind: "colony" });
    const hits = detectSkirmishes([attacker, defender]);
    expect(hits.length).toBe(1);
    expect(hits[0]!.attackerCiv).toBe("aztec");
  });
});
