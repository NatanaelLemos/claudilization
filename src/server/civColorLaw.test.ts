import { describe, expect, it } from "vitest";
import { hexToHsl, hueDistance } from "../shared/civColor";
import type { Island } from "../shared/types";
import { World } from "./world";

const HEX = /^#[0-9a-f]{6}$/;

// Fast clock and sea lanes so voyages land inside the test budget.
const FAST = { daySeconds: 30, boatSpeed: 40, wildSpawnIntervalSeconds: 5, daylightShare: 1 };

function sailUntilDone(w: World, islandId: string, max = 600) {
  for (let t = 0; t < max; t++) {
    w.tick(1);
    if (w.island(islandId)!.boats.every((b) => b.state === "docked")) break;
  }
}

function seafarer(w: World, civ: "norse" | "roman" | "greek" | "japanese") {
  const r = w.join({ civ });
  w.debugGrant(r.islandId, {
    age: "bronze",
    addBoat: true,
    stocks: { food: 5000, wood: 200, stone: 200 },
  });
  return r;
}

describe("every civilization flies its own color", () => {
  it("a founding island is dealt a banner color the moment it is born", () => {
    const w = World.create({ seed: 91 });
    const a = w.join({ civ: "roman" });
    const island = w.island(a.islandId)!;
    expect(island.color).toMatch(HEX);
    expect(w.colorOf(island)).toBe(island.color);
  });

  it("two civilizations of the same culture still fly clearly different colors", () => {
    const w = World.create({ seed: 91 });
    const colors: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = w.join({ civ: "roman" }); // same culture, six founders
      colors.push(w.island(r.islandId)!.color!);
    }
    expect(new Set(colors).size).toBe(6);
    for (let a = 0; a < colors.length; a++) {
      for (let b = a + 1; b < colors.length; b++) {
        const gap = hueDistance(hexToHsl(colors[a]!).h, hexToHsl(colors[b]!).h);
        expect(gap).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("wild land flies no color until somebody takes it", () => {
    const w = World.create({ seed: 91, balance: FAST });
    w.join({ civ: "norse" });
    w.tick(5);
    const wild = w.islands().find((i) => i.kind === "wild")!;
    expect(wild.color).toBeUndefined();
    expect(w.colorOf(wild)).toBeUndefined();
  });

  it("a colony flies its ruler's color, and recolors the day it is conquered", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    w.tick(5);
    const wild = w.islands().find((i) => i.kind === "wild")!;
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    const colony = w.island(wild.id)!;
    expect(colony.ownerId).toBe(a.islandId);
    expect(colony.color).toBeUndefined(); // never its own — always resolved
    expect(w.colorOf(colony)).toBe(w.island(a.islandId)!.color);
    w.applyOrders(b.secret, [{ kind: "voyage", dest: wild.id, intent: "attack" }]);
    sailUntilDone(w, b.islandId);
    expect(w.island(wild.id)!.ownerId).toBe(b.islandId);
    expect(w.colorOf(w.island(wild.id)!)).toBe(w.island(b.islandId)!.color);
  });

  it("colors survive a save and load unchanged", () => {
    const w = World.create({ seed: 91 });
    const a = w.join({ civ: "greek" });
    const before = w.island(a.islandId)!.color;
    const loaded = World.deserialize(w.serialize());
    expect(loaded.island(a.islandId)!.color).toBe(before);
  });

  it("a save from before colors existed deals every home a distinct color on load", () => {
    const w = World.create({ seed: 91 });
    const a = w.join({ civ: "greek" });
    const b = w.join({ civ: "norse" });
    const save = JSON.parse(w.serialize()) as { islands: Island[] };
    for (const island of save.islands) delete island.color; // the old world
    const loaded = World.deserialize(JSON.stringify(save));
    const ca = loaded.island(a.islandId)!.color!;
    const cb = loaded.island(b.islandId)!.color!;
    expect(ca).toMatch(HEX);
    expect(cb).toMatch(HEX);
    expect(ca).not.toBe(cb);
    // and the deal is stable: loading the same old save again deals the same hand
    const again = World.deserialize(JSON.stringify(save));
    expect(again.island(a.islandId)!.color).toBe(ca);
    expect(again.island(b.islandId)!.color).toBe(cb);
  });
});
