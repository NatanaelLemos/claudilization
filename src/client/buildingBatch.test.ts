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
import { createBuildingMesh, isRoofMaterial, roofInstanceTint } from "./structures";

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

  it("paints every block's roof its own shade while sharing one draw call", () => {
    const batch = buildBuildingBatch({
      buildings: buildings.slice(0, 40),
      civ: CIVS.roman,
      age: "renaissance",
      heightAt: () => 0,
      half: 0,
    });
    const roofs = meshes(batch).filter((mesh) => isRoofMaterial(mesh.material));
    expect(roofs.length).toBeGreaterThan(0);
    const roof = roofs[0] as THREE.InstancedMesh;
    expect(roof.isInstancedMesh).toBe(true);
    expect(roof.instanceColor).not.toBeNull();
    const shades = new Set<string>();
    const scratch = new THREE.Color();
    for (let i = 0; i < roof.count; i++) {
      roof.getColorAt(i, scratch);
      shades.add(`${scratch.r.toFixed(3)}|${scratch.g.toFixed(3)}|${scratch.b.toFixed(3)}`);
    }
    expect(shades.size).toBeGreaterThan(roof.count * 0.9);
    disposeBuildingBatch(batch);
  });

  it("keeps the roof tint deterministic and brightness-neutral", () => {
    const a = roofInstanceTint("townhouse-7", 0.02);
    const b = roofInstanceTint("townhouse-7", 0.02);
    expect(a.getHexString()).toBe(b.getHexString());
    expect(roofInstanceTint("townhouse-8", 0.02).getHexString()).not.toBe(a.getHexString());
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      const tint = roofInstanceTint(id, 0.02);
      const luma = tint.r * 0.299 + tint.g * 0.587 + tint.b * 0.114;
      expect(luma).toBeGreaterThan(0.85);
      expect(luma).toBeLessThan(1.2);
      // a tint is a whisper of pigment, never a floodlight: the mint-roof
      // regression multiplied every channel by ~4.7
      expect(Math.max(tint.r, tint.g, tint.b)).toBeLessThan(1.45);
      expect(Math.min(tint.r, tint.g, tint.b)).toBeGreaterThan(0.6);
    }
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
