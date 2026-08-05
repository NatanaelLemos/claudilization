import * as THREE from "three";
import { ageIndex } from "../shared/ages";
import { CIVS } from "../shared/civs";
import { isNight } from "../shared/daylight";
import { hashString, mulberry32 } from "../shared/rng";
import type { Vec2 } from "../shared/types";
import { boatMesh } from "./boatsView";
import type { IslandSummary } from "./net";
import type { Stage } from "./scene";
import { PERSON } from "./settlersView";

/**
 * Ambient life — the background bustle that makes the world read as alive:
 * trade sails and fishing skiffs on the sea lanes, villagers strolling between
 * buildings, gulls over the harbors, and shoreline skirmishes where raids land.
 *
 * None of it is gameplay. Every position is a PURE FUNCTION of the shared
 * world clock plus deterministic per-entity seeds, so two viewers see the same
 * bustle, and navigating between islands can never reset or re-seed a single
 * boat or stroller (the sky learned this law first; the sea obeys it too).
 * Authoritative units — real boats, settlers, creations — are untouched.
 */

// ── caps: the whole ambient system's performance budget ─────────────────────

export const AMBIENT_CAPS = {
  /** ambient trade craft across the whole ocean */
  tradeBoats: 20,
  /** ambient fishing skiffs across the whole ocean */
  fishingBoats: 12,
  /** strolling villagers on any one island */
  walkersPerIsland: 14,
  /** nearest islands that get walkers at once */
  walkerIslands: 4,
  /** nearest islands that get gulls at once */
  gullIslands: 8,
  gullsPerIsland: 3,
  /** concurrent shoreline skirmish vignettes */
  skirmishes: 4,
  /** world units from the camera target within which town ambience runs */
  ambientRadius: 520,
  /** world units beyond which ambient craft are hidden entirely */
  seaCullRadius: 950,
} as const;

/** seconds of world time a skirmish keeps burning after its craft lands */
export const SKIRMISH_LINGER_SECONDS = 22;
/** world units from its destination at which an inbound raid starts the clash */
export const SKIRMISH_RANGE = 36;

// ── pure planning: what ambient life exists, given the world summary ────────

function era(s: Pick<IslandSummary, "age">): number {
  return Math.max(0, ageIndex(s.age));
}

function inhabited(s: IslandSummary): boolean {
  return s.kind !== "wild" && !s.ruins && s.population > 0;
}

function completeBuildings(s: IslandSummary): { type: string; pos: Vec2 }[] {
  return (s.buildings ?? [])
    .filter((b) => b.stage === "complete" && b.type !== "boat" && b.type !== "plane")
    .map((b) => ({ type: b.type, pos: b.pos }));
}

export interface SeaLane {
  id: string;
  a: Vec2;
  b: Vec2;
  civ: IslandSummary["civ"];
  /** ambient boats riding this lane */
  boats: number;
  /** world units per second — later ages trade at a brisker pace */
  speed: number;
}

/**
 * Trade lanes: every seafaring island (bronze age up) keeps a lane to its
 * nearest seafaring neighbour, with more sails on it the later the age.
 * Deterministic: same summaries in, same lanes out, capped world-wide.
 */
