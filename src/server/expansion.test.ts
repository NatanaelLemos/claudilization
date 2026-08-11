import { describe, expect, it } from "vitest";
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
function seafarer(w: World, civ: "norse" | "roman" | "greek") {
  const r = w.join({ civ });
  w.debugGrant(r.islandId, {
    age: "bronze",
    addBoat: true,
    stocks: { food: 5000, wood: 200, stone: 200 },
  });
  return r;
}

function spawnWild(w: World) {
  const events = w.tick(5);
  const wild = w.islands().find((i) => i.kind === "wild")!;
  return { wild, events };
}

describe("wild islands", () => {
  it("an empty island rises on the interval and the world hears of it", () => {
    const w = World.create({ seed: 41, balance: FAST });
    w.join({ civ: "norse" });
    const { wild, events } = spawnWild(w);
    expect(wild).toBeDefined();
    expect(wild.settlers).toHaveLength(0);
    expect(wild.buildings).toHaveLength(0);
    const moment = events.find((e) => e.type === "wild-island");
    expect(moment?.world).toBe(true);
    expect(moment?.text).toContain(wild.name);
  });

  it("one vacancy at a time — no new empty island while one lies unclaimed", () => {
    const w = World.create({ seed: 41, balance: FAST });
    w.join({ civ: "norse" });
    w.join({ civ: "roman" });
    w.join({ civ: "greek" });
    w.tick(200); // forty spawn chances, three civilizations watching
    const wilds = w.islands().filter((i) => i.kind === "wild");
    expect(wilds.length).toBe(1); // the map never holds a second empty island
  });

  it("claiming the empty island frees the sea to raise the next one", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const { wild } = spawnWild(w);
    const [outcome] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: wild.id, intent: "colonize" },
    ]);
    expect(outcome!.ok).toBe(true);
    // while the crew is still at sea the island is unclaimed — no new land
    sailUntilDone(w, a.islandId);
    expect(w.island(wild.id)!.kind).toBe("colony");
    // the vacancy is filled; the next interval may raise a fresh empty island
    for (let t = 0; t < 10 && !w.islands().some((i) => i.kind === "wild"); t++) {
      w.tick(1);
    }
    const wilds = w.islands().filter((i) => i.kind === "wild");
    expect(wilds).toHaveLength(1);
    expect(wilds[0]!.id).not.toBe(wild.id);
  });

  it("a join founds an occupied home and never mints or consumes empty land", () => {
    const w = World.create({ seed: 41, balance: FAST });
    w.join({ civ: "norse" });
    w.tick(5); // one empty island waits
    const before = w.islands().filter((i) => i.kind === "wild").map((i) => i.id);
    expect(before).toHaveLength(1);
    const r = w.join({ civ: "roman" });
    const home = w.island(r.islandId)!;
    expect(home.kind).toBe("home");
    expect(home.origin).toBe("home"); // sacred from birth — never former empty land
    expect(home.settlers.length).toBeGreaterThan(0); // occupied from birth
    const after = w.islands().filter((i) => i.kind === "wild").map((i) => i.id);
    expect(after).toEqual(before); // the vacant island is neither taken nor doubled
  });

  it("two identically driven worlds agree on when land rises — determinism", () => {
    const run = () => {
      const w = World.create({ seed: 77, balance: FAST });
      const a = seafarer(w, "norse");
      w.tick(5);
      const wild = w.islands().find((i) => i.kind === "wild")!;
      w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
      sailUntilDone(w, a.islandId);
      w.tick(20);
      return w.serialize();
    };
    expect(run()).toBe(run());
  });

  it("no players, no wild islands — an empty world stays empty", () => {
    const w = World.create({ seed: 41, balance: FAST });
    w.tick(50);
    expect(w.islands()).toHaveLength(0);
  });

  it("worlds saved before wild islands existed load as home islands", () => {
    const w = World.create({ seed: 41 });
    const r = w.join({ civ: "roman" });
    const s = JSON.parse(w.serialize()) as {
      wildCount?: number;
      islands: { kind?: string }[];
    };
    delete s.wildCount;
    for (const i of s.islands) delete i.kind;
    const back = World.deserialize(JSON.stringify(s));
    expect(back.island(r.islandId)!.kind).toBe("home");
  });
});

