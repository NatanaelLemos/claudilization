import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOrders } from "../shared/orders";
import { FileStore, Persistence } from "./persistence";
import { World } from "./world";

/**
 * The unmaking law. A town that can only ever add is a town that can never fix
 * itself; demolish gives the ruler the power to pull down what no longer makes
 * sense — bounded by soil they own, refusing wonders, costing nothing, taking
 * no time, and surviving a restart like every other order.
 */

const FAST = { daySeconds: 30, boatSpeed: 40, wildSpawnIntervalSeconds: 5, daylightShare: 1 };

/** A player with stores and one named building standing. */
function townWith(w: World, type: string, civ: "roman" | "norse" | "greek" = "roman") {
  const r = w.join({ civ });
  w.debugGrant(r.islandId, {
    age: "bronze",
    stocks: { food: 5000, wood: 500, stone: 500 },
    addBuilding: { type, stage: "complete" },
  });
  const island = w.island(r.islandId)!;
  return { ...r, island, building: island.buildings.find((b) => b.type === type)! };
}

/** A bronze player with a docked boat, ready to sail. */
function seafarer(w: World, civ: "norse" | "roman" | "greek") {
  const r = w.join({ civ });
  w.debugGrant(r.islandId, {
    age: "bronze",
    addBoat: true,
    stocks: { food: 5000, wood: 200, stone: 200 },
  });
  return r;
}

