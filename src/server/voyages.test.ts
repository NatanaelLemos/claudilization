import { describe, expect, it } from "vitest";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

// Trade rule: each side gives 10% of its largest NON-food stock (goods barter).
// Help rule: the visitor gifts 10% of its largest stock, food included.
function twoIslands(w: World) {
  const a = w.join({ civ: "norse" });
  const b = w.join({ civ: "greek" });
  w.debugGrant(a.islandId, {
    age: "bronze",
    addBoat: true,
    stocks: { food: 5000, wood: 100, stone: 50 },
  });
  w.debugGrant(b.islandId, { stocks: { food: 5000, wood: 10, stone: 60 } });
  return { a, b };
}

function sailUntilDone(w: World, islandId: string, max = 600) {
  const events = [];
  for (let t = 0; t < max; t++) {
    events.push(...w.tick(1));
    const boats = w.island(islandId)!.boats;
    if (boats.every((bt) => bt.state === "docked")) break;
  }
  return events;
}

describe("voyages", () => {
  it("boats are gated behind the Bronze Age", () => {
    const w = World.create({ seed: 31, balance: FAST });
    const a = w.join({ civ: "norse" });
    const [outcome] = w.applyOrders(a.secret, [{ kind: "build_boat" }]);
    expect(outcome!.ok).toBe(false);
  });

  it("a trade voyage visibly sails and changes both islands' stocks", () => {
    const w = World.create({ seed: 31, balance: FAST });
    const { a, b } = twoIslands(w);
    const aStone = w.island(a.islandId)!.stocks.stone ?? 0;
    const bWood = w.island(b.islandId)!.stocks.wood ?? 0;

    const [outcome] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: b.islandId, intent: "trade" },
    ]);
    expect(outcome!.ok).toBe(true);

    w.tick(1);
    expect(w.island(a.islandId)!.boats.some((bt) => bt.state === "sailing")).toBe(true);

    const events = sailUntilDone(w, a.islandId);
    expect(events.some((e) => e.type === "trade")).toBe(true);
    // A's wood went to B; B's stone came back to A — both stocks changed.
    expect(w.island(b.islandId)!.stocks.wood ?? 0).toBeGreaterThan(bWood);
    expect(w.island(a.islandId)!.stocks.stone ?? 0).toBeGreaterThan(aStone);
  });

  it("a help voyage delivers goods to the host island", () => {
    const w = World.create({ seed: 31, balance: FAST });
    const { a, b } = twoIslands(w);
    const bTotalBefore = Object.values(w.island(b.islandId)!.stocks).reduce(
      (s, v) => s + (v ?? 0),
      0,
    );
    const [outcome] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: b.islandId, intent: "help" },
    ]);
    expect(outcome!.ok).toBe(true);
    const events = sailUntilDone(w, a.islandId);
    expect(events.some((e) => e.type === "help")).toBe(true);
    const bTotalAfter = Object.values(w.island(b.islandId)!.stocks).reduce(
      (s, v) => s + (v ?? 0),
      0,
    );
    expect(bTotalAfter).toBeGreaterThan(bTotalBefore);
  });

  it("the first-ever voyage between two islands is a world moment", () => {
    const w = World.create({ seed: 31, balance: FAST });
    const { a, b } = twoIslands(w);
    w.applyOrders(a.secret, [
      { kind: "voyage", dest: b.islandId, intent: "trade" },
    ]);
    const events = sailUntilDone(w, a.islandId);
    expect(events.some((e) => e.type === "first-voyage" && e.world)).toBe(true);
  });
});
