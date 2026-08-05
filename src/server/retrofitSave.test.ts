import { describe, expect, it } from "vitest";
import { isAccountSecret, migrateRetrofitIsland, World } from "./world";
import type { Island } from "../shared/types";

/**
 * The live world spent two days under a click-to-play retrofit. Its save is
 * the save we came back to, so loading it must land us in the same ocean:
 * same islands, same owners, same Claude Code players — and nothing left of
 * the browser accounts.
 */
function retrofitIsland(over: Partial<Island> & { id: string }): Island {
  return {
    name: over.name ?? over.id,
    civ: "roman",
    seed: 42,
    age: "stone",
    kind: "home",
    position: { x: 0, y: 0 },
    size: 166,
    settlers: [],
    buildings: [],
    boats: [],
    nodes: [],
    stocks: {},
    workPoints: 0,
    dayClock: 0,
    ...over,
  } as Island;
}

function retrofitSave(): string {
  return JSON.stringify({
    seed: 42,
    overrides: {},
    t: 417292,
    joinCount: 2,
    wildCount: 28,
    idCounter: 1337,
    version: 2,
    accountHomes: [],
    commandIds: [],
    islands: [
      retrofitIsland({ id: "island-5", name: "Portus Solis", kind: "home", lastPulseSeq: 187 }),
      retrofitIsland({ id: "island-27", kind: "expansion" as Island["kind"], ownerId: "island-5" }),
      retrofitIsland({ id: "island-1098", kind: "neutral" as Island["kind"] }),
      retrofitIsland({ id: "island-1337", kind: "expansion" as Island["kind"] }),
    ],
    players: [
      ["s-a28c520a", "island-5"],
      ["account:4779185d-906d-49dd-9b12-161c8933eef4", "island-1338"],
    ],
    voyagePairs: [],
    feeds: [],
  });
}

describe("loading the world the retrofit left behind", () => {
  it("reads settled islands as colonies and unsettled ones as wild", () => {
    const world = World.deserialize(retrofitSave());
    const kinds = Object.fromEntries(world.islands().map((i) => [i.id, i.kind]));
    expect(kinds["island-5"]).toBe("home");
    expect(kinds["island-27"]).toBe("colony");
    expect(kinds["island-1098"]).toBe("wild");
    // an "expansion" with no ruler is land nobody holds, not a free colony
    expect(kinds["island-1337"]).toBe("wild");
    expect(world.islands().find((i) => i.id === "island-27")?.ownerId).toBe("island-5");
  });

  it("keeps the Claude Code player and drops browser accounts", () => {
    const world = World.deserialize(retrofitSave());
    expect(world.islandOf("s-a28c520a")?.id).toBe("island-5");
    expect(world.islandOf("account:4779185d-906d-49dd-9b12-161c8933eef4")).toBeUndefined();
    expect(isAccountSecret("account:x")).toBe(true);
    expect(isAccountSecret("s-a28c520a")).toBe(false);
  });

  it("still accepts a pulse from the restored player's island", () => {
    const world = World.deserialize(retrofitSave());
    const before = world.islandOf("s-a28c520a")!.workPoints;
    world.pulse("s-a28c520a", 20_000);
    expect(world.islandOf("s-a28c520a")!.workPoints).toBeGreaterThan(before);
  });

  it("leaves an untouched island alone", () => {
    const island = retrofitIsland({ id: "island-1", kind: "home" });
    expect(migrateRetrofitIsland(island).kind).toBe("home");
  });
});
