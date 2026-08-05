import { AGE_RESOURCES, advanceRequirements, ageIndex, nextAge } from "../shared/ages";
import type { Balance } from "../shared/balance";
import { DEFAULT_BALANCE } from "../shared/balance";
import { BUILDINGS, buildingSpec } from "../shared/buildings";
import { CIVS } from "../shared/civs";
import { ensureCivColors, pickCivColor } from "../shared/civColor";
import {
  bandPower,
  bandSpeed,
  CREATION_GATHER_RATE_PER_POWER,
  CREATION_LIMITS,
  creationCost,
  homeActivity,
  parseCreationInput,
  unitDefense,
} from "../shared/creations";
import { dayIndex, isNight, secondsIntoDay, worldSecondsAt } from "../shared/daylight";
import { computeHappiness } from "../shared/happiness";
import { computeInspiration } from "../shared/inspiration";
import { WONDER_CIV } from "../shared/wonders";
import { hashString, mulberry32 } from "../shared/rng";
import { generateIsland } from "../shared/terrain";
import type {
  Age,
  Boat,
  Building,
  BuildingSpec,
  CivId,
  CreationBand,
  CreationInput,
  CreationSpec,
  DebugGrant,
  Tile,
  GameEvent,
  Island,
  JoinResult,
  Order,
  OrderOutcome,
  Pulse,
  ResourceId,
  Settler,
  Vec2,
  VoyageIntent,
} from "../shared/types";
import { CIV_IDS } from "../shared/types";

export interface WorldOptions {
  seed?: number;
  balance?: Partial<Balance>;
  /** the real instant this world's clock reads zero — see `anchorTo` */
  anchorMs?: number;
  /** world seconds already on the clock at creation (a wall-clock birth) */
  at?: number;
}

/**
 * How far behind the wall clock the world will simulate rather than skip.
 * An ordinary restart (a snapshot up to `snapshotIntervalSeconds` old plus a
 * boot) lands well inside this and is played out second by second, so nothing
 * is lost. A real outage is not replayed at all — the clock is simply read
 * again, because a sleeping world must never wake up hours in arrears and
 * burn a minute of CPU catching up.
 */
const MAX_CATCHUP_SECONDS = 300;

const GATHER_RATE = 0.5; // resource units per gatherer-second
const BUILD_CREW = 3;

const SURGE_TEXTS = [
  (n: string) => `A surge of inspiration sweeps ${n} — the settlers work with fresh vigor.`,
  (n: string) => `New resolve takes hold on ${n}; hammers ring and baskets fill.`,
  (n: string) => `${n} stirs with purpose — every hand finds its task.`,
];
const BUSTLE_TEXTS = [
  (n: string) => `The people of ${n} bustle about their work.`,
  (n: string) => `Songs rise over ${n} as the day's labor rolls on.`,
  (n: string) => `On ${n}, the paths are busy from shore to hearth.`,
];
const GOLDEN_ANGLE = 2.399963229728653;

const WILD_NAMES = [
  "the Uncharted Isle", "Farshore", "the Silent Atoll", "Driftrock",
  "the Empty Crown", "Mistholm", "the Waiting Isle", "Greenreach",
  "the Lost Shelf", "Windmere",
];

/** completed defense works make a colony's garrison count for more */
const DEFENSE_BONUS: Record<string, number> = {
  palisade: 2, watchtower: 3, "bronze-armory": 2, barracks: 3, arsenal: 3,
  "stone-wall": 4, barbican: 4, "castle-wall": 5, keep: 6,
};

/** Stateless deterministic roll in [0,1) from any key parts. */
function roll(...parts: (string | number)[]): number {
  return mulberry32(hashString(parts.join("|")))();
}

