import * as THREE from "three";
import { ageIndex } from "../shared/ages";
import { buildingSpec } from "../shared/buildings";
import { hashString, mulberry32 } from "../shared/rng";
import type { Age, Building, BuildingSpec, CivSpec } from "../shared/types";
import { ART_DIRECTION, CLAY_PALETTE, clayMaterial } from "./artDirection";
import { compactStaticMeshes } from "./meshCompaction";

/**
 * Civ-parameterized primitive composition — no external assets, ever.
 * Every type maps to an archetype builder (house, hall, workshop, mine, …)
 * or a bespoke hero builder (windmill, cathedral, space elevator, …), all
 * soft-matte clay primitives with civilization color reserved for trim.
 */

// ---------------------------------------------------------------- materials

const MATS = new Map<string, THREE.MeshStandardMaterial>();

function lam(color: string, emissive?: string, intensity = 1): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive ?? ""}|${intensity}`;
  let m = MATS.get(key);
  if (!m) {
    m = clayMaterial({ color, emissive, emissiveIntensity: intensity });
    if (emissive === WINDOW_GLOW[1]) {
      m.userData.nightWindow = true;
      m.userData.nightWindowPeak = intensity;
    }
    MATS.set(key, m);
  }
  return m;
}

/** Windows are dark glass at noon and warm points of life after dusk. */
export function windowGlowIntensity(dayness: number, peak: number = WINDOW_GLOW[2]): number {
  const day = Math.min(1, Math.max(0, dayness));
  return peak * (0.04 + (1 - day) ** 2 * 0.96);
}

export function setWindowGlow(dayness: number): void {
  for (const material of MATS.values()) {
    if (!material.userData.nightWindow) continue;
    material.emissiveIntensity = windowGlowIntensity(
      dayness,
      Number(material.userData.nightWindowPeak ?? WINDOW_GLOW[2]),
    );
  }
}

function lamColor(color: THREE.Color): THREE.MeshStandardMaterial {
  return lam(`#${color.getHexString()}`);
}

/** Roof planes get their own material identity so the batch builder can tint
 * every block's roof individually — a town of one roof colour reads as a
 * single dark mass from map height, which is the opposite of a painted town. */
function roofLam(color: THREE.Color): THREE.MeshStandardMaterial {
  const hex = `#${color.getHexString()}`;
  const key = `roof|${hex}`;
  let m = MATS.get(key);
  if (!m) {
    m = clayMaterial({ color: hex });
    m.userData.roofSurface = true;
    MATS.set(key, m);
  }
  return m;
}

export function isRoofMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.some((m) => m.userData?.roofSurface === true);
}

/**
 * A per-block roof tint, multiplied over the civ's roof colour by the
 * instanced batch. Townscaper's towns read as a mosaic because no two
 * neighbouring roofs share a shade; the hue stays inside a narrow band around
 * the civilization's own colour, so the town is varied without going rainbow.
 * The tint is normalised to average brightness 1, so variation never darkens
 * or blows out the roofline — it only paints it.
 */
export function roofInstanceTint(
  buildingId: string,
  baseHue: number,
  target = new THREE.Color(),
): THREE.Color {
  const r = mulberry32(hashString(`roof:${buildingId}`));
  const hue = (((baseHue + (r() - 0.5) * 0.24) % 1) + 1) % 1;
  const sat = 0.18 + r() * 0.16;
  target.setHSL(hue, sat, 0.5);
  const luma = target.r * 0.299 + target.g * 0.587 + target.b * 0.114;
  const gain = (0.9 + r() * 0.24) / Math.max(0.0001, luma);
  target.multiplyScalar(gain);
  return target;
}

const WOOD = CLAY_PALETTE.wood;
const WOOD_DARK = CLAY_PALETTE.woodDark;
const STONE = CLAY_PALETTE.stone;
const STONE_DARK = CLAY_PALETTE.stoneDark;
const WINDOW_GLOW = ["#4b3525", "#ffc978", 1.15] as const;
const EMBER = ["#4a1d08", "#ff7a2f", 1.8] as const;
const TECH = ["#0f2f3a", "#6fe3ff", 1.0] as const;

const ORE_COLORS: Record<string, string> = {
  copper: "#c47b3d",
  tin: "#a7b0b8",
  iron: "#767a82",
  coal: "#2f3136",
  silver: "#d6dbe2",
  marble: "#efeae2",
  gold: "#e3b544",
};

// ------------------------------------------------------------------ context

interface Ctx {
  g: THREE.Group;
  civ: CivSpec;
  spec: BuildingSpec;
  rand: () => number;
  /** later ages build a little grander */
  grand: number;
  wall: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  /** roof planes only — tinted per block by the instanced batch */
  roofMat: THREE.MeshStandardMaterial;
}

function part(
  ctx: Ctx,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.g.add(mesh);
  return mesh;
}

const box = (ctx: Ctx, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
  part(ctx, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const cyl = (
  ctx: Ctx,
  rt: number,
  rb: number,
  h: number,
  seg: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
) => part(ctx, new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
const cone = (ctx: Ctx, r: number, h: number, seg: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
  part(ctx, new THREE.ConeGeometry(r, h, seg), mat, x, y, z);

/** stone plinth under the whole building — grounds it on uneven terrain */
function plinth(ctx: Ctx, w: number, d: number): void {
  const m = box(ctx, w + 0.25, 0.18, d + 0.25, lam(STONE_DARK), 0, 0.02);
  m.receiveShadow = true;
}

/** the civ's signature roof, with a proper overhang and a pitch that keeps
 * up with the footprint — wide roofs must rise, or they read as flat discs */
function roof(ctx: Ctx, w: number, d: number, topY: number, scale = 1): void {
  const ov = Math.max(w, d) * 0.62 * scale;
  switch (ctx.civ.architecture.roof) {
    case "pagoda": {
      const h1 = 0.3 + ov * 0.42;
      const lower = cone(ctx, ov * 1.1, h1, 4, ctx.roofMat, 0, topY + h1 * 0.45);
      lower.rotation.y = Math.PI / 4;
      const h2 = h1 * 0.75;
      const upper = cone(ctx, ov * 0.66, h2, 4, ctx.roofMat, 0, topY + h1 * 0.85);
      upper.rotation.y = Math.PI / 4;
      break;
    }
    case "domed":
      part(
        ctx,
        new THREE.SphereGeometry(ov * 0.78, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2),
        ctx.roofMat,
        0,
        topY,
      );
      break;
    case "stepped":
      box(ctx, w * 0.82, 0.26 * scale, d * 0.82, ctx.roofMat, 0, topY + 0.13 * scale);
      box(ctx, w * 0.5, 0.24 * scale, d * 0.5, ctx.roofMat, 0, topY + 0.37 * scale);
      break;
    case "flat":
      box(ctx, w * 1.14, 0.12, d * 1.14, ctx.roofMat, 0, topY + 0.06);
      break;
    default: {
      // gabled
      const h = 0.35 + ov * 0.5;
      const r = cone(ctx, ov * 1.05, h, 4, ctx.roofMat, 0, topY + h * 0.48);
      r.rotation.y = Math.PI / 4;
    }
  }
}

/** warm lit windows in a strip along the ±z faces */
function windows(ctx: Ctx, w: number, d: number, rowY: number, count: number): void {
  const glow = lam(...WINDOW_GLOW);
  const geo = new THREE.BoxGeometry(0.14, 0.2, 0.05);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * (w / count) * 0.8;
    part(ctx, geo, glow, x, rowY, d / 2 + 0.005);
    part(ctx, geo, glow, x, rowY, -d / 2 - 0.005);
  }
}

/** Scale audit 2026-08-11: doors rise to ~0.9× a settler so people could
 * plausibly walk in — the old 0.5 default reached the settlers' chest. */
function door(ctx: Ctx, d: number, h = 0.62): void {
  box(ctx, 0.34, h, 0.06, lam(WOOD_DARK), 0, h / 2 + 0.1, d / 2 + 0.01);
}

function chimney(ctx: Ctx, x: number, z: number, topY: number, smoke = true): void {
  box(ctx, 0.18, 0.7, 0.18, lam(STONE_DARK), x, topY + 0.2, z);
  if (!smoke) return;
  const puff = new THREE.SphereGeometry(0.13, 6, 5);
  for (let i = 0; i < 3; i++) {
    const s = part(
      ctx,
      puff,
      new THREE.MeshLambertMaterial({
        color: "#e8e4da",
        transparent: true,
        opacity: 0.45 - i * 0.12,
      }),
      x + ctx.rand() * 0.1,
      topY + 0.72 + i * 0.3,
      z + ctx.rand() * 0.1,
    );
    s.castShadow = false;
    s.scale.setScalar(1 + i * 0.45);
  }
}

/**
 * Every civilization stamps its own mark on homes and halls, so a japanese
 * street can never be mistaken for an aztec one even from map height — the
 * roof shapes overlap between cultures, the signatures never do.
 */
function civSignature(ctx: Ctx, w: number, d: number, h: number, roofScale = 1): void {
  const front = d / 2;
  const ov = Math.max(w, d) * 0.62 * roofScale;
  const accent = lam(ctx.civ.accent);
  switch (ctx.civ.id) {
    case "japanese": {
      // a vermilion torii stands before the door; a paper lantern glows beside it
      const post = new THREE.BoxGeometry(0.09, 0.9, 0.09);
      part(ctx, post, ctx.trim, -0.34, 0.55, front + 0.5);
      part(ctx, post, ctx.trim, 0.34, 0.55, front + 0.5);
      box(ctx, 1.0, 0.09, 0.14, ctx.trim, 0, 1.04, front + 0.5);
      box(ctx, 0.74, 0.07, 0.11, ctx.trim, 0, 0.85, front + 0.5);
      box(ctx, 0.05, 0.5, 0.05, lam(WOOD_DARK), w * 0.44, 0.35, front + 0.16);
      const lantern = part(
        ctx,
        new THREE.SphereGeometry(0.13, 8, 6),
        lam("#f7ecd8", "#ffc46b", 1.1),
        w * 0.44,
        0.7,
        front + 0.16,
      );
      lantern.castShadow = false;
      break;
    }
    case "roman": {
      // a marble portico: twin columns carrying a little pediment over the door
      const marble = lam("#efeae2");
      const colGeo = new THREE.CylinderGeometry(0.07, 0.09, h * 0.88, 6);
      part(ctx, colGeo, marble, -0.34, h * 0.44 + 0.1, front + 0.3);
      part(ctx, colGeo, marble, 0.34, h * 0.44 + 0.1, front + 0.3);
      box(ctx, 0.95, 0.1, 0.36, marble, 0, h * 0.88 + 0.17, front + 0.27);
      const ped = cone(ctx, 0.52, 0.3, 4, marble, 0, h * 0.88 + 0.38, front + 0.27);
      ped.rotation.y = Math.PI / 4;
      ped.scale.z = 0.4;
      break;
    }
    case "greek": {
      // whitewash and sea-blue: a painted band under the eaves, an olive in its urn
      box(ctx, w + 0.07, 0.11, d + 0.07, accent, 0, h - 0.02);
      cyl(ctx, 0.1, 0.14, 0.3, 8, lam("#e9e2d2"), w * 0.46, 0.27, front + 0.3);
      part(
        ctx,
        new THREE.SphereGeometry(0.17, 7, 6),
        lam("#5a7a3f"),
        w * 0.46,
        0.57,
        front + 0.3,
      );
      break;
    }
    case "egyptian": {
      // tapered pylon gates flank the door; a gilded obelisk marks the yard
      const pylon = new THREE.CylinderGeometry(0.1, 0.17, 0.95, 4);
      for (const s of [-1, 1] as const) {
        const p = part(ctx, pylon, ctx.trim, s * 0.4, 0.57, front + 0.24);
        p.rotation.y = Math.PI / 4;
      }
      const ob = cyl(ctx, 0.05, 0.1, 1.35, 4, lam("#e9dcb8"), w * 0.56, 0.77, front + 0.42);
      ob.rotation.y = Math.PI / 4;
      const tip = cone(ctx, 0.1, 0.2, 4, lam("#e3b544"), w * 0.56, 1.55, front + 0.42);
      tip.rotation.y = Math.PI / 4;
      break;
    }
    case "norse": {
      // carved beams cross at the roof peak; a painted shield guards the door
      const peak = h + 0.1 + (0.35 + ov * 0.5) * 0.92;
      const beam = new THREE.BoxGeometry(0.07, 0.72, 0.07);
      const b1 = part(ctx, beam, lam(WOOD_DARK), 0, peak, 0);
      b1.rotation.z = 0.55;
      const b2 = part(ctx, beam, lam(WOOD_DARK), 0, peak, 0);
      b2.rotation.z = -0.55;
      const shield = part(
        ctx,
        new THREE.CylinderGeometry(0.24, 0.24, 0.06, 10),
        accent,
        -w * 0.32,
        h * 0.55,
        front + 0.04,
      );
      shield.rotation.x = Math.PI / 2;
      part(
        ctx,
        new THREE.SphereGeometry(0.07, 6, 5),
        lam("#d6dbe2"),
        -w * 0.32,
        h * 0.55,
        front + 0.09,
      );
      break;
    }
    case "aztec": {
      // a painted step-fret band across the facade; a stone serpent by the door
      for (let i = 0; i < 5; i++) {
        box(
          ctx,
          0.17,
          i % 2 ? 0.17 : 0.09,
          0.05,
          accent,
          (i - 2) * 0.25,
          h * 0.58 + (i % 2 ? 0 : 0.05),
          front + 0.02,
        );
      }
      box(ctx, 0.26, 0.26, 0.34, lam(STONE), w * 0.48, 0.28, front + 0.26);
      const snout = cone(ctx, 0.13, 0.26, 6, lam(STONE), w * 0.48, 0.28, front + 0.5);
      snout.rotation.x = Math.PI / 2;
      break;
    }
    case "mauryan": {
      // a gilded stupa finial crowns the dome; torana posts frame the way in
      const gold = lam("#e3b544");
      const domeTop = h + 0.1 + ov * 0.76;
      cyl(ctx, 0.1, 0.14, 0.1, 8, gold, 0, domeTop + 0.05);
      cyl(ctx, 0.02, 0.02, 0.36, 6, gold, 0, domeTop + 0.28);
      cyl(ctx, 0.1, 0.1, 0.03, 8, gold, 0, domeTop + 0.44);
      const post = new THREE.BoxGeometry(0.08, 0.85, 0.08);
      part(ctx, post, lam(WOOD_DARK), -0.36, 0.52, front + 0.42);
      part(ctx, post, lam(WOOD_DARK), 0.36, 0.52, front + 0.42);
      box(ctx, 0.98, 0.07, 0.12, accent, 0, 0.97, front + 0.42);
      box(ctx, 0.86, 0.06, 0.1, accent, 0, 0.82, front + 0.42);
      break;
    }
    case "mongol": {
      // felt banding rings the walls; a horsetail banner flies from a tall pole
      box(ctx, w + 0.08, 0.13, d + 0.08, accent, 0, h * 0.38);
      const px = w * 0.52;
      const pz = front + 0.34;
      cyl(ctx, 0.03, 0.03, 1.9, 6, lam(WOOD_DARK), px, 0.95, pz);
      box(ctx, 0.42, 0.13, 0.02, accent, px + 0.24, 1.78, pz);
      const tail = cone(ctx, 0.07, 0.3, 6, lam("#e8e4da"), px, 1.5, pz);
      tail.rotation.x = Math.PI;
      break;
    }
  }
}

// ------------------------------------------------------------- archetypes

const THATCH = "#9c8455";
const THATCH_DARK = "#7d6a42";
const BRICK = "#7d4a3a";

/** stone-age home: a hide tent ringed with the camp's small life */
function bTentHome(ctx: Ctx): void {
  const r = 0.75 + (ctx.spec.houses ?? 2) * 0.06;
  part(ctx, new THREE.CylinderGeometry(r + 0.3, r + 0.38, 0.08, 10), lam("#6b5b41"), 0, 0.04);
  const hide = cone(ctx, r, r * 1.5, 8, lam(THATCH), 0, r * 0.75 + 0.06);
  hide.rotation.y = ctx.rand();
  // lashed poles crossing at the smoke hole
  for (const a of [0.3, 1.9, 3.6]) {
    const pole = cyl(ctx, 0.025, 0.025, r * 1.9, 5, lam(WOOD_DARK), Math.cos(a) * 0.1, r * 0.95, Math.sin(a) * 0.1);
    pole.rotation.z = Math.cos(a) * 0.35;
    pole.rotation.x = Math.sin(a) * 0.35;
  }
  // dark door flap and the fire outside it
  box(ctx, 0.26, 0.4, 0.05, lam("#3d3227"), 0, 0.26, r * 0.86);
  const ember = part(ctx, new THREE.CylinderGeometry(0.12, 0.16, 0.1, 7), lam(...EMBER), 0, 0.09, r + 0.5);
  ember.castShadow = false;
  if ((ctx.spec.houses ?? 2) >= 3) {
    const kid = cone(ctx, r * 0.55, r * 0.8, 7, lam(THATCH_DARK), r * 1.2, r * 0.4 + 0.06, -r * 0.5);
    kid.rotation.y = ctx.rand();
  }
}

/** bronze-age home: wattle walls under a heavy thatch cap, no chimney yet */
function bWattleHome(ctx: Ctx): void {
  const w = (1.0 + (ctx.spec.houses ?? 2) * 0.07) * ctx.grand;
  const d = w * (ctx.spec.type === "longhouse" ? 1.7 : 0.9);
  const h = 0.55;
  plinth(ctx, w, d);
  box(ctx, w, h, d, ctx.wall, 0, h / 2 + 0.1);
  const cap = cone(ctx, Math.max(w, d) * 0.85, 0.75, 4, lam(THATCH), 0, h + 0.42);
  cap.rotation.y = Math.PI / 4;
  cap.scale.z = d / w;
  const brow = cone(ctx, Math.max(w, d) * 0.95, 0.22, 4, lam(THATCH_DARK), 0, h + 0.16);
  brow.rotation.y = Math.PI / 4;
  brow.scale.z = d / w;
  door(ctx, d, 0.42);
  windows(ctx, w, d, h * 0.65, 1);
}

/** industrial home: the brick rowhouse — flat parapet, twin smoking stacks */
function bRowHome(ctx: Ctx): void {
  const homes = ctx.spec.houses ?? 8;
  const floors = Math.min(4, 2 + Math.floor(homes / 6));
  const w = (1.3 + Math.min(homes, 12) * 0.06) * ctx.grand;
  const d = w * 0.8;
  const fh = 0.66;
  const h = fh * floors + 0.2;
  ctx.wall.color.lerp(new THREE.Color(BRICK), 0.55);
  plinth(ctx, w, d);
  box(ctx, w, h, d, ctx.wall, 0, h / 2 + 0.1);
  for (let f = 0; f < floors; f++) windows(ctx, w, d, 0.5 + f * fh, 3);
  door(ctx, d);
  // parapet instead of the town roof — the age of soot builds flat
  box(ctx, w + 0.12, 0.12, d + 0.12, ctx.trim, 0, h + 0.14);
  box(ctx, w * 0.5, 0.3, d * 0.5, ctx.wall, 0, h + 0.3, -d * 0.1);
  chimney(ctx, w * 0.32, -d * 0.22, h + 0.2);
  chimney(ctx, -w * 0.32, -d * 0.22, h + 0.2, false);
}

/** modern & future home: the tower — window bands climbing into the sky */
function bTowerHome(ctx: Ctx, future: boolean): void {
  const homes = ctx.spec.houses ?? 16;
  const floors = Math.min(9, 4 + Math.floor(homes / 4));
  const fh = 0.42;
  const w = 1.35 * ctx.grand;
  const d = w * 0.85;
  const h = fh * floors + 0.3;
  plinth(ctx, w, d);
  box(ctx, w, h, d, ctx.wall, 0, h / 2 + 0.1);
  const glow = future ? lam(...TECH) : lam(...WINDOW_GLOW);
  const band = new THREE.BoxGeometry(w * 0.78, 0.16, 0.05);
  for (let f = 0; f < floors; f++) {
    part(ctx, band, glow, 0, 0.5 + f * fh, d / 2 + 0.01).castShadow = false;
    part(ctx, band, glow, 0, 0.5 + f * fh, -d / 2 - 0.01).castShadow = false;
  }
  // corner mullions carry the eye upward
  const mull = new THREE.BoxGeometry(0.08, h, 0.08);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    part(ctx, mull, ctx.trim, (sx * w) / 2, h / 2 + 0.1, (sz * d) / 2);
  }
  box(ctx, w * 0.96, 0.1, d * 0.96, ctx.trim, 0, h + 0.14);
  if (future) {
    const crown = box(ctx, w * 0.55, 0.34, d * 0.55, lam(...TECH), 0, h + 0.36);
    crown.castShadow = false;
    cyl(ctx, 0.02, 0.02, 0.9, 5, ctx.trim, 0, h + 0.95);
  } else {
    box(ctx, w * 0.4, 0.24, d * 0.4, ctx.wall, 0, h + 0.3, -d * 0.15);
    cyl(ctx, 0.015, 0.015, 0.6, 5, lam(STONE_DARK), w * 0.28, h + 0.5, d * 0.2);
  }
  door(ctx, d, 0.55);
}

function bHouse(ctx: Ctx): void {
  const era = ageIndex(ctx.spec.age);
  if (era === 0) return bTentHome(ctx);
  if (era === 1) return bWattleHome(ctx);
  if (era === 6) return bRowHome(ctx);
  if (era >= 7) return bTowerHome(ctx, era >= 8);
  const homes = ctx.spec.houses ?? 2;
  const floors = Math.min(4, Math.max(1, Math.round(homes / 5) + (homes >= 6 ? 2 : 1) - 1));
  const w = (1.1 + Math.min(homes, 8) * 0.09) * ctx.grand;
  const d = w * (ctx.spec.type === "longhouse" ? 1.7 : 0.85);
  const fh = 0.72;
  const h = fh * floors + 0.25;
  plinth(ctx, w, d);
  box(ctx, w, h, d, ctx.wall, 0, h / 2 + 0.1);
  if (era >= 4) {
    // medieval and renaissance build in stone below and timber frame above
    box(ctx, w + 0.07, fh * 0.85, d + 0.07, lam(STONE), 0, fh * 0.42 + 0.1);
    const beam = new THREE.BoxGeometry(0.07, h - fh * 0.7, 0.07);
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
      part(ctx, beam, lam(WOOD_DARK), (sx * w) / 2, fh * 0.8 + (h - fh * 0.7) / 2, (sz * d) / 2);
    }
    box(ctx, w + 0.04, 0.07, d + 0.04, lam(WOOD_DARK), 0, fh * 0.85 + 0.1);
  }
  for (let f = 0; f < floors; f++) windows(ctx, w, d, 0.55 + f * fh, floors > 2 ? 3 : 2);
  door(ctx, d);
  roof(ctx, w, d, h + 0.1, era >= 4 ? 1.12 : 1);
  if (era >= 2) chimney(ctx, w * 0.3, -d * 0.2, h + 0.15);
  civSignature(ctx, w, d, h);
}

/** the modern skyline: a glass office tower where the age builds its pride */
function bOfficeTower(ctx: Ctx, future: boolean, small: boolean): void {
  const w = (small ? 1.1 : 1.5) * ctx.grand;
  const d = w * 0.8;
  const h = (small ? 2.2 : 3.1) * ctx.grand;
  plinth(ctx, w, d);
  const glass = lam(future ? "#16323c" : "#28343e", future ? "#5fd7f2" : "#ffc46b", 0.35);
  box(ctx, w, h, d, glass, 0, h / 2 + 0.1);
  const mull = new THREE.BoxGeometry(0.07, h, 0.07);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    part(ctx, mull, ctx.trim, (sx * w) / 2, h / 2 + 0.1, (sz * d) / 2);
  }
  const glow = future ? lam(...TECH) : lam(...WINDOW_GLOW);
  const band = new THREE.BoxGeometry(0.05, h * 0.9, 0.16);
  for (const s of [-1, 1] as const) {
    part(ctx, band, glow, (s * w) / 3.4, h / 2 + 0.1, d / 2 + 0.01).castShadow = false;
    part(ctx, band, glow, (s * w) / 3.4, h / 2 + 0.1, -d / 2 - 0.01).castShadow = false;
  }
  // a setback crown, then the spire
  box(ctx, w * 0.62, 0.4, d * 0.62, glass, 0, h + 0.3);
  box(ctx, w * 0.66, 0.07, d * 0.66, ctx.trim, 0, h + 0.53);
  cyl(ctx, 0.02, 0.02, future ? 1.1 : 0.8, 5, ctx.trim, 0, h + 0.55 + (future ? 0.55 : 0.4));
  door(ctx, d, 0.6);
}

