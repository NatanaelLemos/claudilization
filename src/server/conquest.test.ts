import { describe, expect, it } from "vitest";
import type { Island } from "../shared/types";
import { World } from "./world";

// Fast clock and sea lanes so voyages land inside the test budget.
const FAST = { daySeconds: 30, boatSpeed: 40, wildSpawnIntervalSeconds: 5, daylightShare: 1 };

function sailUntilDone(w: World, islandId: string, max = 600) {
  const events = [];
  for (let t = 0; t < max; t++) {
    events.push(...w.tick(1));
    if (w.island(islandId)!.boats.every((b) => b.state === "docked")) break;
  }
  return events;
}

/** A bronze player with a docked boat and full stores, ready to sail. */
function seafarer(w: World, civ: "norse" | "roman" | "greek" | "japanese") {
  const r = w.join({ civ });
  w.debugGrant(r.islandId, {
    age: "bronze",
    addBoat: true,
    stocks: { food: 5000, wood: 200, stone: 200 },
  });
  return r;
}

function spawnWild(w: World) {
  w.tick(5);
  return w.islands().find((i) => i.kind === "wild")!;
}

describe("origin — the immutable provenance flag", () => {
  it("a founding island is born origin=home; empty land is born origin=neutral", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = w.join({ civ: "norse" });
    expect(w.island(a.islandId)!.origin).toBe("home");
    const wild = spawnWild(w);
    expect(wild.origin).toBe("neutral");
  });

  it("origin survives colonization and conquest unchanged", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const wild = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    expect(w.island(wild.id)!.origin).toBe("neutral");
    w.applyOrders(b.secret, [{ kind: "voyage", dest: wild.id, intent: "attack" }]);
    sailUntilDone(w, b.islandId);
    expect(w.island(wild.id)!.ownerId).toBe(b.islandId);
    expect(w.island(wild.id)!.origin).toBe("neutral");
  });

  it("saves from before the field existed backfill origin from kind", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const wild = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    const s = JSON.parse(w.serialize()) as { islands: { origin?: string }[] };
    for (const i of s.islands) delete i.origin;
    const back = World.deserialize(JSON.stringify(s));
    expect(back.island(a.islandId)!.origin).toBe("home");
    expect(back.island(wild.id)!.origin).toBe("neutral");
  });
});

describe("conquered empty islands take the conqueror's name", () => {
  it("colonizing an empty island renames it for the colonizer's civilization", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "japanese");
    const home = w.island(a.islandId)!;
    const wild = spawnWild(w);
    const landName = wild.name;
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    const events = sailUntilDone(w, a.islandId);
    expect(w.island(wild.id)!.name).toBe(home.name);
    const founded = events.find((e) => e.type === "colony-founded");
    expect(founded?.text).toContain(landName);
    expect(founded?.text).toContain(home.name);
  });

  it("a settler raid that takes the colony renames it for the new ruler", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const wild = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    expect(w.island(wild.id)!.name).toBe(w.island(a.islandId)!.name);

    w.applyOrders(b.secret, [{ kind: "voyage", dest: wild.id, intent: "attack" }]);
    const events = sailUntilDone(w, b.islandId);
    expect(w.island(wild.id)!.ownerId).toBe(b.islandId);
    expect(w.island(wild.id)!.name).toBe(w.island(b.islandId)!.name);
    const conquest = events.find((e) => e.type === "conquest");
    expect(conquest?.text).toContain(w.island(b.islandId)!.name);
  });

  it("a third player can take it again — and the name follows the conqueror", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const c = seafarer(w, "greek");
    const wild = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    w.applyOrders(b.secret, [{ kind: "voyage", dest: wild.id, intent: "attack" }]);
    sailUntilDone(w, b.islandId);
    expect(w.island(wild.id)!.ownerId).toBe(b.islandId);
    expect(w.island(wild.id)!.name).toBe(w.island(b.islandId)!.name);

    // B's raiders became the garrison (7+); C needs more force to overcome it
    w.debugGrant(c.islandId, { stocks: { food: 50000, wood: 5000, stone: 5000 } });
    (w as unknown as { balance: { raidCrew: number } }).balance.raidCrew = 12;
    for (let i = 0; i < 10; i++) {
      const home = w.island(c.islandId)!;
      home.settlers.push({
        id: `${c.islandId}-extra${i}`,
        name: `Extra ${i}`,
        adult: true,
        bornAt: 0,
        task: { kind: "idle" },
        pos: { x: 10, y: 10 },
        hungerDays: 0,
      });
    }
    const [outcome] = w.applyOrders(c.secret, [
      { kind: "voyage", dest: wild.id, intent: "attack" },
    ]);
    expect(outcome!.ok).toBe(true);
    sailUntilDone(w, c.islandId);
    expect(w.island(wild.id)!.ownerId).toBe(c.islandId);
    expect(w.island(wild.id)!.name).toBe(w.island(c.islandId)!.name);
    expect(w.island(wild.id)!.origin).toBe("neutral");
  });

  it("loading an old save applies the name law to existing colonies once", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "japanese");
    const wild = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    // forge a pre-law save: the colony still carries its wild name
    const s = JSON.parse(w.serialize()) as { islands: Island[] };
    const colony = s.islands.find((i) => i.id === wild.id)!;
    colony.name = "Mistholm";
    const back = World.deserialize(JSON.stringify(s));
    expect(back.island(wild.id)!.name).toBe(back.island(a.islandId)!.name);
    // and the ruler's own home island keeps its own name
    expect(back.island(a.islandId)!.name).not.toBe("Mistholm");
  });
});

