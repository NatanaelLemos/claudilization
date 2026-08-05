import { describe, expect, it } from "vitest";
import { CIVS } from "../shared/civs";
import { World } from "./world";

describe("joining the world", () => {
  it("founds an island with 10 uniquely named adult settlers of the chosen civ", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    expect(r.isNew).toBe(true);
    const island = w.island(r.islandId)!;
    expect(island.civ).toBe("roman");
    expect(island.age).toBe("stone");
    expect(island.buildings).toHaveLength(0);
    expect(island.settlers).toHaveLength(10);
    const names = island.settlers.map((s) => s.name);
    expect(new Set(names).size).toBe(10);
    for (const s of island.settlers) {
      expect(s.adult).toBe(true);
      expect(CIVS.roman.nameBank).toContain(s.name);
    }
  });

  it("names the island in the civilization's style", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "egyptian" });
    expect(CIVS.egyptian.islandNames).toContain(r.islandName);
  });

  it("honors a chosen name, trimmed and clamped to 40 characters", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "egyptian", name: `  ${"Memphis-on-Sea".repeat(5)}  ` });
    expect(r.islandName).toBe("Memphis-on-Sea".repeat(5).slice(0, 40));
    const blank = w.join({ civ: "norse", name: "   " });
    expect(CIVS.norse.islandNames).toContain(blank.islandName);
  });

  it("is idempotent on the secret: joining twice returns home, never a second island", () => {
    const w = World.create({ seed: 7 });
    const first = w.join({ civ: "greek" });
    const again = w.join({ civ: "greek", secret: first.secret });
    expect(again.islandId).toBe(first.islandId);
    expect(again.isNew).toBe(false);
    expect(w.islands()).toHaveLength(1);
  });

  it("a fully mined-out island turns to leisure, never to a crowd of statues", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    const island = w.island(r.islandId)!;
    island.stocks.food = 100_000;
    for (const n of island.nodes) n.remaining = 0; // nothing left anywhere
    island.buildings.push(
      { id: "b-home", type: "hut", stage: "complete", progress: 99, pos: { x: 10, y: 10 } },
      { id: "b-home2", type: "hut", stage: "complete", progress: 99, pos: { x: 20, y: 20 } },
    );
    w.tick(2);
    expect(island.settlers.every((s) => s.task.kind === "relax")).toBe(true);
    // and they spread out — never one blob on a single spot
    const spots = new Set(
      island.settlers.map((s) => (s.task as { buildingId: string }).buildingId),
    );
    expect(spots.size).toBeGreaterThan(1);
  });

  it("leisure yields to labor — a new build site drafts its crew from the parks", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    const island = w.island(r.islandId)!;
    island.stocks.food = 100_000;
    for (const n of island.nodes) n.remaining = 0;
    island.buildings.push(
      { id: "b-home", type: "hut", stage: "complete", progress: 99, pos: { x: 10, y: 10 } },
    );
    w.tick(2); // everyone settles into leisure
    island.buildings.push(
      { id: "b-site", type: "hut", stage: "site", progress: 0, pos: { x: 30, y: 30 } },
    );
    w.tick(1);
    const builders = island.settlers.filter((s) => s.task.kind === "build");
    expect(builders.length).toBe(3);
  });

  it("a relaxer stranded far from their porch walks back out to it by day", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    const island = w.island(r.islandId)!;
    island.stocks.food = 100_000;
    for (const n of island.nodes) n.remaining = 0;
    island.buildings.push(
      { id: "b-porch", type: "hut", stage: "complete", progress: 99, pos: { x: 70, y: 70 } },
    );
    w.tick(2); // everyone settles into leisure at the porch
    for (const s of island.settlers) s.pos = { x: 2, y: 2 }; // a night walked them home
    w.tick(1);
    for (const s of island.settlers) {
      expect(s.task.kind).toBe("relax");
      expect(Math.hypot(s.pos.x - 70, s.pos.y - 70)).toBeLessThan(3);
    }
  });

  it("never freezes when food, wood, and stone run dry — hands turn to the age's ores", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    const island = w.island(r.islandId)!;
    island.age = "bronze";
    island.stocks.food = 100_000; // nobody is hungry — this is pure depletion
    for (const n of island.nodes) {
      if (n.resource === "food" || n.resource === "wood" || n.resource === "stone")
        n.remaining = 0;
    }
    w.tick(2);
    const gathering = island.settlers.filter((s) => s.task.kind === "gather");
    expect(gathering.length).toBeGreaterThan(0);
    for (const s of gathering) {
      expect(["copper", "tin"]).toContain(
        (s.task as { resource: string }).resource,
      );
    }
  });

  it("is idempotent on the machine key: a lost secret still comes home, never a second island", () => {
    const w = World.create({ seed: 7 });
    const first = w.join({ civ: "greek", publicKey: "pem-A" });
    // identity.json gone, key remains — no secret in the retry
    const again = w.join({ civ: "roman", publicKey: "pem-A" });
    expect(again.islandId).toBe(first.islandId);
    expect(again.secret).toBe(first.secret);
    expect(again.isNew).toBe(false);
    expect(w.islands()).toHaveLength(1);
    // a different machine still founds its own island
    const other = w.join({ civ: "roman", publicKey: "pem-B" });
    expect(other.isNew).toBe(true);
    expect(w.islands()).toHaveLength(2);
  });

  it("places islands deterministically and apart", () => {
    const build = () => {
      const w = World.create({ seed: 11 });
      w.join({ civ: "roman" });
      w.join({ civ: "norse" });
      w.join({ civ: "aztec" });
      return w.islands().map((i) => i.position);
    };
    const a = build();
    const b = build();
    expect(a).toEqual(b);
    const [p, q] = [a[0]!, a[1]!];
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    expect(dist).toBeGreaterThan(100);
  });
});

