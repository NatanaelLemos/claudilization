import { describe, expect, it } from "vitest";
import { generateIsland } from "../shared/terrain";
import {
  createWaterDepthField,
  WATER_FIELD_LAND_MAX,
  WATER_FIELD_SPAN,
} from "./waterDepthField";

/** a tiny synthetic island: a single peak in the middle, sea all around */
function peakTerrain(size: number, peak: number) {
  const tiles: { height: number }[] = [];
  const mid = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - mid, y - mid) / mid;
      tiles.push({ height: Math.max(0, peak * (1 - r)) });
    }
  }
  return { size, tiles };
}

function texelAt(field: ReturnType<typeof createWaterDepthField>, wx: number, wz: number) {
  const t = field.texels;
  const ix = Math.floor(((wx + WATER_FIELD_SPAN / 2) / WATER_FIELD_SPAN) * t);
  const iz = Math.floor(((wz + WATER_FIELD_SPAN / 2) / WATER_FIELD_SPAN) * t);
  const at = (iz * t + ix) * 4;
  const d = field.data();
  return { r: d[at]!, g: d[at + 1]!, b: d[at + 2]!, a: d[at + 3]! };
}

describe("water bathymetry field", () => {
  it("stamps real terrain heights and lagoon tint into the island's footprint", () => {
    const field = createWaterDepthField(512);
    const versionBefore = field.texture.version;
    const terrain = peakTerrain(41, WATER_FIELD_LAND_MAX);
    field.stampIsland(300, -200, terrain, { r: 0.25, g: 0.6, b: 0.55 });

    expect(field.stamped()).toBe(1);
    // needsUpdate is a write-only setter in three; it bumps version
    expect(field.texture.version).toBeGreaterThan(versionBefore);
    // the peak encodes near full alpha; the open sea far away stays zero
    const centre = texelAt(field, 300, -200);
    expect(centre.a).toBeGreaterThan(200);
    expect(centre.g).toBe(Math.round(0.6 * 255));
    expect(texelAt(field, -1_000, 1_000).a).toBe(0);
    expect(texelAt(field, -1_000, 1_000).g).toBe(0);
    // the island's water ring still carries the lagoon tint for filtering
    const ring = texelAt(field, 300 + 19, -200);
    expect(ring.a).toBeLessThan(centre.a);
    expect(ring.g).toBe(Math.round(0.6 * 255));
  });

  it("is deterministic and safe at the field's edge", () => {
    const a = createWaterDepthField(256);
    const b = createWaterDepthField(256);
    const terrain = generateIsland(1234, 32);
    const tint = { r: 0.3, g: 0.55, b: 0.5 };
    // an island hanging over the field boundary must clamp, not throw
    a.stampIsland(WATER_FIELD_SPAN / 2 - 4, 0, terrain, tint);
    a.stampIsland(0, 0, terrain, tint);
    b.stampIsland(WATER_FIELD_SPAN / 2 - 4, 0, terrain, tint);
    b.stampIsland(0, 0, terrain, tint);
    expect(Buffer.from(a.data()).equals(Buffer.from(b.data()))).toBe(true);
    expect(a.stamped()).toBe(2);
  });

  it("keeps the waterline inside the encoded range", () => {
    // sea level 0.2 must land inside 0..LAND_MAX with headroom for beaches
    expect(WATER_FIELD_LAND_MAX).toBeGreaterThan(0.2);
    expect(0.2 / WATER_FIELD_LAND_MAX).toBeCloseTo(0.8, 5);
  });
});