function bHall(ctx: Ctx, opts: { columns?: boolean; wide?: boolean; small?: boolean } = {}): void {
  const era = ageIndex(ctx.spec.age);
  if (era >= 7) return bOfficeTower(ctx, era >= 8, Boolean(opts.small));
  const w = (opts.small ? 1.5 : opts.wide ? 2.6 : 2.1) * ctx.grand;
  const d = w * 0.72;
  const h = (opts.small ? 1.0 : 1.4) * ctx.grand * (era <= 1 ? 0.75 : 1);
  plinth(ctx, w, d);
  box(ctx, w, h, d, ctx.wall, 0, h / 2 + 0.1);
  windows(ctx, w, d, h * 0.62, opts.small ? 2 : 4);
  door(ctx, d, 0.6);
  if (era <= 1) {
    // the dawn's meeting hall: heavy thatch and carved posts, nothing more
    const cap = cone(ctx, Math.max(w, d) * 0.8, 0.8, 4, lam(THATCH), 0, h + 0.5);
    cap.rotation.y = Math.PI / 4;
    cap.scale.z = d / w;
    box(ctx, 0.09, h + 0.35, 0.09, lam(WOOD_DARK), -w * 0.3, (h + 0.35) / 2 + 0.1, d / 2 + 0.18);
    box(ctx, 0.09, h + 0.35, 0.09, lam(WOOD_DARK), w * 0.3, (h + 0.35) / 2 + 0.1, d / 2 + 0.18);
    return;
  }
  if (era === 4 || era === 5) {
    // the castle ages buttress their halls in dressed stone
    const butt = new THREE.BoxGeometry(0.18, h * 0.8, 0.3);
    for (const s of [-1, 1] as const) {
      for (const f of [-0.3, 0.3] as const) {
        const m = part(ctx, butt, lam(STONE), (s * w) / 2 + s * 0.06, h * 0.38 + 0.1, f * d);
        m.rotation.z = -s * 0.12;
      }
    }
  }
  if (opts.columns) {
    const colGeo = new THREE.CylinderGeometry(0.09, 0.11, h, 6);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (w / n) * 0.85;
      part(ctx, colGeo, lam("#e9e2d2"), x, h / 2 + 0.1, d / 2 + 0.22);
    }
    box(ctx, w * 0.95, 0.14, 0.5, ctx.trim, 0, h + 0.14, d / 2 + 0.1);
  }
  roof(ctx, w, d, h + 0.1, era === 4 || era === 5 ? 1.28 : 1.15);
  civSignature(ctx, w, d, h, 1.15);
}

const SHED_ROOF = "#4a3f30";

function bWorkshop(
  ctx: Ctx,
  opts: { ember?: boolean; big?: boolean; stacks?: number; accent?: string } = {},
): void {
  const w = (opts.big ? 1.9 : 1.4) * ctx.grand;
  const d = w * 0.85;
  const h = 0.8 * ctx.grand;
  plinth(ctx, w, d);
  box(ctx, w, h, d, ctx.wall, 0, h / 2 + 0.1);
  door(ctx, d);
  windows(ctx, w, d, h * 0.6, 2);
  // workshops wear a plain timber skillion, never the town's grand roof —
  // from map height the roof is the badge: the civ roof means a home, dark
  // timber with the trade's colored stripe means work happens here
  const slope = part(ctx, new THREE.BoxGeometry(w + 0.35, 0.09, d + 0.5), lam(SHED_ROOF), 0, h + 0.2);
  slope.rotation.x = 0.16;
  if (opts.accent) {
    const stripe = part(ctx, new THREE.BoxGeometry(w * 0.92, 0.05, 0.42), lam(opts.accent), 0, h + 0.27, d * 0.12);
    stripe.rotation.x = 0.16;
    const awn = part(ctx, new THREE.BoxGeometry(w * 0.62, 0.05, 0.44), lam(opts.accent), 0, h * 0.72, d / 2 + 0.24);
    awn.rotation.x = 0.3;
    box(ctx, 0.05, h * 0.52, 0.05, lam(WOOD_DARK), -w * 0.28, h * 0.32, d / 2 + 0.42);
    box(ctx, 0.05, h * 0.52, 0.05, lam(WOOD_DARK), w * 0.28, h * 0.32, d / 2 + 0.42);
  }
  const stacks = opts.stacks ?? 1;
  for (let i = 0; i < stacks; i++) chimney(ctx, w * 0.32 - i * 0.5, -d * 0.28, h + 0.3);
  // side lean-to with stores
  box(ctx, w * 0.5, 0.5, d * 0.6, ctx.wall, w * 0.72, 0.35);
  const lean = box(ctx, w * 0.6, 0.07, d * 0.7, lam(SHED_ROOF), w * 0.72, 0.66);
  lean.rotation.z = -0.28;
  cyl(ctx, 0.14, 0.14, 0.3, 8, lam(WOOD), w * 0.72, 0.25, d * 0.55);
  if (opts.ember) {
    const e = part(ctx, new THREE.BoxGeometry(0.44, 0.38, 0.06), lam(...EMBER), 0, 0.34, d / 2 + 0.02);
    e.castShadow = false;
  }
}

function bMine(ctx: Ctx): void {
  const ore = ORE_COLORS[ctx.spec.type.split("-")[0]!] ?? STONE;
  // rocky mound with a dark adit framed in timber
  const mound = part(ctx, new THREE.IcosahedronGeometry(0.9), lam(STONE), 0, 0.35, -0.2);
  mound.scale.set(1.5, 0.85, 1.2);
  box(ctx, 0.5, 0.55, 0.1, lam("#17181c"), 0, 0.32, 0.62);
  box(ctx, 0.1, 0.62, 0.1, lam(WOOD_DARK), -0.3, 0.36, 0.64);
  box(ctx, 0.1, 0.62, 0.1, lam(WOOD_DARK), 0.3, 0.36, 0.64);
  box(ctx, 0.74, 0.1, 0.12, lam(WOOD_DARK), 0, 0.7, 0.64);
  // timber headframe
  const legA = box(ctx, 0.09, 1.5, 0.09, lam(WOOD), 0.75, 0.75, 0.2);
  legA.rotation.z = 0.3;
  const legB = box(ctx, 0.09, 1.5, 0.09, lam(WOOD), 1.15, 0.75, 0.2);
  legB.rotation.z = -0.3;
  box(ctx, 0.5, 0.09, 0.09, lam(WOOD), 0.95, 1.42, 0.2);
  // spilled ore
  const chunk = new THREE.IcosahedronGeometry(0.14);
  for (let i = 0; i < 5; i++) {
    part(ctx, chunk, lam(ore), (ctx.rand() - 0.3) * 1.4, 0.12, 0.9 + ctx.rand() * 0.5);
  }
}

function bSacred(ctx: Ctx, opts: { small?: boolean } = {}): void {
  const w = (opts.small ? 1.1 : 2.0) * ctx.grand;
  const d = w * 0.8;
  const h = (opts.small ? 0.8 : 1.5) * ctx.grand;
  plinth(ctx, w, d);
  box(ctx, w * 1.08, 0.14, d * 1.08, lam("#e9e2d2"), 0, 0.16);
  box(ctx, w * 0.7, h, d * 0.7, ctx.wall, 0, h / 2 + 0.2);
  const colGeo = new THREE.CylinderGeometry(0.08, 0.1, h, 6);
  const n = opts.small ? 2 : 4;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (w / n) * 0.9;
    part(ctx, colGeo, lam("#e9e2d2"), x, h / 2 + 0.2, d * 0.42);
    part(ctx, colGeo, lam("#e9e2d2"), x, h / 2 + 0.2, -d * 0.42);
  }
  roof(ctx, w, d, h + 0.2, 1.2);
  if (!opts.small) {
    const glowMat = lam(...WINDOW_GLOW);
    part(ctx, new THREE.CylinderGeometry(0.12, 0.12, 0.05, 8), glowMat, 0, h * 0.75, d * 0.36).rotation.x =
      Math.PI / 2;
  }
}

function bDefense(ctx: Ctx, opts: { grand?: boolean } = {}): void {
  const w = (opts.grand ? 2.2 : 1.5) * ctx.grand;
  const d = w * 0.85;
  const h = (opts.grand ? 1.8 : 1.1) * ctx.grand;
  plinth(ctx, w, d);
  const stoneMat = lam(STONE);
  box(ctx, w, h, d, stoneMat, 0, h / 2 + 0.1);
  crenellate(ctx, w, d, h + 0.1);
  door(ctx, d, 0.62);
  windows(ctx, w, d, h * 0.7, 2);
  if (opts.grand) {
    const turret = new THREE.CylinderGeometry(0.28, 0.32, h + 0.7, 7);
    const capGeo = new THREE.ConeGeometry(0.38, 0.45, 7);
    for (const [sx, sz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      part(ctx, turret, stoneMat, (sx * w) / 2, (h + 0.7) / 2 + 0.1, (sz * d) / 2);
      part(ctx, capGeo, ctx.trim, (sx * w) / 2, h + 1.0, (sz * d) / 2);
    }
    // banner
    box(ctx, 0.04, 0.8, 0.04, lam(WOOD_DARK), 0, h + 0.5, 0);
    box(ctx, 0.3, 0.2, 0.02, ctx.trim, 0.18, h + 0.78, 0);
  }
}

function crenellate(ctx: Ctx, w: number, d: number, topY: number): void {
  const m = lam(STONE_DARK);
  const geo = new THREE.BoxGeometry(0.16, 0.18, 0.16);
  const n = Math.max(3, Math.round(w / 0.4));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (w / (n - 1)) * 0.96;
    part(ctx, geo, m, x, topY + 0.09, d / 2 - 0.08);
    part(ctx, geo, m, x, topY + 0.09, -d / 2 + 0.08);
  }
}

function bTower(ctx: Ctx, opts: { h?: number; bell?: boolean } = {}): void {
  const h = (opts.h ?? 2.3) * ctx.grand;
  const r = 0.42;
  plinth(ctx, r * 2, r * 2);
  cyl(ctx, r * 0.82, r, h, 7, lam(STONE), 0, h / 2 + 0.1);
  cyl(ctx, r * 1.15, r * 1.15, 0.3, 7, ctx.wall, 0, h + 0.15);
  if (opts.bell) {
    part(ctx, new THREE.SphereGeometry(0.16, 8, 6), lam("#e3b544"), 0, h + 0.02);
  } else {
    windows(ctx, r * 1.6, r * 1.6, h * 0.8, 1);
  }
  cone(ctx, r * 1.35, 0.6, 7, ctx.trim, 0, h + 0.6);
}

function bTech(ctx: Ctx, opts: { dome?: boolean; ring?: boolean; obelisk?: boolean } = {}): void {
  const w = 1.7 * ctx.grand;
  plinth(ctx, w, w);
  const glow = lam(...TECH);
  box(ctx, w, 0.3, w, lam("#c9cdd4"), 0, 0.25);
  if (opts.obelisk) {
    const h = 2.4 * ctx.grand;
    cyl(ctx, 0.16, 0.4, h, 4, lam("#3b4048"), 0, h / 2 + 0.4);
    const strip = part(ctx, new THREE.BoxGeometry(0.06, h * 0.7, 0.06), glow, 0.22, h / 2 + 0.4, 0.22);
    strip.castShadow = false;
    part(ctx, new THREE.SphereGeometry(0.14, 8, 6), glow, 0, h + 0.55).castShadow = false;
  } else if (opts.dome) {
    part(
      ctx,
      new THREE.SphereGeometry(w * 0.48, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({
        color: "#cfeef7",
        transparent: true,
        opacity: 0.55,
        emissive: new THREE.Color("#6fe3ff"),
        emissiveIntensity: 0.28,
      }),
      0,
      0.4,
    );
    cyl(ctx, 0.2, 0.26, 0.5, 8, lam("#3b4048"), 0, 0.6);
  } else {
    cyl(ctx, 0.45, 0.55, 1.1, 8, lam("#3b4048"), 0, 0.95);
    if (opts.ring !== false) {
      const ring = part(ctx, new THREE.TorusGeometry(0.75, 0.07, 8, 24), glow, 0, 1.1);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = false;
    }
    part(ctx, new THREE.SphereGeometry(0.2, 8, 6), glow, 0, 1.7).castShadow = false;
  }
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    box(ctx, 0.1, 0.5, 0.1, lam("#8b9098"), sx * w * 0.42, 0.45, sz * w * 0.42);
  }
}

// ---------------------------------------------------------- hero builders

function bCampfire(ctx: Ctx): void {
  const logGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 5);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const log = part(ctx, logGeo, lam(WOOD_DARK), Math.cos(a) * 0.18, 0.22, Math.sin(a) * 0.18);
    log.rotation.set(Math.cos(a), 0, Math.sin(a));
  }
  const stoneGeo = new THREE.IcosahedronGeometry(0.09);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    part(ctx, stoneGeo, lam(STONE_DARK), Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5);
  }
  const flame = cone(ctx, 0.16, 0.42, 6, lam("#7a2408", "#ff8c2e", 2.2), 0, 0.42);
  flame.castShadow = false;
}

function bStoryCircle(ctx: Ctx): void {
  const seat = new THREE.CylinderGeometry(0.11, 0.13, 0.24, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    part(ctx, seat, lam(WOOD), Math.cos(a) * 0.75, 0.14, Math.sin(a) * 0.75);
  }
  box(ctx, 0.08, 1.5, 0.08, lam(WOOD_DARK), 0, 0.75);
  box(ctx, 0.42, 0.26, 0.03, ctx.trim, 0.24, 1.3);
  const flame = cone(ctx, 0.1, 0.26, 6, lam("#7a2408", "#ff8c2e", 2), 0.4, 0.2, 0.3);
  flame.castShadow = false;
}