/** Found a colony for `ruler` on the first wild island and return it. */
function colonyOf(w: World, ruler: { secret: string; islandId: string }) {
  w.tick(5);
  const wild = w.islands().find((i) => i.kind === "wild")!;
  w.applyOrders(ruler.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
  for (let t = 0; t < 600; t++) {
    w.tick(1);
    if (w.island(ruler.islandId)!.boats.every((b) => b.state === "docked")) break;
  }
  return w.island(wild.id)!;
}

describe("demolish — the town unmakes what makes no sense", () => {
  it("is part of the closed vocabulary, by id or by type, with an optional island", () => {
    expect(parseOrders([{ kind: "demolish", building: "island-1-b7" }])).toEqual([
      { kind: "demolish", building: "island-1-b7" },
    ]);
    expect(
      parseOrders([{ kind: "demolish", building: "shrine", island: "island-9" }]),
    ).toEqual([{ kind: "demolish", building: "shrine", island: "island-9" }]);
    expect(() => parseOrders([{ kind: "demolish" }])).toThrow();
    expect(() => parseOrders([{ kind: "demolish", building: "" }])).toThrow();
  });

  it("razes a building named by its id — instantly, and with no refund", () => {
    const w = World.create({ seed: 12 });
    const { secret, island, building } = townWith(w, "shrine");
    const stocks = JSON.stringify(island.stocks);

    const [outcome] = w.applyOrders(secret, [{ kind: "demolish", building: building.id }]);
    expect(outcome!.ok).toBe(true);
    expect(island.buildings.some((b) => b.id === building.id)).toBe(false);
    // no rubble stage, no timer: the ground is free the same instant
    expect(island.buildings.some((b) => b.stage !== "complete")).toBe(false);
    expect(JSON.stringify(island.stocks)).toBe(stocks);
  });

  it("razes by type when no id is given — the first of that type standing", () => {
    const w = World.create({ seed: 12 });
    const { secret, islandId } = townWith(w, "hut");
    w.debugGrant(islandId, { addBuilding: { type: "hut", stage: "complete" } });
    const island = w.island(islandId)!;
    const huts = island.buildings.filter((b) => b.type === "hut");
    expect(huts).toHaveLength(2);

    const [outcome] = w.applyOrders(secret, [{ kind: "demolish", building: "hut" }]);
    expect(outcome!.ok).toBe(true);
    expect(island.buildings.filter((b) => b.type === "hut")).toHaveLength(1);
    expect(island.buildings.some((b) => b.id === huts[0]!.id)).toBe(false);
    expect(island.buildings.some((b) => b.id === huts[1]!.id)).toBe(true);
  });

  it("refuses a wonder — a monument is not a ruler's to unmake", () => {
    const w = World.create({ seed: 12 });
    const { secret, island } = townWith(w, "bronze-she-wolf");
    const [outcome] = w.applyOrders(secret, [
      { kind: "demolish", building: "bronze-she-wolf" },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("wonder");
    expect(island.buildings.some((b) => b.type === "bronze-she-wolf")).toBe(true);
  });

  it("refuses a building that does not stand there", () => {
    const w = World.create({ seed: 12 });
    const { secret } = townWith(w, "shrine");
    const [outcome] = w.applyOrders(secret, [{ kind: "demolish", building: "granary" }]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("granary");
  });

  it("frees every settler whose task pointed at the razed building", () => {
    const w = World.create({ seed: 12 });
    const { secret, island, building } = townWith(w, "hut");
    const [builder, idler, resident] = island.settlers;
    builder!.task = { kind: "build", buildingId: building.id };
    idler!.task = { kind: "relax", buildingId: building.id };
    resident!.houseId = building.id;
    const bystander = island.settlers[3]!;
    bystander.task = { kind: "gather", resource: "wood", nodeId: "node-x" };

    w.applyOrders(secret, [{ kind: "demolish", building: building.id }]);
    expect(builder!.task).toEqual({ kind: "idle" });
    expect(idler!.task).toEqual({ kind: "idle" });
    expect(resident!.houseId).toBeUndefined();
    // only the hands on that building are freed — the rest keep working
    expect(bystander.task).toEqual({ kind: "gather", resource: "wood", nodeId: "node-x" });
  });

  it("tells the world: the razing lands in the island's feed", () => {
    const w = World.create({ seed: 12 });
    const { secret, islandId, building } = townWith(w, "shrine");
    w.applyOrders(secret, [{ kind: "demolish", building: building.id }]);
    const batch = w.tick(1);
    const told = batch.find((e) => e.type === "demolished");
    expect(told?.islandId).toBe(islandId);
    expect(told?.text).toContain("shrine");
    expect(w.feed(islandId).some((e) => e.type === "demolished")).toBe(true);
  });
});

describe("demolish — only ever your own soil", () => {
  it("razes on a colony the ruler's home rules", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const ruler = seafarer(w, "norse");
    const colony = colonyOf(w, ruler);
    w.debugGrant(colony.id, { addBuilding: { type: "hut", stage: "complete" } });
    const hut = colony.buildings.find((b) => b.type === "hut")!;

    const [outcome] = w.applyOrders(ruler.secret, [
      { kind: "demolish", building: hut.id, island: colony.id },
    ]);
    expect(outcome!.ok).toBe(true);
    expect(w.island(colony.id)!.buildings.some((b) => b.id === hut.id)).toBe(false);
  });

  it("refuses another player's home island, however the payload names it", () => {
    const w = World.create({ seed: 12 });
    const mine = townWith(w, "shrine", "roman");
    const theirs = townWith(w, "shrine", "greek");

    const [outcome] = w.applyOrders(mine.secret, [
      { kind: "demolish", building: theirs.building.id, island: theirs.islandId },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("not yours to raze");
    expect(theirs.island.buildings.some((b) => b.id === theirs.building.id)).toBe(true);
  });

  it("refuses a rival's colony", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const owner = seafarer(w, "norse");
    const rival = seafarer(w, "greek");
    const colony = colonyOf(w, owner);
    w.debugGrant(colony.id, { addBuilding: { type: "hut", stage: "complete" } });
    const hut = colony.buildings.find((b) => b.type === "hut")!;

    const [outcome] = w.applyOrders(rival.secret, [
      { kind: "demolish", building: hut.id, island: colony.id },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("not yours to raze");
    expect(w.island(colony.id)!.buildings.some((b) => b.id === hut.id)).toBe(true);
  });

  it("refuses an island that does not exist", () => {
    const w = World.create({ seed: 12 });
    const { secret, building } = townWith(w, "shrine");
    const [outcome] = w.applyOrders(secret, [
      { kind: "demolish", building: building.id, island: "island-nowhere" },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("no such island");
  });
});

describe("demolish — durable like every other order", () => {
  let dir: string;
  beforeEach(() => {
    mkdirSync("data", { recursive: true });
    dir = mkdtempSync(join("data", "test-demolish-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replays byte-identically from the command log", async () => {
    const p = await Persistence.open(new FileStore(dir));
    const w = World.create({ seed: 55 });
    await p.record({ type: "create", at: 0, seed: 55, catastropheEpoch: 0 });

    await p.record({ type: "join", at: 0, civ: "roman", secret: "s1" });
    const r = w.join({ civ: "roman", secret: "s1" });
    const grant = { age: "bronze" as const, addBuilding: { type: "shrine", stage: "complete" as const } };
    await p.record({ type: "grant", at: 0, islandId: r.islandId, grant });
    w.debugGrant(r.islandId, grant);

    w.tick(30);
    const orders = [{ kind: "demolish", building: "shrine" }];
    await p.record({ type: "orders", at: 30, secret: "s1", orders });
    w.applyOrders("s1", parseOrders(orders));
    w.tick(10);

    const restored = (await Persistence.open(new FileStore(dir))).restore();
    const world = (await restored)!;
    world.tick(Math.max(0, 40 - world.time));
    expect(world.serialize()).toBe(w.serialize());
    expect(world.island(r.islandId)!.buildings.some((b) => b.type === "shrine")).toBe(false);
  });
});