describe("the world's law", () => {
  it("creation overrides survive serialization and are readable as law", () => {
    const w = World.create({ seed: 7, balance: { daySeconds: 120 } });
    expect(w.law.daySeconds).toBe(120);
    expect(w.law.daylightShare).toBeGreaterThan(0); // defaults fill the rest
    const back = World.deserialize(w.serialize());
    expect(back.law.daySeconds).toBe(120);
  });

  it("a rebalance amends the law permanently, leaving other overrides intact", () => {
    const w = World.create({
      seed: 7,
      balance: { daySeconds: 120, wildSpawnIntervalSeconds: 300 },
    });
    w.rebalance({ daySeconds: 3600 });
    expect(w.law.daySeconds).toBe(3600);
    expect(w.law.wildSpawnIntervalSeconds).toBe(300); // untouched
    const back = World.deserialize(w.serialize());
    expect(back.law.daySeconds).toBe(3600);
    expect(back.law.wildSpawnIntervalSeconds).toBe(300);
  });

  it("a world mid-morning on a fast clock wakes into a long day after rebalance", () => {
    const w = World.create({ seed: 7, balance: { daySeconds: 120 } });
    const r = w.join({ civ: "roman" });
    w.tick(70); // past the fast clock's sundown (66)
    w.rebalance({ daySeconds: 3600 });
    w.tick(5);
    const island = w.island(r.islandId)!;
    // dayClock 75 is deep daylight under the new law — hands are at work
    expect(island.settlers.some((s) => s.task.kind !== "idle")).toBe(true);
  });
});

describe("the settlers' building judgment", () => {
  it("back-fills a skipped age's refinery: iron in heaps, no steel — the steelworks rises", () => {
    const w = World.create({ seed: 7, balance: { daySeconds: 30 } });
    const r = w.join({ civ: "japanese" });
    const island = w.island(r.islandId)!;
    island.age = "medieval"; // blitzed past iron without ever raising its works
    island.stocks.food = 100_000;
    island.stocks.wood = 5_000;
    island.stocks.stone = 5_000;
    island.stocks.iron = 3_000;
    w.tick(30 * 20); // twenty short days of the town's own judgment
    expect(island.buildings.some((b) => b.type === "steelworks")).toBe(true);
  });
});

