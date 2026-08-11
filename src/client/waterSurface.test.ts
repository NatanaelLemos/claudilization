import { describe, expect, it } from "vitest";
import { generateIsland } from "../shared/terrain";
import {
  createWaterSurface,
  WATER_SHADER_MARKER,
  waterRenderProfile,
  waterSwellPose,
} from "./waterSurface";

describe("procedural clay water", () => {
  it("uses one bounded mesh, one stamped data texture and a stable live marker", () => {
    const water = createWaterSurface({ reducedMotion: false, mobile: false });
    const triangles = water.mesh.geometry.index!.count / 3;

    expect(water.mesh.name).toBe("procedural-clay-ocean");
    expect(water.mesh.userData.waterShader).toBe(WATER_SHADER_MARKER);
    expect(WATER_SHADER_MARKER).toBe("clay-water-waves-v2");
    // no downloaded assets: the only texture is the CPU-stamped bathymetry
    expect(water.material.map).toBeNull();
    expect(water.material.transparent).toBe(false);
    expect(water.field.texture.image.width).toBe(water.profile.fieldTexels);
    expect(triangles).toBe(water.profile.maxTriangles);
    expect(triangles).toBeLessThanOrEqual(12_800);
  });

  it("stamps island bathymetry through to the shared field deterministically", () => {
    const a = createWaterSurface({ reducedMotion: false, mobile: true });
    const b = createWaterSurface({ reducedMotion: false, mobile: true });
    const terrain = generateIsland(77, 32);
    a.stampIsland(120, 80, 77, terrain);
    b.stampIsland(120, 80, 77, terrain);
    expect(a.field.stamped()).toBe(1);
    // byte compare — a deep-equal diff over megabytes would drown the worker
    expect(Buffer.from(a.field.data()).equals(Buffer.from(b.field.data()))).toBe(true);
    // the stamp actually landed: some texel now holds land
    expect(a.field.data().some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  });

  it("scales the sea to the machine: sheen on desktop, lean field on phones", () => {
    const desktop = waterRenderProfile(false, false);
    const mobile = waterRenderProfile(false, true);
    expect(desktop.sheen).toBe(true);
    expect(desktop.fieldTexels).toBe(2_048);
    expect(mobile.sheen).toBe(false);
    expect(mobile.fieldTexels).toBe(1_024);
    expect(mobile.segments).toBeLessThan(desktop.segments);
  });

  it("throttles mobile animation and freezes completely for reduced motion", () => {
    expect(waterRenderProfile(false, true).animationHz).toBe(20);

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

  it("follows the sky rig's dayness with a clamped uniform", () => {
    const water = createWaterSurface({ reducedMotion: false, mobile: false });
    expect(water.daylight()).toBe(1);
    water.setDaylight(0.4);
    expect(water.daylight()).toBeCloseTo(0.4, 5);
    water.setDaylight(-2);
    expect(water.daylight()).toBe(0);
    water.setDaylight(9);
    expect(water.daylight()).toBe(1);
  });

  it("exposes the shader-identical swell pose that keeps craft on the water", () => {
    const pose = waterSwellPose(31, -17, 4.2);
    const expected =
      -0.08 +
      Math.sin(31 * 0.020 + 4.2 * 0.55) * 0.22 +
      Math.sin(-17 * 0.031 - 4.2 * 0.38) * 0.14 +
      Math.sin((31 - 17) * 0.013 + 4.2 * 0.24) * 0.10;
    expect(pose.height).toBeCloseTo(expected, 8);
    expect(Math.abs(pose.pitch)).toBeLessThan(0.02);
    expect(Math.abs(pose.roll)).toBeLessThan(0.02);
    const shallow = waterSwellPose(31, -17, 4.2, 0);
    expect(Math.abs(shallow.height + 0.08)).toBeLessThan(Math.abs(pose.height + 0.08));
    expect(Math.abs(shallow.pitch)).toBeLessThan(Math.abs(pose.pitch));
  });
});