describe("only originally-empty islands are ever conquerable", () => {
  it("every hostile intent against a home island is refused at the gate", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const [attack] = w.applyOrders(b.secret, [
      { kind: "voyage", dest: a.islandId, intent: "attack" },
    ]);
    expect(attack!.ok).toBe(false);
    expect(attack!.reason).toContain("sacred");
    const [colonize] = w.applyOrders(b.secret, [
      { kind: "voyage", dest: a.islandId, intent: "colonize" },
    ]);
    expect(colonize!.ok).toBe(false);
  });

  it("a corrupted kind cannot unmake a home's sanctity — origin still holds", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    // forge a save where A's home island claims to be an ordinary colony
    const s = JSON.parse(w.serialize()) as { islands: Island[] };
    const home = s.islands.find((i) => i.id === a.islandId)!;
    home.kind = "colony";
    home.ownerId = a.islandId;
    const back = World.deserialize(JSON.stringify(s));
    const [outcome] = back.applyOrders(b.secret, [
      { kind: "voyage", dest: a.islandId, intent: "attack" },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("sacred");
  });

  it("a captured colony never inherits home protection — it stays contestable", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const c = seafarer(w, "greek");
    const wild = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    w.applyOrders(b.secret, [{ kind: "voyage", dest: wild.id, intent: "attack" }]);
    sailUntilDone(w, b.islandId);
    expect(w.island(wild.id)!.ownerId).toBe(b.islandId);
    // C may lawfully declare war on the twice-held island
    const [outcome] = w.applyOrders(c.secret, [
      { kind: "voyage", dest: wild.id, intent: "attack" },
    ]);
    expect(outcome!.ok).toBe(true);
  });

  it("creation bands obey the same law: never a home island, colonies fair game", () => {
    const w = World.create({ seed: 51, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const wild = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    w.debugGrant(b.islandId, { stocks: { food: 50000, wood: 50000 } });
    const creation = {
      name: "Sea Wolves",
      description: "grey raiders of the cold water",
      sprite: { size: 8, palette: ["#444455"], pixels: [
        "..00....", ".0000...", "..00....", ".0000...",
        "0.00.0..", "..00....", ".0..0...", "0....0..",
      ] },
      stats: { power: 8, speed: 4, resilience: 3 },
      verbs: ["raid" as const],
      count: 6,
    };
    const [made] = w.applyOrders(b.secret, [{ kind: "create", creation }]);
    expect(made!.ok).toBe(true);
    const [atHome] = w.applyOrders(b.secret, [
      { kind: "dispatch", creation: "Sea Wolves", dest: a.islandId },
    ]);
    expect(atHome!.ok).toBe(false);
    expect(atHome!.reason).toContain("sacred");
    const [atColony] = w.applyOrders(b.secret, [
      { kind: "dispatch", creation: "Sea Wolves", dest: wild.id },
    ]);
    expect(atColony!.ok).toBe(true);
    // march the band ashore: the colony falls and takes B's name
    for (let t = 0; t < 300; t++) {
      w.tick(1);
      if (w.island(wild.id)!.ownerId === b.islandId) break;
    }
    expect(w.island(wild.id)!.ownerId).toBe(b.islandId);
    expect(w.island(wild.id)!.name).toBe(w.island(b.islandId)!.name);
  });
});
