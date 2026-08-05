import * as THREE from "three";
import type { CivSpec, Island } from "../shared/types";

/** Boats sail (and planes fly) in world space — visible crossing the open ocean. */
export function updateBoats(holder: THREE.Group, island: Island, civ: CivSpec): void {
  holder.clear();
  for (const boat of island.boats) {
    if (boat.state === "docked") continue;
    const group = boat.craft === "plane" ? planeMesh(civ) : boatMesh(civ);
    group.position.set(boat.pos.x, boat.craft === "plane" ? 14 : 0, boat.pos.y);
    group.userData.boatId = boat.id;
    group.userData.islandId = island.id;
    group.add(hitBubble());
    holder.add(group);
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

function boatMesh(civ: CivSpec): THREE.Group {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.5, 1),
    new THREE.MeshLambertMaterial({ color: civ.boat.hull }),
  );
  hull.position.y = 0.35;
  group.add(hull);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.6),
    new THREE.MeshLambertMaterial({ color: "#4a3a2a" }),
  );
  mast.position.y = 1.2;
  group.add(mast);
  const sail = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.1),
    new THREE.MeshLambertMaterial({ color: civ.boat.sail, side: THREE.DoubleSide }),
  );
  sail.position.set(0.2, 1.2, 0);
  group.add(sail);
  return group;
}

function planeMesh(civ: CivSpec): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: civ.boat.sail });
  const trim = new THREE.MeshLambertMaterial({ color: civ.boat.hull });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.22, 3.0, 7), body);
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
  return group;
}
