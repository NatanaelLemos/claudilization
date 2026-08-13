import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../shared/balance";
import {
  CATASTROPHE_GAP_MULTIPLIERS,
  CATASTROPHE_IDS,
  selectCatastrophe,
  selectCatastropheGap,
  type CatastropheId,
} from "../shared/catastrophes";
import type { CreationUnit, GameEvent, Island } from "../shared/types";
import { SseSocket } from "./sse";
import { Hub } from "./ws";
import { World } from "./world";

const FAST = {
  catastropheIntervalSeconds: 20,
  catastropheWarningSeconds: 5,
  catastropheDurationSeconds: 2,
  dormancyHours: 0,
  wildSpawnIntervalSeconds: 0,
};

function seedFor(id: CatastropheId, scheduledAt = FAST.catastropheIntervalSeconds): number {
  for (let seed = 1; seed < 10_000; seed++) {
    if (selectCatastrophe(seed, 1, scheduledAt).id === id) return seed;
  }
  throw new Error(`no deterministic seed found for ${id}`);
}

function prepared(id: CatastropheId) {
  const w = World.create({ seed: seedFor(id), balance: FAST });
  const player = w.join({ civ: "roman" });
  const island = w.island(player.islandId)!;
  island.stocks = { food: 1000, wood: 500, stone: 250 };
  island.workPoints = 1000;
  return { w, island, player };
}

const starts = (events: GameEvent[]) => events.filter((event) => event.type === "catastrophe-start");

