import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CIVS } from "../shared/civs";
import type { Building } from "../shared/types";
import {
  buildingModelSpec,
  buildingRenderSignature,
  createBuildingMesh,
  windowGlowIntensity,
} from "./structures";

const EXISTING: Building[] = [
  { id: "old-home", type: "hut", stage: "complete", progress: 30, pos: { x: 1, y: 1 } },
  { id: "old-store", type: "granary", stage: "complete", progress: 40, pos: { x: 2, y: 2 } },
  { id: "old-hall", type: "elder-lodge", stage: "complete", progress: 45, pos: { x: 3, y: 3 } },
];

describe("age-aware building models", () => {
  it("reselects the current-age model for a mixed set of pre-existing types", () => {
    const before = buildingRenderSignature(EXISTING, "stone");
    const after = buildingRenderSignature(EXISTING, "bronze");
    expect(after).not.toBe(before);

    for (const building of EXISTING) {
      expect(buildingModelSpec(building.type, "stone").age).toBe("stone");
      expect(buildingModelSpec(building.type, "bronze").age).toBe("bronze");
      expect(buildingModelSpec(building.type, "bronze").type).toBe(building.type);
    }

    const stoneHome = createBuildingMesh(EXISTING[0]!, CIVS.roman, "stone");
    const bronzeHome = createBuildingMesh(EXISTING[0]!, CIVS.roman, "bronze");
    expect(stoneHome.userData.modelAge).toBe("stone");
    expect(bronzeHome.userData.modelAge).toBe("bronze");
    expect(new THREE.Box3().setFromObject(bronzeHome).getSize(new THREE.Vector3()).toArray())
      .not.toEqual(new THREE.Box3().setFromObject(stoneHome).getSize(new THREE.Vector3()).toArray());
  });

  it("uses the civilization's current age for buildings created afterward", () => {
    const newBuilding: Building = {
      id: "new-workshop",
      type: "pottery-workshop",
      stage: "complete",
      progress: 50,
      pos: { x: 4, y: 4 },
    };
    const mesh = createBuildingMesh(newBuilding, CIVS.aztec, "bronze");
    expect(mesh.userData.modelAge).toBe("bronze");
    expect(buildingModelSpec(newBuilding.type, "bronze")).toMatchObject({
      type: "pottery-workshop",
      age: "bronze",
    });
  });

  it("keeps windows quiet by day and legible at night", () => {
    expect(windowGlowIntensity(1)).toBeLessThan(0.06);
    expect(windowGlowIntensity(0)).toBeGreaterThan(1);
    expect(windowGlowIntensity(-5)).toBe(windowGlowIntensity(0));
    expect(windowGlowIntensity(5)).toBe(windowGlowIntensity(1));
  });
});