function bGranary(ctx: Ctx): void {
  const legGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.5, 5);
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    part(ctx, legGeo, lam(WOOD_DARK), sx * 0.45, 0.25, sz * 0.4);
  }
  box(ctx, 1.25, 0.8, 1.05, ctx.wall, 0, 0.9);
  roof(ctx, 1.25, 1.05, 1.3);
  // grain sacks at the ladder
  box(ctx, 0.1, 0.55, 0.04, lam(WOOD), 0, 0.35, 0.56);
  part(ctx, new THREE.SphereGeometry(0.14, 6, 5), lam("#d9b56a"), 0.5, 0.14, 0.75);
  part(ctx, new THREE.SphereGeometry(0.12, 6, 5), lam("#d9b56a"), 0.72, 0.12, 0.55);
}

function bTent(ctx: Ctx): void {
  cone(ctx, 0.85, 1.5, 7, lam("#b08a5e"), 0, 0.75);
  const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4);
  for (const a of [0.4, 1.1, 1.9]) {
    const p = part(ctx, poleGeo, lam(WOOD_DARK), Math.cos(a) * 0.16, 1.55, Math.sin(a) * 0.16);
    p.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
  }
  box(ctx, 0.26, 0.5, 0.05, lam("#5c4326"), 0, 0.28, 0.78);
  // totems
  cyl(ctx, 0.07, 0.09, 0.9, 5, ctx.trim, 1.0, 0.45, 0.4);
  part(ctx, new THREE.SphereGeometry(0.12, 6, 5), ctx.trim, 1.0, 0.98, 0.4);
}

function bRack(ctx: Ctx): void {
  const post = new THREE.BoxGeometry(0.07, 1.0, 0.07);
  for (const x of [-0.7, 0, 0.7]) part(ctx, post, lam(WOOD_DARK), x, 0.5, 0);
  box(ctx, 1.55, 0.06, 0.06, lam(WOOD), 0, 0.95);
  box(ctx, 1.55, 0.06, 0.06, lam(WOOD), 0, 0.6);
  const hide = new THREE.BoxGeometry(0.3, 0.34, 0.03);
  for (let i = 0; i < 3; i++) {
    part(ctx, hide, lam("#c2955e"), -0.5 + i * 0.5, 0.76, 0.02);
  }
}

function bMound(ctx: Ctx, dark = false): void {
  const m = part(
    ctx,
    new THREE.SphereGeometry(0.95, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    lam(dark ? "#4a4a42" : "#6d8a4e"),
    0,
    0.06,
  );
  m.scale.y = 0.62;
  box(ctx, 0.4, 0.5, 0.1, lam("#17181c"), 0, 0.28, 0.86);
  box(ctx, 0.12, 0.6, 0.12, lam(STONE_DARK), -0.32, 0.32, 0.9);
  box(ctx, 0.12, 0.6, 0.12, lam(STONE_DARK), 0.32, 0.32, 0.9);
  box(ctx, 0.72, 0.12, 0.14, lam(STONE_DARK), 0, 0.66, 0.9);
  if (dark) chimney(ctx, 0, 0, 0.35);
}

function bStoneCircle(ctx: Ctx): void {
  const stone = new THREE.BoxGeometry(0.26, 1.0, 0.16);
  const lintel = new THREE.BoxGeometry(0.62, 0.2, 0.18);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const s = part(ctx, stone, lam(STONE), Math.cos(a) * 0.85, 0.5, Math.sin(a) * 0.85);
    s.rotation.y = -a;
    if (i % 2 === 0) {
      const l = part(ctx, lintel, lam(STONE_DARK), Math.cos(a) * 0.85, 1.08, Math.sin(a) * 0.85);
      l.rotation.y = -a + Math.PI / 2;
    }
  }
  part(ctx, new THREE.BoxGeometry(0.4, 0.16, 0.4), lam(STONE_DARK), 0, 0.1);
}

function bPalisade(ctx: Ctx): void {
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.1, 5);
  const tipGeo = new THREE.ConeGeometry(0.09, 0.2, 5);
  for (let i = 0; i < 9; i++) {
    const x = -1.2 + i * 0.3;
    const h = 1.0 + ctx.rand() * 0.2;
    part(ctx, postGeo, lam(WOOD), x, h / 2, 0).scale.y = h / 1.1;
    part(ctx, tipGeo, lam(WOOD_DARK), x, h + 0.08, 0);
  }
  box(ctx, 2.5, 0.08, 0.08, lam(WOOD_DARK), 0, 0.75, 0.12);
}

function bStoneWall(ctx: Ctx, grand = false): void {
  const h = grand ? 1.25 : 0.9;
  box(ctx, 2.6, h, 0.4, lam(STONE), 0, h / 2 + 0.1);
  crenellate(ctx, 2.6, 0.4, h + 0.1);
  const tw = grand ? 0.6 : 0.5;
  const th = grand ? 1.8 : 1.3;
  box(ctx, tw, th, tw, lam(STONE_DARK), -1.3, th / 2);
  box(ctx, tw, th, tw, lam(STONE_DARK), 1.3, th / 2);
  if (grand) {
    cone(ctx, 0.45, 0.5, 7, ctx.trim, -1.3, th + 0.25);
    cone(ctx, 0.45, 0.5, 7, ctx.trim, 1.3, th + 0.25);
    box(ctx, 0.5, 0.6, 0.44, lam("#17181c"), 0, 0.4);
  }
}

function bWell(ctx: Ctx): void {
  cyl(ctx, 0.42, 0.46, 0.4, 8, lam(STONE), 0, 0.2);
  const water = part(ctx, new THREE.CylinderGeometry(0.32, 0.32, 0.05, 8), lam("#123c50", "#2e7d9e", 0.5), 0, 0.4);
  water.castShadow = false;
  box(ctx, 0.07, 0.9, 0.07, lam(WOOD_DARK), -0.4, 0.45, 0);
  box(ctx, 0.07, 0.9, 0.07, lam(WOOD_DARK), 0.4, 0.45, 0);
  const r = cone(ctx, 0.62, 0.4, 4, ctx.trim, 0, 1.05);
  r.rotation.y = Math.PI / 4;
  box(ctx, 0.9, 0.05, 0.05, lam(WOOD), 0, 0.85, 0);
}

function bBridge(ctx: Ctx): void {
  box(ctx, 2.6, 0.14, 0.9, lam(WOOD), 0, 0.62);
  const arch = part(ctx, new THREE.CylinderGeometry(0.55, 0.55, 0.9, 10, 1, false, 0, Math.PI), lam(STONE), 0, 0.6);
  arch.rotation.set(0, 0, Math.PI / 2);
  arch.rotation.x = Math.PI / 2;
  box(ctx, 0.4, 0.65, 0.9, lam(STONE), -1.25, 0.32);
  box(ctx, 0.4, 0.65, 0.9, lam(STONE), 1.25, 0.32);
  for (const x of [-1.1, -0.4, 0.4, 1.1]) {
    box(ctx, 0.06, 0.3, 0.06, lam(WOOD_DARK), x, 0.85, 0.42);
    box(ctx, 0.06, 0.3, 0.06, lam(WOOD_DARK), x, 0.85, -0.42);
  }
}

function bDock(ctx: Ctx): void {
  box(ctx, 2.4, 0.12, 1.0, lam(WOOD), 0, 0.45);
  const post = new THREE.CylinderGeometry(0.07, 0.08, 0.6, 5);
  for (const [x, z] of [
    [-1.05, -0.4],
    [-1.05, 0.4],
    [0, -0.4],
    [0, 0.4],
    [1.05, -0.4],
    [1.05, 0.4],
  ] as const) {
    part(ctx, post, lam(WOOD_DARK), x, 0.22, z);
  }
  // crane
  box(ctx, 0.1, 1.2, 0.1, lam(WOOD_DARK), 0.9, 1.1, 0);
  const jib = box(ctx, 0.08, 0.9, 0.08, lam(WOOD), 1.15, 1.55, 0);
  jib.rotation.z = -1.1;
  box(ctx, 0.02, 0.5, 0.02, lam("#3a3a3f"), 1.55, 1.35, 0);
  box(ctx, 0.24, 0.24, 0.24, ctx.trim, 1.55, 1.05, 0);
  // stacked cargo
  box(ctx, 0.3, 0.3, 0.3, lam(WOOD), -0.8, 0.72, 0.2);
  cyl(ctx, 0.16, 0.16, 0.34, 8, lam(WOOD_DARK), -0.45, 0.74, -0.25);
}

function bBoatYard(ctx: Ctx): void {
  const hull = part(ctx, new THREE.CylinderGeometry(0.5, 0.22, 2.0, 6, 1), lam(ctx.civ.boat.hull), 0, 0.75);
  hull.rotation.z = Math.PI / 2;
  hull.scale.z = 0.55;
  box(ctx, 0.3, 0.5, 0.12, lam(WOOD_DARK), -0.7, 0.3, 0.25);
  box(ctx, 0.3, 0.5, 0.12, lam(WOOD_DARK), 0.7, 0.3, 0.25);
  box(ctx, 0.3, 0.5, 0.12, lam(WOOD_DARK), -0.7, 0.3, -0.25);
  box(ctx, 0.3, 0.5, 0.12, lam(WOOD_DARK), 0.7, 0.3, -0.25);
  box(ctx, 0.06, 1.1, 0.06, lam(WOOD), 0, 1.3);
}

function bKiln(ctx: Ctx): void {
  const domeMat = lam("#b3765a");
  part(ctx, new THREE.SphereGeometry(0.7, 9, 7, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, 0, 0.15);
  cyl(ctx, 0.14, 0.18, 0.5, 6, lam(STONE_DARK), 0, 0.85);
  const mouth = part(ctx, new THREE.BoxGeometry(0.3, 0.26, 0.06), lam(...EMBER), 0, 0.22, 0.68);
  mouth.castShadow = false;
  const potGeo = new THREE.CylinderGeometry(0.09, 0.06, 0.16, 7);
  for (let i = 0; i < 3; i++) part(ctx, potGeo, lam("#c98f5f"), 0.85 + i * 0.22, 0.1, 0.35 - i * 0.15);
}

function bRoundhouse(ctx: Ctx): void {
  plinth(ctx, 1.5, 1.5);
  cyl(ctx, 0.78, 0.85, 0.85, 9, ctx.wall, 0, 0.55);
  cone(ctx, 1.1, 0.85, 9, ctx.trim, 0, 1.4);
  door(ctx, 1.55, 0.55);
  windows(ctx, 1.2, 1.55, 0.7, 1);
  chimney(ctx, 0, 0, 1.55);
}

function bArena(ctx: Ctx, opts: { long?: boolean; masts?: boolean; pennants?: boolean } = {}): void {
  const rx = opts.long ? 1.9 : 1.35;
  const rz = 1.35;
  const seg = new THREE.BoxGeometry(0.62, 0.5, 0.34);
  const segHigh = new THREE.BoxGeometry(0.62, 0.82, 0.3);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    const lower = part(ctx, seg, lam(STONE), x, 0.25, z);
    lower.rotation.y = -a + Math.PI / 2;
    const upper = part(ctx, segHigh, ctx.wall, x * 1.08, 0.55, z * 1.08);
    upper.rotation.y = -a + Math.PI / 2;
    if (opts.pennants && i % 3 === 0) {
      box(ctx, 0.04, 0.6, 0.04, lam(WOOD_DARK), x * 1.08, 1.2, z * 1.08);
      box(ctx, 0.22, 0.14, 0.02, ctx.trim, x * 1.08 + 0.12, 1.42, z * 1.08);
    }
    if (opts.masts && i % 3 === 0) {
      box(ctx, 0.05, 1.3, 0.05, lam("#8b9098"), x * 1.1, 1.4, z * 1.1);
      part(ctx, new THREE.BoxGeometry(0.3, 0.12, 0.05), lam(...WINDOW_GLOW), x * 1.02, 2.0, z * 1.02).castShadow =
        false;
    }
  }
  const sand = part(ctx, new THREE.CylinderGeometry(1, 1, 0.06, 16), lam("#d9c08a"), 0, 0.05);
  sand.scale.set(rx * 0.82, 1, rz * 0.82);
  sand.castShadow = false;
}

function bAqueduct(ctx: Ctx): void {
  const pier = new THREE.BoxGeometry(0.34, 1.1, 0.44);
  for (const x of [-1.05, 0, 1.05]) part(ctx, pier, lam(STONE), x, 0.55);
  const archGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.44, 10, 1, false, 0, Math.PI);
  for (const x of [-0.52, 0.52]) {
    const arch = part(ctx, archGeo, lam(STONE_DARK), x, 1.0);
    arch.rotation.z = Math.PI / 2;
    arch.rotation.x = Math.PI / 2;
  }
  box(ctx, 2.7, 0.24, 0.5, lam(STONE), 0, 1.24);
  const water = part(ctx, new THREE.BoxGeometry(2.7, 0.06, 0.3), lam("#123c50", "#2e7d9e", 0.5), 0, 1.38);
  water.castShadow = false;
}

function bWindmill(ctx: Ctx): void {
  plinth(ctx, 1.2, 1.2);
  cyl(ctx, 0.5, 0.72, 1.7, 8, ctx.wall, 0, 0.95);
  cone(ctx, 0.62, 0.5, 8, ctx.trim, 0, 2.05);
  door(ctx, 1.3, 0.55);
  const hub = part(ctx, new THREE.SphereGeometry(0.1, 6, 5), lam(WOOD_DARK), 0, 1.85, 0.62);
  const blade = new THREE.BoxGeometry(0.16, 1.15, 0.04);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(blade, lam("#e9e2d2"));
    b.castShadow = true;
    b.geometry = blade;
    b.position.set(0, 1.85, 0.66);
    b.rotation.z = (i / 4) * Math.PI * 2 + 0.4;
    b.translateY(0.62);
    ctx.g.add(b);
  }
  void hub;
}

function bWatermill(ctx: Ctx): void {
  plinth(ctx, 1.4, 1.1);
  box(ctx, 1.4, 0.9, 1.1, ctx.wall, 0, 0.55);
  roof(ctx, 1.4, 1.1, 1.0);
  windows(ctx, 1.4, 1.1, 0.65, 2);
  const wheel = part(ctx, new THREE.TorusGeometry(0.55, 0.1, 6, 14), lam(WOOD_DARK), 0.85, 0.5, 0);
  wheel.rotation.y = Math.PI / 2;
  const spoke = new THREE.BoxGeometry(0.06, 1.0, 0.06);
  for (let i = 0; i < 3; i++) {
    const s = part(ctx, spoke, lam(WOOD), 0.85, 0.5, 0);
    s.rotation.x = (i / 3) * Math.PI;
  }
}

function bCathedral(ctx: Ctx): void {
  plinth(ctx, 2.4, 1.6);
  box(ctx, 2.2, 1.5, 1.4, ctx.wall, 0, 0.85);
  const r = cone(ctx, 1.5, 0.9, 4, ctx.trim, 0, 2.05);
  r.rotation.y = Math.PI / 4;
  // spire tower
  box(ctx, 0.7, 2.4, 0.7, ctx.wall, -1.15, 1.3);
  cone(ctx, 0.55, 1.1, 4, ctx.trim, -1.15, 3.05).rotation.y = Math.PI / 4;
  // rose window + lancets
  const rose = part(ctx, new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), lam("#2a1a3a", "#c86bff", 1.2), 0.4, 1.15, 0.71);
  rose.rotation.x = Math.PI / 2;
  rose.castShadow = false;
  const lancet = new THREE.BoxGeometry(0.12, 0.5, 0.05);
  for (const x of [-0.15, 0.95]) {
    part(ctx, lancet, lam(...WINDOW_GLOW), x, 0.85, 0.71).castShadow = false;
  }
  part(ctx, new THREE.BoxGeometry(0.06, 0.4, 0.06), lam("#e3b544"), -1.15, 3.75);
}

function bMarket(ctx: Ctx): void {
  plinth(ctx, 2.0, 1.5);
  const post = new THREE.BoxGeometry(0.1, 1.0, 0.1);
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    part(ctx, post, lam(WOOD_DARK), sx * 0.85, 0.6, sz * 0.6);
  }
  roof(ctx, 2.0, 1.5, 1.1, 1.1);
  // stalls with colored awnings
  box(ctx, 0.5, 0.3, 0.35, lam(WOOD), -0.45, 0.28, 0.2);
  box(ctx, 0.5, 0.3, 0.35, lam(WOOD), 0.45, 0.28, -0.2);
  const awning = box(ctx, 0.56, 0.05, 0.42, ctx.trim, -0.45, 0.62, 0.2);
  awning.rotation.x = 0.2;
  const awning2 = box(ctx, 0.56, 0.05, 0.42, lam("#c2591f"), 0.45, 0.62, -0.2);
  awning2.rotation.x = -0.2;
  part(ctx, new THREE.SphereGeometry(0.09, 6, 5), lam("#c23b22"), -0.35, 0.48, 0.32);
  part(ctx, new THREE.SphereGeometry(0.09, 6, 5), lam("#e3b544"), -0.55, 0.48, 0.1);
}

function bObservatory(ctx: Ctx): void {
  plinth(ctx, 1.5, 1.5);
  cyl(ctx, 0.72, 0.85, 1.1, 9, ctx.wall, 0, 0.65);
  const dome = part(
    ctx,
    new THREE.SphereGeometry(0.78, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    ctx.trim,
    0,
    1.2,
  );
  void dome;
  box(ctx, 0.2, 0.75, 0.06, lam("#17181c"), 0, 1.6, 0.45).rotation.x = -0.55;
  const scope = cyl(ctx, 0.07, 0.09, 0.7, 6, lam("#c9a35c"), 0, 1.75, 0.3);
  scope.rotation.x = -0.8;
  windows(ctx, 1.4, 1.5, 0.7, 2);
}

function bClocktower(ctx: Ctx): void {
  plinth(ctx, 0.9, 0.9);
  box(ctx, 0.7, 2.2, 0.7, ctx.wall, 0, 1.2);
  const face = part(ctx, new THREE.CylinderGeometry(0.26, 0.26, 0.05, 12), lam("#f2ecdc"), 0, 1.95, 0.36);
  face.rotation.x = Math.PI / 2;
  box(ctx, 0.03, 0.18, 0.02, lam("#17181c"), 0, 2.02, 0.4);
  box(ctx, 0.12, 0.03, 0.02, lam("#17181c"), 0.05, 1.95, 0.4);
  roof(ctx, 0.8, 0.8, 2.3, 0.8);
  windows(ctx, 0.7, 0.7, 0.9, 1);
}

function bGreenhouse(ctx: Ctx): void {
  plinth(ctx, 1.7, 1.3);
  const glass = new THREE.MeshLambertMaterial({
    color: "#cfe9e2",
    transparent: true,
    opacity: 0.5,
  });
  box(ctx, 1.6, 0.7, 1.2, glass, 0, 0.5);
  const r = part(ctx, new THREE.CylinderGeometry(0.62, 0.62, 1.6, 8, 1, false, 0, Math.PI), glass, 0, 0.85);
  r.rotation.z = Math.PI / 2;
  r.rotation.x = Math.PI / 2;
  const bush = new THREE.SphereGeometry(0.16, 6, 5);
  for (let i = 0; i < 4; i++) {
    part(ctx, bush, lam(i % 2 ? "#3f6b35" : "#6da03f"), -0.5 + i * 0.34, 0.32, i % 2 ? 0.2 : -0.2);
  }
  box(ctx, 0.1, 0.9, 0.1, lam(WOOD_DARK), 0.95, 0.45, 0.5);
}

function bFactory(ctx: Ctx, opts: { stacks?: number } = {}): void {
  const w = 2.2 * ctx.grand;
  const d = 1.5;
  plinth(ctx, w, d);
  box(ctx, w, 1.0, d, lam("#a8624d"), 0, 0.6);
  // sawtooth roofline
  const tooth = new THREE.BoxGeometry(0.5, 0.4, d);
  for (let i = 0; i < 4; i++) {
    const t = part(ctx, tooth, lam("#8a4f3e"), -w / 2 + 0.3 + i * (w / 4), 1.25);
    t.rotation.z = 0.5;
    const g = part(
      ctx,
      new THREE.BoxGeometry(0.34, 0.3, d * 0.9),
      lam(...WINDOW_GLOW),
      -w / 2 + 0.14 + i * (w / 4),
      1.28,
    );
    g.castShadow = false;
  }
  windows(ctx, w, d, 0.6, 4);
  const stacks = opts.stacks ?? 2;
  for (let i = 0; i < stacks; i++) {
    cyl(ctx, 0.13, 0.17, 1.6, 7, lam("#5c4a44"), w * 0.32 - i * 0.55, 1.6, -d * 0.2);
    chimney(ctx, w * 0.32 - i * 0.55, -d * 0.2, 1.9, true);
  }
}

function bDerrick(ctx: Ctx): void {
  const legGeo = new THREE.BoxGeometry(0.09, 2.4, 0.09);
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const leg = part(ctx, legGeo, lam("#4a4640"), sx * 0.55, 1.2, sz * 0.55);
    leg.rotation.set(sz * -0.18, 0, sx * 0.18);
  }
  box(ctx, 0.6, 0.09, 0.6, lam("#4a4640"), 0, 1.3);
  box(ctx, 0.35, 0.09, 0.35, lam("#4a4640"), 0, 2.0);
  cyl(ctx, 0.1, 0.1, 0.5, 6, lam("#2f2b28"), 0, 2.55);
  // nodding pump
  box(ctx, 0.09, 0.7, 0.09, lam("#8a4f3e"), 1.1, 0.45);
  const beam = box(ctx, 1.0, 0.1, 0.1, lam("#8a4f3e"), 1.1, 0.85);
  beam.rotation.z = 0.25;
  part(ctx, new THREE.SphereGeometry(0.13, 6, 5), lam("#2f2b28"), 1.55, 0.72);
  // oil barrels
  const barrel = new THREE.CylinderGeometry(0.13, 0.13, 0.3, 8);
  part(ctx, barrel, lam("#17181c"), -0.9, 0.16, 0.8);
  part(ctx, barrel, lam("#17181c"), -1.15, 0.16, 0.6);
}

