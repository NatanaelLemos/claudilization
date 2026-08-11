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
import {
  createBuildingMesh,
  isRoofMaterial,
  isWallMaterial,
  roofInstanceTint,
  wallInstanceTint,
} from "./structures";

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

  it("paints late-age parapets per block too — no single dark cap mass", () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({
      id: `row-${i}`,
      type: "house",
      stage: "complete" as const,
      progress: 100,
      pos: { x: 10 + i * 3, y: 12 },
    }));
    const batch = buildBuildingBatch({
      buildings: blocks,
      civ: CIVS.roman,
      age: "industrial",
      heightAt: () => 0,
      half: 0,
    });
    // the industrial rowhouse has no pitched roof at all: its flat parapet is
    // the roofline, so it must be a tinted roof surface or the whole street
    // reads as one dark cap
    const roofs = meshes(batch).filter((mesh) => isRoofMaterial(mesh.material));
    expect(roofs.length).toBeGreaterThan(0);
    const shades = new Set<string>();
    const scratch = new THREE.Color();
    for (const mesh of roofs) {
      const inst = mesh as THREE.InstancedMesh;
      expect(inst.instanceColor).not.toBeNull();
      for (let i = 0; i < inst.count; i++) {
        inst.getColorAt(i, scratch);
        shades.add(scratch.getHexString());
      }
    }
    expect(shades.size).toBeGreaterThan(blocks.length * 0.9);
    disposeBuildingBatch(batch);
  });

  it("varies every block's walls under a tighter cap than the roofs", () => {
    const batch = buildBuildingBatch({
      buildings: buildings.slice(0, 40),
      civ: CIVS.roman,
      age: "renaissance",
      heightAt: () => 0,
      half: 0,
    });
    const walls = meshes(batch).filter((mesh) => isWallMaterial(mesh.material));
    expect(walls.length).toBeGreaterThan(0);
    const wall = walls[0] as THREE.InstancedMesh;
    expect(wall.instanceColor).not.toBeNull();
    // hex strings clamp at 1.0 and would hide real variation above it, so
    // uniqueness is measured on the raw linear multiplier
    const shades = new Set<string>();
    const scratch = new THREE.Color();
    for (let i = 0; i < wall.count; i++) {
      wall.getColorAt(i, scratch);
      shades.add(`${scratch.r.toFixed(3)}|${scratch.g.toFixed(3)}|${scratch.b.toFixed(3)}`);
    }
    expect(shades.size).toBeGreaterThan(wall.count * 0.9);
    disposeBuildingBatch(batch);
    // a wall is a settler's whole horizon: its swing stays under the roof's
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const tint = wallInstanceTint(id, 0.08);
      const roofTint = roofInstanceTint(id, 0.08);
      const luma = tint.r * 0.299 + tint.g * 0.587 + tint.b * 0.114;
      expect(luma).toBeGreaterThan(0.82);
      expect(luma).toBeLessThan(1.12);
      // the wall ceiling is hard, and tighter than the roofline's 1.45
      expect(Math.max(tint.r, tint.g, tint.b)).toBeLessThanOrEqual(1.22);
      // and the pigment stays quieter than a roof's: no neon stucco
      const spread = (c: THREE.Color) =>
        Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      expect(spread(tint)).toBeLessThan(spread(roofTint) + 1e-6);
      const repeat = wallInstanceTint(id, 0.08);
      expect(repeat.r).toBeCloseTo(tint.r, 6);
      expect(repeat.g).toBeCloseTo(tint.g, 6);
      expect(repeat.b).toBeCloseTo(tint.b, 6);
      // walls never wear the roof's shade on the same block
      expect(tint.getHexString()).not.toBe(roofTint.getHexString());
    }
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