describe("colonization", () => {
  it("a colonize voyage turns an empty island into a colony of the sender", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const { wild } = spawnWild(w);
    const homeBefore = w.island(a.islandId)!.settlers.length;

    const [outcome] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: wild.id, intent: "colonize" },
    ]);
    expect(outcome!.ok).toBe(true);
    // the colonists left home aboard the boat
    expect(w.island(a.islandId)!.settlers.length).toBe(homeBefore - 3);

    const events = sailUntilDone(w, a.islandId);
    const colony = w.island(wild.id)!;
    expect(colony.kind).toBe("colony");
    expect(colony.ownerId).toBe(a.islandId);
    expect(colony.civ).toBe("norse");
    expect(colony.settlers.length).toBeGreaterThanOrEqual(3);
    expect((colony.stocks.food ?? 0)).toBeGreaterThan(0);
    const founded = events.find((e) => e.type === "colony-founded");
    expect(founded?.world).toBe(true);
  });

  it("colonists on a new shore fend for themselves — gathering and building unbidden", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const { wild } = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    w.tick(FAST.daySeconds * 3);
    const colony = w.island(wild.id)!;
    expect(colony.settlers.some((s) => s.task.kind === "gather")).toBe(true);
    expect(colony.buildings.length).toBeGreaterThan(0);
  });

  it("only an empty island can be colonized", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "greek");
    const [outcome] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: b.islandId, intent: "colonize" },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("empty");
  });

  it("trade and help have no one to meet on a wild island", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const { wild } = spawnWild(w);
    const [outcome] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: wild.id, intent: "trade" },
    ]);
    expect(outcome!.ok).toBe(false);
  });
});

describe("the exodus instinct — a bare island moves its people on its own", () => {
  function bareTheLand(w: World, islandId: string) {
    for (const n of w.island(islandId)!.nodes) {
      if (n.resource === "food" || n.resource === "wood" || n.resource === "stone")
        n.remaining = 0;
    }
  }

  it("settlers sail for empty shores unbidden when the land runs bare", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const { wild } = spawnWild(w);
    bareTheLand(w, a.islandId);

    const events = w.tick(FAST.daySeconds + 1);
    const exodus = events.find((e) => e.type === "exodus");
    expect(exodus?.world).toBe(true);
    expect(exodus?.text).toContain("runs bare");
    expect(
      w.island(a.islandId)!.boats.some(
        (b) => b.state === "sailing" && b.intent === "colonize",
      ),
    ).toBe(true);

    sailUntilDone(w, a.islandId);
    const colony = w.island(wild.id)!;
    expect(colony.kind).toBe("colony");
    expect(colony.ownerId).toBe(a.islandId);
  });

  it("with no empty land it storms the weakest colony — and the winner keeps it", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const { wild } = spawnWild(w);
    // the ocean offers no more free land from here on
    (w as unknown as { balance: { wildSpawnIntervalSeconds: number } }).balance
      .wildSpawnIntervalSeconds = 0;
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    expect(w.island(wild.id)!.kind).toBe("colony");

    bareTheLand(w, b.islandId);
    const events = w.tick(FAST.daySeconds + 1);
    const exodus = events.find((e) => e.type === "exodus");
    expect(exodus?.text).toContain("raiders");

    sailUntilDone(w, b.islandId);
    // 4 raiders against 3 colonists: the colony flies b's banner now
    expect(w.island(wild.id)!.ownerId).toBe(b.islandId);
  });

  it("a green island never launches an exodus", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    spawnWild(w);
    const events = w.tick(FAST.daySeconds * 2);
    expect(events.some((e) => e.type === "exodus")).toBe(false);
    expect(w.island(a.islandId)!.boats.every((b) => b.state === "docked")).toBe(true);
  });
});

