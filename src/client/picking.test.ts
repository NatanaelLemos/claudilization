import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { pickOf, setBatchedAssetPicks, setInstanceAssetPicks } from "./picking";

describe("batched and instanced resource picking", () => {
  it("resolves a BatchedMesh raycast to its logical resource", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const batch = new THREE.BatchedMesh(
      2,
      geometry.getAttribute("position").count * 2,
      geometry.index!.count * 2,
      new THREE.MeshLambertMaterial(),
    );
    const geometryId = batch.addGeometry(geometry);
    const nearId = batch.addInstance(geometryId);
    const farId = batch.addInstance(geometryId);
    batch.setMatrixAt(nearId, new THREE.Matrix4());
    batch.setMatrixAt(farId, new THREE.Matrix4().makeTranslation(5, 0, 0));
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    setBatchedAssetPicks(batch, [
      { kind: "resource", islandId: "i1", nodeId: "berries", resource: "food" },
      { kind: "resource", islandId: "i1", nodeId: "fish", resource: "food" },
    ]);

    const hit = new THREE.Raycaster(
      new THREE.Vector3(5, 0, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(batch)[0] as THREE.Intersection & { batchId?: number };
    expect(hit.batchId).toBe(farId);
    expect(pickOf(hit)).toMatchObject({ kind: "resource", nodeId: "fish" });
  });

  it("resolves an InstancedMesh raycast to its logical resource", () => {
    const resources = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      2,
    );
    resources.setMatrixAt(0, new THREE.Matrix4());
    resources.setMatrixAt(1, new THREE.Matrix4().makeTranslation(6, 0, 0));
    resources.instanceMatrix.needsUpdate = true;
    resources.computeBoundingBox();
    resources.computeBoundingSphere();
    setInstanceAssetPicks(resources, [
      { kind: "resource", islandId: "i1", nodeId: "tree", resource: "wood" },
      { kind: "resource", islandId: "i1", nodeId: "ore", resource: "iron" },
    ]);

    const hit = new THREE.Raycaster(
      new THREE.Vector3(6, 0, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(resources)[0];
    expect(hit?.instanceId).toBe(1);
    expect(pickOf(hit ?? null)).toMatchObject({ kind: "resource", nodeId: "ore" });
  });
});

