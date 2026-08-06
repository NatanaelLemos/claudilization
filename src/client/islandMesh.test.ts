import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createIslandGroup, terrainLodSegments } from "./islandMesh";

describe("terrain level of detail", () => {
  it("keeps the full 166-cell island while reducing distant triangles by about 16x", () => {
    const segments = terrainLodSegments(166);
    const fullTriangles = (166 - 1) ** 2 * 2;
    const distantTriangles = segments ** 2 * 2;
    expect(segments).toBe(42);
    expect(distantTriangles).toBeLessThan(fullTriangles / 15);
  });

  it("retains a useful minimum grid for small islands", () => {
    expect(terrainLodSegments(24)).toBe(16);
  });

  it("keeps resource batch metadata and world bounds aligned", () => {
    const island = createIslandGroup(42, 166, "island-42");
    const roots = island.userData.assetRoots as THREE.Object3D[];
    const batched: THREE.BatchedMesh[] = [];
    const instanced: THREE.InstancedMesh[] = [];
    for (const root of roots) {
      root.traverse((object) => {
        if ((object as THREE.BatchedMesh).isBatchedMesh) batched.push(object as THREE.BatchedMesh);
        else if ((object as THREE.InstancedMesh).isInstancedMesh) {
          instanced.push(object as THREE.InstancedMesh);
        }
      });
    }

    expect(batched.length).toBeGreaterThan(0);
    expect(instanced.length).toBeGreaterThan(0);
    for (const mesh of batched) {
      const picks = mesh.userData.batchedAssetPicks?.picks as unknown[];
      expect(picks.filter(Boolean).length).toBeGreaterThan(0);
      expect(mesh.boundingBox?.isEmpty()).toBe(false);
      expect(mesh.boundingSphere?.isEmpty()).toBe(false);
    }
    for (const mesh of instanced) {
      const picks = mesh.userData.instanceAssetPicks?.picks as unknown[];
      expect(picks).toHaveLength(mesh.count);
      expect(mesh.boundingBox?.isEmpty()).toBe(false);
      expect(mesh.boundingSphere?.isEmpty()).toBe(false);
    }
  });
});

