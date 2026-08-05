export const CIV_IDS = [
  "roman",
  "greek",
  "egyptian",
  "norse",
  "japanese",
  "aztec",
  "mauryan",
  "mongol",
] as const;
export type CivId = (typeof CIV_IDS)[number];

export type Age =
  | "stone"
  | "bronze"
  | "iron"
  | "classical"
  | "medieval"
  | "renaissance"
  | "industrial"
  | "modern"
  | "future";

export type ResourceId =
  | "food"
  | "wood"
  | "stone"
  | "copper"
  | "tin"
  | "iron"
  | "steel"
  | "marble"
  | "gold"
  | "silver"
  | "preciousMetals"
  | "gems"
  | "coal"
  | "oil"
  | "gas"
  | "plutonium"
  | "antimatter";

export interface Vec2 {
  x: number;
  y: number;
}

export type TileKind = "water" | "sand" | "grass" | "rock";

export interface Tile {
  x: number;
  y: number;
  height: number;
  kind: TileKind;
}

/** What a wild food node actually is — settlers hunt, fish, and pick. */
export type FoodSource = "animals" | "fish" | "apple-trees" | "berry-bushes";

export interface ResourceNode {
  id: string;
  resource: ResourceId;
  pos: Vec2;
  remaining: number;
  /** set on food nodes; absent on wood/stone (and on pre-source snapshots) */
  source?: FoodSource;
}

export interface IslandTerrain {
  size: number;
  tiles: Tile[];
  nodes: ResourceNode[];
}

export type SettlerTask =
  | { kind: "idle" }
  | { kind: "gather"; resource: ResourceId; nodeId: string }
  | { kind: "build"; buildingId: string }
  | { kind: "sail"; boatId: string }
  /** whiling the day away at a park or plaza — no work done, spirits raised */
  | { kind: "relax"; buildingId: string };

export interface Settler {
  id: string;
  name: string;
  adult: boolean;
  bornAt: number;
  task: SettlerTask;
  pos: Vec2;
  hungerDays: number;
  houseId?: string;
}

export type BuildingStage = "site" | "construction" | "complete";

export interface Building {
  id: string;
  type: string;
  stage: BuildingStage;
  progress: number;
  pos: Vec2;
}

export interface BuildingSpec {
  type: string;
  age: Age;
  cost: Partial<Record<ResourceId, number>>;
  buildSeconds: number;
  houses?: number;
  /** food added to stocks each in-game day once complete (farms, livestock pens) */
  foodPerDay?: number;
  /** daily refinement once complete: turns stock of one resource into another */
  converts?: { from: ResourceId; to: ResourceId; perDay: number };
  /** happiness this place radiates once complete (parks, arenas, wonders) */
  joy?: number;
  /** a once-per-civilization monument — vast cost, vast pride */
  wonder?: boolean;
}

export type VoyageIntent = "trade" | "help" | "colonize" | "attack";

export interface Boat {
  id: string;
  pos: Vec2;
  state: "docked" | "sailing" | "returning";
  dest?: string;
  intent?: VoyageIntent;
  /** planes fly (modern age, airfield-built); absent means a sailing boat */
  craft?: "boat" | "plane";
  /** settlers aboard — colonists outbound or raiders; rejoin home if the trip fails */
  crew?: Settler[];
}

/**
 * home: a player's founding island — sacred, can never be attacked.
 * wild: uninhabited, waiting to be colonized.
 * colony: founded or conquered — contestable by any player.
 */
export type IslandKind = "home" | "wild" | "colony";

/**
 * Where an island came from — written at birth and never changed again.
 * `home` marks a player's founding island; `neutral` marks land that rose
 * empty from the sea. Protection law reads THIS field, not the mutable
 * `kind`, so no state drift, migration bug, or forged payload can ever make
 * a founding island conquerable — and no formerly-empty island can ever
 * inherit a home's sanctity, no matter how many times it changes hands.
 * Absent only on saves from before the field existed; the loader backfills
 * it from `kind` exactly once.
 */
export type IslandOrigin = "home" | "neutral";