describe("global catastrophe scheduling", () => {
  it("uses an exact hourly production cadence and a five-minute warning", () => {
    expect(DEFAULT_BALANCE.catastropheIntervalSeconds).toBe(60 * 60);
    expect(DEFAULT_BALANCE.catastropheWarningSeconds).toBe(5 * 60);
  });

  it("starts the first event exactly one interval after the world's relevant epoch", () => {
    const w = World.create({ seed: 7, at: 123, balance: FAST });
    expect(w.catastrophe.nextAt).toBe(143);
    expect(starts(w.tick(19))).toHaveLength(0);
    expect(starts(w.tick(1))).toHaveLength(1);
    expect(w.catastrophe.active?.scheduledAt).toBe(143);
    const gap = selectCatastropheGap(7, 1, 143, FAST.catastropheIntervalSeconds);
    expect(w.catastrophe.nextAt).toBe(143 + gap);
    expect(w.catastrophe.intervalSeconds).toBe(gap);
  });

  it("warns once, starts once, ends once, and rolls the next strike from the boundary", () => {
    const w = World.create({ seed: 9, balance: FAST });
    expect(w.tick(14).filter((event) => event.type === "catastrophe-warning")).toHaveLength(0);
    expect(w.tick(1).filter((event) => event.type === "catastrophe-warning")).toHaveLength(1);
    expect(w.tick(4).filter((event) => event.type === "catastrophe-warning")).toHaveLength(0);
    expect(starts(w.tick(1))).toHaveLength(1);
    expect(starts(w.tick(1))).toHaveLength(0);
    expect(w.tick(1).filter((event) => event.type === "catastrophe-end")).toHaveLength(1);
    const gap = selectCatastropheGap(9, 1, 20, FAST.catastropheIntervalSeconds);
    expect(
      CATASTROPHE_GAP_MULTIPLIERS.map((m) => m * FAST.catastropheIntervalSeconds),
    ).toContain(gap);
    expect(w.catastrophe.nextAt).toBe(20 + gap);
    expect(starts(w.tick(w.catastrophe.nextAt - w.time - 1))).toHaveLength(0);
    expect(starts(w.tick(1))).toHaveLength(1);
  });

  it("rolls every gap from the sanctioned multipliers, deterministically", () => {
    const base = DEFAULT_BALANCE.catastropheIntervalSeconds;
    const seen = new Set<number>();
    let at = base;
    for (let sequence = 1; sequence <= 40; sequence++) {
      const gap = selectCatastropheGap(7, sequence, at, base);
      expect(gap).toBe(selectCatastropheGap(7, sequence, at, base));
      expect(CATASTROPHE_GAP_MULTIPLIERS.map((m) => m * base)).toContain(gap);
      seen.add(gap / base);
      at += gap;
    }
    expect(seen).toEqual(new Set(CATASTROPHE_GAP_MULTIPLIERS));
  });

  it("chooses deterministically and never repeats the previous type", () => {
    let previous: CatastropheId | undefined;
    const sequence: CatastropheId[] = [];
    for (let n = 1; n <= 24; n++) {
      const selected = selectCatastrophe(77, n, n * 20, previous).id;
      if (previous) expect(selected).not.toBe(previous);
      sequence.push(selected);
      previous = selected;
    }
    expect(new Set(sequence)).toEqual(new Set(CATASTROPHE_IDS));
    expect(sequence).toEqual(
      sequence.map((_, index) => {
        let last: CatastropheId | undefined;
        for (let n = 1; n <= index + 1; n++) last = selectCatastrophe(77, n, n * 20, last).id;
        return last!;
      }),
    );
  });

  it("persists schedule and active results without applying them twice after restart", () => {
    const { w, island } = prepared("earthquake");
    const events = w.tick(20);
    expect(starts(events)).toHaveLength(1);
    const foodAfter = island.stocks.food!;
    const saved = w.serialize();
    const restored = World.deserialize(saved);
    expect(restored.catastrophe).toEqual(w.catastrophe);
    restored.tick(1);
    expect(restored.islands()[0]!.stocks.food).toBe(foodAfter);
    expect(restored.catastrophe.active?.sequence).toBe(1);
  });

  it("rebases an unstamped 30-minute snapshot once, then preserves the hourly boundary", () => {
    const old = World.create({ seed: 7, at: 100, balance: FAST });
    const legacy = JSON.parse(old.serialize()) as {
      catastrophe: { nextAt: number; intervalSeconds?: number };
    };
    delete legacy.catastrophe.intervalSeconds;
    legacy.catastrophe.nextAt = 120;

    const upgraded = World.deserialize(JSON.stringify(legacy));
    expect(upgraded.catastrophe.nextAt).toBe(120);

    const production = World.create({ seed: 7, at: 100 });
    const productionLegacy = JSON.parse(production.serialize()) as {
      catastrophe: { nextAt: number; intervalSeconds?: number };
    };
    delete productionLegacy.catastrophe.intervalSeconds;
    productionLegacy.catastrophe.nextAt = 1900;
    const rebased = World.deserialize(JSON.stringify(productionLegacy));
    expect(rebased.catastrophe.nextAt).toBe(3700);
    expect(World.deserialize(rebased.serialize()).catastrophe.nextAt).toBe(3700);
  });

  it("holds a pre-feature save inert until one explicit upgrade epoch", () => {
    const current = World.create({ seed: 7, balance: FAST });
    const legacy = JSON.parse(current.serialize()) as { catastrophe?: unknown };
    delete legacy.catastrophe;
    const restored = World.deserialize(JSON.stringify(legacy));
    expect(restored.catastropheNeedsActivation).toBe(true);
    expect(starts(restored.tick(100))).toHaveLength(0);
    restored.activateCatastrophes(restored.time);
    expect(restored.catastropheNeedsActivation).toBe(false);
    expect(restored.catastrophe.nextAt).toBe(120);
    expect(starts(restored.tick(20))).toHaveLength(1);
  });

  it("fires once after long downtime, skips missed slots, and never avalanches", () => {
    const w = World.create({
      seed: 7,
      anchorMs: 0,
      at: 0,
      balance: { ...FAST, catastropheIntervalSeconds: 30 },
    });
    w.join({ civ: "greek" });
    const events = w.advanceToWallClock(3 * 60 * 60 * 1000);
    expect(starts(events)).toHaveLength(1);
    expect(w.catastrophe.nextAt).toBeGreaterThan(w.time);
    expect(w.tick(1).filter((event) => event.type === "catastrophe-start")).toHaveLength(0);
  });

  it("advances safely with no players and synchronizes an active event to late viewers", () => {
    const w = World.create({ seed: 7, balance: FAST });
    const event = starts(w.tick(20))[0]!;
    expect(event.text).toContain("No civilization was awake");
    expect(w.catastrophe.active?.impact.inhabitedIslands).toBe(0);

    const chunks: string[] = [];
    const socket = new SseSocket((chunk) => chunks.push(chunk));
    new Hub(w, w.law, new Map()).attachSocket(socket);
    const frame = JSON.parse(chunks[0]!.slice("data: ".length)) as {
      catastrophe: typeof w.catastrophe;
    };
    expect(frame.catastrophe.active?.sequence).toBe(1);
    expect(frame.catastrophe.nextAt).toBe(w.catastrophe.nextAt);
  });

  it("does not retroactively charge a player who joins during the aftermath", () => {
    const w = World.create({ seed: 7, balance: FAST });
    w.tick(20);
    const late = w.join({ civ: "norse" });
    const island = w.island(late.islandId)!;
    expect(w.catastrophe.active).toBeTruthy();
    expect(island.stocks.food).toBe(30);
    w.tick(w.catastrophe.nextAt - w.time);
    expect(island.stocks.food).toBeLessThan(30);
  });
});

