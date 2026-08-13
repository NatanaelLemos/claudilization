import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../shared/balance";
import { FOOD_SOURCE_CAPACITY, NODE_CAPACITY, nodeCapacity } from "../shared/terrain";
import { World } from "./world";

/** Fast clock: 10-second in-game days, endless daylight. */
const FAST = { daySeconds: 10, daylightShare: 1 };

function bareIsland(seed: number) {
  const w = World.create({ seed, balance: FAST });
  const r = w.join({ civ: "roman" });
  const island = w.island(r.islandId)!;
  island.stocks.food = 100_000; // nobody needs to gather while we measure
  for (const n of island.nodes) n.remaining = 0;
  return { w, island };
}

describe("the land breathes back", () => {
  it("regrows wilds fast and ores slowly at each dawn — dry never means dead", () => {
    const { w, island } = bareIsland(51);
    w.tick(FAST.daySeconds); // exactly one dawn

    const wood = island.nodes.find((n) => n.resource === "wood")!;
    expect(wood.remaining).toBeCloseTo(
      NODE_CAPACITY.wood * DEFAULT_BALANCE.nodeRegenOrganicShare,
    );
    const fish = island.nodes.find((n) => n.resource === "food" && n.source === "fish")!;
    expect(fish.remaining).toBeCloseTo(
      FOOD_SOURCE_CAPACITY.fish * DEFAULT_BALANCE.nodeRegenOrganicShare,
    );
    const iron = island.nodes.find((n) => n.resource === "iron")!;
    expect(iron.remaining).toBeCloseTo(
      NODE_CAPACITY.iron * DEFAULT_BALANCE.nodeRegenMineralShare,
    );
  });

  it("never grows a node past its capacity", () => {
    const { w, island } = bareIsland(52);
    // hold every hand at sea so nobody chops what we are measuring
    for (const s of island.settlers) s.task = { kind: "sail", boatId: "none" };
    const wood = island.nodes.find((n) => n.resource === "wood")!;
    wood.remaining = nodeCapacity(wood) - 1;
    w.tick(FAST.daySeconds);
    expect(wood.remaining).toBe(nodeCapacity(wood));
    w.tick(FAST.daySeconds);
    expect(wood.remaining).toBe(nodeCapacity(wood));
  });

  it("heals wild islands too — empty shores are never inherited bare", () => {
    const w = World.create({ seed: 53, balance: { ...FAST, wildSpawnIntervalSeconds: 1 } });
    w.join({ civ: "norse" });
    w.tick(2);
    const wild = w.islands().find((i) => i.kind === "wild")!;
    for (const n of wild.nodes) n.remaining = 0;
    w.tick(FAST.daySeconds);
    const woodBack = wild.nodes
      .filter((n) => n.resource === "wood")
      .every((n) => n.remaining > 0);
    expect(woodBack).toBe(true);
  });

  it("lets the day's reckoning read dawn's true state before the land recovers", () => {
    // the exodus/urgent-harbor laws judge the land as the day found it; the
    // regrowth lands after the towns have decided, never a step before
    const { w, island } = bareIsland(54);
    w.tick(FAST.daySeconds - 1);
    expect(island.nodes.every((n) => n.remaining === 0)).toBe(true);
    w.tick(1);
    expect(island.nodes.some((n) => n.remaining > 0)).toBe(true);
  });
});