function bTanks(ctx: Ctx, opts: { low?: boolean } = {}): void {
  plinth(ctx, 2.2, 1.6);
  const h = opts.low ? 0.6 : 1.5;
  const tank = lam(opts.low ? "#7fa3ad" : "#c9cdd4");
  cyl(ctx, 0.6, 0.6, h, 12, tank, -0.6, h / 2 + 0.12);
  cyl(ctx, 0.45, 0.45, h * 0.75, 12, tank, 0.65, (h * 0.75) / 2 + 0.12);
  if (!opts.low) {
    part(ctx, new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), tank, -0.6, h + 0.12);
    // pipework
    const pipe = new THREE.CylinderGeometry(0.05, 0.05, 1.15, 6);
    const p = part(ctx, pipe, lam("#8b9098"), 0.02, h * 0.7, 0);
    p.rotation.z = Math.PI / 2;
    cyl(ctx, 0.05, 0.05, h * 0.7, 6, lam("#8b9098"), 0.65, h * 0.4, 0);
    cyl(ctx, 0.1, 0.12, 1.9, 7, lam("#5c4a44"), 1.35, 1.05);
    chimney(ctx, 1.35, 0, 1.85);
  } else {
    const water = part(ctx, new THREE.CylinderGeometry(0.55, 0.55, 0.04, 12), lam("#123c50", "#2e7d9e", 0.5), -0.6, h + 0.13);
    water.castShadow = false;
  }
}

function bGasometer(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  cyl(ctx, 0.85, 0.85, 1.2, 12, lam("#7d8590"), 0, 0.75);
  part(ctx, new THREE.SphereGeometry(0.85, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), lam("#6b7380"), 0, 1.35);
  const rib = new THREE.BoxGeometry(0.07, 1.5, 0.07);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    part(ctx, rib, lam("#4a4640"), Math.cos(a) * 0.92, 0.85, Math.sin(a) * 0.92);
  }
  box(ctx, 0.8, 0.5, 0.6, lam("#a8624d"), 1.15, 0.37);
}

function bCoolingTower(ctx: Ctx): void {
  plinth(ctx, 2.4, 1.8);
  cyl(ctx, 0.62, 0.95, 1.9, 12, lam("#cfd2d6"), -0.65, 1.07);
  cyl(ctx, 0.72, 0.62, 0.4, 12, lam("#cfd2d6"), -0.65, 2.22);
  const puff = new THREE.SphereGeometry(0.3, 7, 6);
  for (let i = 0; i < 2; i++) {
    const s = part(
      ctx,
      puff,
      new THREE.MeshLambertMaterial({ color: "#f4f2ec", transparent: true, opacity: 0.4 - i * 0.15 }),
      -0.65,
      2.6 + i * 0.45,
      0,
    );
    s.castShadow = false;
    s.scale.setScalar(1 + i * 0.5);
  }
  box(ctx, 1.3, 0.8, 1.1, lam("#a8624d"), 0.85, 0.52);
  windows(ctx, 1.3, 1.1, 0.55, 3);
  cyl(ctx, 0.09, 0.12, 1.3, 7, lam("#5c4a44"), 1.35, 1.3, -0.3);
}

function bReactor(ctx: Ctx): void {
  plinth(ctx, 2.0, 1.6);
  part(ctx, new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam("#cfd2d6"), -0.4, 0.15);
  cyl(ctx, 0.8, 0.8, 0.16, 12, lam("#9aa0a8"), -0.4, 0.15);
  box(ctx, 0.9, 0.7, 0.9, lam("#8b9098"), 0.85, 0.5);
  const ring = part(ctx, new THREE.TorusGeometry(0.5, 0.05, 8, 20), lam(...TECH), -0.4, 0.35);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = false;
  windows(ctx, 0.9, 0.9, 0.55, 2);
}

function bAntennaTower(ctx: Ctx, dish = false): void {
  plinth(ctx, 1.0, 1.0);
  cone(ctx, 0.5, 3.0, 4, lam("#b8412f"), 0, 1.6);
  cone(ctx, 0.32, 1.9, 4, lam("#e9e2d2"), 0, 1.7);
  cyl(ctx, 0.03, 0.03, 1.0, 4, lam("#3a3a3f"), 0, 3.4);
  const tip = part(ctx, new THREE.SphereGeometry(0.09, 6, 5), lam("#5c0f0f", "#ff3b30", 2.4), 0, 3.95);
  tip.castShadow = false;
  if (dish) {
    const d = part(ctx, new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), lam("#e9e2d2"), 0.8, 0.7);
    d.rotation.z = -1.1;
    box(ctx, 0.5, 0.4, 0.5, lam("#8b9098"), 0.8, 0.25);
  }
}

function bSkyscraper(ctx: Ctx): void {
  plinth(ctx, 1.6, 1.6);
  const glassGlow = lam("#25313d", "#9fd8ff", 0.5);
  box(ctx, 1.3, 2.4, 1.3, lam("#5d6874"), 0, 1.3);
  box(ctx, 1.0, 1.4, 1.0, lam("#6b7683"), 0, 3.2);
  box(ctx, 0.7, 0.8, 0.7, lam("#78828e"), 0, 4.2);
  const strip = new THREE.BoxGeometry(0.16, 2.2, 0.04);
  for (const x of [-0.4, 0, 0.4]) {
    part(ctx, strip, glassGlow, x, 1.3, 0.66).castShadow = false;
    part(ctx, strip, glassGlow, x, 1.3, -0.66).castShadow = false;
  }
  const strip2 = new THREE.BoxGeometry(0.14, 1.2, 0.04);
  for (const x of [-0.25, 0.25]) part(ctx, strip2, glassGlow, x, 3.2, 0.51).castShadow = false;
  box(ctx, 0.04, 0.7, 0.04, lam("#3a3a3f"), 0, 4.9);
}

function bAirfield(ctx: Ctx): void {
  // control tower
  box(ctx, 0.4, 1.5, 0.4, lam("#cfd2d6"), -1.0, 0.85);
  box(ctx, 0.7, 0.4, 0.7, lam("#25313d", "#9fd8ff", 0.6), -1.0, 1.75);
  box(ctx, 0.85, 0.08, 0.85, lam("#8b9098"), -1.0, 1.98);
  // hangar
  const hangar = part(ctx, new THREE.CylinderGeometry(0.7, 0.7, 1.6, 10, 1, false, 0, Math.PI), lam("#8b9098"), 0.7, 0.1);
  hangar.rotation.z = Math.PI / 2;
  hangar.rotation.x = Math.PI / 2;
  box(ctx, 1.6, 0.06, 0.7, lam("#4a4640"), 0.7, 0.04, 1.1);
  const lightGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  for (let i = 0; i < 4; i++) {
    part(ctx, lightGeo, lam("#4a3208", "#ffd60a", 2), 0.1 + i * 0.45, 0.1, 1.42).castShadow = false;
  }
}

function bLaunchComplex(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  box(ctx, 1.2, 0.25, 1.2, lam("#8b9098"), 0.4, 0.22);
  // rocket
  cyl(ctx, 0.22, 0.22, 1.9, 9, lam("#f2f0ea"), 0.4, 1.3);
  cone(ctx, 0.22, 0.5, 9, lam("#b8412f"), 0.4, 2.5);
  const fin = new THREE.BoxGeometry(0.22, 0.4, 0.04);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(fin, lam("#b8412f"));
    f.castShadow = true;
    const a = (i / 3) * Math.PI * 2;
    f.position.set(0.4 + Math.cos(a) * 0.26, 0.52, Math.sin(a) * 0.26);
    f.rotation.y = -a;
    ctx.g.add(f);
  }
  // gantry
  box(ctx, 0.3, 2.6, 0.3, lam("#c2591f"), -0.55, 1.42);
  box(ctx, 0.7, 0.08, 0.1, lam("#c2591f"), -0.15, 2.3);
  box(ctx, 0.7, 0.08, 0.1, lam("#c2591f"), -0.15, 1.5);
  const flame = cone(ctx, 0.18, 0.4, 7, lam("#7a2408", "#ff8c2e", 2.2), 0.4, 0.18);
  flame.rotation.x = Math.PI;
  flame.castShadow = false;
}

function bSkyfarm(ctx: Ctx): void {
  plinth(ctx, 1.4, 1.4);
  cyl(ctx, 0.16, 0.22, 3.0, 7, lam("#c9cdd4"), 0, 1.6);
  const disc = new THREE.CylinderGeometry(0.85, 0.85, 0.1, 10);
  const green = new THREE.CylinderGeometry(0.8, 0.8, 0.08, 10);
  for (let i = 0; i < 3; i++) {
    const y = 1.1 + i * 0.85;
    part(ctx, disc, lam("#9aa0a8"), 0, y);
    part(ctx, green, lam(i % 2 ? "#6da03f" : "#4f8a3a"), 0, y + 0.08);
    const bush = new THREE.SphereGeometry(0.1, 5, 4);
    for (let j = 0; j < 3; j++) {
      const a = ctx.rand() * Math.PI * 2;
      part(ctx, bush, lam("#3f6b35"), Math.cos(a) * 0.5, y + 0.18, Math.sin(a) * 0.5);
    }
  }
  part(ctx, new THREE.SphereGeometry(0.18, 8, 6), lam(...TECH), 0, 3.25).castShadow = false;
}

function bArcology(ctx: Ctx): void {
  plinth(ctx, 2.6, 2.6);
  const glow = lam("#25313d", "#9fd8ff", 0.6);
  cyl(ctx, 0.75, 1.3, 3.4, 8, lam("#7d8894"), 0, 1.85);
  const band = new THREE.TorusGeometry(1.0, 0.05, 6, 24);
  for (let i = 0; i < 4; i++) {
    const b = part(ctx, band, glow, 0, 0.7 + i * 0.8);
    b.rotation.x = Math.PI / 2;
    b.scale.setScalar(1 - i * 0.14);
    b.castShadow = false;
  }
  // hanging terraces
  const terr = new THREE.CylinderGeometry(0.5, 0.55, 0.1, 8);
  part(ctx, terr, lam("#4f8a3a"), 1.15, 1.1, 0.4);
  part(ctx, terr, lam("#6da03f"), -1.1, 1.7, -0.4).scale.setScalar(0.8);
  part(ctx, new THREE.SphereGeometry(0.3, 10, 7), lam(...TECH), 0, 3.75).castShadow = false;
}

function bSpaceElevator(ctx: Ctx): void {
  plinth(ctx, 2.2, 2.2);
  cyl(ctx, 0.5, 0.9, 0.8, 8, lam("#7d8894"), 0, 0.5);
  cyl(ctx, 0.1, 0.3, 5.4, 6, lam("#c9cdd4"), 0, 3.5);
  const tether = part(ctx, new THREE.CylinderGeometry(0.035, 0.035, 3.4, 4), lam(...TECH), 0, 8.0);
  tether.castShadow = false;
  const ring = part(ctx, new THREE.TorusGeometry(0.6, 0.06, 8, 20), lam(...TECH), 0, 4.4);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = false;
  const car = part(ctx, new THREE.BoxGeometry(0.22, 0.34, 0.22), lam("#e9e2d2"), 0, 5.6);
  void car;
}

function bDyson(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  cone(ctx, 0.75, 0.9, 8, lam("#3b4048"), 0, 0.55);
  const beam = part(ctx, new THREE.CylinderGeometry(0.06, 0.12, 2.4, 6), lam(...TECH), 0, 2.1);
  beam.castShadow = false;
  const torus = part(ctx, new THREE.TorusGeometry(0.85, 0.12, 8, 28), lam(...TECH), 0, 3.3);
  torus.rotation.x = Math.PI / 2.4;
  torus.castShadow = false;
  const orb = part(ctx, new THREE.SphereGeometry(0.28, 10, 8), lam("#fff3d6", "#ffd98c", 2.2), 0, 3.3);
  orb.castShadow = false;
}

function bWeatherArray(ctx: Ctx): void {
  plinth(ctx, 2.0, 2.0);
  box(ctx, 0.8, 0.5, 0.8, lam("#8b9098"), 0, 0.4);
  const mast = new THREE.CylinderGeometry(0.04, 0.06, 2.2, 5);
  const positions: [number, number][] = [
    [-0.7, -0.6],
    [0.75, -0.5],
    [-0.5, 0.7],
    [0.6, 0.65],
    [0, 0],
  ];
  positions.forEach(([x, z], i) => {
    const h = i === 4 ? 1.3 : 1.0 + ctx.rand() * 0.25;
    const m = part(ctx, mast, lam("#c9cdd4"), x, h + 0.2, z);
    m.scale.y = h / 1.1;
    part(ctx, new THREE.SphereGeometry(0.09, 6, 5), lam(...TECH), x, h * 2 + 0.28, z).castShadow = false;
  });
}

function bGraviton(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  const dish = part(ctx, new THREE.SphereGeometry(0.85, 12, 7, 0, Math.PI * 2, 0, Math.PI / 3), lam("#3b4048"), 0, 0.9);
  dish.rotation.x = Math.PI;
  cyl(ctx, 0.3, 0.45, 0.7, 8, lam("#8b9098"), 0, 0.4);
  const orb = part(ctx, new THREE.SphereGeometry(0.32, 10, 8), lam(...TECH), 0, 1.9);
  orb.castShadow = false;
  const ring = part(ctx, new THREE.TorusGeometry(0.5, 0.04, 6, 22), lam(...TECH), 0, 1.9);
  ring.rotation.x = Math.PI / 2.6;
  ring.castShadow = false;
}

function bFarm(ctx: Ctx): void {
  // tilled plot with crop rows and a tool shed
  const soil = box(ctx, 2.0, 0.1, 1.5, lam("#6b4e30"), 0, 0.05);
  soil.receiveShadow = true;
  const row = new THREE.BoxGeometry(1.7, 0.14, 0.16);
  for (let i = 0; i < 4; i++) {
    part(ctx, row, lam(i % 2 ? "#6da03f" : "#82b04a"), 0, 0.16, -0.5 + i * 0.34);
  }
  box(ctx, 0.6, 0.55, 0.5, ctx.wall, 1.35, 0.38, -0.9);
  const shedRoof = cone(ctx, 0.52, 0.4, 4, ctx.trim, 1.35, 0.85, -0.9);
  shedRoof.rotation.y = Math.PI / 4;
  // scarecrow
  box(ctx, 0.05, 0.7, 0.05, lam(WOOD_DARK), -0.9, 0.5, 0.9);
  box(ctx, 0.5, 0.05, 0.05, lam(WOOD_DARK), -0.9, 0.68, 0.9);
  part(ctx, new THREE.SphereGeometry(0.09, 6, 5), lam("#d9b56a"), -0.9, 0.88, 0.9);
}

function bLivestockPen(ctx: Ctx): void {
  // post-and-rail paddock with grazing animals and a hay pile
  const post = new THREE.BoxGeometry(0.07, 0.42, 0.07);
  const railX = new THREE.BoxGeometry(2.0, 0.05, 0.05);
  const railZ = new THREE.BoxGeometry(0.05, 0.05, 1.5);
  for (const [x, z] of [
    [-1, -0.75],
    [-1, 0.75],
    [1, -0.75],
    [1, 0.75],
    [0, -0.75],
    [0, 0.75],
  ] as const) {
    part(ctx, post, lam(WOOD_DARK), x, 0.21, z);
  }
  for (const y of [0.16, 0.34]) {
    part(ctx, railX, lam(WOOD), 0, y, -0.75);
    part(ctx, railX, lam(WOOD), 0, y, 0.75);
    part(ctx, railZ, lam(WOOD), -1, y, 0);
    part(ctx, railZ, lam(WOOD), 1, y, 0);
  }
  const bodyGeo = new THREE.SphereGeometry(0.17, 6, 5);
  const headGeo = new THREE.SphereGeometry(0.09, 5, 4);
  for (let i = 0; i < 3; i++) {
    const x = -0.6 + i * 0.55;
    const z = (ctx.rand() - 0.5) * 0.8;
    const tone = i % 2 ? "#e8e2d4" : "#7a5a44";
    const b = part(ctx, bodyGeo, lam(tone), x, 0.2, z);
    b.scale.set(1.25, 1, 1);
    part(ctx, headGeo, lam(tone), x + 0.24, 0.26, z);
  }
  cone(ctx, 0.32, 0.45, 7, lam("#d9b56a"), 1.45, 0.22, -0.5);
}

function bStable(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.2);
  box(ctx, 1.8, 0.7, 1.1, ctx.wall, 0, 0.45);
  roof(ctx, 1.8, 1.1, 0.8);
  const rail = new THREE.BoxGeometry(1.0, 0.05, 0.05);
  const post = new THREE.BoxGeometry(0.06, 0.4, 0.06);
  for (const z of [0.9, 1.3]) part(ctx, rail, lam(WOOD), 1.0, 0.35, z);
  for (const x of [0.5, 1.5]) {
    part(ctx, post, lam(WOOD_DARK), x, 0.2, 0.9);
    part(ctx, post, lam(WOOD_DARK), x, 0.2, 1.3);
  }
  part(ctx, new THREE.SphereGeometry(0.16, 6, 5), lam("#d9b56a"), 1.0, 0.14, 1.1);
}

