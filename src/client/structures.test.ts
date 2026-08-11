import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CIVS } from "../shared/civs";
import type { Building } from "../shared/types";
import {
  buildingModelSpec,
  buildingRenderSignature,
  createBuildingMesh,
  isRoofMaterial,
  SHED_LUMA_FLOOR,
  SHED_LUMA_FLOOR_LATE,
  shedRoofColor,
  windowGlowIntensity,
} from "./structures";

/** Display-referred luminance — what the eye reads off the screen, not the
 * linear working value, so a value floor means what it says. */
function displayLuma(color: THREE.Color): number {
  const hex = color.getHexString();
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return channel(0) * 0.299 + channel(2) * 0.587 + channel(4) * 0.114;
}

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

describe("working roofs keep their value", () => {
  it("never lets a skillion fall under the town's midtone floor", () => {
    for (let era = 0; era <= 8; era++) {
      const luma = displayLuma(shedRoofColor(era));
      expect(luma).toBeGreaterThanOrEqual(SHED_LUMA_FLOOR);
      if (era >= 6) expect(luma).toBeGreaterThanOrEqual(SHED_LUMA_FLOOR_LATE);
    }
    // the works brighten with the ages — sawn timber, then alloy sheeting
    expect(displayLuma(shedRoofColor(8))).toBeGreaterThan(displayLuma(shedRoofColor(3)));
    // and the lift is bounded: a shed never bleaches out to a white roof
    expect(displayLuma(shedRoofColor(8))).toBeLessThan(0.8);
  });

  it("dresses every workshop skillion in a tintable roof material", () => {
    const workshop: Building = {
      id: "works-1",
      type: "blacksmith",
      stage: "complete",
      progress: 60,
      pos: { x: 7, y: 7 },
    };
    const mesh = createBuildingMesh(workshop, CIVS.greek, "industrial");
    const shedLuma = displayLuma(shedRoofColor(6));
    let skillion: THREE.Mesh | undefined;
    mesh.traverse((object) => {
      const candidate = object as THREE.Mesh;
      if (!candidate.isMesh || Array.isArray(candidate.material)) return;
      const material = candidate.material as THREE.MeshStandardMaterial;
      if (Math.abs(displayLuma(material.color) - shedLuma) < 0.001) skillion = candidate;
    });
    expect(skillion).toBeDefined();
    // a roof surface, so the instanced batch hands every block its own shade
    expect(isRoofMaterial(skillion!.material)).toBe(true);
  });
});