/** "great-torii" → "Great Torii" — for event prose about typed things */
function titleCase(type: string): string {
  return type
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

interface SerializedWorld {
  seed: number;
  overrides: Partial<Balance>;
  t: number;
  /** the real instant t = 0 — absent in saves from before the wall clock */
  anchorMs?: number;
  dayIndex?: number;
  joinCount: number;
  wildCount?: number;
  idCounter: number;
  islands: Island[];
  players: [string, string][];
  pulses: [string, Pulse[]][];
  voyagePairs: string[];
  feeds: [string, GameEvent[]][];
}

/**
 * The retrofit that briefly made this a click-to-play RTS renamed the two
 * unowned/owned island kinds and parked browser accounts in the player map.
 * The world it left behind is the world we keep playing, so read its save in
 * this game's own vocabulary: a settled island is a colony, an unsettled one
 * is wild, and only a Claude Code secret is a player.
 */
export function migrateRetrofitIsland(island: Island): Island {
  const kind = island.kind as string;
  if (kind === "expansion") island.kind = island.ownerId ? "colony" : "wild";
  else if (kind === "neutral") island.kind = "wild";
  // a colony without a ruler is just land again
  if (island.kind === "colony" && !island.ownerId) island.kind = "wild";
  // provenance, written exactly once: saves from before the origin field
  // derive it from kind — a home island was founded, everything else rose
  // empty from the sea. After this, origin never changes again.
  island.origin ??= island.kind === "home" ? "home" : "neutral";
  return island;
}

/** Retrofit-era browser accounts, never a Claude Code identity. */
export function isAccountSecret(secret: string): boolean {
  return secret.startsWith("account:");
}

/**
 * The authoritative, AI-free, deterministic world simulation.
 * Sim time is seconds; tick(dt) advances it. All randomness is seeded and
 * stateless (hash-based), so serialize → replay → serialize is exact.
 */
export class World {
  private balance: Balance;
  private overrides: Partial<Balance>;
  private seed: number;
  private t = 0;
  /**
   * The real instant this world's clock reads zero. When it is set, world time
   * is not counted at all — it is read off the wall clock, so restarts, event
   * loop lag and downtime cannot bend the day. Undefined only for worlds built
   * by hand in tests, which drive `tick()` themselves.
   */
  private anchorMs?: number;
  /** the day the world is living; when it changes, the day turns */
  private dayIndex = 0;
  private tickCarry = 0;
  private joinCount = 0;
  private wildCount = 0;
  private idCounter = 0;
  private islandsMap = new Map<string, Island>();
  private players = new Map<string, string>(); // secret → islandId
  private pulses = new Map<string, Pulse[]>(); // islandId → history
  private pulseSeq = 0;
  private voyagePairs = new Set<string>();
  private feeds = new Map<string, GameEvent[]>();
  private deferred: GameEvent[] = [];
  /** attacker→defender pair → world time the bell last rang. In-memory by
   * design: a restart at worst rings one extra bell. */
  private attackAlerts = new Map<string, number>();

  private constructor(seed: number, overrides: Partial<Balance>) {
    this.seed = seed;
    this.overrides = overrides;
    this.balance = { ...DEFAULT_BALANCE, ...overrides };
  }

  static create(opts?: WorldOptions): World {
    const w = new World(opts?.seed ?? 1, opts?.balance ?? {});
    w.t = Math.max(0, Math.floor(opts?.at ?? 0));
    w.dayIndex = dayIndex(w.t, w.balance.daySeconds);
    if (opts?.anchorMs !== undefined) w.anchorMs = opts.anchorMs;
    return w;
  }

  get time(): number {
    return this.t;
  }

  /** The real instant this world's clock reads zero, if it is wall-clocked. */
  get anchor(): number | undefined {
    return this.anchorMs;
  }

  /**
   * Bind the world's clock to the wall clock. Worlds saved before the clock was
   * wall-clocked adopt an anchor at boot that keeps their current time exactly
   * where it is — no jump, no lost hour — and are drift-free from then on.
   */
  anchorTo(anchorMs: number): void {
    this.anchorMs = anchorMs;
  }

  /**
   * Advance to the time it actually is. This is the only clock the server runs:
   * the simulation is caught up to the wall clock, never counted forward by a
   * timer, so a slow tick, a long GC pause or a redeploy cannot make an island
   * day longer than a real hour. A gap wider than `MAX_CATCHUP_SECONDS` is
   * skipped rather than simulated — the world slept, and wakes at the true hour.
   */
  advanceToWallClock(nowMs: number): GameEvent[] {
    if (this.anchorMs === undefined) return this.tick(this.balance.tickSeconds);
    const target = worldSecondsAt(nowMs, this.anchorMs);
    const gap = target - this.t;
    if (gap <= 0) return [];
    if (gap > MAX_CATCHUP_SECONDS) {
      // step over the sleep: the clock is read, then one live second is run
      this.t = target - 1;
      this.tickCarry = 0;
      return this.tick(1);
    }
    return this.tick(gap);
  }

  /**
   * The law this world actually runs under — creation overrides included.
   * Every layer above (hub, api, client) must read it from here; recomputing
   * from env drifts the sky away from the sim on worlds born with overrides.
   */
  get law(): Balance {
    return this.balance;
  }

  /**
   * Amend the world's law in place — a logged, replay-deterministic command
   * (the only lawful way to change balance after creation). The amendment
   * joins the creation overrides, so it survives serialization forever.
   */
  rebalance(partial: Partial<Balance>): void {
    this.overrides = { ...this.overrides, ...partial };
    this.balance = { ...DEFAULT_BALANCE, ...this.overrides };
  }

  islands(): Island[] {
    return [...this.islandsMap.values()];
  }

  island(id: string): Island | undefined {
    return this.islandsMap.get(id);
  }

  islandOf(secret: string): Island | undefined {
    const id = this.players.get(secret);
    return id ? this.islandsMap.get(id) : undefined;
  }

  feed(islandId: string): GameEvent[] {
    return this.feeds.get(islandId) ?? [];
  }

  // ── joining ──────────────────────────────────────────────────────────────

  join(input: {
    civ: CivId;
    secret?: string;
    publicKey?: string;
    name?: string;
  }): JoinResult {
    const secret =
      input.secret ??
      `s-${hashString(`${this.seed}|secret|${this.joinCount}`).toString(16)}`;
    const existingId = this.players.get(secret);
    if (existingId) {
      const existing = this.islandsMap.get(existingId)!;
      if (!existing.ruins) {
        // a returning ruler with a key pairs their unpaired island on the spot
        if (input.publicKey && !existing.ownerKey) existing.ownerKey = input.publicKey;
        return {
          secret,
          islandId: existingId,
          islandName: existing.name,
          isNew: false,
        };
      }
    }

    // one machine, one civilization: a key that already owns a living island
    // gets that island back — losing identity.json never founds a second one
    if (input.publicKey) {
      for (const [ownerSecret, islandId] of this.players) {
        const owned = this.islandsMap.get(islandId);
        if (owned && !owned.ruins && owned.ownerKey === input.publicKey) {
          return {
            secret: ownerSecret,
            islandId,
            islandName: owned.name,
            isNew: false,
          };
        }
      }
    }

    const civ = CIVS[input.civ];
    const n = this.joinCount++;
    const id = `island-${++this.idCounter}`;
    const islandSeed = hashString(`${this.seed}|island|${n}`);
    const r = this.balance.islandSpacing * Math.sqrt(n + 1);
    const theta = n * GOLDEN_ANGLE;
    const position: Vec2 = {
      x: Math.round(r * Math.cos(theta) * 100) / 100,
      y: Math.round(r * Math.sin(theta) * 100) / 100,
    };

    const terrain = generateIsland(islandSeed, this.balance.islandSize);
    const name =
      input.name?.trim().slice(0, 40) ||
      civ.islandNames[
        Math.floor(roll(islandSeed, "name") * civ.islandNames.length)
      ]!;

    const settlers: Settler[] = [];
    const taken = new Set<number>();
    for (let i = 0; i < 10; i++) {
      let idx = Math.floor(roll(islandSeed, "settler", i) * civ.nameBank.length);
      while (taken.has(idx)) idx = (idx + 1) % civ.nameBank.length;
      taken.add(idx);
      settlers.push({
        id: `${id}-s${i}`,
        name: civ.nameBank[idx]!,
        adult: true,
        bornAt: this.t,
        task: { kind: "idle" },
        pos: this.landTile(terrain, i),
        hungerDays: 0,
      });
    }

    const island: Island = {
      id,
      name,
      civ: input.civ,
      color: this.newCivColor(islandSeed),
      seed: islandSeed,
      age: "stone",
      kind: "home",
      origin: "home",
      ownerKey: input.publicKey,
      position,
      size: this.balance.islandSize,
      settlers,
      buildings: [],
      boats: [],
      nodes: terrain.nodes.map((node) => ({ ...node, pos: { ...node.pos } })),
      stocks: {
        food:
          this.balance.starterFoodDays *
          settlers.length *
          this.balance.foodPerSettlerPerDay,
      },
      workPoints: 0,
      ruins: false,
      dormant: false,
      lastPulseAt: this.t,
      lastPulseSeq: ++this.pulseSeq,
      settledAt: this.t,
      dayClock: secondsIntoDay(this.t, this.balance.daySeconds),
    };
    island.happiness = computeHappiness(island, this.balance).score;

    this.islandsMap.set(id, island);
    this.players.set(secret, id);
    this.feeds.set(id, []);
    this.emit({
      at: this.t,
      type: "founded",
      world: true,
      islandId: id,
      text: `A new island rises from the sea: ${name}, home of a ${civ.label} people.`,
    });
    return { secret, islandId: id, islandName: name, isNew: true };
  }

  /** Roll a founding civilization's banner color, distinct from every color
   * already flying anywhere in the world. Deterministic per island seed. */
  private newCivColor(islandSeed: number): string {
    const flying = [...this.islandsMap.values()]
      .map((i) => i.color)
      .filter((c): c is string => typeof c === "string");
    return pickCivColor(flying, mulberry32(hashString(`${islandSeed}|civ-color`)));
  }

  /** The color an island flies: its own if it is a founded civilization,
   * its ruler's if it is a colony, none if it is wild. Resolved at read time
   * so a conquest recolors a colony the instant it changes hands. */
  colorOf(island: Island): string | undefined {
    if (island.color) return island.color;
    if (island.ownerId) return this.islandsMap.get(island.ownerId)?.color;
    return undefined;
  }

  private landTile(terrain: ReturnType<typeof generateIsland>, salt: number): Vec2 {
    const land = terrain.tiles.filter((t) => t.kind === "grass");
    const pick = land[Math.floor(roll(terrain.tiles.length, "spawn", salt) * land.length)];
    return pick ? { x: pick.x, y: pick.y } : { x: terrain.size / 2, y: terrain.size / 2 };
  }

  // ── wild islands ─────────────────────────────────────────────────────────

  /** Every so often an empty island rises — free land, first come first served. */
  private maybeSpawnWild(batch: GameEvent[]): void {
    const interval = this.balance.wildSpawnIntervalSeconds;
    if (interval <= 0 || this.t % interval !== 0) return;
    const all = [...this.islandsMap.values()];
    const homes = all.filter((i) => i.kind === "home" && !i.ruins).length;
    const wilds = all.filter((i) => i.kind === "wild").length;
    if (homes === 0 || wilds >= Math.ceil(homes * this.balance.maxWildPerHome)) return;

    const n = this.wildCount++;
    const id = `island-${++this.idCounter}`;
    const islandSeed = hashString(`${this.seed}|wild|${n}`);
    // the same spiral as player islands, but half an angle-step out of phase,
    // so wild land rises between the settled rings and never on top of them
    const r = this.balance.islandSpacing * Math.sqrt(n + 1.5);
    const theta = n * GOLDEN_ANGLE + GOLDEN_ANGLE / 2;
    const terrain = generateIsland(islandSeed, this.balance.islandSize);
    const name = WILD_NAMES[Math.floor(roll(islandSeed, "name") * WILD_NAMES.length)]!;
    // the civ is a placeholder palette until colonists bring their own culture
    const civ = CIV_IDS[Math.floor(roll(islandSeed, "civ") * CIV_IDS.length)]!;

    const island: Island = {
      id,
      name,
      civ,
      seed: islandSeed,
      age: "stone",
      kind: "wild",
      origin: "neutral",
      position: {
        x: Math.round(r * Math.cos(theta) * 100) / 100,
        y: Math.round(r * Math.sin(theta) * 100) / 100,
      },
      size: this.balance.islandSize,
      settlers: [],
      buildings: [],
      boats: [],
      nodes: terrain.nodes.map((node) => ({ ...node, pos: { ...node.pos } })),
      stocks: {},
      workPoints: 0,
      ruins: false,
      dormant: false,
      lastPulseAt: this.t,
      lastPulseSeq: 0,
      dayClock: secondsIntoDay(this.t, this.balance.daySeconds),
    };
    island.happiness = computeHappiness(island, this.balance).score;
    this.islandsMap.set(id, island);
    this.feeds.set(id, []);
    const e: GameEvent = {
      at: this.t,
      type: "wild-island",
      world: true,
      islandId: id,
      text: `An empty island rises from the sea: ${name}. Its shores wait for whoever lands first.`,
    };
    this.emit(e);
    batch.push(e);
  }

  // ── pulses ───────────────────────────────────────────────────────────────

  pulse(secret: string, tokens: number): GameEvent[] {
    const island = this.islandOf(secret);
    if (!island) throw new Error("unknown player");
    const history = this.pulses.get(island.id) ?? [];
    const insp = computeInspiration(tokens, history, this.t, this.balance);
    history.push({ time: this.t, tokens });
    this.pulses.set(island.id, history);

    island.lastPulseAt = this.t;
    island.lastPulseSeq = ++this.pulseSeq;
    island.dormant = false;
    island.workPoints += insp.workPoints;
    // colonies live off their ruler's attention — a pulse at home wakes them too
    for (const other of this.islandsMap.values()) {
      if (other.kind === "colony" && other.ownerId === island.id) {
        other.lastPulseAt = this.t;
        other.dormant = false;
      }
    }

    const events: GameEvent[] = [];
    const surge = SURGE_TEXTS[
      Math.floor(roll(island.id, this.t, "surge") * SURGE_TEXTS.length)
    ]!;
    events.push({
      at: this.t,
      type: "work-surge",
      islandId: island.id,
      text: surge(island.name),
    });
    for (let i = 1; i < insp.events; i++) {
      const bustle = BUSTLE_TEXTS[
        Math.floor(roll(island.id, this.t, "bustle", i) * BUSTLE_TEXTS.length)
      ]!;
      events.push({
        at: this.t,
        type: "bustle",
        islandId: island.id,
        text: bustle(island.name),
      });
    }
    // Work arrives through pulses, so cross every newly-qualified age here in
    // the same durable command. The regular simulation step repeats this check
    // for restored/legacy state; changing `island.age` makes that pass a no-op.
    events.push(...this.advanceEligibleAges(island));
    for (const e of events) this.emit(e);
    return events;
  }

  /**
   * The handshake: bind an island to its Claude's public key. First key in
   * wins; after that, only requests signed by it may mutate the island.
   */
  pair(secret: string, publicKey: string): void {
    const island = this.islandOf(secret);
    if (!island) throw new Error("unknown player");
    if (!publicKey.trim()) throw new Error("a public key is required");
    if (island.ownerKey && island.ownerKey !== publicKey) {
      throw new Error("this island is already paired to another Claude");
    }
    island.ownerKey = publicKey;
  }

  /** The ruler renames their island — a world moment everyone hears about. */
  rename(secret: string, name: string): GameEvent[] {
    const island = this.islandOf(secret);
    if (!island) throw new Error("unknown player");
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) throw new Error("a name must have letters in it");
    const old = island.name;
    if (trimmed === old) return [];
    island.name = trimmed;
    const event: GameEvent = {
      at: this.t,
      type: "rename",
      islandId: island.id,
      world: true,
      text: `${old} shall henceforth be known as ${trimmed}.`,
    };
    this.emit(event);
    return [event];
  }

  // ── orders ───────────────────────────────────────────────────────────────

  applyOrders(secret: string, orders: Order[]): OrderOutcome[] {
    const island = this.islandOf(secret);
    if (!island) throw new Error("unknown player");
    return orders.map((order) => this.applyOrder(island, order));
  }

  private applyOrder(island: Island, order: Order): OrderOutcome {
    if (island.ruins) return { order, ok: false, reason: "the island is ruins" };
    switch (order.kind) {
      case "assign_gathering": {
        const unlocked = AGE_RESOURCES[island.age].includes(order.resource);
        if (!unlocked)
          return { order, ok: false, reason: `${order.resource} is beyond this age` };
        if (!island.nodes.some((nd) => nd.resource === order.resource && nd.remaining > 0))
          return { order, ok: false, reason: `no source of ${order.resource} remains` };
        let assigned = 0;
        for (const s of island.settlers) {
          if (assigned >= order.count) break;
          if (s.task.kind === "sail") continue;
          // re-picked per settler so the crew fans out instead of mobbing one node
          const node = this.leastCrowdedNode(island, order.resource);
          if (!node) break;
          s.task = { kind: "gather", resource: order.resource, nodeId: node.id };
          s.pos = { ...node.pos };
          assigned++;
        }
        return { order, ok: assigned > 0, reason: assigned ? undefined : "no settlers free" };
      }
      case "build": {
        if (order.building === "boat" || order.building === "plane")
          return { order, ok: false, reason: "craft rise at their yards — use build_boat or build_plane" };
        const spec = buildingSpec(order.building);
        if (!spec) return { order, ok: false, reason: "unknown building" };
        if (ageIndex(spec.age) > ageIndex(island.age))
          return { order, ok: false, reason: `${order.building} awaits the ${spec.age} age` };
        if (spec.wonder) {
          if (WONDER_CIV.get(spec.type) !== island.civ)
            return { order, ok: false, reason: "that wonder belongs to another people" };
          if (island.buildings.some((b) => b.type === spec.type))
            return { order, ok: false, reason: "that wonder already stands" };
        }
        if (!this.afford(island, spec.cost))
          return { order, ok: false, reason: "not enough resources" };
        this.spend(island, spec.cost);
        island.buildings.push({
          id: `${island.id}-b${++this.idCounter}`,
          type: order.building,
          stage: "site",
          progress: 0,
          pos: this.buildSite(island, order.building),
          age: island.age,
        });
        return { order, ok: true };
      }
      case "build_boat": {
        if (ageIndex(island.age) < ageIndex("bronze"))
          return { order, ok: false, reason: "boats await the bronze age" };
        const dock = island.buildings.find(
          (b) => b.type === "dock" && b.stage === "complete",
        );
        if (!dock) return { order, ok: false, reason: "a completed dock is needed" };
        const spec = buildingSpec("boat")!;
        if (!this.afford(island, spec.cost))
          return { order, ok: false, reason: "not enough resources" };
        this.spend(island, spec.cost);
        island.buildings.push({
          id: `${island.id}-b${++this.idCounter}`,
          type: "boat",
          stage: "site",
          progress: 0,
          pos: { ...dock.pos },
          age: island.age,
        });
        return { order, ok: true };
      }
      case "build_plane": {
        if (ageIndex(island.age) < ageIndex("modern"))
          return { order, ok: false, reason: "planes await the modern age" };
        const airfield = island.buildings.find(
          (b) => b.type === "airfield" && b.stage === "complete",
        );
        if (!airfield) return { order, ok: false, reason: "a completed airfield is needed" };
        const spec = buildingSpec("plane")!;
        if (!this.afford(island, spec.cost))
          return { order, ok: false, reason: "not enough resources" };
        this.spend(island, spec.cost);
        island.buildings.push({
          id: `${island.id}-b${++this.idCounter}`,
          type: "plane",
          stage: "site",
          progress: 0,
          pos: { ...airfield.pos },
          age: island.age,
        });
        return { order, ok: true };
      }
      case "voyage": {
        if (ageIndex(island.age) < ageIndex("bronze"))
          return { order, ok: false, reason: "voyages await the bronze age" };
        // the fastest craft in harbor takes the mission — planes over boats
        const docked = island.boats.filter((b) => b.state === "docked");
        const boat = docked.find((b) => b.craft === "plane") ?? docked[0];
        if (!boat) return { order, ok: false, reason: "no boat is docked" };
        const dest = this.islandsMap.get(order.dest);
        if (!dest || dest.ruins || dest.id === island.id)
          return { order, ok: false, reason: "no such destination" };
        const gate = this.voyageGate(island, dest, order.intent);
        if (gate) return { order, ok: false, reason: gate };
        const crewSize =
          order.intent === "colonize" ? this.balance.colonyCrew :
          order.intent === "attack" ? this.balance.raidCrew : 0;
        if (crewSize > 0) {
          const spare = island.settlers.filter(
            (s) => s.adult && s.task.kind !== "sail",
          );
          // the island is never emptied for an adventure
          if (spare.length < crewSize + 2)
            return { order, ok: false, reason: "not enough adults to spare" };
          const crew = spare.slice(0, crewSize);
          island.settlers = island.settlers.filter((s) => !crew.includes(s));
          boat.crew = crew.map((s) => ({ ...s, task: { kind: "idle" as const } }));
        }
        boat.state = "sailing";
        boat.dest = order.dest;
        boat.intent = order.intent;
        boat.pos = { ...island.position };
        const verb =
          order.intent === "colonize" ? "carrying settlers toward" :
          order.intent === "attack" ? "carrying raiders toward" : "bound for";
        this.emit({
          at: this.t,
          type: "boat-departs",
          islandId: island.id,
          text: `A ${boat.craft === "plane" ? "plane takes off" : "boat sets sail"} from ${island.name}, ${verb} ${dest.name}.`,
        });
        // the gate already proved the target is a rival colony — sound the bell
        if (order.intent === "attack") this.alertAttack(island, dest);
        return { order, ok: true };
      }
      case "advance_age": {
        const next = nextAge(island.age);
        if (!next) return { order, ok: false, reason: "the future age is the horizon" };
        const need = advanceRequirements(next, this.balance);
        if (island.workPoints < need)
          return {
            order,
            ok: false,
            reason: `needs ${Math.ceil(need)} work, has ${Math.floor(island.workPoints)}`,
          };
        const event = this.advanceOneAge(island, next);
        this.deferred.push(event);
        return { order, ok: true };
      }
      case "create":
        return this.applyCreate(island, order);
      case "dispatch":
        return this.applyDispatch(island, order);
      case "disband":
        return this.applyDisband(island, order);
    }
  }

  // ── player-invented creations ────────────────────────────────────────────

  /** A design by id or exact name (case-insensitive) — how orders refer to it. */
  private findSpec(island: Island, ref: string): CreationSpec | undefined {
    const specs = island.creationSpecs ?? [];
    return (
      specs.find((s) => s.id === ref) ??
      specs.find((s) => s.name.toLowerCase() === ref.trim().toLowerCase())
    );
  }

  /** Resolve a unit's design: this island's own, or — for a colony garrison —
   * the ruling home island's. */
  private specOf(island: Island, specId: string): CreationSpec | undefined {
    const own = (island.creationSpecs ?? []).find((s) => s.id === specId);
    if (own) return own;
    const owner = island.ownerId ? this.islandsMap.get(island.ownerId) : undefined;
    return (owner?.creationSpecs ?? []).find((s) => s.id === specId);
  }

  /** What a colony's creation garrison adds to its walls. */
  private creationDefense(island: Island): number {
    let sum = 0;
    for (const u of island.creations ?? []) {
      const spec = this.specOf(island, u.specId);
      if (spec) sum += unitDefense(spec);
    }
    return sum;
  }

  /** One number for "how hard this island is to take" — settlers, works, garrison. */
  private islandDefense(island: Island): number {
    return (
      island.settlers.filter((s) => s.adult).length +
      island.buildings.reduce(
        (sum, b) => sum + (b.stage === "complete" ? DEFENSE_BONUS[b.type] ?? 0 : 0),
        0,
      ) +
      this.creationDefense(island)
    );
  }

  private applyCreate(
    island: Island,
    order: Order & { kind: "create" },
  ): OrderOutcome {
    // defense in depth: every path into the world — API, MCP, log replay —
    // passes the same schema gate, even if a caller skipped parseOrders
    let input: CreationInput;
    try {
      input = parseCreationInput(order.creation);
    } catch {
      return { order, ok: false, reason: "the design gate refused it" };
    }
    const today = dayIndex(this.t, this.balance.daySeconds);
    const counter =
      island.createsOnDay?.day === today ? island.createsOnDay : { day: today, count: 0 };
    if (counter.count >= CREATION_LIMITS.maxCreatesPerDay)
      return {
        order,
        ok: false,
        reason: `the workshop rests — at most ${CREATION_LIMITS.maxCreatesPerDay} creations per island day`,
      };
    const units = (island.creations ??= []);
    const atSea = (island.creationBands ?? []).reduce((n, b) => n + b.units.length, 0);
    if (units.length + atSea + input.count > CREATION_LIMITS.maxUnitsPerIsland)
      return {
        order,
        ok: false,
        reason: `the island sustains at most ${CREATION_LIMITS.maxUnitsPerIsland} creation units`,
      };
    const specs = (island.creationSpecs ??= []);
    const existing = specs.find(
      (s) => s.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (!existing && specs.length >= CREATION_LIMITS.maxSpecsPerIsland)
      return {
        order,
        ok: false,
        reason: `at most ${CREATION_LIMITS.maxSpecsPerIsland} designs — disband one first`,
      };
    // reinforcing an existing design pays for ITS stats, never the resubmission's
    const stats = existing?.stats ?? input.stats;
    const cost = creationCost(stats, input.count);
    if (!this.afford(island, cost))
      return { order, ok: false, reason: "not enough resources" };
    this.spend(island, cost);
    let spec = existing;
    if (!spec) {
      spec = {
        id: `${island.id}-c${++this.idCounter}`,
        name: input.name,
        description: input.description,
        sprite: input.sprite,
        stats: input.stats,
        verbs: input.verbs,
        gathers: input.gathers,
        createdAt: this.t,
      };
      specs.push(spec);
    }
    const half = ((island.size ?? this.balance.islandSize) - 1) / 2;
    for (let i = 0; i < input.count; i++) {
      const id = `${island.id}-u${++this.idCounter}`;
      units.push({
        id,
        specId: spec.id,
        pos: {
          x: half + (roll(id, "cx") - 0.5) * 10,
          y: half + (roll(id, "cy") - 0.5) * 10,
        },
      });
    }
    counter.count += 1;
    island.createsOnDay = counter;
    const e: GameEvent = existing
      ? {
          at: this.t,
          type: "creation-reinforced",
          islandId: island.id,
          text: `${input.count} more of the ${spec.name} step forth on ${island.name}.`,
        }
      : {
          at: this.t,
          type: "creation-born",
          world: true,
          islandId: island.id,
          text: `${island.name} breathes life into a new creation: the ${spec.name}. ${input.count} step forth.`,
        };
    this.deferred.push(e);
    return { order, ok: true };
  }

  private applyDispatch(
    island: Island,
    order: Order & { kind: "dispatch" },
  ): OrderOutcome {
    if (ageIndex(island.age) < ageIndex("bronze"))
      return { order, ok: false, reason: "crossing the sea awaits the bronze age" };
    const spec = this.findSpec(island, order.creation);
    if (!spec) return { order, ok: false, reason: "no such creation design" };
    const home = (island.creations ?? []).filter((u) => u.specId === spec.id);
    if (home.length === 0)
      return { order, ok: false, reason: "no units of that design are home" };
    const dest = this.islandsMap.get(order.dest);
    if (!dest || dest.ruins || dest.id === island.id)
      return { order, ok: false, reason: "no such destination" };
    // the one law of the sea holds for every creature ever invented:
    if (this.sacred(dest))
      return { order, ok: false, reason: "home islands are sacred — they can never be attacked" };
    if (dest.kind === "wild")
      return { order, ok: false, reason: "no one holds it — colonize it with settlers instead" };
    const intent: CreationBand["intent"] =
      dest.ownerId === island.id ? "garrison" : "raid";
    if (intent === "raid" && !spec.verbs.includes("raid"))
      return {
        order,
        ok: false,
        reason: `the ${spec.name} were not made for war — only a design with the "raid" verb may attack`,
      };
    const count = Math.min(order.count ?? home.length, home.length);
    const taken = home.slice(0, count);
    island.creations = (island.creations ?? []).filter((u) => !taken.includes(u));
    (island.creationBands ??= []).push({
      id: `${island.id}-band${++this.idCounter}`,
      specId: spec.id,
      units: taken,
      pos: { ...island.position },
      dest: dest.id,
      intent,
      state: "outbound",
      speed: bandSpeed(spec.stats.speed),
    });
    const e: GameEvent = {
      at: this.t,
      type: "band-departs",
      world: intent === "raid",
      islandId: island.id,
      text:
        intent === "raid"
          ? `The ${spec.name} of ${island.name} set out across the sea to raid ${dest.name}.`
          : `The ${spec.name} of ${island.name} set out to stand guard over ${dest.name}.`,
    };
    this.deferred.push(e);
    if (intent === "raid") this.alertAttack(island, dest);
    return { order, ok: true };
  }

  private applyDisband(
    island: Island,
    order: Order & { kind: "disband" },
  ): OrderOutcome {
    const spec = this.findSpec(island, order.creation);
    if (!spec) return { order, ok: false, reason: "no such creation design" };
    island.creations = (island.creations ?? []).filter((u) => u.specId !== spec.id);
    // the design itself retires only when no unit anywhere still carries it
    const atSea = (island.creationBands ?? []).some((b) => b.specId === spec.id);
    const garrisoned = [...this.islandsMap.values()].some(
      (i) =>
        i.id !== island.id &&
        i.ownerId === island.id &&
        (i.creations ?? []).some((u) => u.specId === spec.id),
    );
    if (!atSea && !garrisoned)
      island.creationSpecs = (island.creationSpecs ?? []).filter((s) => s.id !== spec.id);
    this.deferred.push({
      at: this.t,
      type: "creation-disbanded",
      islandId: island.id,
      text: `The ${spec.name} of ${island.name} are released from service.`,
    });
    return { order, ok: true };
  }

  /**
   * Advance through every age whose cumulative work threshold is already met.
   * Age itself is the idempotency key: after a transition, the next check can
   * only consider the following age, and the final age has no successor.
   */
  private advanceEligibleAges(island: Island): GameEvent[] {
    const events: GameEvent[] = [];
    for (let next = nextAge(island.age); next; next = nextAge(island.age)) {
      if (island.workPoints < advanceRequirements(next, this.balance)) break;
      events.push(this.advanceOneAge(island, next));
    }
    return events;
  }

  /**
   * Every structure the civilization owns crosses into the age with it — one
   * cheap idempotent pass. Sites and half-built frames are stamped too, so a
   * building begun in the old age completes as a building of the new one.
   */
  private retrofitBuildings(island: Island, age: Age): void {
    for (const b of island.buildings) b.age = age;
  }

  private advanceOneAge(island: Island, next: NonNullable<ReturnType<typeof nextAge>>): GameEvent {
    island.age = next;
    this.retrofitBuildings(island, next);
    // A colony is part of its home civilization. Keep its laws and every
    // building model on the same age without inventing separate colony work.
    if (island.kind === "home") {
      for (const colony of this.islandsMap.values()) {
        if (colony.kind === "colony" && colony.ownerId === island.id) {
          colony.age = next;
          this.retrofitBuildings(colony, next);
        }
      }
    }
    return {
      at: this.t,
      type: "age-up",
      world: true,
      islandId: island.id,
      text: CIVS[island.civ].voice.ageUp.replace("{island}", island.name) +
        ` (${next} age)`,
    };
  }

  /**
   * The one law above all others: a founding island can never be taken.
   * Judged on the immutable `origin`, with the mutable `kind` as a second
   * lock — whichever field a bug or forged save corrupts, the other still
   * holds the door. Formerly-empty land is never sacred, no matter who
   * holds it today or how many times it has changed hands.
   */
  private sacred(island: Island): boolean {
    return island.origin === "home" || island.kind === "home";
  }

  /** The laws of the sea: who may sail where, for what. Null means "go ahead". */
  private voyageGate(from: Island, dest: Island, intent: VoyageIntent): string | null {
    switch (intent) {
      case "colonize":
        if (dest.kind !== "wild") return "only an empty island can be colonized";
        // a forged save could claim a home island is wild — origin still holds
        if (this.sacred(dest)) return "home islands are sacred — they can never be taken";
        return null;
      case "attack":
        if (this.sacred(dest)) return "home islands are sacred — they can never be attacked";
        if (dest.kind === "wild") return "no one holds it — colonize it instead";
        if (dest.ownerId === from.id) return "that colony already flies your banner";
        return null;
      default:
        if (dest.kind === "wild") return "no one lives there to meet you";
        return null;
    }
  }

  /**
   * The law of conquest names: land that rose empty from the sea takes the
   * name of whoever holds it. Colonize it or storm it and it is renamed for
   * the conqueror's civilization — until somebody else takes it in turn.
   */
  private adoptConquerorName(colony: Island, conqueror: Island): void {
    if (this.sacred(colony)) return; // founding islands keep their own names
    colony.name = conqueror.name;
  }

  private afford(island: Island, cost: Partial<Record<ResourceId, number>>): boolean {
    return Object.entries(cost).every(
      ([res, amt]) => (island.stocks[res as ResourceId] ?? 0) >= (amt ?? 0),
    );
  }

  private spend(island: Island, cost: Partial<Record<ResourceId, number>>): void {
    for (const [res, amt] of Object.entries(cost)) {
      island.stocks[res as ResourceId] =
        (island.stocks[res as ResourceId] ?? 0) - (amt ?? 0);
    }
  }

  /** buildings that only make sense at the water's edge */
  private static readonly COASTAL = new Set(["dock", "fishing-hut"]);

  /** an island's terrain at its own size — old saves predate the size field */
  private islandTerrain(island: Island): ReturnType<typeof generateIsland> {
    return generateIsland(island.seed, island.size ?? this.balance.islandSize);
  }

  /** beach tiles touching open water — where piers and fishing huts belong */
  private shoreTiles(terrain: ReturnType<typeof generateIsland>): Tile[] {
    const kindAt = new Map(terrain.tiles.map((t) => [`${t.x},${t.y}`, t.kind]));
    return terrain.tiles.filter(
      (tl) =>
        tl.kind === "sand" &&
        (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        ).some(([dx, dy]) => kindAt.get(`${tl.x + dx},${tl.y + dy}`) === "water"),
    );
  }

  private buildSite(island: Island, type: string): Vec2 {
    const terrain = this.islandTerrain(island);
    const half = (terrain.size - 1) / 2;
    const clear = (tl: Tile, gap: number) =>
      island.buildings.every((b) => Math.hypot(b.pos.x - tl.x, b.pos.y - tl.y) >= gap);
    if (World.COASTAL.has(type)) {
      // the pier rises on the beach nearest the town, never inland
      const bs = island.buildings;
      const cx = bs.length ? bs.reduce((sum, b) => sum + b.pos.x, 0) / bs.length : half;
      const cy = bs.length ? bs.reduce((sum, b) => sum + b.pos.y, 0) / bs.length : half;
      const shore = this.shoreTiles(terrain).sort(
        (a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy),
      );
      const spot = shore.find((tl) => clear(tl, 3)) ?? shore.find((tl) => clear(tl, 1)) ?? shore[0];
      if (spot) return { x: spot.x, y: spot.y };
    }
    const candidates = terrain.tiles
      .filter((tl) => tl.kind === "grass" || tl.kind === "sand")
      .sort(
        (a, b) =>
          Math.hypot(a.x - half, a.y - half) - Math.hypot(b.x - half, b.y - half),
      );
    // buildings span several tiles on screen, so sites need breathing room;
    // if the town gets so dense nothing qualifies, fall back to any free tile
    const GAP = 5;
    const free = candidates.find((tl) => clear(tl, GAP)) ?? candidates.find((tl) => clear(tl, 1));
    return free ? { x: free.x, y: free.y } : { x: half, y: half };
  }

  /** one-time fixup when the world's islands outgrow an old save: the terrain
   * noise is sampled in size-normalized coordinates, so the same seed at a
   * larger size is the same island scaled up — everything on it slides
   * outward proportionally, and the newly exposed land brings fresh nature */
  private growIsland(island: Island): void {
    const size = this.balance.islandSize;
    const old = island.size ?? 64;
    if (old >= size) {
      island.size ??= old;
      return;
    }
    const f = size / old;
    const scale = (p: Vec2) => {
      p.x *= f;
      p.y *= f;
    };
    for (const b of island.buildings) scale(b.pos);
    for (const s of island.settlers) scale(s.pos);
    for (const n of island.nodes) scale(n.pos);
    island.size = size;
    // the bigger island rolls its own, richer set of nodes — keep the old
    // ones (settler tasks point at them) and add whatever lands on new ground
    const taken = (p: Vec2) =>
      island.nodes.some((n) => Math.hypot(n.pos.x - p.x, n.pos.y - p.y) < 2);
    let added = 0;
    for (const node of generateIsland(island.seed, size).nodes) {
      if (taken(node.pos)) continue;
      island.nodes.push({ ...node, id: `node-g${old}-${added++}`, pos: { ...node.pos } });
    }
  }

  /** the wild resources every island has always known */
  private static readonly WILDS = new Set<string>(["food", "wood", "stone"]);

  /** one-time fixup for saves born before minerals existed: the ground held
   * them all along — copy the terrain's lodes into the island's live nodes */
  private seedMinerals(island: Island): void {
    if (island.nodes.some((n) => !World.WILDS.has(n.resource))) return;
    let i = 0;
    for (const node of this.islandTerrain(island).nodes) {
      if (World.WILDS.has(node.resource)) continue;
      island.nodes.push({ ...node, id: `node-m${i++}`, pos: { ...node.pos } });
    }
  }

  /** one-time fixup for saves from before the coast rule: inland docks and
   * fishing huts walk down to the nearest shore, boat hulls follow the pier */
  private settleCoast(island: Island): void {
    if (!island.buildings.some((b) => World.COASTAL.has(b.type))) return;
    const terrain = this.islandTerrain(island);
    const shore = this.shoreTiles(terrain);
    if (!shore.length) return;
    const onShore = (p: Vec2) =>
      shore.some((tl) => tl.x === Math.round(p.x) && tl.y === Math.round(p.y));
    for (const b of island.buildings) {
      if (!World.COASTAL.has(b.type) || onShore(b.pos)) continue;
      const near = [...shore].sort(
        (s1, s2) =>
          Math.hypot(s1.x - b.pos.x, s1.y - b.pos.y) -
          Math.hypot(s2.x - b.pos.x, s2.y - b.pos.y),
      )[0]!;
      b.pos = { x: near.x, y: near.y };
    }
    const dock = island.buildings.find((b) => b.type === "dock");
    if (dock) {
      for (const hull of island.buildings) {
        if (hull.type === "boat") hull.pos = { ...dock.pos };
      }
    }
  }

  // ── simulation ───────────────────────────────────────────────────────────

  tick(dtSeconds: number): GameEvent[] {
    const batch: GameEvent[] = [];
    this.tickCarry += dtSeconds;
    while (this.tickCarry >= 1) {
      this.tickCarry -= 1;
      this.step(batch);
    }
    return batch;
  }

  private step(batch: GameEvent[]): void {
    this.t += 1;
    if (this.deferred.length) {
      for (const e of this.deferred) {
        this.emit(e);
        batch.push(e);
      }
      this.deferred = [];
    }
    this.maybeSpawnWild(batch);
    // one sun for the whole ocean: night and the day boundary come from world
    // time, so no island keeps a private clock that drifts while it sleeps —
    // and nobody's sky depends on which island a viewer happens to watch
    const clock = secondsIntoDay(this.t, this.balance.daySeconds);
    const night = isNight(this.t, this.balance.daySeconds, this.balance.daylightShare);
    // the day turns when the world's day *number* changes, so a clock that
    // jumps a gap still turns it exactly once instead of stepping over dawn
    const today = dayIndex(this.t, this.balance.daySeconds);
    const dayTurns = today !== this.dayIndex;
    this.dayIndex = today;
    for (const island of this.islandsMap.values()) {
      // the clock a viewer reads is the world's, on every island alike
      island.dayClock = clock;
      if (island.ruins || island.kind === "wild") continue;
      for (const event of this.advanceEligibleAges(island)) {
        this.emit(event);
        batch.push(event);
      }
      island.dormant =
        this.t - island.lastPulseAt > this.balance.dormancyHours * 3600;
      if (island.dormant) continue;

      this.foodInvariant(island);
      // after sundown the town rests: no gathering, no building until dawn —
      // only the ships at sea keep moving under the stars
      if (night) {
        this.nightRest(island);
      } else {
        this.autoTask(island);
        this.gather(island);
        this.construct(island, batch);
      }
      // creations are tireless constructs — they work and watch through the night
      this.creationsAct(island);
      this.sail(island, batch);
      this.marchBands(island, batch);

      // dawn: the whole ocean turns its day together. A town that landed
      // yesterday evening is spared the first one — nobody eats a full day's
      // stores an hour after stepping ashore.
      if (dayTurns && this.t - (island.settledAt ?? 0) >= this.balance.daySeconds) {
        this.daily(island, batch);
      }
    }
  }

  /**
   * The open node of this resource with the fewest settlers already working
   * it — crews spread across the island instead of stacking on one spot.
   */
  private leastCrowdedNode(island: Island, resource: ResourceId) {
    const open = island.nodes.filter((n) => n.resource === resource && n.remaining > 0);
    if (open.length === 0) return undefined;
    const load = new Map<string, number>();
    for (const s of island.settlers) {
      if (s.task.kind === "gather")
        load.set(s.task.nodeId, (load.get(s.task.nodeId) ?? 0) + 1);
    }
    let best = open[0]!;
    for (const n of open) {
      if ((load.get(n.id) ?? 0) < (load.get(best.id) ?? 0)) best = n;
    }
    return best;
  }

  /** Hard rule (council carry-forward 5): hungry islands always send someone for food. */
  private foodInvariant(island: Island): void {
    const need = island.settlers.length * this.balance.foodPerSettlerPerDay;
    if ((island.stocks.food ?? 0) >= need) return;
    const gathering = island.settlers.some(
      (s) => s.task.kind === "gather" && s.task.resource === "food",
    );
    if (gathering) return;
    const node = this.leastCrowdedNode(island, "food");
    if (!node) return;
    const pick =
      island.settlers.find((s) => s.task.kind === "idle") ??
      island.settlers.find((s) => s.task.kind === "relax") ??
      island.settlers.find((s) => s.task.kind === "gather") ??
      island.settlers.find((s) => s.task.kind === "build");
    if (pick) {
      pick.task = { kind: "gather", resource: "food", nodeId: node.id };
      pick.pos = { ...node.pos };
    }
  }

  /** Everyone not at sea walks home for the night — to their own bed if they
   * have one, to any hearth-lit house if not. Tasks keep; work waits for dawn. */
  private nightRest(island: Island): void {
    const anyHome = island.buildings.find(
      (b) => b.stage === "complete" && (buildingSpec(b.type)?.houses ?? 0) > 0,
    );
    const half = ((island.size ?? this.balance.islandSize) - 1) / 2;
    for (const s of island.settlers) {
      if (s.task.kind === "sail") continue;
      const home =
        island.buildings.find((b) => b.id === s.houseId) ?? anyHome;
      const spot = home?.pos ?? { x: half, y: half };
      s.pos = {
        x: spot.x + (roll(island.seed, "sleep", s.id) - 0.5) * 2,
        y: spot.y + 1 + roll(island.seed, "sleep-y", s.id),
      };
    }
  }

  /**
   * Settlers act on their own judgment — nobody stands idle. Food comes first
   * until two days of meals are stored; after that, hands split between wood
   * and stone. The ruler's orders still re-task anyone at any time.
   */
  private autoTask(island: Island): void {
    for (const s of island.settlers) {
      // a relaxer stranded far from their chosen porch — a night walked home,
      // a law amended mid-day — strolls back out to it instead of loitering
      if (s.task.kind === "relax") {
        const task = s.task;
        const spot = island.buildings.find((b) => b.id === task.buildingId);
        if (spot && Math.hypot(s.pos.x - spot.pos.x, s.pos.y - spot.pos.y) > 4) {
          s.pos = {
            x: spot.pos.x + roll(island.seed, "leisure", s.id) * 2 - 1,
            y: spot.pos.y + roll(island.seed, "leisure-y", s.id) * 2 - 1,
          };
        }
        continue;
      }
      if (s.task.kind !== "idle") continue;
      const counts: Record<"food" | "wood" | "stone", number> = { food: 0, wood: 0, stone: 0 };
      for (const x of island.settlers) {
        if (x.task.kind === "gather" && x.task.resource in counts)
          counts[x.task.resource as keyof typeof counts]++;
      }
      const hungry =
        (island.stocks.food ?? 0) <
          island.settlers.length * this.balance.foodPerSettlerPerDay * 2 &&
        counts.food < Math.ceil(island.settlers.length / 3);
      const wish: ResourceId[] = hungry
        ? ["food", "wood", "stone"]
        : counts.wood <= counts.stone
          ? ["wood", "stone", "food"]
          : ["stone", "wood", "food"];
      for (const resource of wish) {
        const node = this.leastCrowdedNode(island, resource);
        if (!node) continue;
        s.task = { kind: "gather", resource, nodeId: node.id };
        s.pos = { ...node.pos };
        break;
      }
      // the primal nodes can run dry on a well-harvested island — rather
      // than stand idle forever, hands turn to whatever the age unlocks
      if (s.task.kind === "idle") {
        for (const resource of AGE_RESOURCES[island.age]) {
          const node = this.leastCrowdedNode(island, resource);
          if (!node) continue;
          s.task = { kind: "gather", resource, nodeId: node.id };
          s.pos = { ...node.pos };
          break;
        }
      }
      // and when the whole island is mined out, the people are never a crowd
      // of statues — they spread through the parks, baths, and porches, at
      // leisure until new work appears (builds and orders still draft them)
      if (s.task.kind === "idle") {
        const spots = island.buildings.filter((b) => {
          const spec = buildingSpec(b.type);
          return (
            b.stage === "complete" &&
            ((spec?.joy ?? 0) > 0 || (spec?.houses ?? 0) > 0) &&
            !spec?.wonder
          );
        });
        const spot =
          spots[Math.floor(roll(island.seed, "spot", s.id) * Math.max(1, spots.length))];
        if (spot) {
          s.task = { kind: "relax", buildingId: spot.id };
          s.pos = {
            x: spot.pos.x + roll(island.seed, "leisure", s.id) * 2 - 1,
            y: spot.pos.y + roll(island.seed, "leisure-y", s.id) * 2 - 1,
          };
        }
      }
    }
  }

  /**
   * The settlers' own building judgment, once per day: house everyone, keep
   * food growing, open the harbor — and when the stores overflow, raise
   * whatever the age allows. Never more sites than the crews can staff, and
   * never a build that eats into two days of meals.
   */
  private autoPlan(island: Island, batch: GameEvent[]): void {
    const sites = island.buildings.filter((b) => b.stage !== "complete").length;
    const maxSites = Math.max(
      1,
      Math.min(3, Math.floor(island.settlers.length / (BUILD_CREW * 2))),
    );
    if (sites >= maxSites) return;
    const reserve =
      island.settlers.length * this.balance.foodPerSettlerPerDay * 2;
    if ((island.stocks.food ?? 0) < reserve) return;
    const buildable = (spec: BuildingSpec) =>
      ageIndex(spec.age) <= ageIndex(island.age) &&
      this.afford(island, spec.cost) &&
      (island.stocks.food ?? 0) - (spec.cost.food ?? 0) >= reserve;
    const pick = this.judgeBuild(island, buildable);
    if (!pick) return;
    this.spend(island, pick.cost);
    island.buildings.push({
      id: `${island.id}-b${++this.idCounter}`,
      type: pick.type,
      stage: "site",
      progress: 0,
      pos: this.buildSite(island, pick.type),
      age: island.age,
    });
    const e: GameEvent = {
      at: this.t,
      type: "ground-broken",
      islandId: island.id,
      text: `The settlers of ${island.name} judge a ${pick.type} necessary and break ground.`,
    };
    this.emit(e);
    batch.push(e);
  }

  /** What the island needs most: beds, bread, a harbor, the works, then glory. */
  private judgeBuild(
    island: Island,
    buildable: (spec: BuildingSpec) => boolean,
  ): BuildingSpec | undefined {
    const catalog = BUILDINGS.filter((b) => b.type !== "boat" && b.type !== "plane");
    const beds = island.buildings.reduce(
      (sum, b) => sum + (buildingSpec(b.type)?.houses ?? 0),
      0,
    );
    const harvest = island.buildings.reduce(
      (sum, b) => sum + (buildingSpec(b.type)?.foodPerDay ?? 0),
      0,
    );
    const meals = island.settlers.length * this.balance.foodPerSettlerPerDay;
    // more beds mean more mouths — only expand while the land can bear them:
    // farms feeding everyone, or at least ten days of wild food still standing
    const wildFood = island.nodes.reduce(
      (sum, n) => sum + (n.resource === "food" ? n.remaining : 0),
      0,
    );
    const canFeedMore = harvest >= meals || wildFood > meals * 10;
    if (island.settlers.length > beds && canFeedMore) {
      const homes = catalog.filter((b) => (b.houses ?? 0) > 0 && buildable(b));
      if (homes.length)
        return homes.reduce((a, b) => ((b.houses ?? 0) > (a.houses ?? 0) ? b : a));
    }
    if (harvest < meals / 2) {
      const farms = catalog.filter((b) => (b.foodPerDay ?? 0) > 0 && buildable(b));
      if (farms.length)
        return farms.reduce((a, b) =>
          (b.foodPerDay ?? 0) > (a.foodPerDay ?? 0) ? b : a,
        );
    }
    if (
      ageIndex(island.age) >= ageIndex("bronze") &&
      !island.buildings.some((b) => b.type === "dock")
    ) {
      const dock = buildingSpec("dock")!;
      if (buildable(dock)) return dock;
    }
    // the works: a refinery whose feedstock lies in heaps while its product
    // sits at zero is a need, not a luxury — even one from a blitzed-past age
    const works = catalog.find((b) => {
      const conv = b.converts;
      if (!conv) return false;
      return (
        ageIndex(b.age) <= ageIndex(island.age) &&
        !island.buildings.some((x) => x.type === b.type) &&
        (island.stocks[conv.from] ?? 0) >= conv.perDay * 10 &&
        (island.stocks[conv.to] ?? 0) <= 0 &&
        buildable(b)
      );
    });
    if (works) return works;
    // prosperity builds: anything this age or an earlier one allows — only
    // with double the cost banked, and never a repeat
    const dayIndex = Math.floor(this.t / this.balance.daySeconds);
    const flush = catalog.filter(
      (b) =>
        ageIndex(b.age) <= ageIndex(island.age) &&
        buildable(b) &&
        !island.buildings.some((x) => x.type === b.type) &&
        this.afford(
          island,
          Object.fromEntries(
            Object.entries(b.cost).map(([r, amt]) => [r, (amt ?? 0) * 2]),
          ) as Partial<Record<ResourceId, number>>,
        ),
    );
    if (!flush.length) return undefined;
    return flush[Math.floor(roll(island.seed, "judge", dayIndex) * flush.length)];
  }

  private gather(island: Island): void {
    for (const s of island.settlers) {
      if (s.task.kind !== "gather") continue;
      const task = s.task;
      const node = island.nodes.find((n) => n.id === task.nodeId);
      if (!node || node.remaining <= 0) {
        const alt = this.leastCrowdedNode(island, task.resource);
        if (!alt) {
          s.task = { kind: "idle" };
          continue;
        }
        task.nodeId = alt.id;
        s.pos = { ...alt.pos };
        continue;
      }
      const take = Math.min(GATHER_RATE, node.remaining);
      node.remaining -= take;
      island.stocks[task.resource] = (island.stocks[task.resource] ?? 0) + take;
    }
  }

  private construct(island: Island, batch: GameEvent[]): void {
    for (const b of island.buildings) {
      if (b.stage === "complete") continue;
      let crew = island.settlers.filter(
        (s) => s.task.kind === "build" && s.task.buildingId === b.id,
      );
      if (crew.length < BUILD_CREW) {
        for (const s of island.settlers) {
          if (crew.length >= BUILD_CREW) break;
          if (s.task.kind === "idle") {
            s.task = { kind: "build", buildingId: b.id };
            s.pos = { ...b.pos };
            crew = [...crew, s];
          }
        }
      }
      // still short-handed: pull gatherers off wood and stone — but never off
      // food, so the food invariant's guarantee stays intact
      if (crew.length < BUILD_CREW) {
        for (const s of island.settlers) {
          if (crew.length >= BUILD_CREW) break;
          if (s.task.kind === "gather" && s.task.resource !== "food") {
            s.task = { kind: "build", buildingId: b.id };
            s.pos = { ...b.pos };
            crew = [...crew, s];
          }
        }
      }
      // and only when no other hands remain does leisure yield to labor —
      // the mined-out island still raises its buildings, park by park
      if (crew.length < BUILD_CREW) {
        for (const s of island.settlers) {
          if (crew.length >= BUILD_CREW) break;
          if (s.task.kind === "relax") {
            s.task = { kind: "build", buildingId: b.id };
            s.pos = { ...b.pos };
            crew = [...crew, s];
          }
        }
      }
      if (crew.length === 0) continue;
      if (b.stage === "site") b.stage = "construction";
      const spec = buildingSpec(b.type);
      b.progress += crew.length;
      if (spec && b.progress >= spec.buildSeconds) {
        b.stage = "complete";
        const lead = crew[0]!;
        for (const s of crew) if (s.task.kind === "build") s.task = { kind: "idle" };
        if (b.type === "boat" || b.type === "plane") {
          island.buildings = island.buildings.filter((x) => x.id !== b.id);
          island.boats.push({
            id: `${island.id}-${b.type}${++this.idCounter}`,
            pos: { ...island.position },
            state: "docked",
            craft: b.type,
          });
        }
        // a finished wonder is a world moment; ordinary works stay local news
        const e: GameEvent = spec.wonder
          ? {
              at: this.t,
              type: "wonder-complete",
              world: true,
              islandId: island.id,
              settler: lead.name,
              text: `The ${titleCase(b.type)} stands complete on ${island.name} — a wonder of the ${CIVS[island.civ].label} people, for all the ocean to envy.`,
            }
          : {
              at: this.t,
              type: "build-complete",
              islandId: island.id,
              settler: lead.name,
              text: CIVS[island.civ].voice.build
                .replace("{name}", lead.name)
                .replace("{building}", b.type),
            };
        this.emit(e);
        batch.push(e);
      }
    }
  }

  /**
   * The standing life of every creation on this island's soil, one second at a
   * time — all of it stateless off (t, id), so replay lands every golem on the
   * same tile. Gatherers harvest by their power; patrollers walk their rounds;
   * guards and performers hold their posts.
   */
  private creationsAct(island: Island): void {
    const units = island.creations;
    if (!units?.length) return;
    const half = ((island.size ?? this.balance.islandSize) - 1) / 2;
    const guardPost = (() => {
      const works = island.buildings.filter((b) => b.stage === "complete");
      if (!works.length) return { x: half, y: half };
      const cx = works.reduce((s, b) => s + b.pos.x, 0) / works.length;
      const cy = works.reduce((s, b) => s + b.pos.y, 0) / works.length;
      return { x: cx, y: cy };
    })();
    const stagePos = (() => {
      const joyful = island.buildings.find(
        (b) => b.stage === "complete" && (buildingSpec(b.type)?.joy ?? 0) > 0,
      );
      return joyful?.pos ?? guardPost;
    })();
    units.forEach((u, idx) => {
      const spec = this.specOf(island, u.specId);
      if (!spec) return;
      switch (homeActivity(spec.verbs)) {
        case "gather": {
          if (!spec.gathers) return;
          let node = island.nodes.find((n) => n.id === u.nodeId && n.remaining > 0);
          if (!node) {
            node = this.leastCrowdedNode(island, spec.gathers);
            u.nodeId = node?.id;
            if (node) u.pos = { ...node.pos };
          }
          if (!node) return;
          const take = Math.min(
            CREATION_GATHER_RATE_PER_POWER * spec.stats.power,
            node.remaining,
          );
          node.remaining -= take;
          island.stocks[spec.gathers] = (island.stocks[spec.gathers] ?? 0) + take;
          return;
        }
        case "patrol": {
          // each patroller rides its own deterministic ring around the town
          const radius = half * (0.35 + roll(u.id, "ring") * 0.3);
          const period = Math.max(60, 300 - spec.stats.speed * 20);
          const angle =
            ((this.t % period) / period) * Math.PI * 2 + roll(u.id, "phase") * Math.PI * 2;
          u.pos = {
            x: half + Math.cos(angle) * radius,
            y: half + Math.sin(angle) * radius,
          };
          return;
        }
        case "guard": {
          u.pos = {
            x: guardPost.x + (roll(u.id, "gx") - 0.5) * 6,
            y: guardPost.y + (roll(u.id, "gy") - 0.5) * 6,
          };
          return;
        }
        case "perform": {
          u.pos = {
            x: stagePos.x + Math.cos(this.t / 7 + idx) * 2,
            y: stagePos.y + Math.sin(this.t / 7 + idx) * 2,
          };
          return;
        }
        default:
          return;
      }
    });
  }

  /** Dispatched bands cross the open sea under their own power. */
  private marchBands(island: Island, batch: GameEvent[]): void {
    const bands = island.creationBands;
    if (!bands?.length) return;
    const finished = new Set<string>();
    for (const band of bands) {
      const target =
        band.state === "outbound"
          ? this.islandsMap.get(band.dest)?.position
          : island.position;
      if (!target) {
        band.state = "returning";
        continue;
      }
      const dx = target.x - band.pos.x;
      const dy = target.y - band.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > band.speed) {
        band.pos = {
          x: band.pos.x + (dx / dist) * band.speed,
          y: band.pos.y + (dy / dist) * band.speed,
        };
        continue;
      }
      band.pos = { x: target.x, y: target.y };
      if (band.state === "returning") {
        // home again: the units step ashore and take up their posts
        const half = ((island.size ?? this.balance.islandSize) - 1) / 2;
        const units = (island.creations ??= []);
        for (const u of band.units) {
          u.pos = { x: half, y: half };
          u.nodeId = undefined;
          units.push(u);
        }
        finished.add(band.id);
        continue;
      }
      const dest = this.islandsMap.get(band.dest);
      if (!dest || dest.ruins) {
        band.state = "returning";
        continue;
      }
      if (this.bandArrives(island, dest, band, batch)) finished.add(band.id);
      else band.state = "returning";
    }
    if (finished.size)
      island.creationBands = bands.filter((b) => !finished.has(b.id));
  }

  /**
   * Landfall for a creation band. True means the band is spent — its units
   * moved ashore or were lost; false sends it home. The same conquest law as
   * settler raids: strictly more force than the defense takes the colony.
   * Home islands never reach here — the dispatch gate refuses them.
   */
  private bandArrives(
    from: Island,
    to: Island,
    band: CreationBand,
    batch: GameEvent[],
  ): boolean {
    const spec = (from.creationSpecs ?? []).find((s) => s.id === band.specId);
    if (!spec || band.units.length === 0) return true; // design retired mid-voyage
    const half = ((to.size ?? this.balance.islandSize) - 1) / 2;
    const landUnits = () => {
      const units = (to.creations ??= []);
      for (const u of band.units) {
        u.pos = { x: half, y: half };
        u.nodeId = undefined;
        units.push(u);
      }
    };
    if (band.intent === "garrison") {
      // still ours? then stand guard. Lost at sea-time? turn for home.
      if (to.kind !== "colony" || to.ownerId !== from.id) return false;
      landUnits();
      const e: GameEvent = {
        at: this.t,
        type: "band-garrison",
        islandId: to.id,
        text: `The ${spec.name} of ${from.name} now stand guard over ${to.name}.`,
      };
      this.emit(e);
      batch.push(e);
      return true;
    }
    // a raid — but only a rival colony is ever a lawful target
    if (this.sacred(to) || to.kind !== "colony" || to.ownerId === from.id) return false;
    const attack = bandPower(spec, band.units.length);
    const defense = this.islandDefense(to);
    if (attack > defense) {
      const fallenName = to.name;
      to.ownerId = from.id;
      // conquered land joins the conqueror's civilization — colors and age both,
      // and every standing building crosses into that age with it
      to.civ = from.civ;
      to.age = from.age;
      this.retrofitBuildings(to, from.age);
      to.lastPulseAt = this.t;
      to.dormant = false;
      // the fallen defenders' constructs are broken with them
      to.creations = [];
      this.adoptConquerorName(to, from);
      landUnits();
      const e: GameEvent = {
        at: this.t,
        type: "conquest",
        world: true,
        islandId: to.id,
        text: `The ${spec.name} of ${from.name} storm ${fallenName} — the colony changes hands and now bears the name ${to.name}.`,
      };
      this.emit(e);
      batch.push(e);
      return true;
    }
    const fell: GameEvent = {
      at: this.t,
      type: "raid-repelled",
      world: true,
      islandId: to.id,
      text: `${to.name} shatters the ${spec.name} of ${from.name} upon its walls; none return.`,
    };
    this.emit(fell);
    this.emit({ ...fell, islandId: from.id });
    batch.push(fell);
    return true; // the band is lost
  }

  private sail(island: Island, batch: GameEvent[]): void {
    for (const boat of island.boats) {
      if (boat.state === "docked") continue;
      const target =
        boat.state === "sailing"
          ? this.islandsMap.get(boat.dest!)?.position
          : island.position;
      if (!target) {
        boat.state = "docked";
        continue;
      }
      const dx = target.x - boat.pos.x;
      const dy = target.y - boat.pos.y;
      const dist = Math.hypot(dx, dy);
      const step =
        boat.craft === "plane" ? this.balance.planeSpeed : this.balance.boatSpeed;
      if (dist > step) {
        boat.pos = { x: boat.pos.x + (dx / dist) * step, y: boat.pos.y + (dy / dist) * step };
        continue;
      }
      boat.pos = { x: target.x, y: target.y };
      if (boat.state === "returning") {
        boat.state = "docked";
        boat.dest = undefined;
        boat.intent = undefined;
        // whoever is still aboard steps ashore and goes back to work
        if (boat.crew?.length) {
          for (const s of boat.crew) {
            s.task = { kind: "idle" };
            s.pos = {
              x: ((island.size ?? this.balance.islandSize) - 1) / 2,
              y: ((island.size ?? this.balance.islandSize) - 1) / 2,
            };
            island.settlers.push(s);
          }
          boat.crew = undefined;
        }
        continue;
      }
      const dest = this.islandsMap.get(boat.dest!);
      if (dest && !dest.ruins) this.arrive(island, dest, boat, batch);
      boat.state = "returning";
    }
  }

  private arrive(from: Island, to: Island, boat: Boat, batch: GameEvent[]): void {
    const intent = boat.intent!;
    if (intent === "colonize") {
      this.arriveColonize(from, to, boat, batch);
      return;
    }
    if (intent === "attack") {
      this.arriveAttack(from, to, boat, batch);
      return;
    }
    const pairKey = [from.id, to.id].sort().join("~");
    if (!this.voyagePairs.has(pairKey)) {
      this.voyagePairs.add(pairKey);
      const e: GameEvent = {
        at: this.t,
        type: "first-voyage",
        world: true,
        islandId: from.id,
        text: `For the first time, sails pass between ${from.name} and ${to.name}.`,
      };
      this.emit(e);
      batch.push(e);
    }
    if (intent === "trade") {
      this.give(from, to, this.topStock(from, true));
      this.give(to, from, this.topStock(to, true));
      const e: GameEvent = {
        at: this.t,
        type: "trade",
        islandId: from.id,
        text: `${from.name} and ${to.name} trade goods at the harbor.`,
      };
      this.emit(e);
      batch.push(e);
    } else {
      this.give(from, to, this.topStock(from, false));
      const e: GameEvent = {
        at: this.t,
        type: "help",
        islandId: to.id,
        text: `${from.name} brings aid to the people of ${to.name}.`,
      };
      this.emit(e);
      batch.push(e);
    }
  }

  /** Largest stock; trade barters goods (non-food), help sends anything including food. */
  private topStock(island: Island, excludeFood: boolean): ResourceId | null {
    let best: ResourceId | null = null;
    let bestAmt = 0;
    for (const [res, amt] of Object.entries(island.stocks)) {
      if (excludeFood && res === "food") continue;
      if ((amt ?? 0) > bestAmt) {
        bestAmt = amt ?? 0;
        best = res as ResourceId;
      }
    }
    return best;
  }

  private give(from: Island, to: Island, res: ResourceId | null): void {
    if (!res) return;
    const amount = Math.max(1, Math.floor((from.stocks[res] ?? 0) * 0.1));
    if ((from.stocks[res] ?? 0) < amount) return;
    from.stocks[res] = (from.stocks[res] ?? 0) - amount;
    to.stocks[res] = (to.stocks[res] ?? 0) + amount;
  }

  /** Landfall on an empty shore: the crew steps off and a colony is born. */
  private arriveColonize(from: Island, to: Island, boat: Boat, batch: GameEvent[]): void {
    const crew = boat.crew ?? [];
    if (this.sacred(to) || to.kind !== "wild" || crew.length === 0) {
      // claimed while the boat was at sea — the crew stays aboard and sails home
      const e: GameEvent = {
        at: this.t,
        type: "colony-refused",
        islandId: from.id,
        text: `The crew from ${from.name} finds ${to.name} already claimed and turns for home.`,
      };
      this.emit(e);
      batch.push(e);
      return;
    }
    const landName = to.name;
    to.kind = "colony";
    to.ownerId = from.id;
    to.civ = from.civ;
    to.age = from.age;
    this.retrofitBuildings(to, from.age);
    to.lastPulseAt = this.t;
    to.settledAt = this.t; // the colony's own first day starts at landfall
    to.dormant = false;
    this.adoptConquerorName(to, from);
    const terrain = this.islandTerrain(to);
    crew.forEach((s, i) => {
      s.task = { kind: "idle" };
      s.pos = this.landTile(terrain, i);
      to.settlers.push(s);
    });
    boat.crew = undefined;
    // the colonists' provisions come ashore with them
    to.stocks.food =
      (to.stocks.food ?? 0) +
      crew.length * this.balance.foodPerSettlerPerDay * this.balance.starterFoodDays;
    const e: GameEvent = {
      at: this.t,
      type: "colony-founded",
      world: true,
      islandId: to.id,
      text: `Settlers from ${from.name} raise their banner over ${landName} — a colony is founded, and the island takes the name ${to.name}.`,
    };
    this.emit(e);
    batch.push(e);
  }

  /**
   * Raiders storm a colony. No dice: bring strictly more force than the
   * garrison and its works, and the colony changes hands; fall short and the
   * raiders are lost. Home islands never reach this code — the order gate
   * refuses them.
   */
  private arriveAttack(from: Island, to: Island, boat: Boat, batch: GameEvent[]): void {
    const crew = boat.crew ?? [];
    if (this.sacred(to) || to.kind !== "colony" || to.ownerId === from.id || crew.length === 0) {
      // nothing left to fight — the raiders stay aboard and sail home
      return;
    }
    const defense = this.islandDefense(to);
    if (crew.length > defense) {
      const fallenName = to.name;
      to.ownerId = from.id;
      // conquered land joins the conqueror's civilization — colors and age both,
      // and every standing building crosses into that age with it
      to.civ = from.civ;
      to.age = from.age;
      this.retrofitBuildings(to, from.age);
      to.lastPulseAt = this.t;
      to.dormant = false;
      // the fallen defenders' constructs are broken with them
      to.creations = [];
      this.adoptConquerorName(to, from);
      const terrain = this.islandTerrain(to);
      crew.forEach((s, i) => {
        s.task = { kind: "idle" };
        s.pos = this.landTile(terrain, i + crew.length);
        to.settlers.push(s);
      });
      boat.crew = undefined;
      const e: GameEvent = {
        at: this.t,
        type: "conquest",
        world: true,
        islandId: to.id,
        text: `Raiders from ${from.name} storm ${fallenName} — the colony changes hands and now bears the name ${to.name}.`,
      };
      this.emit(e);
      batch.push(e);
    } else {
      boat.crew = undefined;
      const fell: GameEvent = {
        at: this.t,
        type: "raid-repelled",
        world: true,
        islandId: to.id,
        text: `${to.name} repels the raiders of ${from.name}; none of them see home again.`,
      };
      this.emit(fell);
      this.emit({ ...fell, islandId: from.id });
      batch.push(fell);
    }
  }

  private daily(island: Island, batch: GameEvent[]): void {
    const civ = CIVS[island.civ];
    // the harvest: completed farms and livestock pens yield before anyone eats,
    // so the day's produce feeds the day's meals
    let harvest = 0;
    for (const b of island.buildings) {
      if (b.stage === "complete") harvest += buildingSpec(b.type)?.foodPerDay ?? 0;
    }
    if (harvest > 0) island.stocks.food = (island.stocks.food ?? 0) + harvest;
    // the refineries: works that turn one stock into another, each drawing
    // up to its daily draught (the steelworks feeds on iron, yields steel)
    for (const b of island.buildings) {
      if (b.stage !== "complete") continue;
      const conv = buildingSpec(b.type)?.converts;
      if (!conv) continue;
      const take = Math.min(conv.perDay, island.stocks[conv.from] ?? 0);
      if (take <= 0) continue;
      island.stocks[conv.from] = (island.stocks[conv.from] ?? 0) - take;
      island.stocks[conv.to] = (island.stocks[conv.to] ?? 0) + take;
    }
    // leisure: yesterday's idlers go back to work, and the parks draw the
    // next few away from their labors — time "wasted", spirits raised
    for (const s of island.settlers) {
      if (s.task.kind === "relax") s.task = { kind: "idle" };
    }
    const leisureSpots = island.buildings.filter((b) => {
      const spec = buildingSpec(b.type);
      return b.stage === "complete" && (spec?.joy ?? 0) > 0 && !spec?.wonder;
    });
    // at most a fifth of the town idles the day away, two to a place
    let allowance = Math.floor(island.settlers.length / 5);
    for (const spot of leisureSpots) {
      for (let k = 0; k < 2 && allowance > 0; k++) {
        const worker =
          island.settlers.find(
            (s) => s.task.kind === "gather" && s.task.resource !== "food",
          ) ?? island.settlers.find((s) => s.task.kind === "idle");
        if (!worker) break;
        worker.task = { kind: "relax", buildingId: spot.id };
        worker.pos = {
          x: spot.pos.x + roll(island.seed, "relax", this.t, k) - 0.5,
          y: spot.pos.y + roll(island.seed, "relax", this.t, k + 7) - 0.5,
        };
        allowance--;
      }
    }
    // dawn: the town wakes and walks back out to its work
    for (const s of island.settlers) {
      const task = s.task;
      if (task.kind === "gather") {
        const node = island.nodes.find((n) => n.id === task.nodeId);
        if (node) s.pos = { ...node.pos };
      } else if (task.kind === "build" || task.kind === "relax") {
        const site = island.buildings.find((b) => b.id === task.buildingId);
        if (site) s.pos = { ...site.pos };
      }
    }
    // the day's mood, written down before anyone eats: it steers the births
    island.happiness = computeHappiness(island, this.balance).score;
    // meals — in settler order; the unfed go hungry
    const per = this.balance.foodPerSettlerPerDay;
    for (const s of island.settlers) {
      if ((island.stocks.food ?? 0) >= per) {
        island.stocks.food = (island.stocks.food ?? 0) - per;
        s.hungerDays = 0;
      } else {
        s.hungerDays += 1;
      }
    }
    // starvation: dies after starvationDays consecutive food-less days
    const dead = island.settlers.filter(
      (s) => s.hungerDays >= this.balance.starvationDays,
    );
    if (dead.length) {
      island.settlers = island.settlers.filter((s) => !dead.includes(s));
      for (const s of dead) {
        const e: GameEvent = {
          at: this.t,
          type: "death",
          islandId: island.id,
          settler: s.name,
          text: civ.voice.death.replace("{name}", s.name),
        };
        this.emit(e);
        batch.push(e);
      }
      if (island.settlers.length === 0) {
        island.ruins = true;
        const e: GameEvent = {
          at: this.t,
          type: "extinction",
          world: true,
          islandId: island.id,
          text: `The people of ${island.name} are no more; only ruins remain to tell their story.`,
        };
        this.emit(e);
        batch.push(e);
        return;
      }
    }
    // housing: fill completed houses, adults first
    const houses = island.buildings.filter(
      (b) => b.stage === "complete" && (buildingSpec(b.type)?.houses ?? 0) > 0,
    );
    for (const s of island.settlers) {
      if (s.houseId && island.buildings.some((b) => b.id === s.houseId)) continue;
      const home = houses.find(
        (h) =>
          island.settlers.filter((x) => x.houseId === h.id).length <
          (buildingSpec(h.type)?.houses ?? 0),
      );
      s.houseId = home?.id;
    }
    // births: a completed house with two adult residents and food on hand
    const dayIndex = Math.floor(this.t / this.balance.daySeconds);
    // a happy island fills its cradles; a miserable one barely does
    const birthChance =
      this.balance.birthChancePerDay * (0.4 + 0.012 * (island.happiness ?? 50));
    for (const h of houses) {
      const adults = island.settlers.filter((s) => s.houseId === h.id && s.adult);
      if (adults.length < 2) continue;
      if ((island.stocks.food ?? 0) <= 0) continue;
      if (roll(island.seed, "birth", h.id, dayIndex) >= birthChance) continue;
      const bank = civ.nameBank;
      const base =
        bank[Math.floor(roll(island.seed, "childname", dayIndex, h.id) * bank.length)]!;
      const name = island.settlers.some((s) => s.name === base)
        ? `${base} the Younger`
        : base;
      const child: Settler = {
        id: `${island.id}-s${++this.idCounter}`,
        name,
        adult: false,
        bornAt: this.t,
        task: { kind: "idle" },
        pos: { ...h.pos },
        hungerDays: 0,
        houseId: h.id,
      };
      island.settlers.push(child);
      const e: GameEvent = {
        at: this.t,
        type: "birth",
        islandId: island.id,
        settler: name,
        text: civ.voice.birth.replace("{name}", name),
      };
      this.emit(e);
      batch.push(e);
    }
    // children grow up
    for (const s of island.settlers) {
      if (
        !s.adult &&
        this.t - s.bornAt >= this.balance.childGrowsDays * this.balance.daySeconds
      ) {
        s.adult = true;
      }
    }
    // and the settlers weigh what the town still needs
    this.autoPlan(island, batch);
    this.autoExodus(island, batch);
  }

  /**
   * The survival instinct, judged once per day: when the island's primal
   * veins (food, wood, stone) are nearly mined out, the settlers look across
   * the sea on their own — to any empty island first; failing that, to the
   * weakest colony they can honestly take. The fight follows the one law of
   * conquest: whoever wins keeps the island. Orders go through the same
   * executor as a ruler's, so every gate of server law still applies.
   */
  private autoExodus(island: Island, batch: GameEvent[]): void {
    if (island.kind !== "home") return;
    if (ageIndex(island.age) < ageIndex("bronze")) return;
    // "running out" means the land itself: three or fewer primal veins open
    const openPrimal = island.nodes.filter(
      (n) =>
        (n.resource === "food" || n.resource === "wood" || n.resource === "stone") &&
        n.remaining > 0,
    ).length;
    if (openPrimal > 3) return;
    // one expedition at a time — a fleet at sea is already the answer
    if (
      island.boats.some(
        (b) =>
          b.state !== "docked" &&
          (b.intent === "colonize" || b.intent === "attack"),
      )
    )
      return;

    const others = [...this.islandsMap.values()].filter(
      (i) => !i.ruins && i.id !== island.id,
    );
    const dist = (i: Island) =>
      Math.hypot(i.position.x - island.position.x, i.position.y - island.position.y);

    // 1. any empty island → settle the nearest
    let dest = others
      .filter((i) => i.kind === "wild")
      .sort((a, b) => dist(a) - dist(b))[0];
    let intent: VoyageIntent = "colonize";
    if (!dest) {
      // 2. the weakest colony the raiders can honestly overcome
      const defense = (i: Island) => this.islandDefense(i);
      dest = others
        .filter(
          (i) =>
            i.kind === "colony" &&
            i.ownerId !== island.id &&
            defense(i) < this.balance.raidCrew,
        )
        .sort((a, b) => defense(a) - defense(b) || dist(a) - dist(b))[0];
      intent = "attack";
    }
    if (!dest) return; // nowhere to go — hold out and look again tomorrow

    // no boat in harbor: lay one down today, sail another day
    if (!island.boats.some((b) => b.state === "docked")) {
      this.applyOrder(island, { kind: "build_boat" });
      return;
    }
    const res = this.applyOrder(island, {
      kind: "voyage",
      dest: dest.id,
      intent,
    });
    if (res.ok) {
      const e: GameEvent = {
        at: this.t,
        type: "exodus",
        world: true,
        islandId: island.id,
        text:
          intent === "colonize"
            ? `The land of ${island.name} runs bare — settlers sail for the empty shores of ${dest.name}.`
            : `The land of ${island.name} runs bare — desperate raiders of ${island.name} sail to take ${dest.name}.`,
      };
      this.emit(e);
      batch.push(e);
    }
  }

  // ── test/dev seam ────────────────────────────────────────────────────────

  debugGrant(islandId: string, grant: DebugGrant): void {
    const island = this.islandsMap.get(islandId);
    if (!island) throw new Error("unknown island");
    if (grant.age) {
      island.age = grant.age;
      this.retrofitBuildings(island, grant.age);
    }
    if (grant.stocks) Object.assign(island.stocks, grant.stocks);
    if (grant.workPoints !== undefined) island.workPoints = grant.workPoints;
    if (grant.clearFoodSources) {
      for (const n of island.nodes) if (n.resource === "food") n.remaining = 0;
    }
    if (grant.addBuilding) {
      island.buildings.push({
        id: `${island.id}-b${++this.idCounter}`,
        type: grant.addBuilding.type,
        stage: grant.addBuilding.stage,
        progress: 0,
        pos: this.buildSite(island, grant.addBuilding.type),
        age: island.age,
      });
    }
    if (grant.addBoat) {
      island.boats.push({
        id: `${island.id}-boat${++this.idCounter}`,
        pos: { ...island.position },
        state: "docked",
      });
    }
  }

  // ── events & persistence ────────────────────────────────────────────────

  /**
   * The tocsin: the moment raiders put to sea toward someone's colony, the
   * whole world hears "X is being attacked by Y". One bell per
   * attacker→defender wave — the same pair rings again only after the
   * cooldown, so a flotilla launched together lands as a single alarm while a
   * renewed assault later still sounds. The event names the defender in
   * `islandId` and the aggressor in `attackerId`, so any viewer can click
   * straight to the fight.
   */
  private alertAttack(attacker: Island, defender: Island): void {
    const key = `${attacker.id}>${defender.id}`;
    const last = this.attackAlerts.get(key);
    if (last !== undefined && this.t - last < this.balance.attackAlertCooldownSeconds)
      return;
    this.attackAlerts.set(key, this.t);
    this.deferred.push({
      at: this.t,
      type: "under-attack",
      world: true,
      islandId: defender.id,
      attackerId: attacker.id,
      text: `${defender.name} is being attacked by ${attacker.name}!`,
    });
  }

  private emit(e: GameEvent): void {
    if (e.islandId) {
      const feed = this.feeds.get(e.islandId);
      if (feed) {
        feed.push(e);
        if (feed.length > 200) feed.splice(0, feed.length - 200);
      }
    }
  }

  serialize(): string {
    const s: SerializedWorld = {
      seed: this.seed,
      overrides: this.overrides,
      t: this.t,
      anchorMs: this.anchorMs,
      dayIndex: this.dayIndex,
      joinCount: this.joinCount,
      wildCount: this.wildCount,
      idCounter: this.idCounter,
      islands: this.islands(),
      players: [...this.players.entries()],
      pulses: [...this.pulses.entries()],
      voyagePairs: [...this.voyagePairs.values()],
      feeds: [...this.feeds.entries()],
    };
    return JSON.stringify(s);
  }

  static deserialize(raw: string): World {
    const s = JSON.parse(raw) as SerializedWorld;
    const w = new World(s.seed, s.overrides);
    w.t = s.t;
    w.anchorMs = s.anchorMs;
    w.dayIndex = s.dayIndex ?? dayIndex(s.t, w.balance.daySeconds);
    w.joinCount = s.joinCount;
    w.wildCount = s.wildCount ?? 0;
    w.idCounter = s.idCounter;
    // worlds saved before wild islands existed only knew home islands
    for (const i of s.islands) i.kind ??= "home";
    for (const i of s.islands) migrateRetrofitIsland(i);
    w.islandsMap = new Map(s.islands.map((i) => [i.id, i]));
    // islands are never removed, so the counter is exactly the highest stamp
    w.pulseSeq = Math.max(0, ...s.islands.map((i) => i.lastPulseSeq ?? 0));
    // browser-account rows from the retrofit are not players of this world
    w.players = new Map((s.players ?? []).filter(([secret]) => !isAccountSecret(secret)));
    w.pulses = new Map(s.pulses);
    w.voyagePairs = new Set(s.voyagePairs);
    w.feeds = new Map(s.feeds);
    // saves from smaller days grow to the current island size, and saves
    // from before the coast rule may hold docks stranded inland
    for (const island of w.islandsMap.values()) {
      w.growIsland(island);
      w.seedMinerals(island);
      w.settleCoast(island);
      island.happiness ??= computeHappiness(island, w.balance).score;
      // saves from before buildings carried an age: every structure stands in
      // its island's current age. Idempotent — stamped buildings keep theirs.
      for (const b of island.buildings) b.age ??= island.age;
      // the conquest-name law applied to worlds saved before it existed:
      // conquered land bears its ruler's name. Idempotent — a colony already
      // named for its ruler stays put — and only a new conquest changes it.
      if (island.kind === "colony" && island.ownerId) {
        const ruler = w.islandsMap.get(island.ownerId);
        if (ruler && !w.sacred(island)) island.name = ruler.name;
      }
    }
    // civilizations founded before colors existed roll theirs now — once,
    // deterministically, each distinct from every color already flying
    ensureCivColors([...w.islandsMap.values()]);
    return w;
  }
}
