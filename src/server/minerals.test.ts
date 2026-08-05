import { describe, expect, it } from "vitest";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

describe("minerals through the ages", () => {
  it("iron can be mined once the age allows, never before", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "norse" });

    const [refused] = w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "iron", count: 2 },
    ]);
    expect(refused!.ok).toBe(false); // the stone age knows no iron

    w.debugGrant(r.islandId, { age: "iron" });
    const [granted] = w.applyOrders(r.secret, [
      { kind: "assign_gathering", resource: "iron", count: 2 },
    ]);
    expect(granted!.ok).toBe(true);
    w.tick(30);
    expect(w.island(r.islandId)!.stocks.iron ?? 0).toBeGreaterThan(0);
  });

  it("the steelworks refines iron into steel day by day", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "roman" });
    w.debugGrant(r.islandId, { age: "iron", stocks: { iron: 100, food: 500 } });
    w.debugGrant(r.islandId, {
      addBuilding: { type: "steelworks", stage: "complete" },
    });

    w.tick(25); // two day boundaries at 10-second days
    const island = w.island(r.islandId)!;
    expect(island.stocks.steel ?? 0).toBeGreaterThanOrEqual(20);
    expect(island.stocks.iron!).toBeLessThan(100);
  });

  it("an old save without mineral lodes gains them on load, exactly once", () => {
    const w = World.create({ seed: 9, balance: FAST });
    const r = w.join({ civ: "greek" });

    // strip the save back to the wilds-only nodes of the early servers
    const raw = JSON.parse(w.serialize()) as {
      islands: { nodes: { resource: string }[] }[];
    };
    for (const isle of raw.islands) {
      isle.nodes = isle.nodes.filter((n) =>
        ["food", "wood", "stone"].includes(n.resource),
      );
    }

    const revived = World.deserialize(JSON.stringify(raw));
    const island = revived.island(r.islandId)!;
    expect(island.nodes.some((n) => n.resource === "copper")).toBe(true);
    expect(island.nodes.some((n) => n.resource === "plutonium")).toBe(true);

    const again = World.deserialize(revived.serialize());
    expect(again.island(r.islandId)!.nodes).toHaveLength(island.nodes.length);
  });
});