// -------------------------------------------------- trades wear their work
// Every trade building carries an unmistakable prop of its craft in the
// yard — the base body stays civ-styled, the tell says what happens inside.

function bToolmaker(ctx: Ctx): void {
  bWorkshop(ctx, { accent: "#8f9399" });
  // a giant axe leaning on the wall — the shop sign of the tool trade
  const haft = box(ctx, 0.09, 1.5, 0.09, lam(WOOD_DARK), -0.9, 0.75, 0.7);
  haft.rotation.x = -0.2;
  box(ctx, 0.34, 0.26, 0.1, lam("#8f9399"), -0.9, 1.35, 0.58);
  box(ctx, 0.7, 0.35, 0.32, lam(WOOD), 0.5, 0.24, 0.85);
  const handle = new THREE.BoxGeometry(0.06, 0.7, 0.06);
  for (let i = 0; i < 3; i++) {
    const t = part(ctx, handle, lam(WOOD_DARK), 0.2 + i * 0.3, 0.6, 0.9);
    t.rotation.x = -0.35;
    part(ctx, new THREE.BoxGeometry(0.18, 0.12, 0.08), lam(i === 1 ? STONE_DARK : "#8f9399"), 0.2 + i * 0.3, 0.88, 0.8);
  }
}

function bKnapper(ctx: Ctx): void {
  part(ctx, new THREE.IcosahedronGeometry(0.5), lam(STONE), -0.3, 0.32, -0.2);
  part(ctx, new THREE.IcosahedronGeometry(0.3), lam(STONE_DARK), 0.5, 0.18, 0.3);
  const mat = box(ctx, 0.8, 0.04, 0.6, lam("#c2955e"), 0.2, 0.04, 0.55);
  mat.receiveShadow = true;
  const flake = new THREE.ConeGeometry(0.06, 0.14, 4);
  for (let i = 0; i < 6; i++) {
    const f = part(
      ctx,
      flake,
      lam("#5b5e66"),
      0.2 + (ctx.rand() - 0.5) * 0.7,
      0.07,
      0.55 + (ctx.rand() - 0.5) * 0.5,
    );
    f.rotation.set(ctx.rand() * 3, ctx.rand() * 3, ctx.rand() * 3);
  }
  // hide windbreak against the sea wind
  box(ctx, 0.06, 0.7, 0.06, lam(WOOD_DARK), -0.7, 0.35, 0.5);
  box(ctx, 0.06, 0.7, 0.06, lam(WOOD_DARK), -0.7, 0.35, -0.4);
  box(ctx, 0.04, 0.5, 0.95, lam("#b08a5e"), -0.72, 0.5, 0.05);
}

function bFishingHut(ctx: Ctx): void {
  plinth(ctx, 1.2, 1.0);
  box(ctx, 1.1, 0.7, 0.9, ctx.wall, 0, 0.45);
  door(ctx, 0.9);
  roof(ctx, 1.1, 0.9, 0.8);
  // net hung to dry between two poles, the day's catch beside it
  box(ctx, 0.06, 1.1, 0.06, lam(WOOD_DARK), 0.85, 0.55, 0.4);
  box(ctx, 0.06, 1.1, 0.06, lam(WOOD_DARK), 0.85, 0.55, -0.45);
  const net = part(
    ctx,
    new THREE.BoxGeometry(0.03, 0.55, 0.75),
    new THREE.MeshLambertMaterial({ color: "#d8c69a", transparent: true, opacity: 0.55 }),
    0.85,
    0.72,
    -0.03,
  );
  net.castShadow = false;
  const fish = new THREE.SphereGeometry(0.07, 6, 4);
  for (let i = 0; i < 3; i++) {
    const f = part(ctx, fish, lam("#b9c4cc"), -0.75, 0.14, 0.55 - i * 0.2);
    f.scale.set(1.8, 1, 0.5);
  }
  const hull = part(ctx, new THREE.CylinderGeometry(0.16, 0.09, 0.85, 6, 1), lam(WOOD), -0.85, 0.13, -0.2);
  hull.rotation.z = Math.PI / 2;
  hull.scale.z = 0.5;
}

function bSmokehouse(ctx: Ctx): void {
  plinth(ctx, 1.1, 0.95);
  box(ctx, 1.0, 0.75, 0.85, ctx.wall, 0, 0.48);
  roof(ctx, 1.0, 0.85, 0.9);
  chimney(ctx, 0, 0, 1.15);
  door(ctx, 0.85);
  // fish curing on a rack beside the door
  box(ctx, 0.05, 0.6, 0.05, lam(WOOD_DARK), 0.75, 0.3, 0.3);
  box(ctx, 0.05, 0.6, 0.05, lam(WOOD_DARK), 0.75, 0.3, -0.3);
  box(ctx, 0.05, 0.05, 0.68, lam(WOOD), 0.75, 0.58, 0);
  const fish = new THREE.SphereGeometry(0.06, 6, 4);
  for (let i = 0; i < 4; i++) {
    const f = part(ctx, fish, lam("#c47f52"), 0.75, 0.45, -0.24 + i * 0.16);
    f.scale.set(0.9, 1.7, 0.5);
  }
}

function bTanner(ctx: Ctx): void {
  plinth(ctx, 1.2, 0.9);
  box(ctx, 1.0, 0.6, 0.8, ctx.wall, 0, 0.4);
  const slope = part(ctx, new THREE.BoxGeometry(1.3, 0.08, 1.2), lam(SHED_ROOF), 0, 0.78);
  slope.rotation.x = 0.16;
  // a hide big as a sail stretched on its frame, pits of different steeps
  const frame = new THREE.BoxGeometry(0.08, 1.4, 0.08);
  part(ctx, frame, lam(WOOD_DARK), 0.75, 0.7, 0.3).rotation.z = 0.22;
  part(ctx, frame, lam(WOOD_DARK), 1.25, 0.7, 0.3).rotation.z = -0.22;
  box(ctx, 0.6, 0.7, 0.04, lam("#c2955e"), 1.0, 0.75, 0.3);
  const pit = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 8);
  part(ctx, pit, lam("#6b4e30"), -0.85, 0.06, 0.35);
  part(ctx, pit, lam("#8a5a3a"), -0.85, 0.06, -0.2);
  part(ctx, pit, lam("#4a3a26"), -0.4, 0.06, 0.6);
}

function bPottery(ctx: Ctx): void {
  bWorkshop(ctx, { accent: "#c96f4a" });
  // the giant amphora is the shop sign — taller than a settler
  cyl(ctx, 0.3, 0.18, 0.75, 8, lam("#c96f4a"), -0.95, 0.38, 0.75);
  cyl(ctx, 0.13, 0.22, 0.24, 8, lam("#b3765a"), -0.95, 0.86, 0.75);
  // potter's wheel and wares drying in a row
  cyl(ctx, 0.28, 0.32, 0.12, 9, lam(STONE_DARK), 0.6, 0.13, 0.85);
  cyl(ctx, 0.16, 0.08, 0.22, 7, lam("#c98f5f"), 0.6, 0.3, 0.85);
  const amp = new THREE.CylinderGeometry(0.11, 0.07, 0.34, 7);
  for (let i = 0; i < 3; i++) {
    part(ctx, amp, lam(i % 2 ? "#c98f5f" : "#b3765a"), -0.35 + i * 0.33, 0.2, 0.95);
  }
}

function bWeaverShop(ctx: Ctx): void {
  bWorkshop(ctx, { accent: "#3f5f8a" });
  // the dye-pole flies fresh cloth above the roofline — visible across town
  cyl(ctx, 0.05, 0.07, 2.0, 6, lam(WOOD_DARK), -0.95, 1.0, 0.75);
  box(ctx, 1.0, 0.06, 0.06, lam(WOOD), -0.95, 1.92, 0.75);
  const cloth = new THREE.BoxGeometry(0.18, 0.85, 0.03);
  ["#b8412f", "#3f5f8a", "#c9a35c"].forEach((c, i) => {
    part(ctx, cloth, lam(c), -1.32 + i * 0.37, 1.45, 0.75);
  });
  // the loom against the front wall
  box(ctx, 0.07, 1.0, 0.07, lam(WOOD_DARK), 0.25, 0.5, 0.85);
  box(ctx, 0.07, 1.0, 0.07, lam(WOOD_DARK), 0.95, 0.5, 0.85);
  box(ctx, 0.8, 0.07, 0.07, lam(WOOD), 0.6, 0.98, 0.85);
  box(ctx, 0.66, 0.6, 0.03, lam("#3f5f8a"), 0.6, 0.6, 0.85);
}

function bBreweryShop(ctx: Ctx): void {
  bWorkshop(ctx, { stacks: 1, accent: "#c9922f" });
  // barrels big enough to swim in, the copper vat on show
  const barrel = new THREE.CylinderGeometry(0.24, 0.24, 0.55, 9);
  for (const [x, y, z] of [
    [-0.95, 0.26, 0.9],
    [-0.95, 0.26, 0.35],
    [-0.95, 0.72, 0.62],
  ] as const) {
    part(ctx, barrel, lam(WOOD), x, y, z).rotation.z = Math.PI / 2;
  }
  cyl(ctx, 0.26, 0.32, 0.6, 9, lam("#c47b3d"), 0.8, 0.31, 0.85);
  cyl(ctx, 0.08, 0.24, 0.18, 9, lam("#c47b3d"), 0.8, 0.68, 0.85);
}

function bBath(ctx: Ctx, grand = false): void {
  const s = grand ? 1.3 : 1;
  plinth(ctx, 2.2 * s, 1.6 * s);
  // changing hall at one end, the pool steaming in the open
  box(ctx, 1.0 * s, 0.9 * s, 1.4 * s, ctx.wall, -0.6 * s, 0.55 * s);
  const r = cone(ctx, 0.85 * s, 0.6 * s, 4, ctx.trim, -0.6 * s, 1.25 * s);
  r.rotation.y = Math.PI / 4;
  box(ctx, 1.2 * s, 0.14, 1.5 * s, lam("#e9e2d2"), 0.55 * s, 0.09);
  const water = part(
    ctx,
    new THREE.BoxGeometry(0.9 * s, 0.06, 1.2 * s),
    lam("#1a5c74", "#3fc1d8", 0.7),
    0.55 * s,
    0.17,
  );
  water.castShadow = false;
  for (let i = 0; i < 2; i++) {
    const p = part(
      ctx,
      new THREE.SphereGeometry(0.12, 6, 5),
      new THREE.MeshLambertMaterial({ color: "#f4f2ec", transparent: true, opacity: 0.35 }),
      0.4 * s + i * 0.3,
      0.45 + i * 0.22,
      i % 2 ? 0.3 : -0.2,
    );
    p.castShadow = false;
    p.scale.setScalar(1 + i * 0.4);
  }
  if (grand) {
    const colGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.8, 6);
    for (let i = 0; i < 3; i++) {
      part(ctx, colGeo, lam("#e9e2d2"), 1.3, 0.5, (-0.6 + i * 0.6) * s);
    }
  }
}

function bArmory(ctx: Ctx, opts: { crates?: boolean } = {}): void {
  bDefense(ctx);
  const w = 1.5 * ctx.grand;
  const front = (w * 0.85) / 2;
  // shields on the facade, spears racked against the side
  const shield = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 8);
  for (const x of [-0.45, 0.45]) {
    const sh = part(ctx, shield, ctx.trim, x, 0.5, front + 0.03);
    sh.rotation.x = Math.PI / 2;
  }
  const spear = new THREE.CylinderGeometry(0.018, 0.028, 0.85, 4);
  for (let i = 0; i < 4; i++) {
    const s = part(ctx, spear, lam(WOOD_DARK), w * 0.62, 0.48, 0.3 - i * 0.2);
    s.rotation.z = -0.22;
    part(ctx, new THREE.ConeGeometry(0.035, 0.1, 4), lam("#8f9399"), w * 0.62 + 0.09, 0.92, 0.3 - i * 0.2);
  }
  if (opts.crates) {
    box(ctx, 0.24, 0.24, 0.24, lam(WOOD), -w * 0.55, 0.12, front + 0.25);
    box(ctx, 0.24, 0.24, 0.24, lam(WOOD), -w * 0.55, 0.36, front + 0.25);
  }
}

function bChariotWorks(ctx: Ctx): void {
  bWorkshop(ctx, { big: true, accent: "#c2955e" });
  // a chariot taking shape in the yard, spare wheel against the wall
  const wheel = new THREE.TorusGeometry(0.28, 0.06, 6, 14);
  part(ctx, wheel, lam(WOOD_DARK), -1.0, 0.32, 1.05);
  part(ctx, wheel, lam(WOOD_DARK), -0.3, 0.32, 1.05);
  box(ctx, 0.66, 0.3, 0.36, ctx.trim, -0.65, 0.5, 1.05);
  box(ctx, 1.0, 0.06, 0.06, lam(WOOD), 0.25, 0.32, 1.05);
  part(ctx, wheel, lam(WOOD_DARK), 0.75, 0.3, 0.95).rotation.y = 0.4;
}

function bBarracks(ctx: Ctx): void {
  bDefense(ctx);
  // drill dummy and the company banner
  box(ctx, 0.06, 0.7, 0.06, lam(WOOD_DARK), 1.0, 0.35, 0.75);
  box(ctx, 0.4, 0.05, 0.05, lam(WOOD), 1.0, 0.6, 0.75);
  part(ctx, new THREE.SphereGeometry(0.09, 6, 5), lam("#d9b56a"), 1.0, 0.78, 0.75);
  box(ctx, 0.04, 1.0, 0.04, lam(WOOD_DARK), -1.0, 0.5, 0.8);
  box(ctx, 0.26, 0.18, 0.02, ctx.trim, -0.87, 0.86, 0.8);
}

function bGristmill(ctx: Ctx): void {
  bHall(ctx, { small: true });
  // a millstone tall as the door leans on the wall, flour sacks going out
  const stone = part(ctx, new THREE.CylinderGeometry(0.45, 0.45, 0.16, 14), lam(STONE), 0.95, 0.48, 0.7);
  stone.rotation.x = Math.PI / 2;
  stone.rotation.z = 0.2;
  part(ctx, new THREE.CylinderGeometry(0.09, 0.09, 0.18, 6), lam(STONE_DARK), 0.95, 0.48, 0.78);
  const sack = new THREE.SphereGeometry(0.18, 6, 5);
  for (let i = 0; i < 3; i++) {
    const s = part(ctx, sack, lam("#d9b56a"), -0.85 + i * 0.35, 0.17, 0.9);
    s.scale.y = 1.35;
  }
}

function bSiegeWorks(ctx: Ctx): void {
  bWorkshop(ctx, { big: true, accent: "#6b4f2a" });
  // a catapult waits in the yard, arm cocked over the roofline
  const wheel = new THREE.TorusGeometry(0.16, 0.05, 6, 12);
  for (const [x, z] of [
    [-0.45, 0.7],
    [-0.45, 1.2],
    [-1.15, 0.7],
    [-1.15, 1.2],
  ] as const) {
    part(ctx, wheel, lam(WOOD_DARK), x, 0.18, z);
  }
  box(ctx, 0.9, 0.1, 0.5, lam(WOOD), -0.8, 0.28, 0.95);
  const arm = box(ctx, 0.08, 1.2, 0.08, lam(WOOD_DARK), -0.7, 0.8, 0.95);
  arm.rotation.z = -0.7;
  part(ctx, new THREE.SphereGeometry(0.12, 6, 5), lam(STONE_DARK), -0.28, 1.25, 0.95);
}

function bMootHall(ctx: Ctx): void {
  bHall(ctx);
  const front = (2.1 * ctx.grand * 0.72) / 2;
  // the carved law-post and the speaker's stone
  cyl(ctx, 0.08, 0.1, 1.1, 6, ctx.trim, 0.85, 0.55, front + 0.3);
  part(ctx, new THREE.SphereGeometry(0.12, 6, 5), ctx.trim, 0.85, 1.2, front + 0.3);
  part(ctx, new THREE.CylinderGeometry(0.18, 0.22, 0.25, 7), lam(STONE), -0.65, 0.13, front + 0.35);
}

function bGuildhall(ctx: Ctx): void {
  bHall(ctx);
  const front = (2.1 * ctx.grand * 0.72) / 2;
  // the guild's shield swings over the door
  box(ctx, 0.05, 0.35, 0.05, lam(WOOD_DARK), 0.4, 1.1, front + 0.14);
  box(ctx, 0.3, 0.05, 0.05, lam(WOOD_DARK), 0.52, 1.25, front + 0.14);
  const sh = part(ctx, new THREE.CylinderGeometry(0.13, 0.13, 0.04, 8), ctx.trim, 0.58, 1.02, front + 0.14);
  sh.rotation.x = Math.PI / 2;
}

function bTavern(ctx: Ctx): void {
  bHall(ctx, { small: true });
  const front = (1.5 * ctx.grand * 0.72) / 2;
  // swinging sign, barrels, and a bench for the regulars
  box(ctx, 0.05, 0.4, 0.05, lam(WOOD_DARK), 0.45, 0.95, front + 0.12);
  box(ctx, 0.3, 0.05, 0.05, lam(WOOD_DARK), 0.56, 1.12, front + 0.12);
  part(ctx, new THREE.BoxGeometry(0.22, 0.18, 0.03), lam("#c9a35c"), 0.62, 0.96, front + 0.12);
  const barrel = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8);
  part(ctx, barrel, lam(WOOD), -0.6, 0.15, front + 0.3);
  part(ctx, barrel, lam(WOOD), -0.85, 0.15, front + 0.18);
  box(ctx, 0.5, 0.06, 0.16, lam(WOOD), 0.15, 0.2, front + 0.35);
  box(ctx, 0.05, 0.2, 0.14, lam(WOOD_DARK), -0.05, 0.1, front + 0.35);
  box(ctx, 0.05, 0.2, 0.14, lam(WOOD_DARK), 0.35, 0.1, front + 0.35);
}

function bApothecary(ctx: Ctx): void {
  bWorkshop(ctx, { accent: "#5a7a3f" });
  const front = (1.4 * ctx.grand * 0.85) / 2;
  // a giant mortar and pestle at the door — medicine sold here
  cyl(ctx, 0.3, 0.2, 0.4, 8, lam(STONE), -0.85, 0.22, front + 0.35);
  const pestle = cyl(ctx, 0.07, 0.09, 0.6, 6, lam(WOOD_DARK), -0.75, 0.6, front + 0.35);
  pestle.rotation.z = -0.5;
  // a shelf of remedies and herbs drying under the eave
  box(ctx, 0.8, 0.06, 0.18, lam(WOOD_DARK), 0.4, 0.55, front + 0.12);
  const bottle = new THREE.CylinderGeometry(0.07, 0.07, 0.2, 6);
  ["#3f8a5a", "#8a3f6b", "#c9a35c", "#3f6b8a"].forEach((c, i) => {
    part(ctx, bottle, lam(c), 0.1 + i * 0.2, 0.68, front + 0.12);
  });
}

