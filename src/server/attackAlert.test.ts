import { describe, expect, it } from "vitest";
import type { CreationInput, GameEvent, Order } from "../shared/types";
import { World } from "./world";

// Fast clock and sea lanes so voyages land inside the test budget; a short
// alert cooldown so the re-alert path is testable without hundreds of ticks.
const FAST = {
  daySeconds: 30,
  boatSpeed: 40,
  wildSpawnIntervalSeconds: 5,
  maxWildPerHome: 3,
  daylightShare: 1,
  attackAlertCooldownSeconds: 20,
};

function raiders(over: Partial<CreationInput> = {}): Order {
  return {
    kind: "create",
    creation: {
      name: "Moon Ninjas",
      description: "silent blades of the night",
      sprite: {
        size: 8,
        palette: ["#1a1a2e", "#e94560"],
        pixels: [
          "..00....", ".0110...", "..00....", ".0000...",
          "0.00.0..", "..00....", ".0..0...", "0....0..",
        ],
      },
      stats: { power: 7, speed: 5, resilience: 3 },
      verbs: ["raid", "patrol"],
      count: 4,
      ...over,
    },
  };
}

/** Two bronze rivals and a colony the defender lawfully holds. */
function battlefield(seed = 91) {
  const w = World.create({ seed, balance: FAST });
  const atk = w.join({ civ: "mongol" });
  const dfd = w.join({ civ: "greek" });
  w.debugGrant(atk.islandId, { age: "bronze", addBoat: true, stocks: { food: 1e5, wood: 1e5, stone: 1e5 } });
  w.debugGrant(dfd.islandId, { age: "bronze", addBoat: true, stocks: { food: 1e5, wood: 1e5, stone: 1e5 } });
  w.tick(6); // a wild island rises
  const wild = w.islands().find((i) => i.kind === "wild")!;
  expect(wild).toBeTruthy();
  const [colonize] = w.applyOrders(dfd.secret, [
    { kind: "voyage", dest: wild.id, intent: "colonize" },
  ]);
  expect(colonize!.ok).toBe(true);
  for (let t = 0; t < 600 && w.island(wild.id)!.kind !== "colony"; t++) w.tick(1);
  expect(w.island(wild.id)!.ownerId).toBe(dfd.islandId);
  return { w, atk, dfd, colonyId: wild.id };
}

const alerts = (events: GameEvent[]) => events.filter((e) => e.type === "under-attack");

describe("the tocsin — under-attack alerts", () => {
  it("a raiding voyage rings the bell with defender, attacker, and the words", () => {
    const { w, atk, colonyId } = battlefield();
    const [raid] = w.applyOrders(atk.secret, [
      { kind: "voyage", dest: colonyId, intent: "attack" },
    ]);
    expect(raid!.ok).toBe(true);
    const rung = alerts(w.tick(1));
    expect(rung).toHaveLength(1);
    const bell = rung[0]!;
    // the payload any viewer needs to render the card and jump to the fight
    expect(bell.islandId).toBe(colonyId);
    expect(bell.attackerId).toBe(atk.islandId);
    expect(bell.world).toBe(true);
    const defender = w.island(colonyId)!;
    const attacker = w.island(atk.islandId)!;
    expect(bell.text).toBe(`${defender.name} is being attacked by ${attacker.name}!`);
  });

  it("a dispatched raiding band rings the bell too", () => {
    const { w, atk, colonyId } = battlefield(92);
    const [made] = w.applyOrders(atk.secret, [raiders()]);
    expect(made!.ok).toBe(true);
    const [raid] = w.applyOrders(atk.secret, [
      { kind: "dispatch", creation: "Moon Ninjas", dest: colonyId, count: 2 },
    ]);
    expect(raid!.ok).toBe(true);
    const rung = alerts(w.tick(1));
    expect(rung).toHaveLength(1);
    expect(rung[0]!.islandId).toBe(colonyId);
    expect(rung[0]!.attackerId).toBe(atk.islandId);
  });

  it("one wave, one bell: a second strike inside the cooldown stays silent", () => {
    const { w, atk, colonyId } = battlefield(93);
    w.applyOrders(atk.secret, [raiders()]);
    w.applyOrders(atk.secret, [
      { kind: "dispatch", creation: "Moon Ninjas", dest: colonyId, count: 1 },
    ]);
    expect(alerts(w.tick(1))).toHaveLength(1);
    // the same attacker sends more force right away — the bell already rang
    w.applyOrders(atk.secret, [
      { kind: "dispatch", creation: "Moon Ninjas", dest: colonyId, count: 1 },
    ]);
    expect(alerts(w.tick(1))).toHaveLength(0);
  });

  it("a renewed assault after the cooldown is news again", () => {
    const { w, atk, colonyId } = battlefield(94);
    w.applyOrders(atk.secret, [raiders({ count: 4, stats: { power: 1, speed: 5, resilience: 1 } })]);
    w.applyOrders(atk.secret, [
      { kind: "dispatch", creation: "Moon Ninjas", dest: colonyId, count: 1 },
    ]);
    expect(alerts(w.tick(1))).toHaveLength(1);
    w.tick(FAST.attackAlertCooldownSeconds + 1);
    // the colony must still stand and still be a rival for the re-alert to fire
    if (w.island(colonyId)!.ownerId === atk.islandId) throw new Error("colony fell too soon for this test");
    w.applyOrders(atk.secret, [
      { kind: "dispatch", creation: "Moon Ninjas", dest: colonyId, count: 1 },
    ]);
    expect(alerts(w.tick(1))).toHaveLength(1);
  });

  it("a different attacker on the same colony is its own alarm, cooldown or not", () => {
    const { w, atk, colonyId } = battlefield(95);
    const third = w.join({ civ: "norse" });
    w.debugGrant(third.islandId, { age: "bronze", addBoat: true, stocks: { food: 1e5, wood: 1e5 } });
    w.applyOrders(atk.secret, [
      { kind: "voyage", dest: colonyId, intent: "attack" },
    ]);
    expect(alerts(w.tick(1))).toHaveLength(1);
    const [raid] = w.applyOrders(third.secret, [
      { kind: "voyage", dest: colonyId, intent: "attack" },
    ]);
    expect(raid!.ok).toBe(true);
    const rung = alerts(w.tick(1));
    expect(rung).toHaveLength(1);
    expect(rung[0]!.attackerId).toBe(third.islandId);
  });

  it("peaceful movement never rings it: colonize, trade, garrison", () => {
    const { w, atk, dfd, colonyId } = battlefield(96);
    // trade with the rival home, garrison one's own colony, colonize fresh land
    w.applyOrders(atk.secret, [
      { kind: "voyage", dest: dfd.islandId, intent: "trade" },
    ]);
    w.applyOrders(dfd.secret, [raiders({ name: "Guard Owls" })]);
    w.applyOrders(dfd.secret, [
      { kind: "dispatch", creation: "Guard Owls", dest: colonyId, count: 1 },
    ]);
    const rung = alerts(w.tick(2));
    expect(rung).toHaveLength(0);
  });
});
