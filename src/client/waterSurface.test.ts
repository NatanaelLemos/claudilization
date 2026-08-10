import { describe, expect, it } from "vitest";
import { createWaterSurface, WATER_SHADER_MARKER, waterRenderProfile } from "./waterSurface";

describe("procedural clay water", () => {
  it("uses one bounded texture-free mesh and a stable live marker", () => {
    const water = createWaterSurface({ reducedMotion: false, mobile: false });
    const triangles = water.mesh.geometry.index!.count / 3;

    expect(water.mesh.name).toBe("procedural-clay-ocean");
    expect(water.mesh.userData.waterShader).toBe(WATER_SHADER_MARKER);
    expect(water.material.map).toBeNull();
    expect(triangles).toBe(water.profile.maxTriangles);
    expect(triangles).toBeLessThanOrEqual(12_800);
  });

  it("throttles mobile animation and freezes completely for reduced motion", () => {
    expect(waterRenderProfile(false, true).animationHz).toBe(20);
    expect(waterRenderProfile(false, true).segments).toBeLessThan(
      waterRenderProfile(false, false).segments,
    );

    const animated = createWaterSurface({ reducedMotion: false, mobile: true });
    animated.tick(0.02);
    expect(animated.animationTime()).toBe(0);
    animated.tick(0.04);
    expect(animated.animationTime()).toBeGreaterThan(0);

    const reduced = createWaterSurface({ reducedMotion: true, mobile: false });
    reduced.tick(10);
    expect(reduced.animationTime()).toBe(0);
    expect(reduced.profile.animationHz).toBe(0);
  });
});