function bScrollHall(ctx: Ctx): void {
  bHall(ctx, { columns: true });
  const front = (2.1 * ctx.grand * 0.72) / 2;
  // an open book on a lectern by the steps
  cyl(ctx, 0.05, 0.07, 0.35, 5, lam(STONE), -0.8, 0.18, front + 0.5);
  box(ctx, 0.22, 0.03, 0.3, lam("#f2f0ea"), -0.9, 0.4, front + 0.5).rotation.z = 0.25;
  box(ctx, 0.22, 0.03, 0.3, lam("#f2f0ea"), -0.7, 0.4, front + 0.5).rotation.z = -0.25;
}

function bAcademy(ctx: Ctx): void {
  bHall(ctx, { columns: true });
  const front = (2.1 * ctx.grand * 0.72) / 2;
  // the founder's statue watches the steps
  box(ctx, 0.24, 0.3, 0.24, lam("#efeae2"), 0.9, 0.15, front + 0.5);
  const fig = part(ctx, new THREE.SphereGeometry(0.09, 6, 5), lam("#efeae2"), 0.9, 0.48, front + 0.5);
  fig.scale.set(1, 1.8, 0.8);
  part(ctx, new THREE.SphereGeometry(0.055, 6, 5), lam("#efeae2"), 0.9, 0.68, front + 0.5);
}

function bBank(ctx: Ctx): void {
  bHall(ctx, { columns: true });
  const front = (2.1 * ctx.grand * 0.72) / 2;
  const h = 1.4 * ctx.grand;
  // the gilded seal above the door, a strongbox on the steps
  const disc = part(ctx, new THREE.CylinderGeometry(0.16, 0.16, 0.04, 10), lam("#e3b544"), 0, h * 0.8, front + 0.06);
  disc.rotation.x = Math.PI / 2;
  box(ctx, 0.26, 0.22, 0.2, lam("#5d6874"), 0.65, 0.12, front + 0.35);
  const dial = part(ctx, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8), lam("#e3b544"), 0.65, 0.14, front + 0.46);
  dial.rotation.x = Math.PI / 2;
}

function bExchange(ctx: Ctx): void {
  bHall(ctx, { columns: true });
  const front = (2.1 * ctx.grand * 0.72) / 2;
  const h = 1.4 * ctx.grand;
  // the ticker band never sleeps
  const tick = part(ctx, new THREE.BoxGeometry(1.7, 0.14, 0.03), lam("#0f2f1a", "#4ef58a", 1.6), 0, h + 0.03, front + 0.05);
  tick.castShadow = false;
}

function bUniversity(ctx: Ctx): void {
  bHall(ctx, { columns: true, wide: true });
  const w = 2.6 * ctx.grand;
  const front = (w * 0.72) / 2;
  // the quad lawn and twin banners
  const lawn = box(ctx, w * 0.7, 0.03, 0.5, lam("#6da03f"), 0, 0.03, front + 0.55);
  lawn.receiveShadow = true;
  for (const sx of [-1, 1]) {
    box(ctx, 0.04, 1.1, 0.04, lam(WOOD_DARK), sx * w * 0.35, 0.55, front + 0.3);
    box(ctx, 0.22, 0.16, 0.02, ctx.trim, sx * w * 0.35 + 0.12, 1.0, front + 0.3);
  }
}

function bForum(ctx: Ctx): void {
  plinth(ctx, 2.0, 1.6);
  // an open colonnaded square with the speaker's rostrum
  box(ctx, 1.9, 0.12, 1.5, lam("#e9e2d2"), 0, 0.12);
  const colGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.8, 6);
  for (let i = 0; i < 4; i++) {
    const x = -0.75 + i * 0.5;
    part(ctx, colGeo, lam("#e9e2d2"), x, 0.58, 0.65);
    part(ctx, colGeo, lam("#e9e2d2"), x, 0.58, -0.65);
  }
  box(ctx, 1.9, 0.1, 0.32, ctx.trim, 0, 1.03, 0.65);
  box(ctx, 1.9, 0.1, 0.32, ctx.trim, 0, 1.03, -0.65);
  box(ctx, 0.4, 0.25, 0.4, lam("#efeae2"), -0.5, 0.3, 0);
}

function bGoldsmith(ctx: Ctx): void {
  bWorkshop(ctx, { ember: true, accent: "#e3b544" });
  const front = (1.4 * ctx.grand * 0.85) / 2;
  // a hoard in plain sight — stacked ingots catching the sun
  const ingot = new THREE.BoxGeometry(0.26, 0.11, 0.14);
  part(ctx, ingot, lam("#e3b544"), -0.6, 0.08, front + 0.3);
  part(ctx, ingot, lam("#e3b544"), -0.3, 0.08, front + 0.3);
  part(ctx, ingot, lam("#e3b544"), -0.45, 0.2, front + 0.3);
  const ring = part(ctx, new THREE.TorusGeometry(0.16, 0.05, 8, 16), lam("#e3b544"), 0.5, 0.2, front + 0.3);
  void ring;
}

function bGemCutter(ctx: Ctx): void {
  bWorkshop(ctx, { accent: "#8a5fc9" });
  const front = (1.4 * ctx.grand * 0.85) / 2;
  // a gem the size of a dog, glowing on its plinth
  box(ctx, 0.34, 0.2, 0.34, lam(STONE_DARK), -0.7, 0.1, front + 0.35);
  const gem = part(ctx, new THREE.OctahedronGeometry(0.32), lam("#3a1a4a", "#c86bff", 1.4), -0.7, 0.5, front + 0.35);
  gem.castShadow = false;
  const gem2 = part(ctx, new THREE.OctahedronGeometry(0.18), lam("#12333a", "#4fd8c4", 1.4), -0.1, 0.18, front + 0.4);
  gem2.castShadow = false;
}

function bMint(ctx: Ctx): void {
  bHall(ctx, { columns: true, small: true });
  const front = (1.5 * ctx.grand * 0.72) / 2;
  // struck coin, stacked high
  const coin = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 10);
  for (let i = 0; i < 4; i++) {
    part(ctx, coin, lam("#e3b544"), 0.7, 0.04 + i * 0.04, front + 0.35 - (i % 2) * 0.02);
  }
  part(ctx, coin, lam("#d6dbe2"), 0.42, 0.04, front + 0.3);
}

function bSculptors(ctx: Ctx): void {
  bWorkshop(ctx, { accent: "#e8e2d4" });
  const front = (1.4 * ctx.grand * 0.85) / 2;
  // a full standing statue mid-carve, scaffold still against it
  box(ctx, 0.45, 0.35, 0.45, lam("#efeae2"), -0.75, 0.18, front + 0.35);
  const fig = part(ctx, new THREE.SphereGeometry(0.17, 7, 6), lam("#efeae2"), -0.75, 0.72, front + 0.35);
  fig.scale.set(0.9, 1.9, 0.8);
  part(ctx, new THREE.SphereGeometry(0.1, 6, 5), lam("#efeae2"), -0.75, 1.12, front + 0.35);
  box(ctx, 0.06, 1.3, 0.06, lam(WOOD_DARK), -0.4, 0.65, front + 0.4);
  part(ctx, new THREE.IcosahedronGeometry(0.2), lam("#efeae2"), 0.3, 0.18, front + 0.4);
}

function bGallery(ctx: Ctx): void {
  bHall(ctx);
  const front = (2.1 * ctx.grand * 0.72) / 2;
  // gilt-framed canvases on the facade
  const frame = new THREE.BoxGeometry(0.3, 0.24, 0.03);
  const canvas = new THREE.BoxGeometry(0.24, 0.18, 0.035);
  ["#b8412f", "#3f6b8a"].forEach((c, i) => {
    const x = -0.45 + i * 0.9;
    part(ctx, frame, lam("#e3b544"), x, 0.95, front + 0.02);
    part(ctx, canvas, lam(c), x, 0.95, front + 0.03);
  });
}

function bAnatomy(ctx: Ctx): void {
  // the surgeons' rotunda, lit from above
  plinth(ctx, 1.5, 1.5);
  cyl(ctx, 0.7, 0.8, 1.0, 10, ctx.wall, 0, 0.6);
  cyl(ctx, 0.78, 0.78, 0.15, 10, ctx.trim, 0, 1.18);
  const sky = part(
    ctx,
    new THREE.SphereGeometry(0.42, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: "#cfe9e2", transparent: true, opacity: 0.6 }),
    0,
    1.25,
  );
  sky.castShadow = false;
  door(ctx, 1.55, 0.55);
  windows(ctx, 1.4, 1.55, 0.75, 2);
}

function bCartographers(ctx: Ctx): void {
  bHall(ctx, { small: true });
  const front = (1.5 * ctx.grand * 0.72) / 2;
  // the globe on its stand — the ocean, drawn smaller
  cyl(ctx, 0.04, 0.06, 0.3, 5, lam(WOOD_DARK), 0.7, 0.15, front + 0.3);
  part(ctx, new THREE.SphereGeometry(0.14, 8, 6), lam("#3f6b8a"), 0.7, 0.42, front + 0.3);
  const land = part(ctx, new THREE.SphereGeometry(0.145, 5, 4), lam("#6da03f"), 0.7, 0.42, front + 0.3);
  land.scale.set(0.6, 0.9, 0.8);
}

function bPrintingHouse(ctx: Ctx): void {
  bHall(ctx, { small: true });
  const front = (1.5 * ctx.grand * 0.72) / 2;
  // the press itself, and fresh sheets stacked to dry
  box(ctx, 0.3, 0.08, 0.3, lam(WOOD), 0.75, 0.1, front + 0.3);
  box(ctx, 0.06, 0.55, 0.06, lam(WOOD_DARK), 0.62, 0.4, front + 0.3);
  box(ctx, 0.06, 0.55, 0.06, lam(WOOD_DARK), 0.88, 0.4, front + 0.3);
  box(ctx, 0.34, 0.07, 0.08, lam(WOOD_DARK), 0.75, 0.66, front + 0.3);
  cyl(ctx, 0.035, 0.035, 0.3, 5, lam("#8f9399"), 0.75, 0.48, front + 0.3);
  const sheet = new THREE.BoxGeometry(0.2, 0.015, 0.28);
  for (let i = 0; i < 3; i++) {
    part(ctx, sheet, lam("#f2f0ea"), -0.6 - i * 0.05, 0.03 + i * 0.02, front + 0.3 - i * 0.04);
  }
}

function bGlassworks(ctx: Ctx): void {
  bWorkshop(ctx, { ember: true, accent: "#5fb8ac" });
  const front = (1.4 * ctx.grand * 0.85) / 2;
  // blown vessels cooling, the blowpipe leaning by the mouth
  const glass = new THREE.MeshLambertMaterial({ color: "#9fd8d0", transparent: true, opacity: 0.6 });
  const orb = new THREE.SphereGeometry(0.16, 8, 6);
  for (let i = 0; i < 3; i++) {
    const g = part(ctx, orb, glass, -0.75 + i * 0.36, 0.17, front + 0.3);
    g.scale.y = 1 + (i % 2) * 0.6;
    g.castShadow = false;
  }
  const pipe = part(ctx, new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4), lam("#8f9399"), 0.6, 0.55, front + 0.15);
  pipe.rotation.x = -0.4;
}

function bAlchemist(ctx: Ctx): void {
  bWorkshop(ctx, { stacks: 1, accent: "#63c46f" });
  const front = (1.4 * ctx.grand * 0.85) / 2;
  // the great retort glows a color nature never meant
  const flask = part(ctx, new THREE.SphereGeometry(0.24, 8, 6), lam("#173a2a", "#4ef58a", 1.6), -0.7, 0.26, front + 0.35);
  flask.castShadow = false;
  const neck = part(ctx, new THREE.CylinderGeometry(0.05, 0.05, 0.3, 5), lam("#173a2a", "#4ef58a", 1.6), -0.7, 0.55, front + 0.35);
  neck.castShadow = false;
  const fume = part(
    ctx,
    new THREE.SphereGeometry(0.2, 6, 5),
    new THREE.MeshLambertMaterial({ color: "#9fe0b2", transparent: true, opacity: 0.4 }),
    -0.7,
    0.85,
    front + 0.35,
  );
  fume.castShadow = false;
}

function bBlacksmith(ctx: Ctx): void {
  bWorkshop(ctx, { ember: true, accent: "#3a3a3f" });
  const front = (1.4 * ctx.grand * 0.85) / 2;
  // an anvil you could shoe an ox on, quench barrel at arm's reach
  cyl(ctx, 0.16, 0.2, 0.3, 6, lam(WOOD_DARK), -0.65, 0.15, front + 0.4);
  box(ctx, 0.44, 0.16, 0.18, lam("#3a3a3f"), -0.65, 0.4, front + 0.4);
  const horn = cone(ctx, 0.09, 0.2, 4, lam("#3a3a3f"), -0.93, 0.4, front + 0.4);
  horn.rotation.z = Math.PI / 2;
  cyl(ctx, 0.16, 0.16, 0.34, 8, lam(WOOD), 0.05, 0.17, front + 0.42);
}

function bSteelworks(ctx: Ctx): void {
  bWorkshop(ctx, { ember: true, big: true, stacks: 2, accent: "#5d6874" });
  // the ladle mid-pour, ingots cooling in a row
  cyl(ctx, 0.22, 0.16, 0.32, 8, lam("#3a3a3f"), -1.05, 0.75, 0.95);
  const pour = part(ctx, new THREE.CylinderGeometry(0.05, 0.05, 0.55, 5), lam("#7a2408", "#ff8c2e", 2.2), -1.05, 0.35, 0.95);
  pour.castShadow = false;
  const ingot = new THREE.BoxGeometry(0.26, 0.1, 0.13);
  part(ctx, ingot, lam("#8f9399"), -0.55, 0.07, 1.1);
  part(ctx, ingot, lam("#8f9399"), -0.25, 0.07, 1.05);
}

function bSteamEngine(ctx: Ctx): void {
  bWorkshop(ctx, { ember: true, big: true, stacks: 2, accent: "#a8624d" });
  // the great flywheel breathing for the works
  part(ctx, new THREE.TorusGeometry(0.42, 0.08, 8, 18), lam("#2f2b28"), -1.05, 0.55, 0.95);
  const spoke = new THREE.BoxGeometry(0.07, 0.75, 0.07);
  for (let i = 0; i < 2; i++) {
    const s = part(ctx, spoke, lam("#2f2b28"), -1.05, 0.55, 0.95);
    s.rotation.z = (i * Math.PI) / 2 + 0.4;
  }
}

function bCokingPlant(ctx: Ctx): void {
  bWorkshop(ctx, { ember: true, big: true, stacks: 2, accent: "#26272b" });
  // coal in, coke out — the heaps say which
  const heap = new THREE.ConeGeometry(0.42, 0.5, 7);
  part(ctx, heap, lam("#2f3136"), -1.05, 0.24, 1.05);
  part(ctx, heap, lam("#17181c"), -0.55, 0.2, 1.15).scale.setScalar(0.8);
}

function bTelegraph(ctx: Ctx): void {
  bWorkshop(ctx, { accent: "#7fa9c9" });
  // the pole rises well above the roof — news outrunning sails
  cyl(ctx, 0.05, 0.07, 2.1, 5, lam(WOOD_DARK), -0.95, 1.05, 0.7);
  box(ctx, 0.7, 0.05, 0.05, lam(WOOD), -0.95, 1.95, 0.7);
  box(ctx, 0.7, 0.05, 0.05, lam(WOOD), -0.95, 1.75, 0.7);
  const ins = new THREE.SphereGeometry(0.045, 5, 4);
  for (const dx of [-0.28, 0.28]) {
    part(ctx, ins, lam("#9fd8d0"), -0.95 + dx, 2.0, 0.7);
    part(ctx, ins, lam("#9fd8d0"), -0.95 + dx, 1.8, 0.7);
  }
}

function bRailyard(ctx: Ctx): void {
  bWorkshop(ctx, { big: true, accent: "#8a4f3e" });
  // a siding with a boxcar waiting for the whistle
  const sleeper = new THREE.BoxGeometry(0.5, 0.04, 0.1);
  for (let i = 0; i < 6; i++) part(ctx, sleeper, lam(WOOD_DARK), -1.0 + i * 0.42, 0.03, 1.15);
  box(ctx, 2.4, 0.05, 0.05, lam("#8f9399"), 0, 0.07, 1.0);
  box(ctx, 2.4, 0.05, 0.05, lam("#8f9399"), 0, 0.07, 1.3);
  box(ctx, 0.85, 0.4, 0.36, lam("#8a4f3e"), -0.5, 0.34, 1.15);
  const wheel = new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8);
  for (const x of [-0.8, -0.2]) {
    const wl = part(ctx, wheel, lam("#2f2b28"), x, 0.09, 1.15);
    wl.rotation.x = Math.PI / 2;
  }
}

function bTrainStation(ctx: Ctx): void {
  bHall(ctx, { wide: true });
  const w = 2.6 * ctx.grand;
  const front = (w * 0.72) / 2;
  // platform, rails, and the clock everyone runs for
  box(ctx, w + 0.6, 0.14, 0.5, lam(STONE), 0, 0.09, front + 0.35);
  const sleeper = new THREE.BoxGeometry(0.4, 0.03, 0.09);
  for (let i = 0; i < 7; i++) part(ctx, sleeper, lam(WOOD_DARK), -w / 2 + i * (w / 6), 0.02, front + 0.85);
  box(ctx, w + 0.6, 0.04, 0.04, lam("#8f9399"), 0, 0.05, front + 0.73);
  box(ctx, w + 0.6, 0.04, 0.04, lam("#8f9399"), 0, 0.05, front + 0.97);
  cyl(ctx, 0.03, 0.03, 0.7, 5, lam("#2f2b28"), w / 2 - 0.2, 0.5, front + 0.4);
  const face = part(ctx, new THREE.CylinderGeometry(0.1, 0.1, 0.04, 10), lam("#f2ecdc"), w / 2 - 0.2, 0.9, front + 0.4);
  face.rotation.x = Math.PI / 2;
}

function bNewspaperPress(ctx: Ctx): void {
  bWorkshop(ctx, { big: true, stacks: 1, accent: "#e8e6df" });
  // newsprint by the ton
  const roll = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10);
  for (const [x, y, z] of [
    [-0.9, 0.17, 1.05],
    [-0.55, 0.17, 1.05],
    [-0.72, 0.46, 1.05],
  ] as const) {
    part(ctx, roll, lam("#e8e6df"), x, y, z).rotation.z = Math.PI / 2;
  }
  const bundle = new THREE.BoxGeometry(0.22, 0.1, 0.16);
  part(ctx, bundle, lam("#f2f0ea"), 0.5, 0.06, 1.05);
}

function bCannery(ctx: Ctx): void {
  bWorkshop(ctx, { big: true, accent: "#b9c4cc" });
  // crates sealed and stacked, tins catching the light
  const crate = new THREE.BoxGeometry(0.24, 0.24, 0.24);
  part(ctx, crate, lam(WOOD), -0.85, 0.13, 1.05);
  part(ctx, crate, lam(WOOD), -0.57, 0.13, 1.05);
  part(ctx, crate, lam(WOOD), -0.71, 0.37, 1.05);
  const tin = new THREE.CylinderGeometry(0.05, 0.05, 0.07, 8);
  part(ctx, tin, lam("#c9cdd4"), -0.3, 0.05, 1.1);
  part(ctx, tin, lam("#c9cdd4"), -0.2, 0.05, 0.95);
}

