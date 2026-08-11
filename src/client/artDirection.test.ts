import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ART_DIRECTION,
  BEAUTY_MARKER,
  CLAY_PALETTE,
  clayMaterial,
  effectDensity,
  islandPalette,
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

describe("per-island palette", () => {
  it("ships the scroll-diorama beauty marker", () => {
    expect(BEAUTY_MARKER).toBe("scroll-diorama-v1");
  });

  it("is deterministic per seed and varies between seeds", () => {
    const a = islandPalette(42);
    const b = islandPalette(42);
    expect(a).toEqual(b);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const grasses = new Set(seeds.map((seed) => islandPalette(seed).grass));
    expect(grasses.size).toBeGreaterThan(3);
  });

  it("keeps every island within a small drift of the shared clay palette", () => {
    const base = new THREE.Color(CLAY_PALETTE.grass);
    const baseHsl = { h: 0, s: 0, l: 0 };
    base.getHSL(baseHsl);
    for (const seed of [1, 7, 99, 1234, 987654]) {
      const palette = islandPalette(seed);
      const hsl = { h: 0, s: 0, l: 0 };
      new THREE.Color(palette.grass).getHSL(hsl);
      const drift = Math.min(
        Math.abs(hsl.h - baseHsl.h),
        1 - Math.abs(hsl.h - baseHsl.h),
      );
      expect(drift).toBeLessThan(0.08);
      // the whole island paints from a small set of pots: 4-6 hex families
      expect(palette.canopy).toHaveLength(3);
      expect(palette.bloom).toHaveLength(2);
      for (const hex of [
        palette.grass,
        palette.grassLight,
        ...palette.canopy,
        ...palette.bloom,
        palette.soil,
        palette.rock,
        palette.lagoon,
      ]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("deals each island its own lagoon in the shared turquoise family", () => {
    const base = new THREE.Color(CLAY_PALETTE.oceanShallow);
    const baseHsl = { h: 0, s: 0, l: 0 };
    base.getHSL(baseHsl);
    const lagoons = new Set<string>();
    for (const seed of [1, 7, 99, 1234, 987654]) {
      const lagoon = islandPalette(seed).lagoon;
      lagoons.add(lagoon);
      const hsl = { h: 0, s: 0, l: 0 };
      new THREE.Color(lagoon).getHSL(hsl);
      const drift = Math.min(Math.abs(hsl.h - baseHsl.h), 1 - Math.abs(hsl.h - baseHsl.h));
      expect(drift).toBeLessThan(0.05);
    }
    expect(lagoons.size).toBeGreaterThan(2);
  });
});

