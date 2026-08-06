import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CIVS } from "../shared/civs";
import type { Building } from "../shared/types";
import {
  applyBuildingShadowDistance,
  buildBuildingBatch,
  buildingPickTargets,
  disposeBuildingBatch,
} from "./buildingBatch";
import { pickOf } from "./picking";
import { createBuildingMesh } from "./structures";

const buildings = Array.from({ length: 600 }, (_, index): Building => ({
  id: `townhouse-${index}`,
  type: "townhouse",
  stage: "complete",
  progress: 100,
  pos: { x: 4 + (index % 30) * 4, y: 4 + Math.floor(index / 30) * 4 },
}));

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && !object.userData.buildingPickProxy) {
      found.push(object as THREE.Mesh);
    }
  });
  return found;
}

describe("instanced building batches", () => {
  it("turns 600 repeated townhouses into one draw per model part", () => {
    const template = createBuildingMesh(buildings[0]!, CIVS.roman, "renaissance");
    const templateMeshes = meshes(template);
    const batch = buildBuildingBatch({
      buildings,
      civ: CIVS.roman,
      age: "renaissance",
      heightAt: () => 0,
      half: 0,
    });
    const batchedMeshes = meshes(batch);
    const legacyMainSubmissions = templateMeshes.length * buildings.length;
    const legacyShadowSubmissions = templateMeshes.filter((mesh) => mesh.castShadow).length * buildings.length;
    const batchShadowSubmissions = batchedMeshes.filter((mesh) => mesh.castShadow).length;

    expect(batchedMeshes).toHaveLength(templateMeshes.length);
    expect(batchedMeshes.every((mesh) => (mesh as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
    expect((batchedMeshes[0]! as THREE.InstancedMesh).count).toBe(600);
    expect(batchedMeshes.length / legacyMainSubmissions).toBeLessThan(0.01);
    expect(batchShadowSubmissions / legacyShadowSubmissions).toBeLessThan(0.01);
  });

  it("uses one invisible hitbox set and removes distant small-building shadows", () => {
    const batch = buildBuildingBatch({
      buildings: buildings.slice(0, 3),
      civ: CIVS.roman,
      age: "renaissance",
      heightAt: () => 0,
      half: 0,
    });
    const [proxy] = buildingPickTargets(batch) as THREE.InstancedMesh[];
    expect(proxy).toBeDefined();
    expect(proxy!.visible).toBe(false);
    expect(pickOf({ object: proxy!, instanceId: 2 })).toEqual({
      kind: "building",
      buildingId: "townhouse-2",
    });

    applyBuildingShadowDistance(batch, 181);
    expect(
      meshes(batch)
        .filter((mesh) => mesh.userData.buildingShadowBatch)
        .every((mesh) => mesh.castShadow === false),
    ).toBe(true);
    applyBuildingShadowDistance(batch, 20);
    expect(
      meshes(batch)
        .filter((mesh) => mesh.userData.buildingShadowBatch)
        .every((mesh) => mesh.castShadow === true),
    ).toBe(true);
  });

  it("disposes generated geometry when a batch is replaced", () => {
    const batch = buildBuildingBatch({
      buildings: buildings.slice(0, 2),
      civ: CIVS.roman,
      age: "renaissance",
      heightAt: () => 0,
      half: 0,
    });
    const geometry = meshes(batch)[0]!.geometry;
    const dispose = vi.spyOn(geometry, "dispose");
    disposeBuildingBatch(batch);
    expect(dispose).toHaveBeenCalledOnce();
    expect(batch.children).toHaveLength(0);
  });
});