function addBuildings(island: Island, types: string[]): void {
  types.forEach((type, index) =>
    island.buildings.push({
      id: `${island.id}-${type}-${index}`,
      type,
      stage: "complete",
      progress: 10_000,
      pos: { x: 20 + index * 12, y: 30 + index * 7 },
    }),
  );
}

describe("the four catastrophe laws", () => {
  it("earthquakes remove stores and work while damaging widespread non-wonder buildings", () => {
    const { w, island } = prepared("earthquake");
    addBuildings(island, ["hut", "granary", "toolmaker", "campfire", "saturn-stones"]);
    const nodesBefore = island.nodes.reduce((sum, node) => sum + node.remaining, 0);
    w.tick(20);
    expect(island.stocks.food).toBeCloseTo(880);
    expect(island.workPoints).toBeCloseTo(920);
    expect(island.buildings.filter((building) => building.stage === "construction")).toHaveLength(2);
    expect(island.buildings.find((building) => building.type === "saturn-stones")?.stage).toBe(
      "complete",
    );
    expect(island.nodes.reduce((sum, node) => sum + node.remaining, 0)).toBeCloseTo(nodesBefore);
  });

  it("volcanoes burn stores, deplete every map's reserves, and interrupt production", () => {
    const { w, island } = prepared("volcano");
    addBuildings(island, ["farm", "livestock-pen", "hut"]);
    const nodesBefore = island.nodes.reduce((sum, node) => sum + node.remaining, 0);
    w.tick(20);
    expect(island.stocks.food).toBeCloseTo(840);
    expect(island.nodes.reduce((sum, node) => sum + node.remaining, 0)).toBeCloseTo(
      nodesBefore * 0.88,
    );
    expect(
      island.buildings.filter((building) => building.stage === "construction"),
    ).toHaveLength(1);
  });

  it("tsunamis flood every treasury, damage the coast, and destroy docked ships", () => {
    const { w, island } = prepared("tsunami");
    addBuildings(island, ["dock", "fishing-hut", "hut"]);
    island.boats = [0, 1, 2].map((index) => ({
      id: `boat-${index}`,
      pos: { ...island.position },
      state: "docked" as const,
    }));
    w.tick(20);
    expect(island.stocks.food).toBeCloseTo(820);
    expect(island.buildings.filter((building) => building.stage === "construction")).toHaveLength(2);
    expect(island.boats).toHaveLength(1);
  });

  it("Godzilla carves a deterministic building path and thins large creation armies", () => {
    const { w, island } = prepared("godzilla");
    addBuildings(island, ["hut", "granary", "toolmaker", "campfire"]);
    island.creations = Array.from({ length: 10 }, (_, index): CreationUnit => ({
      id: `creation-${index}`,
      specId: "test-spec",
      pos: { x: 40 + index, y: 40 },
    }));
    w.tick(20);
    expect(island.stocks.food).toBeCloseTo(750);
    expect(island.workPoints).toBeCloseTo(800);
    expect(island.buildings.filter((building) => building.stage === "construction")).toHaveLength(2);
    expect(island.creations).toHaveLength(8);
  });

  it("hits every civilization, including dormant ones, without crossing any resource floor", () => {
    const seed = seedFor("earthquake");
    const w = World.create({ seed, balance: FAST });
    const players = [w.join({ civ: "roman" }), w.join({ civ: "aztec" })];
    for (const [index, player] of players.entries()) {
      const island = w.island(player.islandId)!;
      island.stocks = index ? { food: 0, wood: 0.01 } : { food: 100, wood: 50 };
      island.dormant = true;
    }
    w.tick(20);
    for (const player of players) {
      const island = w.island(player.islandId)!;
      for (const amount of Object.values(island.stocks)) {
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(amount)).toBe(true);
      }
    }
    expect(w.island(players[0]!.islandId)!.stocks.food).toBeCloseTo(88);
    expect(w.island(players[1]!.islandId)!.stocks.wood).toBeCloseTo(0.0088);
    expect(w.catastrophe.active?.impact.inhabitedIslands).toBe(2);
  });
});