describe("pulses — a completed prompt", () => {
  it("emits at least one visible event on that island, immediately", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "japanese" });
    const events = w.pulse(r.secret, 5000);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const e of events) {
      expect(e.islandId).toBe(r.islandId);
    }
    expect(events.some((e) => e.type === "work-surge")).toBe(true);
  });

  it("rejects an unknown secret", () => {
    const w = World.create({ seed: 7 });
    expect(() => w.pulse("nope", 100)).toThrow();
  });
});

describe("founding provisions", () => {
  it("a new island starts with starterFoodDays of food for its whole population", () => {
    const w = World.create({ seed: 7, balance: { starterFoodDays: 3 } });
    const r = w.join({ civ: "norse" });
    const island = w.island(r.islandId)!;
    expect(island.stocks.food).toBe(
      3 * island.settlers.length * 1, // days × settlers × foodPerSettlerPerDay
    );
  });
});

describe("the feed's voice", () => {
  it("work-surge lines vary across pulses instead of looping one phrase", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    const texts = new Set<string>();
    for (let i = 0; i < 5; i++) {
      w.tick(37);
      const events = w.pulse(r.secret, 5000);
      texts.add(events.find((e) => e.type === "work-surge")!.text);
    }
    expect(texts.size).toBeGreaterThanOrEqual(2);
    for (const t of texts) expect(t).toContain(w.island(r.islandId)!.name);
  });
});

describe("renaming the island", () => {
  it("renames by secret, trims, and announces a world moment naming both names", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "japanese" });
    const events = w.rename(r.secret, "  New Kyoto  ");
    expect(w.island(r.islandId)!.name).toBe("New Kyoto");
    expect(events).toHaveLength(1);
    expect(events[0]!.world).toBe(true);
    expect(events[0]!.text).toContain(r.islandName);
    expect(events[0]!.text).toContain("New Kyoto");
  });

  it("survives serialization — the new name is the island's name, not a costume", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "norse" });
    w.rename(r.secret, "Stormhold");
    const back = World.deserialize(w.serialize());
    expect(back.island(r.islandId)!.name).toBe("Stormhold");
  });

  it("rejects strangers and blank names, clamps novels to 40 characters", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    expect(() => w.rename("s-not-a-player", "Nope")).toThrow();
    expect(() => w.rename(r.secret, "   ")).toThrow();
    w.rename(r.secret, "N".repeat(80));
    expect(w.island(r.islandId)!.name).toHaveLength(40);
  });

  it("renaming to the current name is a quiet no-op", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "greek" });
    expect(w.rename(r.secret, r.islandName)).toHaveLength(0);
  });
});

describe("pairing — only my Claude edits my civilization", () => {
  it("a join with a public key locks the island from birth", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "norse", publicKey: "PEM-A" });
    expect(w.island(r.islandId)!.ownerKey).toBe("PEM-A");
  });

  it("an unpaired island pairs on rejoin or via pair(), first key wins", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "roman" });
    expect(w.island(r.islandId)!.ownerKey).toBeUndefined();
    w.pair(r.secret, "PEM-A");
    expect(w.island(r.islandId)!.ownerKey).toBe("PEM-A");
    w.pair(r.secret, "PEM-A"); // same key: a quiet no-op
    expect(() => w.pair(r.secret, "PEM-B")).toThrow(/another Claude/);
    expect(w.island(r.islandId)!.ownerKey).toBe("PEM-A");
  });

  it("a rejoin never silently re-keys a paired island", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "greek", publicKey: "PEM-A" });
    w.join({ civ: "greek", secret: r.secret, publicKey: "PEM-B" });
    expect(w.island(r.islandId)!.ownerKey).toBe("PEM-A");
  });

  it("the pairing survives serialization", () => {
    const w = World.create({ seed: 7 });
    const r = w.join({ civ: "aztec", publicKey: "PEM-A" });
    expect(World.deserialize(w.serialize()).island(r.islandId)!.ownerKey).toBe("PEM-A");
  });
});
