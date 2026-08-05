import * as THREE from "three";
import { drawableSprite } from "../shared/creations";
import { hashString } from "../shared/rng";
import type { CreationSprite, Vec2 } from "../shared/types";

/**
 * Player-invented creations on screen. Every creation is pixel-art DATA from
 * the closed vocabulary — never markup, never a URL — re-validated here with
 * `drawableSprite` because it arrives over the wire from a public server.
 * Valid sprites become nearest-filtered canvas textures on billboards; anything
 * off becomes a plain placeholder swatch instead of a crash.
 */

export interface CreationSpecView {
  id: string;
  name: string;
  sprite: CreationSprite;
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
}

/**
 * Pixel rows → per-row runs of same-colored pixels (pure, testable): the
 * painter draws one rect per run instead of one per pixel.
 */
export function spriteRuns(
  sprite: CreationSprite,
): { x: number; y: number; w: number; color: string }[] {
  const ok = drawableSprite(sprite);
  if (!ok) return [];
  const runs: { x: number; y: number; w: number; color: string }[] = [];
  ok.pixels.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      if (ch === ".") {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      runs.push({ x, y, w, color: ok.palette[Number(ch)]! });
      x += w;
    }
  });
  return runs;
}

// ── textures: one per design, cached — specs are immutable once created ────

const textures = new Map<string, THREE.Texture | null>();

function specTexture(spec: CreationSpecView): THREE.Texture | null {
  const cached = textures.get(spec.id);
  if (cached !== undefined) return cached;
  let texture: THREE.Texture | null = null;
  if (typeof document !== "undefined") {
    const runs = spriteRuns(spec.sprite);
    if (runs.length) {
      const canvas = document.createElement("canvas");
      canvas.width = spec.sprite.size;
      canvas.height = spec.sprite.size;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        for (const r of runs) {
          ctx.fillStyle = r.color;
          ctx.fillRect(r.x, r.y, r.w, 1);
        }
        texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
      }
    }
  }
  textures.set(spec.id, texture);
  return texture;
}

/** Cross-island design registry: colony garrisons and bands at sea reference
 * specs that live on the ruler's home island, which arrives in the same world
 * frame — every summary's specs land here first. */
const specIndex = new Map<string, CreationSpecView>();

export function registerCreationSpecs(specs: CreationSpecView[] | undefined): void {
  for (const s of specs ?? []) specIndex.set(s.id, s);
}

function materialFor(specId: string): THREE.SpriteMaterial {
  const spec = specIndex.get(specId);
  const texture = spec ? specTexture(spec) : null;
  return texture
    ? new THREE.SpriteMaterial({ map: texture, transparent: true })
    : new THREE.SpriteMaterial({ color: "#b9a389" });
}

// ── land units: billboards that glide between server positions and bob ─────

interface UnitAnim {
  sprite: THREE.Sprite;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  phase: number;
}

interface ViewState {
  units: Map<string, UnitAnim>;
  heightAt: (x: number, y: number) => number;
  half: number;
  time: number;
}

const views = new Map<THREE.Group, ViewState>();

const GLIDE = 2.5; // island units per second toward the server's position
const SIZE = 3.4; // world units per billboard side

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
  const alive = new Set<string>();
  for (const u of units ?? []) {
    alive.add(u.id);
    const existing = view.units.get(u.id);
    if (existing) {
      existing.targetX = u.pos.x;
      existing.targetZ = u.pos.y;
      continue;
    }
    const sprite = new THREE.Sprite(materialFor(u.specId));
    sprite.scale.set(SIZE, SIZE, 1);
    holder.add(sprite);
    view.units.set(u.id, {
      sprite,
      x: u.pos.x,
      z: u.pos.y,
      targetX: u.pos.x,
      targetZ: u.pos.y,
      phase: hashString(u.id) % 7,
    });
  }
  for (const [id, anim] of [...view.units]) {
    if (alive.has(id)) continue;
    holder.remove(anim.sprite);
    anim.sprite.material.dispose();
    view.units.delete(id);
  }
}

/** Advance every creation one frame: glide toward its post, bob gently. */
export function tickCreations(dt: number): void {
  for (const view of views.values()) {
    view.time += dt;
    for (const anim of view.units.values()) {
      const dx = anim.targetX - anim.x;
      const dz = anim.targetZ - anim.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.02) {
        const step = Math.min(1, (GLIDE * dt * Math.max(1, dist * 0.4)) / dist);
        anim.x += dx * step;
        anim.z += dz * step;
      }
      const ground = Math.max(0.1, view.heightAt(anim.x, anim.z));
      const bob = Math.sin(view.time * 2.2 + anim.phase) * 0.12;
      anim.sprite.position.set(
        anim.x - view.half,
        ground + SIZE / 2 + 0.4 + bob,
        anim.z - view.half,
      );
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
    const sprite = new THREE.Sprite(materialFor(band.specId));
    const count = Array.isArray(band.units)
      ? band.units.length
      : typeof band.units === "number"
        ? band.units
        : 1;
    const grow = Math.min(1.6, 1 + count * 0.08);
    sprite.scale.set(SIZE * grow, SIZE * grow, 1);
    sprite.position.set(band.pos.x, SIZE / 2 + 0.6, band.pos.y);
    holder.add(sprite);
  }
}