export function planSeaLanes(islands: IslandSummary[]): SeaLane[] {
  const seafarers = islands.filter((s) => inhabited(s) && era(s) >= 1);
  const lanes = new Map<string, SeaLane>();
  for (const s of seafarers) {
    let nearest: IslandSummary | undefined;
    let nearestD = Infinity;
    for (const other of seafarers) {
      if (other.id === s.id) continue;
      const d = Math.hypot(other.position.x - s.position.x, other.position.y - s.position.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = other;
      }
    }
    if (!nearest) continue;
    const key = [s.id, nearest.id].sort().join("~");
    if (lanes.has(key)) continue;
    const minEra = Math.min(era(s), era(nearest));
    lanes.set(key, {
      id: key,
      a: s.position,
      b: nearest.position,
      civ: s.civ,
      boats: 1 + (minEra >= 3 ? 1 : 0) + (minEra >= 6 ? 1 : 0),
      speed: 3.2 + minEra * 0.3,
    });
  }
  const ordered = [...lanes.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  let budget = AMBIENT_CAPS.tradeBoats;
  const out: SeaLane[] = [];
  for (const lane of ordered) {
    if (budget <= 0) break;
    const boats = Math.min(lane.boats, budget);
    budget -= boats;
    out.push({ ...lane, boats });
  }
  return out;
}

export interface FishingSpot {
  islandId: string;
  civ: IslandSummary["civ"];
  center: Vec2;
  /** half the island's footprint in world units — the skiffs idle just outside it */
  half: number;
  skiffs: number;
}

/** Fishing skiffs idle just offshore of any settled island with a harborfront. */
export function planFishing(islands: IslandSummary[]): FishingSpot[] {
  const spots: FishingSpot[] = [];
  let budget = AMBIENT_CAPS.fishingBoats;
  const settled = islands
    .filter((s) => inhabited(s) && era(s) >= 1 && completeBuildings(s).length > 0)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  for (const s of settled) {
    if (budget <= 0) break;
    const skiffs = Math.min(1 + (era(s) >= 2 ? 1 : 0), budget);
    budget -= skiffs;
    spots.push({
      islandId: s.id,
      civ: s.civ,
      center: s.position,
      half: (s.size ?? 166) / 2,
      skiffs,
    });
  }
  return spots;
}

/**
 * How many ambient strollers a settlement earns: none while it is empty,
 * asleep, or unbuilt; otherwise it scales with people, buildings, and age —
 * a future-age metropolis bustles, a fresh landing barely stirs.
 */
export function walkerBudget(s: IslandSummary): number {
  if (!inhabited(s) || s.dormant) return 0;
  const built = completeBuildings(s).length;
  if (built === 0) return 0;
  return Math.min(
    AMBIENT_CAPS.walkersPerIsland,
    2 + Math.floor(s.population / 3) + Math.floor(built / 3) + era(s),
  );
}

/** One stroller's endless round: legs between stops plus a dwell at each. */
export interface WalkerTrack {
  stops: Vec2[];
  legSeconds: number[];
  dwellSeconds: number[];
  totalSeconds: number;
  phase: number;
}

const WALK_SPEED = 2.1; // island units per second — a stroll, not an errand

/**
 * Build a walker's deterministic loop over the town's buildings. Same seed and
 * stops in, same track out — worldTime does the rest.
 */
export function walkerTrack(seed: string, places: Vec2[], speed = WALK_SPEED): WalkerTrack | null {
  if (places.length === 0) return null;
  const rand = mulberry32(hashString(seed));
  const count = Math.min(places.length, 3 + Math.floor(rand() * 3));
  const stops: Vec2[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(rand() * places.length);
    if (places.length > count) {
      while (used.has(idx)) idx = (idx + 1) % places.length;
    }
    used.add(idx);
    // approach the porch, not the ridgepole: a deterministic offset per stop
    const a = rand() * Math.PI * 2;
    const r = 1.6 + rand() * 1.8;
    const p = places[idx]!;
    stops.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
  }
  if (stops.length === 1) {
    stops.push({ x: stops[0]!.x + 4, y: stops[0]!.y + 4 });
  }
  const legSeconds: number[] = [];
  const dwellSeconds: number[] = [];
  let total = 0;
  for (let i = 0; i < stops.length; i++) {
    const next = stops[(i + 1) % stops.length]!;
    const leg = Math.max(
      0.5,
      Math.hypot(next.x - stops[i]!.x, next.y - stops[i]!.y) / speed,
    );
    const dwell = 5 + rand() * 9;
    legSeconds.push(leg);
    dwellSeconds.push(dwell);
    total += leg + dwell;
  }
  return { stops, legSeconds, dwellSeconds, totalSeconds: total, phase: rand() * total };
}

export interface WalkerPose {
  x: number;
  y: number;
  moving: boolean;
  heading: number;
}

/** Where the walker stands at a given world time — pure, so it can never reset. */
export function walkerPose(track: WalkerTrack, worldTime: number): WalkerPose {
  let t = (((worldTime + track.phase) % track.totalSeconds) + track.totalSeconds) %
    track.totalSeconds;
  for (let i = 0; i < track.stops.length; i++) {
    const here = track.stops[i]!;
    const next = track.stops[(i + 1) % track.stops.length]!;
    if (t < track.dwellSeconds[i]!) {
      return {
        x: here.x,
        y: here.y,
        moving: false,
        heading: Math.atan2(next.x - here.x, next.y - here.y),
      };
    }
    t -= track.dwellSeconds[i]!;
    if (t < track.legSeconds[i]!) {
      const f = t / track.legSeconds[i]!;
      return {
        x: here.x + (next.x - here.x) * f,
        y: here.y + (next.y - here.y) * f,
        moving: true,
        heading: Math.atan2(next.x - here.x, next.y - here.y),
      };
    }
    t -= track.legSeconds[i]!;
  }
  const last = track.stops[0]!;
  return { x: last.x, y: last.y, moving: false, heading: 0 };
}

export interface SkirmishSighting {
  islandId: string;
  /** where the clash burns — on the water just off the defender's shore */
  at: Vec2;
  attackerCiv: IslandSummary["civ"];
  defenderCiv: IslandSummary["civ"];
}

/**
 * Hostile traffic close to its target: attack boats and raid bands within
 * range of the island they were dispatched against. The renderer keeps each
 * sighting burning a while past the landing, so the fight is visible even
 * though the server resolves it in one tick.
 */
export function detectSkirmishes(islands: IslandSummary[]): SkirmishSighting[] {
  const byId = new Map(islands.map((s) => [s.id, s]));
  const sightings: SkirmishSighting[] = [];
  const seen = new Set<string>();
  const consider = (
    from: IslandSummary,
    pos: Vec2,
    dest: string | undefined,
    hostile: boolean,
  ) => {
    if (!hostile || !dest) return;
    const target = byId.get(dest);
    if (!target || target.id === from.id) return;
    const dx = pos.x - target.position.x;
    const dy = pos.y - target.position.y;
    const d = Math.hypot(dx, dy);
    if (d > SKIRMISH_RANGE) return;
    const key = `${target.id}|${from.civ}`;
    if (seen.has(key)) return;
    seen.add(key);
    const half = (target.size ?? 166) / 2;
    const shore = half * 1.04;
    const nx = d > 1e-6 ? dx / d : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    sightings.push({
      islandId: target.id,
      at: { x: target.position.x + nx * shore, y: target.position.y + ny * shore },
      attackerCiv: from.civ,
      defenderCiv: target.civ,
    });
  };
  for (const s of islands) {
    for (const b of s.boats ?? []) {
      consider(s, b.pos, b.dest, b.state === "sailing" && b.intent === "attack");
    }
    for (const band of s.creationBands ?? []) {
      consider(s, band.pos, band.dest, band.state === "outbound" && band.intent === "raid");
    }
  }
  return sightings;
}

// ── rendering ───────────────────────────────────────────────────────────────

interface IslandAnchor {
  group: THREE.Group;
  heightAt: (x: number, y: number) => number;
  half: number;
}

interface AmbientDeps {
  /** the island's built terrain, when it exists — walkers stand on it */
  anchor(id: string): IslandAnchor | undefined;
  /** the world's day law, straight from the server frames */
  law(): { daySeconds: number; daylightShare: number };
}

export interface AmbientLife {
  updateWorld(summaries: IslandSummary[]): void;
}

interface AmbientCraft {
  group: THREE.Group;
  kind: "trader" | "skiff";
  lane?: SeaLane;
  laneOffset?: number;
  laneIndex?: number;
  spot?: FishingSpot;
  skiffIndex?: number;
  seed: number;
}

interface TownWalkers {
  islandId: string;
  holder: THREE.Group;
  parts: {
    torso: THREE.InstancedMesh;
    head: THREE.InstancedMesh;
    hair: THREE.InstancedMesh;
    arms: THREE.InstancedMesh;
    legs: THREE.InstancedMesh;
  } | null;
  tracks: (WalkerTrack | null)[];
  count: number;
  placesKey: string;
}

interface GullFlock {
  islandId: string;
  center: Vec2;
  half: number;
  birds: THREE.Group[];
  holder: THREE.Group;
  seed: number;
}

interface SkirmishEffect {
  holder: THREE.Group;
  at: Vec2;
  fighters: THREE.Group[];
  splashes: THREE.Mesh[];
  puffs: THREE.Mesh[];
  seed: number;
  /** world time of the last sighting — the fire burns LINGER past it */
  lastSeen: number;
}

export function initAmbientLife(stage: Stage, deps: AmbientDeps): AmbientLife {
  const sea = new THREE.Group();
  sea.name = "ambient-sea";
  stage.scene.add(sea);

  let crafts = new Map<string, AmbientCraft>();
  const towns = new Map<string, TownWalkers>();
  const flocks = new Map<string, GullFlock>();
  const skirmishes = new Map<string, SkirmishEffect>();
  let summaries: IslandSummary[] = [];
  let planKey = "";

  // ── sea lanes & harbors: rebuilt only when the world's shape changes ──────

  function rebuildSea(): void {
    const lanes = planSeaLanes(summaries);
    const fishing = planFishing(summaries);
    const next = new Map<string, AmbientCraft>();
    for (const lane of lanes) {
      for (let i = 0; i < lane.boats; i++) {
        // the civ is part of the identity: a conquered harbor repaints its sails
        const id = `lane:${lane.id}:${lane.civ}:${i}`;
        let craft = crafts.get(id);
        if (!craft) {
          const group = boatMesh(CIVS[lane.civ]);
          group.scale.setScalar(0.85);
          sea.add(group);
          craft = { group, kind: "trader", seed: hashString(id) };
        }
        craft.lane = lane;
        craft.laneIndex = i;
        craft.laneOffset = ((craft.seed % 7) - 3) * 2.2;
        next.set(id, craft);
      }
    }
    for (const spot of fishing) {
      for (let i = 0; i < spot.skiffs; i++) {
        const id = `skiff:${spot.islandId}:${spot.civ}:${i}`;
        let craft = crafts.get(id);
        if (!craft) {
          const group = boatMesh(CIVS[spot.civ]);
          group.scale.setScalar(0.6);
          sea.add(group);
          craft = { group, kind: "skiff", seed: hashString(id) };
        }
        craft.spot = spot;
        craft.skiffIndex = i;
        next.set(id, craft);
      }
    }
    for (const [id, craft] of crafts) {
      if (!next.has(id)) sea.remove(craft.group);
    }
    crafts = next;
  }

  function craftPose(craft: AmbientCraft, wt: number): { x: number; z: number; heading: number } {
    if (craft.kind === "trader" && craft.lane) {
      const lane = craft.lane;
      const dx = lane.b.x - lane.a.x;
      const dy = lane.b.y - lane.a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / len;
      const uy = dy / len;
      // sail coast to coast, not center to center
      const trim = Math.min(len * 0.33, 62);
      const ax = lane.a.x + ux * trim;
      const ay = lane.a.y + uy * trim;
      const bx = lane.b.x - ux * trim;
      const by = lane.b.y - uy * trim;
      const span = Math.max(1, Math.hypot(bx - ax, by - ay));
      const period = (2 * span) / lane.speed;
      const phase = ((craft.seed % 997) / 997) * period;
      const s = (((wt + phase) % period) + period) % period;
      const f = s < period / 2 ? s / (period / 2) : 2 - s / (period / 2);
      const off = craft.laneOffset ?? 0;
      return {
        x: ax + (bx - ax) * f - uy * off,
        z: ay + (by - ay) * f + ux * off,
        heading: s < period / 2 ? Math.atan2(bx - ax, by - ay) : Math.atan2(ax - bx, ay - by),
      };
    }
    const spot = craft.spot!;
    const rand = mulberry32(craft.seed);
    const baseA = rand() * Math.PI * 2;
    const drift = 0.05 + rand() * 0.04; // radians per second around the isle
    const bobR = 5 + rand() * 4;
    const a = baseA + wt * drift;
    const r = spot.half * 1.12 + Math.sin(wt * 0.11 + craft.seed) * bobR;
    return {
      x: spot.center.x + Math.cos(a) * r,
      z: spot.center.y + Math.sin(a) * r,
      heading: a + Math.PI / 2,
    };
  }

  // ── town walkers ──────────────────────────────────────────────────────────

  const tint = new THREE.Color();
  const accent = new THREE.Color();

  function buildWalkers(town: TownWalkers, s: IslandSummary, places: Vec2[]): void {
    disposeWalkers(town);
    const count = walkerBudget(s);
    town.count = count;
    if (count === 0) return;
    const make = (geo: THREE.BufferGeometry, n: number) => {
      const mesh = new THREE.InstancedMesh(geo, PERSON.mat, n);
      mesh.frustumCulled = false;
      town.holder.add(mesh);
      return mesh;
    };
    town.parts = {
      torso: make(PERSON.torsoGeo, count),
      head: make(PERSON.headGeo, count),
      hair: make(PERSON.hairGeo, count),
      arms: make(PERSON.armGeo, count * 2),
      legs: make(PERSON.legGeo, count * 2),
    };
    town.tracks = [];
    accent.set(CIVS[s.civ].accent);
    for (let i = 0; i < count; i++) {
      town.tracks.push(walkerTrack(`${s.id}|walker|${i}`, places));
      const rand = mulberry32(hashString(`${s.id}|walker-look|${i}`));
      const pick = (tones: readonly string[]) => tones[Math.floor(rand() * tones.length)]!;
      tint.set(pick(PERSON.SKIN_TONES));
      town.parts.head.setColorAt(i, tint);
      town.parts.arms.setColorAt(2 * i, tint);
      town.parts.arms.setColorAt(2 * i + 1, tint);
      town.parts.hair.setColorAt(i, tint.set(pick(PERSON.HAIR_TONES)));
      town.parts.torso.setColorAt(i, tint.copy(accent).offsetHSL(0, 0, (rand() - 0.5) * 0.2));
      tint.set(pick(PERSON.LEG_TONES));
      town.parts.legs.setColorAt(2 * i, tint);
      town.parts.legs.setColorAt(2 * i + 1, tint);
    }
    for (const mesh of Object.values(town.parts)) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  function disposeWalkers(town: TownWalkers): void {
    if (town.parts) {
      for (const mesh of Object.values(town.parts)) mesh.dispose();
    }
    town.holder.clear();
    town.parts = null;
    town.tracks = [];
    town.count = 0;
  }

  const rootM = new THREE.Matrix4();
  const localM = new THREE.Matrix4();
  const partM = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  function poseLimb(
    mesh: THREE.InstancedMesh,
    index: number,
    swing: number,
    lean: number,
    px: number,
    py: number,
  ): void {
    euler.set(swing, 0, lean);
    localM.makeRotationFromEuler(euler).setPosition(px, py, 0);
    partM.multiplyMatrices(rootM, localM);
    mesh.setMatrixAt(index, partM);
  }

  function tickTown(town: TownWalkers, anchorRef: IslandAnchor, wt: number): void {
    const parts = town.parts;
    if (!parts) return;
    for (let i = 0; i < town.count; i++) {
      const track = town.tracks[i];
      if (!track) continue;
      const pose = walkerPose(track, wt);
      const stride = Math.sin(wt * 8 + i * 1.7);
      const b = pose.moving ? 1 : 0;
      const sway = Math.sin(wt * 1.9 + i) * 0.08 * (1 - b);
      const bob = Math.abs(stride) * 0.05 * b + (Math.sin(wt * 2.6 + i) + 1) * 0.02 * (1 - b);
      const ground = Math.max(0.1, anchorRef.heightAt(pose.x, pose.y));
      quat.setFromAxisAngle(Y_AXIS, pose.heading);
      rootM
        .makeRotationFromQuaternion(quat)
        .setPosition(pose.x - anchorRef.half, ground + bob, pose.y - anchorRef.half);
      parts.torso.setMatrixAt(i, rootM);
      parts.head.setMatrixAt(i, rootM);
      parts.hair.setMatrixAt(i, rootM);
      poseLimb(parts.legs, 2 * i, stride * 0.5 * b, 0, -PERSON.LEG_X, PERSON.HIP_Y);
      poseLimb(parts.legs, 2 * i + 1, -stride * 0.5 * b, 0, PERSON.LEG_X, PERSON.HIP_Y);
      poseLimb(parts.arms, 2 * i, -stride * 0.4 * b + sway, -PERSON.ARM_TILT, -PERSON.ARM_X, PERSON.SHOULDER_Y);
      poseLimb(parts.arms, 2 * i + 1, stride * 0.4 * b - sway, PERSON.ARM_TILT, PERSON.ARM_X, PERSON.SHOULDER_Y);
    }
    for (const mesh of Object.values(parts)) mesh.instanceMatrix.needsUpdate = true;
  }

  // ── gulls ─────────────────────────────────────────────────────────────────

  const gullBody = new THREE.BoxGeometry(0.5, 0.1, 0.16);
  const gullWing = new THREE.BoxGeometry(0.16, 0.04, 0.72);
  const gullMat = new THREE.MeshLambertMaterial({ color: "#e8ecf2", flatShading: true });

  function makeGull(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(gullBody, gullMat);
    const left = new THREE.Mesh(gullWing, gullMat);
    left.position.z = -0.4;
    const right = new THREE.Mesh(gullWing, gullMat);
    right.position.z = 0.4;
    g.add(body, left, right);
    g.userData.left = left;
    g.userData.right = right;
    return g;
  }

  function tickFlock(flock: GullFlock, wt: number): void {
    flock.birds.forEach((bird, i) => {
      const rand = mulberry32(flock.seed + i * 31);
      const baseA = rand() * Math.PI * 2;
      const w = 0.16 + rand() * 0.08;
      const r = flock.half * (0.55 + rand() * 0.5);
      const alt = 11 + rand() * 5;
      const a = baseA + wt * w;
      bird.position.set(
        flock.center.x + Math.cos(a) * r,
        alt + Math.sin(wt * 0.7 + i) * 1.4,
        flock.center.y + Math.sin(a) * r,
      );
      bird.rotation.y = -a - Math.PI / 2;
      const flap = Math.sin(wt * 9 + i * 2.1) * 0.55;
      (bird.userData.left as THREE.Mesh).rotation.x = flap;
      (bird.userData.right as THREE.Mesh).rotation.x = -flap;
    });
  }

  // ── skirmishes ────────────────────────────────────────────────────────────

  const fighterBody = new THREE.BoxGeometry(0.42, 0.85, 0.3).translate(0, 0.55, 0);
  const fighterHead = new THREE.SphereGeometry(0.16, 6, 5).translate(0, 1.15, 0);
  const splashGeo = new THREE.TorusGeometry(1.1, 0.07, 5, 18);
  const puffGeo = new THREE.SphereGeometry(0.5, 6, 5);

  function buildSkirmish(sighting: SkirmishSighting, wt: number): SkirmishEffect {
    const holder = new THREE.Group();
    holder.position.set(sighting.at.x, 0, sighting.at.y);
    sea.add(holder);
    const seed = hashString(`${sighting.islandId}|${sighting.attackerCiv}`);
    const rand = mulberry32(seed);
    const fighters: THREE.Group[] = [];
    for (let i = 0; i < 6; i++) {
      const attacker = i < 3;
      const civ = CIVS[attacker ? sighting.attackerCiv : sighting.defenderCiv];
      const mat = new THREE.MeshLambertMaterial({ color: civ.accent, flatShading: true });
      const f = new THREE.Group();
      f.add(new THREE.Mesh(fighterBody, mat));
      const skin = new THREE.MeshLambertMaterial({
        color: PERSON.SKIN_TONES[Math.floor(rand() * PERSON.SKIN_TONES.length)],
      });
      f.add(new THREE.Mesh(fighterHead, skin));
      f.userData.side = attacker ? 1 : -1;
      f.userData.slot = i % 3;
      holder.add(f);
      fighters.push(f);
    }
    const splashes: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const splash = new THREE.Mesh(
        splashGeo,
        new THREE.MeshBasicMaterial({
          color: "#dff2f7",
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      );
      splash.rotation.x = Math.PI / 2;
      splash.position.y = 0.1;
      holder.add(splash);
      splashes.push(splash);
    }
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(
        puffGeo,
        new THREE.MeshLambertMaterial({
          color: "#c9c2b8",
          transparent: true,
          opacity: 0.4,
        }),
      );
      holder.add(puff);
      puffs.push(puff);
    }
    return { holder, at: sighting.at, fighters, splashes, puffs, seed, lastSeen: wt };
  }

  function tickSkirmish(fx: SkirmishEffect, wt: number): void {
    for (const f of fx.fighters) {
      const side = f.userData.side as number;
      const slot = f.userData.slot as number;
      const lungePhase = wt * 3.4 + slot * 2.1 + (side > 0 ? 0 : Math.PI);
      const lunge = Math.max(0, Math.sin(lungePhase)) * 1.1;
      const x = side * (1.6 - lunge) ;
      const z = (slot - 1) * 1.5 + Math.sin(wt * 2.2 + slot * 3.1) * 0.25;
      f.position.set(x, 0.25 + Math.abs(Math.sin(lungePhase)) * 0.18, z);
      f.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      f.rotation.z = side * Math.max(0, Math.sin(lungePhase)) * 0.28;
    }
    fx.splashes.forEach((splash, i) => {
      const cycle = ((wt * 0.7 + i * 0.33) % 1 + 1) % 1;
      splash.scale.setScalar(0.6 + cycle * 2.2);
      (splash.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - cycle);
    });
    fx.puffs.forEach((puff, i) => {
      const cycle = ((wt * 0.35 + i * 0.25) % 1 + 1) % 1;
      const rand = mulberry32(fx.seed + i * 17 + Math.floor(wt * 0.35 + i * 0.25));
      puff.position.set((rand() - 0.5) * 3, 0.6 + cycle * 3.4, (rand() - 0.5) * 3);
      puff.scale.setScalar(0.7 + cycle * 1.5);
      (puff.material as THREE.MeshLambertMaterial).opacity = 0.42 * (1 - cycle);
    });
  }

  function disposeSkirmish(fx: SkirmishEffect): void {
    sea.remove(fx.holder);
    fx.holder.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material) (mesh.material as THREE.Material).dispose();
    });
  }

  // ── world updates ─────────────────────────────────────────────────────────

  function updateWorld(next: IslandSummary[]): void {
    summaries = next;
    const key = next
      .map(
        (s) =>
          `${s.id}|${s.civ}|${s.age}|${s.kind}|${s.ruins ? 1 : 0}|${s.dormant ? 1 : 0}|` +
          `${s.population}|${completeBuildings(s).length}`,
      )
      .join(";");
    if (key !== planKey) {
      planKey = key;
      rebuildSea();
    }
    // skirmish sightings refresh every frame the raid is still inbound
    const wt = stage.worldTime();
    for (const sighting of detectSkirmishes(next)) {
      const id = `${sighting.islandId}|${sighting.attackerCiv}`;
      const existing = skirmishes.get(id);
      if (existing) {
        existing.lastSeen = wt;
        existing.at = sighting.at;
        existing.holder.position.set(sighting.at.x, 0, sighting.at.y);
      } else if (skirmishes.size < AMBIENT_CAPS.skirmishes) {
        skirmishes.set(id, buildSkirmish(sighting, wt));
      }
    }
  }

  // ── the frame loop ────────────────────────────────────────────────────────

  const camTarget = new THREE.Vector3();
  let recullIn = 0;
  let activeWalkerIds = new Set<string>();
  let activeGullIds = new Set<string>();

  function recull(): void {
    stage.controls.getTarget(camTarget);
    const near = summaries
      .filter((s) => inhabited(s))
      .map((s) => ({
        s,
        d: Math.hypot(s.position.x - camTarget.x, s.position.y - camTarget.z),
      }))
      .filter((e) => e.d <= AMBIENT_CAPS.ambientRadius * 1.6)
      .sort((a, b) => a.d - b.d);
    activeWalkerIds = new Set(
      near
        .filter((e) => e.d <= AMBIENT_CAPS.ambientRadius)
        .slice(0, AMBIENT_CAPS.walkerIslands)
        .map((e) => e.s.id),
    );
    activeGullIds = new Set(near.slice(0, AMBIENT_CAPS.gullIslands).map((e) => e.s.id));

    // walkers spin up/down with the active set
    for (const id of activeWalkerIds) {
      const s = summaries.find((x) => x.id === id)!;
      const anchorRef = deps.anchor(id);
      if (!anchorRef) continue;
      let town = towns.get(id);
      if (!town) {
        town = {
          islandId: id,
          holder: new THREE.Group(),
          parts: null,
          tracks: [],
          count: 0,
          placesKey: "",
        };
        towns.set(id, town);
      }
      if (town.holder.parent !== anchorRef.group) anchorRef.group.add(town.holder);
      const places = completeBuildings(s).map((b) => b.pos);
      const placesKey = `${walkerBudget(s)}|${places.map((p) => `${p.x},${p.y}`).join(",")}`;
      if (placesKey !== town.placesKey) {
        town.placesKey = placesKey;
        buildWalkers(town, s, places);
      }
    }
    for (const [id, town] of towns) {
      if (!activeWalkerIds.has(id)) {
        disposeWalkers(town);
        town.holder.parent?.remove(town.holder);
        town.placesKey = "";
        towns.delete(id);
      }
    }

    // gull flocks over the nearest harbors
    for (const id of activeGullIds) {
      const s = summaries.find((x) => x.id === id)!;
      if (completeBuildings(s).length === 0) continue;
      if (!flocks.has(id)) {
        const holder = new THREE.Group();
        const birds: THREE.Group[] = [];
        for (let i = 0; i < AMBIENT_CAPS.gullsPerIsland; i++) {
          const bird = makeGull();
          holder.add(bird);
          birds.push(bird);
        }
        sea.add(holder);
        flocks.set(id, {
          islandId: id,
          center: s.position,
          half: (s.size ?? 166) / 2,
          birds,
          holder,
          seed: hashString(`${id}|gulls`),
        });
      }
    }
    for (const [id, flock] of flocks) {
      if (!activeGullIds.has(id)) {
        sea.remove(flock.holder);
        flocks.delete(id);
      }
    }
  }

  stage.onFrame((dt) => {
    const wt = stage.worldTime();
    const law = deps.law();
    recullIn -= dt;
    if (recullIn <= 0) {
      recullIn = 0.5;
      recull();
    }
    stage.controls.getTarget(camTarget);

    // craft at sea — hidden beyond the cull radius, posed purely from the clock
    for (const craft of crafts.values()) {
      const pose = craftPose(craft, wt);
      const far =
        Math.hypot(pose.x - camTarget.x, pose.z - camTarget.z) > AMBIENT_CAPS.seaCullRadius;
      craft.group.visible = !far;
      if (far) continue;
      craft.group.position.set(pose.x, Math.sin(wt * 1.5 + craft.seed) * 0.09, pose.z);
      craft.group.rotation.y = pose.heading - Math.PI / 2;
      craft.group.rotation.z = Math.sin(wt * 1.2 + craft.seed) * 0.04;
    }

    // the town sleeps at night, exactly like its settlers do
    const night = isNight(wt, law.daySeconds, law.daylightShare);
    for (const town of towns.values()) {
      town.holder.visible = !night;
      if (night) continue;
      const anchorRef = deps.anchor(town.islandId);
      if (anchorRef) tickTown(town, anchorRef, wt);
    }

    for (const flock of flocks.values()) {
      flock.holder.visible = !night;
      if (!night) tickFlock(flock, wt);
    }

    for (const [id, fx] of skirmishes) {
      if (wt - fx.lastSeen > SKIRMISH_LINGER_SECONDS) {
        disposeSkirmish(fx);
        skirmishes.delete(id);
        continue;
      }
      tickSkirmish(fx, wt);
    }
  });

  return { updateWorld };
}
