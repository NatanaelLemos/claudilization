import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import type { CivSpec, Island, Settler } from "../shared/types";
import {
  ART_DIRECTION,
  CLAY_PALETTE,
  ROLE_ACCENTS,
  clayMaterial,
  settlerRole,
  type SettlerRole,
} from "./artDirection";

const WALK_SPEED = 3; // island units per second

// A settler is a little clay person assembled from instanced parts. Geometry
// origins are baked so the figure's root sits at its feet and limbs pivot at
// the hip/shoulder, letting a single matrix per part both place and swing it.
const HIP_Y = 0.6;
const SHOULDER_Y = 1.25;
const LEG_X = 0.12;
const ARM_X = 0.33;
const ARM_TILT = 0.12; // constant outward lean so arms clear the tunic

const legGeo = new THREE.CylinderGeometry(0.085, 0.105, 0.58, 8).translate(0, -0.3, 0);
const armGeo = new THREE.CylinderGeometry(0.07, 0.082, 0.54, 8).translate(0, -0.275, 0);
const torsoGeo = new THREE.CylinderGeometry(0.25, 0.37, 0.82, 8).translate(0, 0.91, 0);
const headGeo = new THREE.SphereGeometry(0.23 * ART_DIRECTION.sprites.headScale, 8, 6).translate(
  0,
  1.46,
  0,
);
const hairGeo = new THREE.SphereGeometry(0.285, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(
  0,
  1.51,
  0,
);
const roleGeo = new THREE.CylinderGeometry(0.31, 0.35, 0.1, 8);
const toolGeo = new THREE.CylinderGeometry(0.032, 0.04, 0.6, 6).translate(0, -0.3, 0);

// One shared white material — every part is tinted through instanceColor.
const partMat = clayMaterial({ color: "#ffffff" });
const toolMat = clayMaterial({ color: CLAY_PALETTE.woodDark });

const SKIN_TONES = ["#f0c9a6", "#e3b68c", "#c98f5f", "#a96f43", "#7f5232"];
const HAIR_TONES = ["#241b12", "#4a3320", "#6e4a26", "#8a6a3c", "#3a3a3f", "#8f8578"];
const LEG_TONES = ["#5f4a36", "#4a3d33", "#6b5a44", "#41414a"];

/** The little-person kit, shared with the ambient strollers so the town's
 * background life is built from exactly the same figures as its workers. */
export const PERSON = {
  legGeo,
  armGeo,
  torsoGeo,
  headGeo,
  hairGeo,
  mat: partMat,
  HIP_Y,
  SHOULDER_Y,
  LEG_X,
  ARM_X,
  ARM_TILT,
  SKIN_TONES,
  HAIR_TONES,
  LEG_TONES,
} as const;

/**
 * Deterministic per-settler offset around a shared target, so a crew sent to
 * one node spreads out instead of stacking into a single dot.
 */
export function spreadOffset(id: string): { x: number; z: number } {
  const rand = mulberry32(hashString(id));
  const angle = rand() * Math.PI * 2;
  const radius = 0.6 + rand() * 1.4;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

interface Parts {
  torso: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  hair: THREE.InstancedMesh;
  arms: THREE.InstancedMesh; // two instances per settler
  legs: THREE.InstancedMesh; // two instances per settler
  roles: THREE.InstancedMesh; // hat/band silhouette, colored by authoritative role
  tools: THREE.InstancedMesh; // tiny work prop; hidden by scale for idle villagers
}

interface SettlerAnim {
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  phase: number;
  yaw: number;
  blend: number; // 0 = at rest/working, 1 = mid-stride
  role: SettlerRole;
}

interface ViewState {
  parts: Parts | null;
  settlers: Map<string, SettlerAnim>;
  order: string[];
  heightAt: (x: number, y: number) => number;
  half: number;
  time: number;
  accumulator: number;
  population: number;
  active: boolean;
}

const views = new Map<THREE.Group, ViewState>();

export const MAX_VISIBLE_SETTLERS = 1_024;
const DENSE_POPULATION = 256;

export function crowdUpdateHz(population: number): 15 | 30 {
  return population > DENSE_POPULATION ? 15 : 30;
}

/** Stable representatives keep huge civilizations bounded without flicker. */
export function sampledSettlers<T extends { id: string }>(settlers: T[], cap = MAX_VISIBLE_SETTLERS): T[] {
  if (settlers.length <= cap) return settlers;
  return [...settlers]
    .sort((a, b) => hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id))
    .slice(0, cap);
}

function buildParts(holder: THREE.Group, count: number): Parts {
  const make = (geo: THREE.BufferGeometry, n: number) => {
    const mesh = new THREE.InstancedMesh(geo, partMat, n);
    // instances scatter across the island, so per-mesh sphere culling misfires
    mesh.frustumCulled = false;
    holder.add(mesh);
    return mesh;
  };
  return {
    torso: make(torsoGeo, count),
    head: make(headGeo, count),
    hair: make(hairGeo, count),
    arms: make(armGeo, count * 2),
    legs: make(legGeo, count * 2),
    roles: make(roleGeo, count),
    tools: (() => {
      const mesh = new THREE.InstancedMesh(toolGeo, toolMat, count);
      mesh.frustumCulled = false;
      mesh.name = "clay-character-tools";
      holder.add(mesh);
      return mesh;
    })(),
  };
}

function disposeParts(holder: THREE.Group, view: ViewState): void {
  if (view.parts) {
    for (const mesh of Object.values(view.parts)) mesh.dispose();
  }
  holder.clear();
  view.parts = null;
}

const tint = new THREE.Color();
const accent = new THREE.Color();

function paintSettlers(view: ViewState, civ: CivSpec, settlers: Settler[]): void {
  const parts = view.parts!;
  accent.set(civ.accent);
  settlers.forEach((settler, i) => {
    const id = settler.id;
    const rand = mulberry32(hashString(`${id}|look`));
    const pick = (tones: string[]) => tones[Math.floor(rand() * tones.length)]!;
    tint.set(pick(SKIN_TONES));
    parts.head.setColorAt(i, tint);
    parts.arms.setColorAt(2 * i, tint);
    parts.arms.setColorAt(2 * i + 1, tint);
    parts.hair.setColorAt(i, tint.set(pick(HAIR_TONES)));
    parts.torso.setColorAt(i, tint.copy(accent).offsetHSL(0, 0, (rand() - 0.5) * 0.14));
    parts.roles.setColorAt(i, tint.set(ROLE_ACCENTS[settlerRole(settler.task)]));
    tint.set(pick(LEG_TONES));
    parts.legs.setColorAt(2 * i, tint);
    parts.legs.setColorAt(2 * i + 1, tint);
  });
  for (const mesh of Object.values(parts)) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** The island's people — walking, working little figures in the civ's colors. */
export function updateSettlers(
  holder: THREE.Group,
  island: Island,
  civ: CivSpec,
  heightAt: (x: number, y: number) => number,
  half: number,
  active = true,
): void {
  let view = views.get(holder);
  if (!view) {
    view = {
      parts: null,
      settlers: new Map(),
      order: [],
      heightAt,
      half,
      time: 0,
      accumulator: 0,
      population: 0,
      active,
    };
    views.set(holder, view);
  }

  view.active = active;
  view.population = island.settlers.length;

  if (island.settlers.length === 0) {
    disposeParts(holder, view);
    view.settlers.clear();
    view.order = [];
    return;
  }

  const visibleSettlers = sampledSettlers(island.settlers);
  if (!view.parts || view.parts.torso.count !== visibleSettlers.length) {
    disposeParts(holder, view);
    view.parts = buildParts(holder, visibleSettlers.length);
  }

  const alive = new Set<string>();
  view.order = [];
  for (const s of visibleSettlers) {
    alive.add(s.id);
    view.order.push(s.id);
    const off = spreadOffset(s.id);
    const targetX = s.pos.x + off.x;
    const targetZ = s.pos.y + off.z;
    const existing = view.settlers.get(s.id);
    if (existing) {
      existing.targetX = targetX;
      existing.targetZ = targetZ;
      existing.role = settlerRole(s.task);
    } else {
      // newcomers appear where they stand — no ghost walks across the island
      const rand = mulberry32(hashString(`${s.id}|phase`));
      view.settlers.set(s.id, {
        x: targetX,
        z: targetZ,
        targetX,
        targetZ,
        phase: rand() * Math.PI * 2,
        yaw: rand() * Math.PI * 2,
        blend: 0,
        role: settlerRole(s.task),
      });
    }
  }
  for (const id of [...view.settlers.keys()]) {
    if (!alive.has(id)) view.settlers.delete(id);
  }

  paintSettlers(view, civ, visibleSettlers);
}

export function setSettlerViewActive(holder: THREE.Group, active: boolean): void {
  const view = views.get(holder);
  if (!view) return;
  view.active = active;
  view.accumulator = 0;
}

const rootM = new THREE.Matrix4();
const localM = new THREE.Matrix4();
const partM = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const identityQ = new THREE.Quaternion();
const accessoryPosition = new THREE.Vector3();
const accessoryScale = new THREE.Vector3();

const ROLE_SHAPE: Record<SettlerRole, { width: number; height: number; tool: number }> = {
  villager: { width: 0.72, height: 0.55, tool: 0.001 },
  farmer: { width: 1.2, height: 0.42, tool: 1.15 },
  forager: { width: 0.82, height: 0.9, tool: 0.72 },
  mason: { width: 0.92, height: 0.72, tool: 0.92 },
  builder: { width: 1.0, height: 0.62, tool: 1 },
  sailor: { width: 0.78, height: 1.05, tool: 1.25 },
};

function poseLimb(
  mesh: THREE.InstancedMesh,
  index: number,
  swing: number,
  tilt: number,
  px: number,
  py: number,
): void {
  euler.set(swing, 0, tilt);
  localM.makeRotationFromEuler(euler).setPosition(px, py, 0);
  partM.multiplyMatrices(rootM, localM);
  mesh.setMatrixAt(index, partM);
}

/** Advance every island's settlers one frame: stride toward tasks, chop at work. */
export function tickSettlers(dt: number): void {
  for (const view of views.values()) {
    const parts = view.parts;
    if (!parts || !view.active) continue;
    view.accumulator += dt;
    const interval = 1 / crowdUpdateHz(view.population);
    if (view.accumulator < interval) continue;
    const tickDt = Math.min(0.25, view.accumulator);
    view.accumulator %= interval;
    view.time += tickDt;
    const t = view.time;
    view.order.forEach((id, i) => {
      const s = view.settlers.get(id);
      if (!s) return;
      const dx = s.targetX - s.x;
      const dz = s.targetZ - s.z;
      const dist = Math.hypot(dx, dz);
      const walking = dist > 0.05;
      if (walking) {
        const step = Math.min(1, (WALK_SPEED * tickDt) / dist);
        s.x += dx * step;
        s.z += dz * step;
        let turn = Math.atan2(dx, dz) - s.yaw;
        turn = ((((turn + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
        s.yaw += turn * Math.min(1, tickDt * 10);
      }
      s.blend += ((walking ? 1 : 0) - s.blend) * Math.min(1, tickDt * 8);
      const b = s.blend;

      // mid-stride the limbs counter-swing; at rest both arms keep a steady
      // work-chop going, with a gentle bob in either state
      const stride = Math.sin(t * 9 + s.phase);
      const chop = (-0.45 + Math.sin(t * 5 + s.phase) * 0.35) * (1 - b);
      const bob =
        Math.abs(stride) * 0.05 * b + (Math.sin(t * 4 + s.phase) + 1) * 0.03 * (1 - b);

      const ground = Math.max(0.1, view.heightAt(s.x, s.z));
      quat.setFromAxisAngle(Y_AXIS, s.yaw);
      rootM
        .makeRotationFromQuaternion(quat)
        .setPosition(s.x - view.half, ground + bob, s.z - view.half);

      parts.torso.setMatrixAt(i, rootM);
      parts.head.setMatrixAt(i, rootM);
      parts.hair.setMatrixAt(i, rootM);
      const roleShape = ROLE_SHAPE[s.role];
      localM.compose(
        accessoryPosition.set(0, 1.72, 0),
        identityQ,
        accessoryScale.set(roleShape.width, roleShape.height, roleShape.width),
      );
      parts.roles.setMatrixAt(i, partM.multiplyMatrices(rootM, localM));
      poseLimb(parts.legs, 2 * i, stride * 0.55 * b, 0, -LEG_X, HIP_Y);
      poseLimb(parts.legs, 2 * i + 1, -stride * 0.55 * b, 0, LEG_X, HIP_Y);
      poseLimb(parts.arms, 2 * i, -stride * 0.45 * b + chop, -ARM_TILT, -ARM_X, SHOULDER_Y);
      poseLimb(parts.arms, 2 * i + 1, stride * 0.45 * b + chop, ARM_TILT, ARM_X, SHOULDER_Y);
      euler.set(stride * 0.25 * b + chop, 0, ARM_TILT);
      localM.compose(
        accessoryPosition.set(ARM_X + 0.08, SHOULDER_Y - 0.05, 0),
        quat.setFromEuler(euler),
        accessoryScale.set(roleShape.tool, roleShape.tool, roleShape.tool),
      );
      parts.tools.setMatrixAt(i, partM.multiplyMatrices(rootM, localM));
    });
    for (const mesh of Object.values(parts)) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
