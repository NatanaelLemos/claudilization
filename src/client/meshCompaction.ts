import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Static primitive models are authored as many tiny meshes. Collapse meshes
 * with a shared material into one draw while retaining the model's parent
 * group, transforms, bounds, shadows, and parent-level inspection metadata.
 */
export function compactStaticMeshes(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const inverseRoot = group.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh[]>();
  const candidates: THREE.Mesh[] = [];
  const removedGeometries = new Set<THREE.BufferGeometry>();

  group.traverse((object) => {
    if (object === group || !(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    if (
      Array.isArray(mesh.material) ||
      !(mesh.geometry instanceof THREE.BufferGeometry) ||
      mesh.userData.assetPick ||
      mesh.userData.instanceAssetPicks
    ) return;
    candidates.push(mesh);
    const material = mesh.material;
    // UUID identity is deliberate. A partial visual-property signature can
    // accidentally merge materials that differ through maps, clipping,
    // wireframe state, shader hooks, or a future three.js property.
    const key = [
      material.uuid,
      mesh.castShadow,
      mesh.receiveShadow,
      mesh.renderOrder,
    ].join("|");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(mesh);
    else buckets.set(key, [mesh]);
  });

  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateWorldMatrix(true, false);
      const transform = inverseRoot.clone().multiply(mesh.matrixWorld);
      return mesh.geometry.clone().applyMatrix4(transform);
    });
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;

    const first = meshes[0]!;
    const compacted = new THREE.Mesh(merged, first.material);
    compacted.castShadow = first.castShadow;
    compacted.receiveShadow = first.receiveShadow;
    compacted.renderOrder = first.renderOrder;
    group.add(compacted);
    for (const mesh of meshes) {
      removedGeometries.add(mesh.geometry);
      mesh.parent?.remove(mesh);
    }
  }

  // Authoring primitives replaced by merged buffers must not accumulate each
  // time an island's building batch is rebuilt. Keep any geometry still used
  // by an unmerged mesh, and release only the truly replaced sources.
  const liveGeometries = new Set<THREE.BufferGeometry>();
  group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) liveGeometries.add((object as THREE.Mesh).geometry);
  });
  for (const geometry of removedGeometries) {
    if (!liveGeometries.has(geometry)) geometry.dispose();
  }

  return group;
}