function bHighwayDepot(ctx: Ctx): void {
  bWorkshop(ctx, { big: true, accent: "#e8c93d" });
  // fresh blacktop and the barriers that guard it
  const road = box(ctx, 2.6, 0.05, 0.7, lam("#3a3a3f"), 0, 0.03, 1.25);
  road.receiveShadow = true;
  const dash = new THREE.BoxGeometry(0.25, 0.06, 0.06);
  for (let i = 0; i < 4; i++) part(ctx, dash, lam("#e8c93d"), -0.95 + i * 0.65, 0.04, 1.25);
  box(ctx, 0.4, 0.08, 0.08, lam("#c2591f"), 1.15, 0.2, 0.85);
  box(ctx, 0.05, 0.2, 0.05, lam("#3a3a3f"), 1.0, 0.1, 0.85);
  box(ctx, 0.05, 0.2, 0.05, lam("#3a3a3f"), 1.3, 0.1, 0.85);
}

function bHospital(ctx: Ctx): void {
  const w = 2.2 * ctx.grand;
  const d = 1.4;
  plinth(ctx, w, d);
  // white wards under a flat roof, the cross unmistakable
  box(ctx, w, 1.6, d, lam("#e8e6df"), 0, 0.9);
  windows(ctx, w, d, 0.7, 4);
  windows(ctx, w, d, 1.3, 4);
  box(ctx, w * 1.02, 0.1, d * 1.02, lam("#c9cdd4"), 0, 1.75);
  const red = lam("#7a1414", "#e63946", 1.2);
  part(ctx, new THREE.BoxGeometry(0.14, 0.5, 0.05), red, 0, 1.2, d / 2 + 0.03).castShadow = false;
  part(ctx, new THREE.BoxGeometry(0.5, 0.14, 0.05), red, 0, 1.2, d / 2 + 0.03).castShadow = false;
  box(ctx, 0.7, 0.06, 0.4, lam("#c9cdd4"), 0, 0.62, d / 2 + 0.2);
  box(ctx, 0.3, 0.5, 0.06, lam("#25313d", "#9fd8ff", 0.6), 0, 0.28, d / 2 + 0.02);
}

function bCinema(ctx: Ctx): void {
  const w = 1.7 * ctx.grand;
  const d = 1.3;
  plinth(ctx, w, d);
  box(ctx, w, 1.1, d, ctx.wall, 0, 0.65);
  box(ctx, w, 0.1, d, lam("#3a3a3f"), 0, 1.25);
  // deco tower and the marquee glowing over the doors
  box(ctx, 0.4, 1.6, 0.3, ctx.trim, -w * 0.28, 0.85, 0.1);
  box(ctx, w * 0.8, 0.3, 0.34, lam("#3a3a3f"), 0.15, 0.95, d / 2 + 0.12);
  const sign = part(
    ctx,
    new THREE.BoxGeometry(w * 0.72, 0.2, 0.03),
    lam("#4a3208", "#ffd60a", 1.8),
    0.15,
    0.95,
    d / 2 + 0.3,
  );
  sign.castShadow = false;
  door(ctx, d, 0.6);
}

function bPlaneYard(ctx: Ctx): void {
  // an airframe on trestles, wings still waiting
  const fus = part(ctx, new THREE.CylinderGeometry(0.16, 0.12, 1.5, 8), lam("#c9cdd4"), 0, 0.6, 0);
  fus.rotation.z = Math.PI / 2;
  const nose = cone(ctx, 0.12, 0.3, 8, lam("#b8412f"), 0.9, 0.6, 0);
  nose.rotation.z = -Math.PI / 2;
  box(ctx, 0.3, 0.35, 0.06, lam("#8b9098"), -0.7, 0.85, 0);
  box(ctx, 0.25, 0.4, 0.12, lam(WOOD_DARK), -0.45, 0.25, 0);
  box(ctx, 0.25, 0.4, 0.12, lam(WOOD_DARK), 0.45, 0.25, 0);
  part(ctx, new THREE.BoxGeometry(0.5, 0.04, 1.3), lam("#c9cdd4"), -0.2, 0.05, 0.9);
}

function bFusionCore(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  // the tokamak ring and its bottled star
  box(ctx, 1.4, 0.4, 1.4, lam("#3b4048"), 0, 0.3);
  part(ctx, new THREE.TorusGeometry(0.65, 0.14, 8, 24), lam("#c9cdd4"), 0, 1.25);
  const core = part(ctx, new THREE.SphereGeometry(0.22, 10, 8), lam("#fff3d6", "#ffd98c", 2.4), 0, 1.25);
  core.castShadow = false;
  const pipe = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6);
  for (const a of [0.7, 2.4, 4.0, 5.5]) {
    const p = part(ctx, pipe, lam("#8b9098"), Math.cos(a) * 0.75, 0.5, Math.sin(a) * 0.75);
    p.rotation.z = 0.4;
  }
}

function bAINexus(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  box(ctx, 1.5, 0.25, 1.5, lam("#c9cdd4"), 0, 0.2);
  // a ring of racks around the mind itself
  const glow = lam(...TECH);
  const rack = new THREE.BoxGeometry(0.3, 1.0, 0.14);
  const led = new THREE.BoxGeometry(0.2, 0.7, 0.02);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = part(ctx, rack, lam("#3b4048"), Math.cos(a) * 0.6, 0.82, Math.sin(a) * 0.6);
    r.rotation.y = -a + Math.PI / 2;
    const l = part(ctx, led, glow, Math.cos(a) * 0.52, 0.82, Math.sin(a) * 0.52);
    l.rotation.y = -a + Math.PI / 2;
    l.castShadow = false;
  }
  part(ctx, new THREE.SphereGeometry(0.2, 10, 8), glow, 0, 1.05).castShadow = false;
}

function bCryoVault(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.5);
  box(ctx, 1.6, 0.9, 1.2, lam("#7d8894"), 0, 0.55);
  box(ctx, 1.7, 0.12, 1.3, lam("#c9cdd4"), 0, 1.06);
  // frosted pods, and the cold leaking out the door
  const frost = lam("#dff3f7", "#9fe8ff", 0.5);
  const podG = new THREE.SphereGeometry(0.14, 8, 6);
  for (let i = 0; i < 3; i++) {
    const p = part(ctx, podG, frost, -0.45 + i * 0.45, 0.38, 0.68);
    p.scale.set(1, 1.9, 0.8);
    p.castShadow = false;
  }
  const mist = part(
    ctx,
    new THREE.SphereGeometry(0.2, 6, 5),
    new THREE.MeshLambertMaterial({ color: "#dff6fb", transparent: true, opacity: 0.35 }),
    0,
    0.16,
    0.8,
  );
  mist.castShadow = false;
  mist.scale.set(2.2, 0.5, 1);
}

function bHoloTheater(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  cyl(ctx, 0.9, 1.0, 0.3, 12, lam("#3b4048"), 0, 0.25);
  // seats around a figure made of light
  const seat = new THREE.BoxGeometry(0.3, 0.12, 0.14);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.15 + (i / 7) * Math.PI * 0.7;
    const s = part(ctx, seat, lam("#5d6874"), Math.cos(a) * 0.72, 0.46, Math.sin(a) * 0.72);
    s.rotation.y = -a + Math.PI / 2;
  }
  const holo = new THREE.MeshLambertMaterial({
    color: "#7fe3ff",
    transparent: true,
    opacity: 0.55,
    emissive: new THREE.Color("#6fe3ff"),
    emissiveIntensity: 0.6,
  });
  const fig = part(ctx, new THREE.SphereGeometry(0.12, 7, 6), holo, 0, 1.05, -0.15);
  fig.scale.set(1, 1.7, 0.8);
  fig.castShadow = false;
  part(ctx, new THREE.SphereGeometry(0.08, 6, 5), holo, 0, 1.35, -0.15).castShadow = false;
  const beam = part(
    ctx,
    new THREE.ConeGeometry(0.3, 0.7, 8, 1, true),
    new THREE.MeshLambertMaterial({ color: "#7fe3ff", transparent: true, opacity: 0.18 }),
    0,
    0.75,
    -0.15,
  );
  beam.castShadow = false;
}

function bTerraformerX(ctx: Ctx): void {
  plinth(ctx, 2.0, 2.0);
  cyl(ctx, 0.4, 0.6, 1.8, 7, lam("#7d8894"), 0, 1.0);
  // half the ground already turned green — the machine mid-work
  const half = new THREE.CylinderGeometry(0.85, 0.85, 0.04, 10, 1, false, 0, Math.PI);
  const green = part(ctx, half, lam("#4f8a3a"), 0, 0.04);
  green.receiveShadow = true;
  const barren = part(ctx, half, lam("#b0956a"), 0, 0.04);
  barren.rotation.y = Math.PI;
  barren.receiveShadow = true;
  for (const a of [0.5, 1.6, 2.7, 3.8, 4.9]) {
    const v = cyl(ctx, 0.07, 0.09, 0.5, 6, lam("#8b9098"), Math.cos(a) * 0.5, 1.9, Math.sin(a) * 0.5);
    v.rotation.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
  }
  const cloud = part(
    ctx,
    new THREE.SphereGeometry(0.3, 7, 6),
    new THREE.MeshLambertMaterial({ color: "#f4f2ec", transparent: true, opacity: 0.4 }),
    0,
    2.4,
    0,
  );
  cloud.castShadow = false;
  cloud.scale.set(1.8, 0.6, 1.2);
}

function bNanoforge(ctx: Ctx): void {
  bTech(ctx, { ring: false });
  // the assembly arm, atom by atom
  const armMat = lam("#c9cdd4");
  const a1 = box(ctx, 0.08, 0.6, 0.08, armMat, 0.7, 0.6, 0.5);
  a1.rotation.z = -0.5;
  const a2 = box(ctx, 0.08, 0.5, 0.08, armMat, 0.95, 0.95, 0.5);
  a2.rotation.z = 0.9;
  part(ctx, new THREE.SphereGeometry(0.07, 6, 5), lam(...TECH), 1.15, 1.1, 0.5).castShadow = false;
}

function bAntimatterLab(ctx: Ctx): void {
  plinth(ctx, 1.8, 1.8);
  box(ctx, 1.4, 0.4, 1.4, lam("#3b4048"), 0, 0.3);
  // the priceless mote, suspended between pylons
  const orb = part(ctx, new THREE.SphereGeometry(0.16, 9, 7), lam("#2a0f33", "#d86bff", 1.8), 0, 1.15);
  orb.castShadow = false;
  const pylon = new THREE.ConeGeometry(0.1, 0.7, 5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = part(ctx, pylon, lam("#8b9098"), Math.cos(a) * 0.5, 0.85, Math.sin(a) * 0.5);
    p.rotation.set(Math.sin(a) * -0.4, 0, Math.cos(a) * 0.4);
  }
}

function bTradingPost(ctx: Ctx): void {
  bMarket(ctx);
  // cargo and honest scales — trade goes through here
  const crate = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  part(ctx, crate, lam(WOOD), 1.05, 0.11, 0.55);
  part(ctx, crate, lam(WOOD), 1.05, 0.33, 0.55);
  part(ctx, crate, lam(WOOD_DARK), 1.3, 0.11, 0.35);
  box(ctx, 0.04, 0.4, 0.04, lam("#3a3a3f"), -1.05, 0.3, 0.6);
  box(ctx, 0.4, 0.03, 0.03, lam("#3a3a3f"), -1.05, 0.5, 0.6);
  cyl(ctx, 0.06, 0.06, 0.02, 7, lam("#e3b544"), -1.23, 0.42, 0.6);
  cyl(ctx, 0.06, 0.06, 0.02, 7, lam("#e3b544"), -0.87, 0.46, 0.6);
}

function bRollingMill(ctx: Ctx): void {
  bFactory(ctx, { stacks: 1 });
  // steel coils on the yard
  const coil = new THREE.TorusGeometry(0.16, 0.07, 7, 14);
  for (let i = 0; i < 3; i++) {
    const c = part(ctx, coil, lam("#8f9399"), -1.0 + i * 0.42, 0.1, 1.1);
    c.rotation.x = Math.PI / 2;
  }
}

function bTextileMill(ctx: Ctx): void {
  bFactory(ctx, { stacks: 1 });
  // cloth by the acre, rolled and ready
  const bolt = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8);
  ["#b8412f", "#3f6b8a", "#c9a35c"].forEach((c, i) => {
    const b = part(ctx, bolt, lam(c), -0.95 + i * 0.3, 0.1, 1.1);
    b.rotation.z = Math.PI / 2;
  });
}

function bPetro(ctx: Ctx): void {
  bTanks(ctx);
  // the flare stack burning off what the pipes can't hold
  cyl(ctx, 0.05, 0.07, 2.2, 6, lam("#8b9098"), -1.45, 1.2);
  const fl = cone(ctx, 0.12, 0.35, 6, lam("#7a2408", "#ff8c2e", 2.4), -1.45, 2.5);
  fl.castShadow = false;
}

// --------------------------------------------------------------- registry

type Builder = (ctx: Ctx) => void;

// ---------------------------------------------------------------- leisure

const LEAF = "#4c7a3a";
const WATER_BLUE = "#3d7d95";

function tree(ctx: Ctx, x: number, z: number, s = 1): void {
  cyl(ctx, 0.05 * s, 0.07 * s, 0.4 * s, 5, lam(WOOD_DARK), x, 0.2 * s, z);
  part(ctx, new THREE.SphereGeometry(0.32 * s, 6, 5), lam(LEAF), x, 0.62 * s, z);
}

function bench(ctx: Ctx, x: number, z: number, ry = 0): void {
  const b = box(ctx, 0.5, 0.06, 0.16, lam(WOOD), x, 0.22, z);
  b.rotation.y = ry;
  box(ctx, 0.05, 0.2, 0.14, lam(WOOD_DARK), x - 0.18, 0.1, z);
  box(ctx, 0.05, 0.2, 0.14, lam(WOOD_DARK), x + 0.18, 0.1, z);
}

function pond(ctx: Ctx, r: number, x = 0, z = 0): void {
  const water = part(
    ctx,
    new THREE.CylinderGeometry(r, r, 0.06, 12),
    lam(WATER_BLUE),
    x,
    0.08,
    z,
  );
  water.castShadow = false;
  part(ctx, new THREE.TorusGeometry(r + 0.06, 0.07, 5, 12), lam(STONE), x, 0.08, z).rotation.x =
    Math.PI / 2;
}

function flowerBed(ctx: Ctx, x: number, z: number): void {
  box(ctx, 0.7, 0.12, 0.45, lam(LEAF), x, 0.12, z);
  const colors = ["#c0392b", "#e3b544", "#b06fc9", "#e8e2d4"];
  for (let i = 0; i < 4; i++) {
    part(
      ctx,
      new THREE.SphereGeometry(0.05, 5, 4),
      lam(colors[i]!),
      x - 0.24 + i * 0.16,
      0.22,
      z + (i % 2 ? 0.1 : -0.1),
    );
  }
}

function bDancingGround(ctx: Ctx): void {
  part(ctx, new THREE.CylinderGeometry(1.1, 1.1, 0.08, 12), lam("#a08a5f"), 0, 0.05, 0);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    part(ctx, new THREE.IcosahedronGeometry(0.13), lam(STONE), Math.cos(a) * 1.0, 0.14, Math.sin(a) * 1.0);
  }
  cyl(ctx, 0.04, 0.05, 1.4, 6, lam(WOOD_DARK), 0, 0.7, 0);
  for (let i = 0; i < 3; i++) {
    const r = box(ctx, 0.5, 0.05, 0.02, lam(["#c0392b", "#e3b544", ctx.civ.accent][i]!), 0.25, 1.3 - i * 0.16, 0);
    r.rotation.y = i * 1.1;
  }
}

function bGardenPlot(ctx: Ctx): void {
  box(ctx, 2.2, 0.06, 1.7, lam("#8fae6b"), 0, 0.05);
  flowerBed(ctx, -0.55, -0.35);
  flowerBed(ctx, 0.55, 0.4);
  box(ctx, 0.4, 0.04, 1.6, lam("#cbb78a"), 0, 0.09);
  tree(ctx, 0.85, -0.5, 0.9);
  bench(ctx, -0.7, 0.5);
}

function bBathingLake(ctx: Ctx): void {
  pond(ctx, 1.15);
  for (const [x, z] of [[-1.25, 0.3], [1.2, -0.4], [0.4, 1.2]] as const) {
    cyl(ctx, 0.02, 0.03, 0.5, 4, lam(LEAF), x, 0.3, z);
  }
  box(ctx, 0.8, 0.06, 0.3, lam(WOOD), 0.7, 0.16, 0.7).rotation.y = -0.6;
  tree(ctx, -1.1, -0.9, 0.8);
}

function bPleasureGarden(ctx: Ctx): void {
  box(ctx, 2.6, 0.14, 2.0, lam("#e9e2d2"), 0, 0.08);
  pond(ctx, 0.45, 0, 0.1);
  cyl(ctx, 0.06, 0.08, 0.5, 6, lam("#e9e2d2"), 0, 0.35, 0.1);
  part(ctx, new THREE.SphereGeometry(0.1, 6, 5), lam(WATER_BLUE), 0, 0.63, 0.1).castShadow = false;
  flowerBed(ctx, -0.95, -0.6);
  flowerBed(ctx, 0.95, -0.6);
  tree(ctx, -1.0, 0.75, 0.85);
  tree(ctx, 1.0, 0.75, 0.85);
}

function bVillageGreen(ctx: Ctx): void {
  part(ctx, new THREE.CylinderGeometry(1.4, 1.5, 0.1, 12), lam("#7fae5a"), 0, 0.06, 0);
  cyl(ctx, 0.04, 0.05, 1.8, 6, lam(WOOD), 0, 0.9, 0);
  for (let i = 0; i < 4; i++) {
    const rb = box(ctx, 0.02, 1.1, 0.05, lam(["#c0392b", "#e3b544", "#3f5f8a", "#e8e2d4"][i]!), 0, 1.1, 0);
    rb.rotation.z = 0.5;
    rb.rotation.y = i * (Math.PI / 2);
    rb.position.x = Math.cos(i * (Math.PI / 2)) * 0.35;
    rb.position.z = Math.sin(i * (Math.PI / 2)) * 0.35;
  }
  bench(ctx, -0.9, 0.7, 0.7);
  bench(ctx, 0.9, 0.7, -0.7);
  tree(ctx, 0, -1.2, 0.9);
}

function bFountainPlaza(ctx: Ctx): void {
  part(ctx, new THREE.CylinderGeometry(1.5, 1.5, 0.1, 8), lam("#d9d2c0"), 0, 0.06, 0);
  pond(ctx, 0.7);
  cyl(ctx, 0.3, 0.4, 0.18, 8, lam("#e9e2d2"), 0, 0.2, 0);
  cyl(ctx, 0.05, 0.07, 0.5, 6, lam("#e9e2d2"), 0, 0.5, 0);
  part(ctx, new THREE.CylinderGeometry(0.22, 0.22, 0.05, 8), lam(WATER_BLUE), 0, 0.72, 0).castShadow = false;
  part(ctx, new THREE.SphereGeometry(0.08, 6, 5), lam("#cde6f7"), 0, 0.85, 0).castShadow = false;
  bench(ctx, -1.1, 0.55, 0.9);
  bench(ctx, 1.1, -0.55, 0.9);
}

