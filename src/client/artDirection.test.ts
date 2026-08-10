import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ART_DIRECTION,
  CLAY_PALETTE,
  clayMaterial,
  effectDensity,
  settlerRole,
} from "./artDirection";

describe("miniature clay art direction", () => {
  it("is a single stable marker with matte material rules", () => {
    expect(ART_DIRECTION.id).toBe("miniature-clay-v1");
    const material = clayMaterial({ color: CLAY_PALETTE.clay });
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.roughness).toBeGreaterThanOrEqual(0.9);
    expect(material.metalness).toBeLessThan(0.05);
    expect(material.userData.artMaterial).toBe("soft-matte-clay");
  });

  it("derives readable roles from authoritative settler work", () => {
    expect(settlerRole({ kind: "idle" })).toBe("villager");
    expect(settlerRole({ kind: "gather", resource: "food", nodeId: "n" })).toBe("farmer");
    expect(settlerRole({ kind: "gather", resource: "stone", nodeId: "n" })).toBe("mason");
    expect(settlerRole({ kind: "build", buildingId: "b" })).toBe("builder");
    expect(settlerRole({ kind: "sail", boatId: "boat" })).toBe("sailor");
  });

  it("bounds mobile effects and removes ambient motion for reduced motion", () => {
    expect(effectDensity(false, false)).toBe(1);
    expect(effectDensity(false, true)).toBeLessThan(1);
    expect(effectDensity(true, false)).toBe(0);
  });
});

