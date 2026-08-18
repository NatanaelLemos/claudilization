import * as THREE from "three";
import { drawableSprite } from "../shared/creations";
import { drawableModel, modelFromSprite } from "../shared/voxel";
import { hashString } from "../shared/rng";
import type { CreationModel, CreationSprite, Vec2 } from "../shared/types";
import { ART_DIRECTION, CLAY_PALETTE, clayMaterial } from "./artDirection";
import { buildModel, type BuiltModel } from "./voxelMesh";

/**
 * Player-invented creations on screen — as solid as anything else on the
 * island. Every creation is DATA from the closed vocabulary — never markup,
 * never a URL — re-validated here with `drawableModel` because it arrives over
 * the wire from a public server. A valid model becomes greedy-meshed clay
 * geometry that stands on the ground, turns to face where it is going, casts a
 * shadow, and rests on a soft contact blob like every settler does. A design
 * from before the world went solid is carved out of its old flat art on the
 * spot; anything unreadable becomes a plain clay marker instead of a crash.
 */

export interface CreationSpecView {
  id: string;
  name: string;
  /** the 3D asset — designs are immutable, so it arrives once and is cached */
  model?: CreationModel;
  /** legacy flat art from a save older than the format */
  sprite?: CreationSprite;
}

export interface CreationUnitView {
  id: string;
  specId: string;
  pos: Vec2;
}

export interface CreationBandView {
  id: string;
  specId: string;
  pos: Vec2;
  state?: string;
  /** summaries send the head-count; full island pulses send the units themselves */
  units?: number | unknown[];
  /** where the band is bound and why — the client stages skirmishes with it */
  dest?: string;
  intent?: string;
}

// ── geometry: one build per design, cached — specs are immutable ────────────

const SPAN = ART_DIRECTION.sprites.creationScale; // world units on the long side

const builds = new Map<string, BuiltModel | null>();

/** The clay every creation is finished in; the model's own palette rides in
 * the vertex colors, so one material serves the whole ocean. */
const creationMaterial = clayMaterial({ color: "#ffffff", vertexColors: true });

const markerGeo = new THREE.BoxGeometry(SPAN * 0.5, SPAN * 0.5, SPAN * 0.5);
const markerMat = clayMaterial({ color: "#b9a389" });

const blobGeo = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({
  color: "#33261c",
  transparent: true,
  opacity: 0.24,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});

const raftGeo = new THREE.BoxGeometry(SPAN * 0.9, SPAN * 0.14, SPAN * 0.7);
const raftMat = clayMaterial({ color: CLAY_PALETTE.woodDark });

/** The model a design is built from — carving legacy flat art if that is all
 * this design ever had. Never trusts the wire: both paths re-validate. */
export function modelOf(spec: CreationSpecView): CreationModel | null {
  const model = drawableModel(spec.model);
  if (model) return model;
  const sprite = drawableSprite(spec.sprite);
  return sprite ? modelFromSprite(sprite) : null;
}

function specBuild(spec: CreationSpecView): BuiltModel | null {
  const cached = builds.get(spec.id);
  if (cached !== undefined) return cached;
  const model = modelOf(spec);
  const built = model ? buildModel(model, SPAN) : null;
  builds.set(spec.id, built);
  return built;
}

/** Cross-island design registry: colony garrisons and bands at sea reference
 * specs that live on the ruler's home island, which arrives in the same world
 * frame — every summary's specs land here first. A later frame may carry only
 * the design's id (models travel once), so a known model is never forgotten. */
const specIndex = new Map<string, CreationSpecView>();

export function registerCreationSpecs(specs: CreationSpecView[] | undefined): void {
  for (const s of specs ?? []) {
    const known = specIndex.get(s.id);
    specIndex.set(s.id, {
      ...s,
      model: s.model ?? known?.model,
      sprite: s.sprite ?? known?.sprite,
    });
  }
}

interface CreationPiece {
  root: THREE.Group;
  height: number;
}

/** One creation, assembled: the clay body plus its contact shadow. */
function makePiece(specId: string, scale = 1): CreationPiece {
  const root = new THREE.Group();
  const spec = specIndex.get(specId);
  const built = spec ? specBuild(spec) : null;
  const body = built
    ? new THREE.Mesh(built.geometry, creationMaterial)
    : new THREE.Mesh(markerGeo, markerMat);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  const blob = new THREE.Mesh(blobGeo, blobMat);
  const radius = (built?.radius ?? SPAN * 0.3) * 1.15;
  blob.scale.set(radius, 1, radius);
  blob.position.y = 0.02;
  root.add(blob);
  root.scale.setScalar(scale);
  return { root, height: (built?.height ?? SPAN * 0.5) * scale };
}