export interface Island {
  id: string;
  name: string;
  civ: CivId;
  seed: number;
  age: Age;
  kind: IslandKind;
  /** immutable provenance: founding island or formerly-empty land (see above) */
  origin?: IslandOrigin;
  /** colonies only: the home island that currently rules them */
  ownerId?: string;
  /** Ed25519 public key (PEM) of the paired Claude — once set, only requests
   * it signed can mutate this island. Public by nature; safe to broadcast. */
  ownerKey?: string;
  position: Vec2;
  /** tiles per side of this island's terrain grid; saves from before islands
   * grew have none and are treated as the historical 64 */
  size?: number;
  settlers: Settler[];
  buildings: Building[];
  boats: Boat[];
  /** live resource nodes — mutable sim state, seeded from generateIsland */
  nodes: ResourceNode[];
  stocks: Partial<Record<ResourceId, number>>;
  workPoints: number;
  ruins: boolean;
  dormant: boolean;
  lastPulseAt: number;
  /** monotonic activity order — world time only ticks once a second, so this
   * breaks "most recently active" ties between pulses in the same tick */
  lastPulseSeq: number;
  /** world time when this island's people first stood on it. A town gets a
   * full day before its first dawn, so landing an hour before the world's
   * turns the day never costs it a day's stores. Absent on worlds saved before
   * the clock became the world's. */
  settledAt?: number;
  /** seconds since the world's last in-game day boundary. Derived from world
   * time every tick — never a private per-island counter, so islands can never
   * drift into separate days (and a viewer's sky never depends on who they
   * are watching). Kept on the island for wire compatibility. */
  dayClock: number;
  /** the people's mood, 0–100 — recomputed at every day boundary */
  happiness?: number;
  /** player-invented designs this island keeps (absent on older saves) */
  creationSpecs?: CreationSpec[];
  /** living creation units on this island's soil */
  creations?: CreationUnit[];
  /** dispatched bands this island sent across the ocean */
  creationBands?: CreationBand[];
  /** create-order rate limiting: how many landed on which in-game day */
  createsOnDay?: { day: number; count: number };
}

// ── player-invented creations ──────────────────────────────────────────────
// A creation is data, never code: name + pixel sprite + clamped stats +
// behaviors from a closed verb list. See shared/creations.ts for the gate.

export type CreationVerb = "guard" | "patrol" | "perform" | "gather" | "raid";

export interface CreationStats {
  /** attack strength and gathering muscle, 1–10 */
  power: number;
  /** travel pace when dispatched, 1–10 */
  speed: number;
  /** defensive worth (guards count it double), 1–10 */
  resilience: number;
}

export interface CreationSprite {
  /** pixels per side, 8–16 */
  size: number;
  /** up to 8 #rrggbb colors */
  palette: string[];
  /** `size` rows of `size` characters: "." transparent, digits index the palette */
  pixels: string[];
}

/** What a player's Claude submits — the untrusted definition. */
export interface CreationInput {
  name: string;
  description: string;
  sprite: CreationSprite;
  stats: CreationStats;
  verbs: CreationVerb[];
  gathers?: ResourceId;
  count: number;
}

/** A validated design an island keeps — every unit points back at one. */
export interface CreationSpec {
  id: string;
  name: string;
  description: string;
  sprite: CreationSprite;
  stats: CreationStats;
  verbs: CreationVerb[];
  gathers?: ResourceId;
  createdAt: number;
}

/** One living unit of a design, at home or garrisoning a colony. */
export interface CreationUnit {
  id: string;
  specId: string;
  pos: Vec2;
  /** gathering units bind to a node like settlers do */
  nodeId?: string;
}

/** A dispatched band crossing the ocean — raiders or a garrison in transit. */
export interface CreationBand {
  id: string;
  specId: string;
  units: CreationUnit[];
  pos: Vec2;
  dest: string;
  intent: "raid" | "garrison";
  state: "outbound" | "returning";
  /** world units per second — the slowest member set the pace at dispatch */
  speed: number;
}

export interface GameEvent {
  at: number;
  type: string;
  text: string;
  islandId?: string;
  world?: boolean;
  settler?: string;
}

export type Order =
  | { kind: "assign_gathering"; resource: ResourceId; count: number }
  | { kind: "build"; building: string }
  | { kind: "build_boat" }
  | { kind: "build_plane" }
  | { kind: "voyage"; dest: string; intent: VoyageIntent }
  | { kind: "advance_age" }
  /** bring a player-invented creation to life (validated, clamped, paid for) */
  | { kind: "create"; creation: CreationInput }
  /** send units of a design to a rival colony (raid) or your own (garrison) */
  | { kind: "dispatch"; creation: string; dest: string; count?: number }
  /** dismiss a design's home units; removes the design once none remain */
  | { kind: "disband"; creation: string };

export interface OrderOutcome {
  order: Order;
  ok: boolean;
  reason?: string;
}

export interface JoinResult {
  secret: string;
  islandId: string;
  islandName: string;
  isNew: boolean;
}

export interface Pulse {
  time: number;
  tokens: number;
}

export interface CivSpec {
  id: CivId;
  label: string;
  nameBank: string[];
  islandNames: string[];
  accent: string;
  architecture: { roof: "flat" | "gabled" | "domed" | "pagoda" | "stepped"; primary: string; trim: string };
  boat: { hull: string; sail: string; shape: "longship" | "galley" | "reed" | "junk" | "canoe" };
  voice: { build: string; birth: string; death: string; ageUp: string };
}

export interface DebugGrant {
  age?: Age;
  stocks?: Partial<Record<ResourceId, number>>;
  addBuilding?: { type: string; stage: BuildingStage };
  addBoat?: boolean;
  clearFoodSources?: boolean;
  workPoints?: number;
}