function bCityPark(ctx: Ctx): void {
  box(ctx, 3.0, 0.06, 2.3, lam("#7fae5a"), 0, 0.05);
  pond(ctx, 0.55, 0.8, 0.5);
  tree(ctx, -1.05, -0.7);
  tree(ctx, -0.3, 0.75, 0.9);
  tree(ctx, 0.4, -0.85, 1.1);
  bench(ctx, -1.0, 0.55, 0.5);
  bench(ctx, 1.15, -0.5, -0.5);
  // wrought-iron gate hint
  box(ctx, 0.05, 0.5, 0.05, lam("#3a3a3f"), -0.35, 0.27, 1.2);
  box(ctx, 0.05, 0.5, 0.05, lam("#3a3a3f"), 0.35, 0.27, 1.2);
  box(ctx, 0.86, 0.06, 0.05, lam("#3a3a3f"), 0, 0.55, 1.2);
}

function bFunfair(ctx: Ctx): void {
  // the great wheel
  const wheelMat = lam(ctx.civ.accent);
  const hub = 1.5;
  cyl(ctx, 0.06, 0.09, hub, 5, lam("#5d6874"), -0.45, hub / 2, 0).rotation.z = 0.28;
  cyl(ctx, 0.06, 0.09, hub, 5, lam("#5d6874"), 0.45, hub / 2, 0).rotation.z = -0.28;
  const rim = part(ctx, new THREE.TorusGeometry(0.95, 0.05, 6, 14), wheelMat, 0, hub, 0);
  rim.rotation.y = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = box(ctx, 0.04, 1.8, 0.04, lam("#8f9399"), 0, hub, 0);
    spoke.rotation.x = a;
    box(ctx, 0.18, 0.16, 0.14, lam(["#c0392b", "#e3b544", "#3f5f8a"][i % 3]!), 0, hub + Math.cos(a) * 0.95, Math.sin(a) * 0.95);
  }
  // ticket hut with a striped awning
  box(ctx, 0.55, 0.5, 0.45, ctx.wall, 1.35, 0.35, 0.4);
  const awn = box(ctx, 0.65, 0.05, 0.55, lam("#c0392b"), 1.35, 0.68, 0.45);
  awn.rotation.x = 0.2;
}

function bGravityGarden(ctx: Ctx): void {
  part(ctx, new THREE.CylinderGeometry(1.2, 1.35, 0.14, 10), lam("#5d6874"), 0, 0.09, 0);
  const glow = lam(...TECH);
  for (let i = 0; i < 3; i++) {
    const y = 0.7 + i * 0.55;
    const ring = part(ctx, new THREE.TorusGeometry(0.75 - i * 0.18, 0.06, 6, 14), glow, 0, y, 0);
    ring.rotation.x = Math.PI / 2 + (i % 2 ? 0.2 : -0.2);
    ring.castShadow = false;
    part(ctx, new THREE.SphereGeometry(0.16, 6, 5), lam(LEAF), 0.55 - i * 0.16, y + 0.14, 0.1 * i);
  }
  tree(ctx, -0.6, 0.6, 0.7);
}

// ---------------------------------------------------------------- wonders

/**
 * Every wonder shares one monumental silhouette — a terraced mountain of a
 * building — and wears its civilization's roof, colors, and banners, so a
 * Parthenon can never be mistaken for a Great Torii across the water.
 */
function bWonder(ctx: Ctx): void {
  const g = 1.35 * ctx.grand;
  const w = 3.2 * g;
  const d = 2.6 * g;
  const h = 1.9 * g;
  // terraced foundation
  box(ctx, w + 1.6, 0.22, d + 1.6, lam(STONE_DARK), 0, 0.11);
  box(ctx, w + 0.9, 0.22, d + 0.9, lam(STONE), 0, 0.33);
  box(ctx, w + 0.3, 0.22, d + 0.3, lam(STONE_DARK), 0, 0.55);
  const baseY = 0.66;
  // the great hall and its gilded crown
  box(ctx, w, h, d, ctx.wall, 0, baseY + h / 2);
  windows(ctx, w, d, baseY + h * 0.55, 5);
  box(ctx, 0.8, 1.15, 0.08, lam(WOOD_DARK), 0, baseY + 0.58, d / 2 + 0.03);
  box(ctx, w + 0.14, 0.16, d + 0.14, lam("#e3b544"), 0, baseY + h - 0.06);
  roof(ctx, w, d, baseY + h + 0.05, 1.45);
  // grand stair to the door
  const stair = box(ctx, 1.6, 0.16, 1.1, lam(STONE), 0, 0.4, d / 2 + 0.9);
  stair.rotation.x = -0.25;
  // banner poles at the terrace corners, flying the people's color
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const px = sx * (w / 2 + 0.6);
    const pz = sz * (d / 2 + 0.6);
    cyl(ctx, 0.05, 0.05, 2.7, 6, lam(WOOD_DARK), px, 1.35, pz);
    box(ctx, 0.36, 0.65, 0.03, lam(ctx.civ.accent), px, 2.35, pz + 0.02);
  }
  // twin braziers burning at the entrance, day and night
  for (const s of [-1, 1] as const) {
    cyl(ctx, 0.14, 0.1, 0.35, 6, lam(STONE_DARK), s * 1.1, 0.85, d / 2 + 0.5);
    const fire = part(ctx, new THREE.SphereGeometry(0.12, 6, 5), lam(...EMBER), s * 1.1, 1.1, d / 2 + 0.5);
    fire.castShadow = false;
  }
}

const SPECIALS: Record<string, Builder> = {
  "dancing-ground": bDancingGround,
  garden: bGardenPlot,
  "bathing-lake": bBathingLake,
  "pleasure-garden": bPleasureGarden,
  "village-green": bVillageGreen,
  "fountain-plaza": bFountainPlaza,
  "city-park": bCityPark,
  funfair: bFunfair,
  "gravity-garden": bGravityGarden,
  farm: bFarm,
  "livestock-pen": bLivestockPen,
  campfire: bCampfire,
  "storyteller-circle": bStoryCircle,
  granary: bGranary,
  "shaman-tent": bTent,
  "drying-rack": bRack,
  "burial-mound": (c) => bMound(c, false),
  "charcoal-burner": (c) => bMound(c, true),
  "stone-circle": bStoneCircle,
  palisade: bPalisade,
  "stone-wall": (c) => bStoneWall(c, false),
  "castle-wall": (c) => bStoneWall(c, true),
  well: bWell,
  "toll-bridge": bBridge,
  dock: bDock,
  boat: bBoatYard,
  kiln: bKiln,
  roundhouse: bRoundhouse,
  toolmaker: bToolmaker,
  "flint-knapper": bKnapper,
  "fishing-hut": bFishingHut,
  smokehouse: bSmokehouse,
  "hide-tanner": bTanner,
  "pottery-workshop": bPottery,
  weaver: bWeaverShop,
  brewery: bBreweryShop,
  bathhouse: (c) => bBath(c, false),
  thermae: (c) => bBath(c, true),
  "bronze-armory": (c) => bArmory(c),
  arsenal: (c) => bArmory(c, { crates: true }),
  "chariot-works": bChariotWorks,
  barracks: bBarracks,
  gristmill: bGristmill,
  "siege-workshop": bSiegeWorks,
  "moot-hall": bMootHall,
  guildhall: bGuildhall,
  tavern: bTavern,
  apothecary: bApothecary,
  library: bScrollHall,
  academy: bAcademy,
  bank: bBank,
  exchange: bExchange,
  university: bUniversity,
  forum: bForum,
  goldsmith: bGoldsmith,
  "gem-cutter": bGemCutter,
  mint: bMint,
  "sculptors-guild": bSculptors,
  gallery: bGallery,
  "anatomy-theater": bAnatomy,
  "cartographers-hall": bCartographers,
  "printing-house": bPrintingHouse,
  glassworks: bGlassworks,
  "alchemist-lab": bAlchemist,
  blacksmith: bBlacksmith,
  "bronze-forge": bBlacksmith,
  steelworks: bSteelworks,
  "steam-engine-house": bSteamEngine,
  "coking-plant": bCokingPlant,
  "telegraph-office": bTelegraph,
  "railway-yard": bRailyard,
  "train-station": bTrainStation,
  "newspaper-press": bNewspaperPress,
  cannery: bCannery,
  "highway-depot": bHighwayDepot,
  hospital: bHospital,
  cinema: bCinema,
  plane: bPlaneYard,
  amphitheater: (c) => bArena(c),
  hippodrome: (c) => bArena(c, { long: true }),
  "tourney-grounds": (c) => bArena(c, { pennants: true }),
  stadium: (c) => bArena(c, { masts: true }),
  aqueduct: bAqueduct,
  windmill: bWindmill,
  watermill: bWatermill,
  cathedral: bCathedral,
  "market-hall": bMarket,
  "trading-post": bTradingPost,
  observatory: bObservatory,
  clockmaker: bClocktower,
  "bell-tower": (c) => bTower(c, { bell: true }),
  "botanical-garden": bGreenhouse,
  factory: (c) => bFactory(c),
  "rolling-mill": bRollingMill,
  "textile-mill": bTextileMill,
  "oil-derrick": bDerrick,
  gasworks: bGasometer,
  refinery: (c) => bTanks(c),
  "petrochemical-plant": bPetro,
  "water-treatment": (c) => bTanks(c, { low: true }),
  "power-plant": bCoolingTower,
  reactor: bReactor,
  "fusion-core": bFusionCore,
  "broadcast-tower": (c) => bAntennaTower(c, false),
  "radar-station": (c) => bAntennaTower(c, true),
  skyscraper: bSkyscraper,
  airfield: bAirfield,
  "launch-complex": bLaunchComplex,
  skyfarm: bSkyfarm,
  arcology: bArcology,
  "space-elevator": bSpaceElevator,
  "dyson-relay": bDyson,
  "weather-array": bWeatherArray,
  "graviton-plant": bGraviton,
  "ai-nexus": bAINexus,
  "cryo-vault": bCryoVault,
  "holo-theater": bHoloTheater,
  terraformer: bTerraformerX,
  nanoforge: bNanoforge,
  "antimatter-lab": bAntimatterLab,
  stable: bStable,
  keep: (c) => bDefense(c, { grand: true }),
  watchtower: (c) => bTower(c),
};

/** archetype fallback, decided by what the name says the building does */
function archetype(spec: BuildingSpec): Builder {
  const t = spec.type;
  if (spec.houses) return bHouse;
  if (/mine|quarry/.test(t)) return bMine;
  if (/tower/.test(t)) return bTower;
  if (/temple|shrine|monastery|senate/.test(t)) {
    return (c) => bSacred(c, { small: t === "shrine" });
  }
  if (/barracks|arsenal|armory|barbican/.test(t)) return bDefense;
  if (
    /quantum|ai-nexus|antimatter|nano|holo|cryo|terraformer|research-lab/.test(t)
  ) {
    if (/holo|cryo/.test(t)) return (c) => bTech(c, { dome: true });
    if (/ai-nexus|quantum/.test(t)) return (c) => bTech(c, { obelisk: true });
    return (c) => bTech(c);
  }
  if (/forge|smith|steelworks|steam|coking/.test(t)) {
    return (c) =>
      bWorkshop(c, {
        ember: true,
        big: /steelworks|coking/.test(t),
        stacks: /steelworks|coking/.test(t) ? 2 : 1,
        accent: "#3a3a3f",
      });
  }
  if (
    /works|press|maker|weaver|brewery|tanner|knapper|smokehouse|pottery|chariot|gem-cutter|sculptors|apothecary|alchemist|gunsmith|cannery|siege|fishing|toolmaker|highway|railway|telegraph/.test(
      t,
    )
  ) {
    return (c) => bWorkshop(c, { big: /railway|chariot/.test(t), accent: "#8f9399" });
  }
  if (/forum|bank|exchange|university|academy|library|mint|hall|thermae|bathhouse|gallery|opera|theater|station|hospital|cinema|scriptorium|tavern|gristmill/.test(t)) {
    const columns = /forum|bank|exchange|university|academy|senate|library|mint/.test(t);
    const small = /tavern|scriptorium|mint|cinema|gristmill/.test(t);
    const wide = /station|opera|hospital|university/.test(t);
    return (c) => bHall(c, { columns, small, wide });
  }
  return (c) => bHall(c, { small: true });
}

// ------------------------------------------------------------- entry point

/**
 * The catalog age controls when a building unlocks; the civilization age
 * controls how it looks now. Keeping those concepts separate lets an old hut
 * be rebuilt in the new era without changing its gameplay type or save data.
 */
export function buildingModelSpec(type: string, modelAge: Age): BuildingSpec {
  const catalog = buildingSpec(type) ?? {
    type,
    age: "stone" as const,
    cost: {},
    buildSeconds: 30,
  };
  return { ...catalog, age: modelAge };
}

/**
 * The age a building is drawn in: its own server-stamped age first, the
 * island's age when the stamp is missing (old saves), and — if a newer server
 * ever sends an age this client has never heard of — the closest age we do
 * know rather than nothing at all.
 */
export function resolveModelAge(building: Building, islandAge: Age): Age {
  const own = building.age;
  if (own && ageIndex(own) >= 0) return own;
  if (ageIndex(islandAge) >= 0) return islandAge;
  return "stone";
}

/** Ages are part of the mesh cache key, so an age-up redraws immediately. */
export function buildingRenderSignature(buildings: Building[], modelAge: Age): string {
  return `${modelAge}|${buildings
    .map((b) => `${b.id}:${b.stage}:${b.age ?? ""}`)
    .join(",")}`;
}

/** Geometry is identical inside this key; building ids only vary placement. */
export function buildingInstanceKey(building: Building, islandAge: Age): string {
  return `${building.type}|${building.stage}|${resolveModelAge(building, islandAge)}`;
}

/** Preserve the hand-authored, deterministic street variation for instances.
 * When the town plan supplies a facing, the building addresses its street or
 * plaza with only a whisper of jitter; without one (tests, legacy callers)
 * the old random lean stands unchanged. */
export function buildingVisualTransform(
  building: Building,
  target: THREE.Object3D,
  facing?: number,
): THREE.Object3D {
  const irand = mulberry32(hashString(building.id));
  target.scale.setScalar(1.9 + irand() * 0.25);
  const lean = irand() - 0.5;
  target.rotation.y = facing === undefined ? lean * 0.4 : facing;
  return target;
}

export function createBuildingMesh(
  building: Building,
  civ: CivSpec,
  islandAge: Age,
): THREE.Group {
  const modelAge = resolveModelAge(building, islandAge);
  const group = new THREE.Group();
  group.userData.modelAge = modelAge;
  // buildings must dwarf the settlers (~1.65 tall), so the whole composition
  // is authored at unit scale and roughly doubled here
  buildingVisualTransform(building, group);

  const spec = buildingModelSpec(building.type, modelAge);
  const rand = mulberry32(hashString(building.type));
  const era = ageIndex(spec.age);
  // every civilization's look evolves through the ages: wattle-and-daub and
  // thatch at the dawn, the civ's true colors through its glory years, then
  // pale dressed stone and weathered alloy toward the end of history — so a
  // stone-age hut and a modern block of the same people read as kin, not twins
  const wallColor = new THREE.Color(civ.architecture.primary);
  if (era <= 1) wallColor.lerp(new THREE.Color("#a08a63"), 0.45 - era * 0.2);
  // the castle ages dress every wall in stone, whatever the people's colors
  if (era === 4 || era === 5) wallColor.lerp(new THREE.Color(STONE), 0.34);
  if (era >= 6) wallColor.lerp(new THREE.Color("#cfcbc2"), 0.22 + (era - 6) * 0.11);
  wallColor.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
  const trimColor = new THREE.Color(civ.architecture.trim);
  // A civilization's banner hue remains unmistakable on roofs and props, but
  // clay pigment is dusty rather than neon: large roof planes share the world
  // neutral while flags, clothes, shields, and signatures keep the pure hue.
  trimColor.lerp(new THREE.Color(CLAY_PALETTE.chalk), 0.48);
  trimColor.offsetHSL(0, -0.1, 0);
  if (era === 0) trimColor.lerp(new THREE.Color("#8a7a4f"), 0.55);
  if (era >= 7) trimColor.lerp(new THREE.Color("#5d6874"), 0.28 + (era - 7) * 0.14);
  // Roofs are the town's biggest colour surface seen from map height, so they
  // keep far more of the civ's pigment than the trim does — chalked just
  // enough to stay clay, then painted per block by the batch tint.
  const roofColor = new THREE.Color(civ.architecture.trim);
  roofColor.lerp(new THREE.Color(CLAY_PALETTE.chalk), 0.2);
  roofColor.offsetHSL(0, 0.05, 0.045);
  if (era === 0) roofColor.lerp(new THREE.Color("#8a7a4f"), 0.45);
  if (era >= 7) roofColor.lerp(new THREE.Color("#6d7884"), 0.22 + (era - 7) * 0.1);
  const ctx: Ctx = {
    g: group,
    civ,
    spec,
    rand,
    // later ages build markedly grander, not just a shade
    grand: 1 + era * 0.09,
    wall: lamColor(wallColor),
    trim: lamColor(trimColor),
    roofMat: roofLam(roofColor),
  };

  const w = 1.1 + (hashString(building.type) % 2) * 0.4;
  if (building.stage === "site") {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.3, 0.08, w + 0.3),
      new THREE.MeshLambertMaterial({
        color: civ.architecture.trim,
        transparent: true,
        opacity: 0.55,
      }),
    );
    pad.receiveShadow = true;
    group.add(pad);
    const stake = new THREE.BoxGeometry(0.05, 0.3, 0.05);
    for (const [sx, sz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      part(ctx, stake, lam(WOOD_DARK), (sx * (w + 0.3)) / 2, 0.15, (sz * (w + 0.3)) / 2);
    }
    return compactStaticMeshes(group);
  }

  if (building.stage === "construction") {
    const h = 1 + (hashString(building.type) % 3) * 0.5;
    box(ctx, w, h * 0.45, w, ctx.wall, 0, h * 0.225);
    const postGeo = new THREE.BoxGeometry(0.08, h, 0.08);
    const beamGeo = new THREE.BoxGeometry(w + 0.2, 0.07, 0.07);
    const postMat = lam("#6b4f2a");
    for (const [px, pz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      part(ctx, postGeo, postMat, (px * w) / 2, h / 2, (pz * w) / 2);
    }
    part(ctx, beamGeo, postMat, 0, h * 0.95, w / 2);
    part(ctx, beamGeo, postMat, 0, h * 0.95, -w / 2);
    const cross = part(ctx, beamGeo, postMat, 0, h * 0.6, w / 2 + 0.02);
    cross.rotation.z = 0.4;
    // materials staged outside
    box(ctx, 0.35, 0.2, 0.25, lam(WOOD), w * 0.9, 0.1, 0.3);
    part(ctx, new THREE.IcosahedronGeometry(0.16), lam(STONE), w * 0.85, 0.12, -0.35);
    return compactStaticMeshes(group);
  }

  // complete — a soft contact blob grounds the building even where the
  // shadow map goes soft
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 14),
    new THREE.MeshBasicMaterial({
      color: CLAY_PALETTE.ink,
      transparent: true,
      opacity: ART_DIRECTION.material.shadowOpacity,
      depthWrite: false,
    }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  group.add(blob);
  const builder = spec.wonder ? bWonder : (SPECIALS[building.type] ?? archetype(spec));
  builder(ctx);
  return compactStaticMeshes(group);
}