// ── land units: clay figures that walk between their server positions ───────

interface UnitAnim {
  piece: CreationPiece;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  phase: number;
  yaw: number;
}

interface ViewState {
  units: Map<string, UnitAnim>;
  heightAt: (x: number, y: number) => number;
  half: number;
  time: number;
}

const views = new Map<THREE.Group, ViewState>();

const GLIDE = 2.5; // island units per second toward the server's position
const TURN = 4.5; // radians per second a creation swings around to its heading

/** The island's creations — called on every island pulse and summary. */
export function updateCreations(
  holder: THREE.Group,
  specs: CreationSpecView[] | undefined,
  units: CreationUnitView[] | undefined,
  heightAt: (x: number, y: number) => number,
  half: number,
): void {
  registerCreationSpecs(specs);
  let view = views.get(holder);
  if (!view) {
    view = { units: new Map(), heightAt, half, time: 0 };
    views.set(holder, view);
  }
  view.heightAt = heightAt;
  view.half = half;
  const alive = new Set<string>();
  for (const u of units ?? []) {
    alive.add(u.id);
    const existing = view.units.get(u.id);
    if (existing) {
      existing.targetX = u.pos.x;
      existing.targetZ = u.pos.y;
      continue;
    }
    const piece = makePiece(u.specId);
    holder.add(piece.root);
    view.units.set(u.id, {
      piece,
      x: u.pos.x,
      z: u.pos.y,
      targetX: u.pos.x,
      targetZ: u.pos.y,
      phase: hashString(u.id) % 7,
      yaw: ((hashString(u.id) % 628) / 100) - Math.PI,
    });
  }
  for (const [id, anim] of [...view.units]) {
    if (alive.has(id)) continue;
    holder.remove(anim.piece.root);
    view.units.delete(id);
  }
}

/** Advance every creation one frame: walk toward its post, turn, breathe. */
export function tickCreations(dt: number): void {
  for (const view of views.values()) {
    view.time += dt;
    for (const anim of view.units.values()) {
      const dx = anim.targetX - anim.x;
      const dz = anim.targetZ - anim.z;
      const dist = Math.hypot(dx, dz);
      let moving = false;
      if (dist > 0.02) {
        const step = Math.min(1, (GLIDE * dt * Math.max(1, dist * 0.4)) / dist);
        anim.x += dx * step;
        anim.z += dz * step;
        moving = true;
        // face the way it walks, the short way around
        const want = Math.atan2(dx, dz);
        let turn = want - anim.yaw;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        anim.yaw += Math.max(-TURN * dt, Math.min(TURN * dt, turn));
      }
      const ground = Math.max(0.1, view.heightAt(anim.x, anim.z));
      // standing creations breathe in place; walking ones ride their stride
      const bob = moving
        ? Math.abs(Math.sin(view.time * 5 + anim.phase)) * 0.09
        : Math.sin(view.time * 1.6 + anim.phase) * 0.03;
      const root = anim.piece.root;
      root.position.set(anim.x - view.half, ground + bob, anim.z - view.half);
      root.rotation.y = anim.yaw;
    }
  }
}

// ── bands at sea: the ninjas visibly crossing the open ocean ───────────────

/** Dispatched bands sail in world space, like boats — rebuilt on every pulse. */
export function updateCreationBands(
  holder: THREE.Group,
  bands: CreationBandView[] | undefined,
): void {
  holder.clear();
  for (const band of bands ?? []) {
    const count = Array.isArray(band.units)
      ? band.units.length
      : typeof band.units === "number"
        ? band.units
        : 1;
    const grow = Math.min(1.5, 0.9 + count * 0.07);
    const piece = makePiece(band.specId, grow);
    // a raft under their feet, so a band reads as crossing water, not walking on it
    const raft = new THREE.Mesh(raftGeo, raftMat);
    raft.scale.setScalar(grow);
    raft.position.y = -SPAN * 0.05 * grow;
    raft.receiveShadow = true;
    piece.root.add(raft);
    piece.root.position.set(band.pos.x, 0.25, band.pos.y);
    piece.root.rotation.y = (hashString(band.id) % 628) / 100;
    holder.add(piece.root);
  }
}