describe("conquest — homes are sacred, colonies are contested", () => {
  /** A world where A rules a fresh 3-settler colony and B has a boat ready. */
  function contested(w: World) {
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const { wild } = spawnWild(w);
    w.applyOrders(a.secret, [{ kind: "voyage", dest: wild.id, intent: "colonize" }]);
    sailUntilDone(w, a.islandId);
    expect(w.island(wild.id)!.kind).toBe("colony");
    return { a, b, colonyId: wild.id };
  }

  it("a home island can never be attacked — server law", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const a = seafarer(w, "norse");
    const b = seafarer(w, "roman");
    const [outcome] = w.applyOrders(b.secret, [
      { kind: "voyage", dest: a.islandId, intent: "attack" },
    ]);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.reason).toContain("sacred");
  });

  it("a wild island cannot be attacked, and neither can your own colony", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const { a, colonyId } = contested(w);
    const wild2 = (() => {
      w.tick(5);
      return w.islands().find((i) => i.kind === "wild")!;
    })();
    const [atWild] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: wild2.id, intent: "attack" },
    ]);
    expect(atWild!.ok).toBe(false);
    const [atOwn] = w.applyOrders(a.secret, [
      { kind: "voyage", dest: colonyId, intent: "attack" },
    ]);
    expect(atOwn!.ok).toBe(false);
    expect(atOwn!.reason).toContain("your banner");
  });

  it("outnumber the garrison and the colony changes hands", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const { b, colonyId } = contested(w);
    const [outcome] = w.applyOrders(b.secret, [
      { kind: "voyage", dest: colonyId, intent: "attack" },
    ]);
    expect(outcome!.ok).toBe(true);
    const events = sailUntilDone(w, b.islandId);
    const colony = w.island(colonyId)!;
    expect(colony.ownerId).toBe(b.islandId);
    // the raiders stay on as the new garrison
    expect(colony.settlers.length).toBeGreaterThanOrEqual(7);
    const moment = events.find((e) => e.type === "conquest");
    expect(moment?.world).toBe(true);
  });

  it("defense works tip the scales — a walled colony repels the raid", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const { a, b, colonyId } = contested(w);
    w.debugGrant(colonyId, { addBuilding: { type: "palisade", stage: "complete" } });
    const bPopBefore = w.island(b.islandId)!.settlers.length;

    w.applyOrders(b.secret, [{ kind: "voyage", dest: colonyId, intent: "attack" }]);
    const events = sailUntilDone(w, b.islandId);
    const colony = w.island(colonyId)!;
    expect(colony.ownerId).toBe(a.islandId); // still A's
    expect(events.some((e) => e.type === "raid-repelled")).toBe(true);
    // the raiders are lost; the boat limps home empty
    expect(w.island(b.islandId)!.settlers.length).toBeLessThan(bPopBefore);
    expect(w.island(b.islandId)!.boats.every((bt) => !bt.crew)).toBe(true);
  });
});

describe("planes — the sky opens in the modern age", () => {
  it("build_plane needs the modern age and a completed airfield", () => {
    const w = World.create({ seed: 41, balance: FAST });
    const r = w.join({ civ: "japanese" });
    const [tooEarly] = w.applyOrders(r.secret, [{ kind: "build_plane" }]);
    expect(tooEarly!.ok).toBe(false);
    expect(tooEarly!.reason).toContain("modern");

    w.debugGrant(r.islandId, { age: "modern", stocks: { steel: 500, oil: 500, food: 5000 } });
    const [noField] = w.applyOrders(r.secret, [{ kind: "build_plane" }]);
    expect(noField!.ok).toBe(false);
    expect(noField!.reason).toContain("airfield");

    w.debugGrant(r.islandId, { addBuilding: { type: "airfield", stage: "complete" } });
    const [ok] = w.applyOrders(r.secret, [{ kind: "build_plane" }]);
    expect(ok!.ok).toBe(true);
  });

  it("a finished plane joins the fleet and flies planeSpeed, not boatSpeed", () => {
    const w = World.create({ seed: 41, balance: { ...FAST, planeSpeed: 100 } });
    const r = w.join({ civ: "japanese" });
    const other = w.join({ civ: "greek" });
    w.debugGrant(r.islandId, {
      age: "modern",
      stocks: { steel: 500, oil: 500, food: 5000, wood: 500 },
      addBuilding: { type: "airfield", stage: "complete" },
    });
    w.applyOrders(r.secret, [{ kind: "build_plane" }]);
    w.tick(120); // crews finish the plane
    const island = () => w.island(r.islandId)!;
    const plane = island().boats.find((b) => b.craft === "plane");
    expect(plane).toBeDefined();

    w.applyOrders(r.secret, [
      { kind: "voyage", dest: other.islandId, intent: "help" },
    ]);
    const start = { ...island().position };
    w.tick(1);
    const flown = Math.hypot(plane!.pos.x - start.x, plane!.pos.y - start.y);
    expect(flown).toBeCloseTo(100, 0); // planeSpeed, not the 40 of FAST boats
  });
});
