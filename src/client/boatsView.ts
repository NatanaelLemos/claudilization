import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import type { CivSpec, Island } from "../shared/types";
import { CLAY_PALETTE, clayMaterial } from "./artDirection";

/**
 * Boats sail (and planes fly) in world space — visible crossing the open
 * ocean. Server pulses land once a second, so each craft keeps a persistent
 * mesh that glides toward its latest reported position, turns its bow into
 * the direction of travel, bobs on the swell, and drags a foam wake — instead
 * of teleporting a fresh mesh every pulse.
 */

const GLIDE = 5; // world units per second toward the server position (scaled up with distance)
const PLANE_ALT = 14;

interface CraftAnim {
  group: THREE.Group;
  wake: THREE.Mesh | null;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  yaw: number;
  /** smoothed speed, world units/s — drives the wake and the bow wave */
  speed: number;
  phase: number;
  plane: boolean;
}

interface ViewState {
  crafts: Map<string, CraftAnim>;
  time: number;
}

const views = new Map<THREE.Group, ViewState>();

export function updateBoats(holder: THREE.Group, island: Island, civ: CivSpec): void {
  let view = views.get(holder);
  if (!view) {
    view = { crafts: new Map(), time: 0 };
    views.set(holder, view);
  }
  const alive = new Set<string>();
  for (const boat of island.boats) {
    if (boat.state === "docked") continue;
    alive.add(boat.id);
    const existing = view.crafts.get(boat.id);
    if (existing) {
      existing.targetX = boat.pos.x;
      existing.targetZ = boat.pos.y;
      continue;
    }
    const plane = boat.craft === "plane";
    const group = plane ? planeMesh(civ) : boatMesh(civ);
    group.position.set(boat.pos.x, plane ? PLANE_ALT : 0, boat.pos.y);
    group.userData.boatId = boat.id;
    group.userData.islandId = island.id;
    group.add(hitBubble());
    let wake: THREE.Mesh | null = null;
    if (!plane) {
      wake = wakeMesh();
      group.add(wake);
    }
    holder.add(group);
    view.crafts.set(boat.id, {
      group,
      wake,
      x: boat.pos.x,
      z: boat.pos.y,
      targetX: boat.pos.x,
      targetZ: boat.pos.y,
      yaw: mulberry32(hashString(boat.id))() * Math.PI * 2,
      speed: 0,
      phase: hashString(boat.id) % 13,
      plane,
    });
  }
  for (const [id, anim] of [...view.crafts]) {
    if (alive.has(id)) continue;
    holder.remove(anim.group);
    view.crafts.delete(id);
  }
}

/** Advance every craft one frame: glide, steer, bob, and trail foam. */
export function tickBoats(dt: number): void {
  for (const view of views.values()) {
    view.time += dt;
    const t = view.time;
    for (const anim of view.crafts.values()) {
      const dx = anim.targetX - anim.x;
      const dz = anim.targetZ - anim.z;
      const dist = Math.hypot(dx, dz);
      let moved = 0;
      if (dist > 0.02) {
        const pace = GLIDE * Math.max(1, dist * 0.45) * (anim.plane ? 3 : 1);
        const step = Math.min(1, (pace * dt) / dist);
        anim.x += dx * step;
        anim.z += dz * step;
        moved = dist * step;
        const heading = Math.atan2(dx, dz);
        let turn = heading - anim.yaw;
        turn = ((((turn + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
        anim.yaw += turn * Math.min(1, dt * 4);
      }
      anim.speed += (moved / Math.max(dt, 1e-4) - anim.speed) * Math.min(1, dt * 3);
      const g = anim.group;
      // meshes are authored bow toward +x; heading is atan2(dx, dz) around y
      g.rotation.y = anim.yaw - Math.PI / 2;
      if (anim.plane) {
        g.position.set(anim.x, PLANE_ALT + Math.sin(t * 1.3 + anim.phase) * 0.5, anim.z);
        g.rotation.z = Math.sin(t * 0.9 + anim.phase) * 0.06;
      } else {
        g.position.set(anim.x, Math.sin(t * 1.7 + anim.phase) * 0.1, anim.z);
        g.rotation.z = Math.sin(t * 1.4 + anim.phase) * 0.045;
        g.rotation.x = Math.sin(t * 1.1 + anim.phase) * 0.03;
        if (anim.wake) {
          const strength = Math.min(1, anim.speed / 6);
          const mat = anim.wake.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.38 * strength;
          anim.wake.scale.set(1 + strength * 1.6, 1, 1 + strength * 0.3);
          anim.wake.visible = strength > 0.04;
        }
      }
    }
  }
}

/** a craft is a sliver on the open sea — this unseen sphere is what the
 * raycaster actually catches, so a click doesn't demand pixel aim */
function hitBubble(): THREE.Mesh {
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(4, 8, 6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  bubble.position.y = 1;
  return bubble;
}

const wakeGeo = new THREE.PlaneGeometry(3.4, 1.4).translate(-2.6, 0, 0);

/** foam trailing off the stern, stretched and faded by the craft's pace */
function wakeMesh(): THREE.Mesh {
  const wake = new THREE.Mesh(
    wakeGeo,
    new THREE.MeshBasicMaterial({
      color: "#dff2f7",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.y = 0.06;
  return wake;
}

export function boatMesh(civ: CivSpec): THREE.Group {
  const group = new THREE.Group();
  group.userData.artFamily = "clay-craft";
  const hull = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.68, 2.45, 8),
    clayMaterial({ color: civ.boat.hull }),
  );
  hull.rotation.z = Math.PI / 2;
  hull.scale.z = 0.72;
  hull.position.y = 0.42;
  group.add(hull);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.07, 1.7, 7),
    clayMaterial({ color: CLAY_PALETTE.woodDark }),
  );
  mast.position.y = 1.2;
  group.add(mast);
  const sail = new THREE.Mesh(
    new THREE.CircleGeometry(0.82, 8, -Math.PI / 2, Math.PI),
    clayMaterial({ color: civ.boat.sail, side: THREE.DoubleSide }),
  );
  sail.scale.set(0.85, 1.2, 1);
  sail.position.set(0.15, 1.22, 0);
  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.42),
    clayMaterial({ color: CLAY_PALETTE.wood }),
  );
  cargo.position.set(-0.72, 0.8, 0);
  cargo.rotation.y = 0.18;
  group.add(sail, cargo);
  group.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return group;
}

export function planeMesh(civ: CivSpec): THREE.Group {
  const group = new THREE.Group();
  group.userData.artFamily = "clay-craft";
  const body = clayMaterial({ color: civ.boat.sail });
  const trim = clayMaterial({ color: civ.boat.hull });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 3.0, 9), body);
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), trim);
  nose.position.x = 1.5;
  group.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 3.6), body);
  wing.position.x = 0.2;
  group.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.08), trim);
  tail.position.set(-1.4, 0.35, 0);
  group.add(tail);
  group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) object.castShadow = true;
  });
  return group;
}
