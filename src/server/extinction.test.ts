import { describe, expect, it } from "vitest";
import { World } from "./world";

const FAST = { daySeconds: 10, daylightShare: 1 };

function starveOut(w: World, islandId: string) {
  w.debugGrant(islandId, { stocks: { food: 0 }, clearFoodSources: true });
  const events = [];
  for (let t = 0; t < 200 && w.island(islandId)!.settlers.length > 0; t++) {
    events.push(...w.tick(1));
  }
  return events;
}

describe("extinction — legend, not a dead end", () => {
  it("announces the last settler's death to the whole world and leaves ruins", () => {
    const w = World.create({ seed: 21, balance: FAST });
    const r = w.join({ civ: "egyptian" });
    const events = starveOut(w, r.islandId);

    const island = w.island(r.islandId)!;
    expect(island.settlers).toHaveLength(0);
    expect(island.ruins).toBe(true);

    const moment = events.find((e) => e.type === "extinction");
    expect(moment).toBeDefined();
    expect(moment!.world).toBe(true);
    expect(moment!.text).toContain(island.name);
  });

  it("the fallen player may found anew; the ruins remain on the map", () => {
    const w = World.create({ seed: 21, balance: FAST });
    const r = w.join({ civ: "egyptian" });
    starveOut(w, r.islandId);

    const rejoin = w.join({ civ: "norse", secret: r.secret });
    expect(rejoin.isNew).toBe(true);
    expect(rejoin.islandId).not.toBe(r.islandId);
    expect(w.islands()).toHaveLength(2);
    expect(w.island(r.islandId)!.ruins).toBe(true);
  });
});
