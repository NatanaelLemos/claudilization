import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import type { CivSpec, Island } from "../shared/types";

const WALK_SPEED = 3; // island units per second

// A settler is a little person assembled from five instanced parts. Geometry
// origins are baked so the figure's root sits at its feet and limbs pivot at
// the hip/shoulder, letting a single matrix per part both place and swing it.
const HIP_Y = 0.6;
const SHOULDER_Y = 1.25;
const LEG_X = 0.12;
const ARM_X = 0.33;
const ARM_TILT = 0.12; // constant outward lean so arms clear the tunic

const legGeo = new THREE.BoxGeometry(0.17, 0.6, 0.17).translate(0, -0.3, 0);
const armGeo = new THREE.BoxGeometry(0.13, 0.55, 0.13).translate(0, -0.275, 0);
const torsoGeo = new THREE.CylinderGeometry(0.24, 0.36, 0.8, 6).translate(0, 0.9, 0);
const headGeo = new THREE.BoxGeometry(0.32, 0.32, 0.3).translate(0, 1.44, 0);
const hairGeo = new THREE.BoxGeometry(0.36, 0.13, 0.34).translate(0, 1.62, 0);

// One shared white material — every part is tinted through instanceColor.
const partMat = new THREE.MeshLambertMaterial({ flatShading: true });

const SKIN_TONES = ["#f0c9a6", "#e3b68c", "#c98f5f", "#a96f43", "#7f5232"];
const HAIR_TONES = ["#241b12", "#4a3320", "#6e4a26", "#8a6a3c", "#3a3a3f", "#8f8578"];
const LEG_TONES = ["#5f4a36", "#4a3d33", "#6b5a44", "#41414a"];

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
}

interface SettlerAnim {
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  phase: number;
  yaw: number;
  blend: number; // 0 = at rest/working, 1 = mid-stride
}

interface ViewState {
  parts: Parts | null;
  settlers: Map<string, SettlerAnim>;
  order: string[];
  heightAt: (x: number, y: number) => number;
  half: number;
  time: number;
}

const views = new Map<THREE.Group, ViewState>();

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

function paintSettlers(view: ViewState, civ: CivSpec): void {
  const parts = view.parts!;
  accent.set(civ.accent);
  view.order.forEach((id, i) => {
    const rand = mulberry32(hashString(`${id}|look`));
    const pick = (tones: string[]) => tones[Math.floor(rand() * tones.length)]!;
    tint.set(pick(SKIN_TONES));
    parts.head.setColorAt(i, tint);
    parts.arms.setColorAt(2 * i, tint);
    parts.arms.setColorAt(2 * i + 1, tint);
    parts.hair.setColorAt(i, tint.set(pick(HAIR_TONES)));
    parts.torso.setColorAt(i, tint.copy(accent).offsetHSL(0, 0, (rand() - 0.5) * 0.14));
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
): void {
  let view = views.get(holder);
  if (!view) {
    view = { parts: null, settlers: new Map(), order: [], heightAt, half, time: 0 };
    views.set(holder, view);
  }

  if (island.settlers.length === 0) {
    disposeParts(holder, view);
    view.settlers.clear();
    view.order = [];
    return;
  }

  if (!view.parts || view.parts.torso.count !== island.settlers.length) {
    disposeParts(holder, view);
    view.parts = buildParts(holder, island.settlers.length);
  }

  const alive = new Set<string>();
  view.order = [];
  for (const s of island.settlers) {
    alive.add(s.id);
    view.order.push(s.id);
    const off = spreadOffset(s.id);
    const targetX = s.pos.x + off.x;
    const targetZ = s.pos.y + off.z;
    const existing = view.settlers.get(s.id);
    if (existing) {
      existing.targetX = targetX;
      existing.targetZ = targetZ;
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
      });
    }
  }
  for (const id of [...view.settlers.keys()]) {
    if (!alive.has(id)) view.settlers.delete(id);
  }

  paintSettlers(view, civ);
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
    if (!parts) continue;
    view.time += dt;
    const t = view.time;
    view.order.forEach((id, i) => {
      const s = view.settlers.get(id);
      if (!s) return;
      const dx = s.targetX - s.x;
      const dz = s.targetZ - s.z;
      const dist = Math.hypot(dx, dz);
      const walking = dist > 0.05;
      if (walking) {
        const step = Math.min(1, (WALK_SPEED * dt) / dist);
        s.x += dx * step;
        s.z += dz * step;
        let turn = Math.atan2(dx, dz) - s.yaw;
        turn = ((((turn + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
        s.yaw += turn * Math.min(1, dt * 10);
      }
      s.blend += ((walking ? 1 : 0) - s.blend) * Math.min(1, dt * 8);
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
      poseLimb(parts.legs, 2 * i, stride * 0.55 * b, 0, -LEG_X, HIP_Y);
      poseLimb(parts.legs, 2 * i + 1, -stride * 0.55 * b, 0, LEG_X, HIP_Y);
      poseLimb(parts.arms, 2 * i, -stride * 0.45 * b + chop, -ARM_TILT, -ARM_X, SHOULDER_Y);
      poseLimb(parts.arms, 2 * i + 1, stride * 0.45 * b + chop, ARM_TILT, ARM_X, SHOULDER_Y);
    });
    for (const mesh of Object.values(parts)) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
