import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compactStaticMeshes } from "./meshCompaction";

function meshCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

describe("static mesh compaction", () => {
  it("merges equivalent materials without changing world bounds", () => {
    const group = new THREE.Group();
    group.scale.setScalar(1.9);
    group.rotation.y = 0.2;
    const material = new THREE.MeshLambertMaterial({ color: "#cc3377" });
    const other = new THREE.MeshLambertMaterial({ color: "#446688" });
    for (const [x, mat] of [[-2, material], [0, material], [2, other]] as const) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.position.x = x;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const before = new THREE.Box3().setFromObject(group);

    compactStaticMeshes(group);

    expect(meshCount(group)).toBe(2);
    expect(new THREE.Box3().setFromObject(group).min.toArray()).toEqual(before.min.toArray());
    expect(new THREE.Box3().setFromObject(group).max.toArray()).toEqual(before.max.toArray());
  });

  it("does not merge meshes with different shadow behavior", () => {
    const group = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color: "white" });
    const caster = new THREE.Mesh(new THREE.BoxGeometry(), material);
    caster.castShadow = true;
    const decoration = new THREE.Mesh(new THREE.BoxGeometry(), material);
    decoration.castShadow = false;
    group.add(caster, decoration);

    compactStaticMeshes(group);

    expect(meshCount(group)).toBe(2);
  });

  it("does not merge distinct materials that merely look alike", () => {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ color: "white" })),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ color: "white" })),
    );

    compactStaticMeshes(group);

    expect(meshCount(group)).toBe(2);
  });
});

