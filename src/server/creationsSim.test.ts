import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CREATION_LIMITS } from "../shared/creations";
import { parseOrders } from "../shared/orders";
import { CREATION_MODEL_EXAMPLE } from "../shared/rules";
import type { CreationInput, Order } from "../shared/types";
import { FileStore, Persistence } from "./persistence";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

function ninja(over: Partial<CreationInput> = {}): CreationInput {
  return {
    name: "Moon Ninjas",
    description: "silent blades of the night",
    model: CREATION_MODEL_EXAMPLE,
    stats: { power: 7, speed: 5, resilience: 3 },
    verbs: ["raid", "patrol"],
    count: 4,
    ...over,
  };
}

const create = (over: Partial<CreationInput> = {}): Order => ({
  kind: "create",
  creation: ninja(over),
});

describe("creations in the world", () => {
  it("a create order pays resources and puts living units on the island", () => {
    const w = World.create({ seed: 7, balance: FAST });
    const a = w.join({ civ: "japanese" });
    w.debugGrant(a.islandId, { stocks: { food: 5000, wood: 5000 } });
    const foodBefore = w.island(a.islandId)!.stocks.food!;

    const [out] = w.applyOrders(a.secret, [create()]);
    expect(out!.ok).toBe(true);
    const island = w.island(a.islandId)!;
    expect(island.creationSpecs).toHaveLength(1);
    expect(island.creations).toHaveLength(4);
    // 4 units × food 4×15 = 240
    expect(island.stocks.food).toBe(foodBefore - 240);
    expect(island.stocks.wood).toBe(5000 - 120);
    // the birth of a design is a world moment carrying its (sanitized) name
    const events = w.tick(1);
    expect(events.some((e) => e.type === "creation-born" && e.text.includes("Moon Ninjas"))).toBe(true);
  });

  it("refuses creation beyond the caps: designs, units, creates per day", () => {
    const w = World.create({ seed: 7, balance: { ...FAST, daySeconds: 100000 } });
    const a = w.join({ civ: "japanese" });
    w.debugGrant(a.islandId, { stocks: { food: 1e6, wood: 1e6 } });

    // per-day cap
    for (let i = 0; i < CREATION_LIMITS.maxCreatesPerDay; i++) {
      const [out] = w.applyOrders(a.secret, [create({ name: `Design ${i}`, count: 1 })]);
      expect(out!.ok).toBe(true);
    }
    const [overDay] = w.applyOrders(a.secret, [create({ name: "One Too Many", count: 1 })]);
    expect(overDay!.ok).toBe(false);
    expect(overDay!.reason).toContain("workshop");
  });

  it("refuses more designs than the cap and more units than the island sustains", () => {
    // a fast day so the per-day cap resets while we fill the other caps
    const w = World.create({ seed: 7, balance: FAST });
    const a = w.join({ civ: "japanese" });
    w.debugGrant(a.islandId, { stocks: { food: 1e6, wood: 1e6 } });
    let made = 0;
    for (let i = 0; i < CREATION_LIMITS.maxSpecsPerIsland; i++) {
      const [out] = w.applyOrders(a.secret, [create({ name: `Corps ${i}`, count: 2 })]);
      expect(out!.ok).toBe(true);
      made += 2;
      w.tick(10); // next in-game day — the daily counter resets
    }
    const [overSpecs] = w.applyOrders(a.secret, [create({ name: "The Ninth", count: 1 })]);
    expect(overSpecs!.ok).toBe(false);
    expect(overSpecs!.reason).toContain("designs");

    // reinforce an existing design up to the island-wide unit cap
    while (made + 6 <= CREATION_LIMITS.maxUnitsPerIsland) {
      const [out] = w.applyOrders(a.secret, [create({ name: "Corps 0", count: 6 })]);
      expect(out!.ok).toBe(true);
      made += 6;
      w.tick(10);
    }
    const [overUnits] = w.applyOrders(a.secret, [
      create({ name: "Corps 1", count: 6 }),
    ]);
    expect(overUnits!.ok).toBe(false);
    expect(overUnits!.reason).toContain("sustains");
  });

  it("refuses a create the island cannot pay for", () => {
    const w = World.create({ seed: 7, balance: FAST });
    const a = w.join({ civ: "japanese" });
    const [out] = w.applyOrders(a.secret, [create()]);
    expect(out!.ok).toBe(false);
    expect(out!.reason).toBe("not enough resources");
  });

  it("reinforcing a design pays for ITS stats — resubmitted stats cannot cheapen it", () => {
    const w = World.create({ seed: 7, balance: FAST });
    const a = w.join({ civ: "japanese" });
    w.debugGrant(a.islandId, { stocks: { food: 5000, wood: 5000 } });
    w.applyOrders(a.secret, [create({ count: 1 })]); // 15-point design
    const foodAfterFirst = w.island(a.islandId)!.stocks.food!;
    // same name, minimal stats — must still cost the original 15-point price
    const [out] = w.applyOrders(a.secret, [
      create({ count: 1, stats: { power: 1, speed: 1, resilience: 1 } }),
    ]);
    expect(out!.ok).toBe(true);
    const island = w.island(a.islandId)!;
    expect(island.creationSpecs).toHaveLength(1);
    expect(island.stocks.food).toBe(foodAfterFirst - 60); // 4×15, not 4×3
  });

  it("gathering creations harvest tirelessly by their power", () => {
    const w = World.create({ seed: 7, balance: FAST });
    const a = w.join({ civ: "japanese" });
    w.debugGrant(a.islandId, { stocks: { food: 5000, wood: 5000 } });
    const [out] = w.applyOrders(a.secret, [
      create({
        name: "Timber Golems",
        verbs: ["gather", "guard"],
        gathers: "wood",
        stats: { power: 10, speed: 1, resilience: 4 },
        count: 2,
      }),
    ]);
    expect(out!.ok).toBe(true);
    const before = w.island(a.islandId)!.stocks.wood ?? 0;
    w.tick(20);
    // two golems × 0.05×10 = 1/s, minus whatever settlers also do — strictly more wood
    expect(w.island(a.islandId)!.stocks.wood ?? 0).toBeGreaterThan(before);
  });

  it("dispatch raids a rival colony and conquest follows the one law", () => {
    // a wild island rises through the world's own clockwork; the defender
    // colonizes it lawfully, and only then is there anything to raid
    const w2 = World.create({ seed: 8, balance: { ...FAST, wildSpawnIntervalSeconds: 5 } });
    const atk = w2.join({ civ: "mongol" });
    const dfd = w2.join({ civ: "greek" });
    w2.debugGrant(atk.islandId, { age: "bronze", stocks: { food: 1e5, wood: 1e5 } });
    w2.debugGrant(dfd.islandId, { age: "bronze", addBoat: true, stocks: { food: 1e5, wood: 1e5 } });
    w2.tick(6); // a wild island rises
    const wildIsle = w2.islands().find((i) => i.kind === "wild")!;
    expect(wildIsle).toBeTruthy();
    const [colonize] = w2.applyOrders(dfd.secret, [
      { kind: "voyage", dest: wildIsle.id, intent: "colonize" },
    ]);
    expect(colonize!.ok).toBe(true);
    for (let t = 0; t < 600 && w2.island(wildIsle.id)!.kind !== "colony"; t++) w2.tick(1);
    expect(w2.island(wildIsle.id)!.kind).toBe("colony");
    expect(w2.island(wildIsle.id)!.ownerId).toBe(dfd.islandId);

    // home islands stay sacred to creations too
    const [strike] = w2.applyOrders(atk.secret, [create({ count: 6, stats: { power: 10, speed: 4, resilience: 1 } })]);
    expect(strike!.ok).toBe(true);
    const [sacred] = w2.applyOrders(atk.secret, [
      { kind: "dispatch", creation: "Moon Ninjas", dest: dfd.islandId },
    ]);
    expect(sacred!.ok).toBe(false);
    expect(sacred!.reason).toContain("sacred");

    // a raid on the colony: 6 ninjas × power 10 = 60 beats a 3-settler garrison
    const [raid] = w2.applyOrders(atk.secret, [
      { kind: "dispatch", creation: "Moon Ninjas", dest: wildIsle.id },
    ]);
    expect(raid!.ok).toBe(true);
    expect(w2.island(atk.islandId)!.creations).toHaveLength(0);
    expect(w2.island(atk.islandId)!.creationBands).toHaveLength(1);
    let conquered = false;
    for (let t = 0; t < 900; t++) {
      const events = w2.tick(1);
      if (events.some((e) => e.type === "conquest")) conquered = true;
      if (conquered) break;
    }
    expect(conquered).toBe(true);
    const colony = w2.island(wildIsle.id)!;
    expect(colony.ownerId).toBe(atk.islandId);
    // the raiders now garrison their prize
    expect(colony.creations!.length).toBe(6);
  });

  it("a design without the raid verb may garrison but never attack", () => {
    const w = World.create({ seed: 9, balance: { ...FAST, wildSpawnIntervalSeconds: 5 } });
    const a = w.join({ civ: "roman" });
    const b = w.join({ civ: "greek" });
    w.debugGrant(a.islandId, { age: "bronze", addBoat: true, stocks: { food: 1e5, wood: 1e5 } });
    w.debugGrant(b.islandId, { age: "bronze", addBoat: true, stocks: { food: 1e5, wood: 1e5 } });
    w.tick(6);
    const wildIsle = w.islands().find((i) => i.kind === "wild")!;
    const [colonize] = w.applyOrders(b.secret, [
      { kind: "voyage", dest: wildIsle.id, intent: "colonize" },
    ]);
    expect(colonize!.ok).toBe(true);
    for (let t = 0; t < 600 && w.island(wildIsle.id)!.kind !== "colony"; t++) w.tick(1);

    w.applyOrders(a.secret, [
      create({ name: "Peace Dancers", verbs: ["perform"], count: 2 }),
    ]);
    const [noRaid] = w.applyOrders(a.secret, [
      { kind: "dispatch", creation: "Peace Dancers", dest: wildIsle.id },
    ]);
    expect(noRaid!.ok).toBe(false);
    expect(noRaid!.reason).toContain("raid");
  });

  it("disband releases home units and retires an unreferenced design", () => {
    const w = World.create({ seed: 7, balance: FAST });
    const a = w.join({ civ: "japanese" });
    w.debugGrant(a.islandId, { stocks: { food: 5000, wood: 5000 } });
    w.applyOrders(a.secret, [create()]);
    const [out] = w.applyOrders(a.secret, [{ kind: "disband", creation: "Moon Ninjas" }]);
    expect(out!.ok).toBe(true);
    const island = w.island(a.islandId)!;
    expect(island.creations).toHaveLength(0);
    expect(island.creationSpecs).toHaveLength(0);
  });

  it("orders with creations replay to an identical world (durable-log round trip)", async () => {
    mkdirSync("data", { recursive: true });
    const dir = mkdtempSync(join("data", "test-creations-"));
    try {
      const p = await Persistence.open(new FileStore(dir));
      const w = World.create({ seed: 55, balance: FAST });
      await p.record({
        type: "create",
        at: 0,
        seed: 55,
        balance: FAST,
        catastropheEpoch: 0,
      });
      await p.record({ type: "join", at: 0, civ: "japanese", secret: "s1" });
      w.join({ civ: "japanese", secret: "s1" });
      await p.record({
        type: "grant",
        at: 0,
        islandId: "island-1",
        grant: { stocks: { food: 5000, wood: 5000 } },
      });
      w.debugGrant("island-1", { stocks: { food: 5000, wood: 5000 } });
      const orders = parseOrders([create(), { kind: "disband", creation: "Moon Ninjas" }]);
      await p.record({ type: "orders", at: 0, secret: "s1", orders });
      w.applyOrders("s1", orders);
      w.tick(25);

      const restored = (await (await Persistence.open(new FileStore(dir))).restore())!;
      restored.tick(w.time - restored.time);
      expect(restored.serialize()).toBe(w.serialize());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a world snapshot with creations round-trips, and an old snapshot without them still loads", () => {
    const w = World.create({ seed: 7, balance: FAST });
    const a = w.join({ civ: "japanese" });
    w.debugGrant(a.islandId, { stocks: { food: 5000, wood: 5000 } });
    w.applyOrders(a.secret, [create()]);
    w.tick(5);
    const again = World.deserialize(w.serialize());
    expect(again.serialize()).toBe(w.serialize());
    expect(again.island(a.islandId)!.creations).toHaveLength(4);

    // a snapshot from before creations existed: strip the fields entirely
    const legacy = JSON.parse(w.serialize()) as { islands: Record<string, unknown>[] };
    for (const island of legacy.islands) {
      delete island.creationSpecs;
      delete island.creations;
      delete island.creationBands;
      delete island.createsOnDay;
    }
    const old = World.deserialize(JSON.stringify(legacy));
    expect(old.island(a.islandId)!.creations ?? []).toHaveLength(0);
    // and the old world keeps simulating without a stumble
    expect(() => old.tick(10)).not.toThrow();
  });
});
