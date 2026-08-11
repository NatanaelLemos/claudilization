import * as THREE from "three";

/**
 * A world-space bathymetry texture for the one ocean plane. Each island that
 * finishes building stamps its real underwater terrain — the same heights the
 * game reasons about — into this field, so the water shader can bank from a
 * lagoon turquoise at the beach down to the deep sea, hug the actual coastline
 * with foam, and tint every island's shallows from that island's own palette.
 *
 * Encoding, one RGBA8 texel per ~2.5 world units (desktop):
 *   rgb — the island's lagoon tint (linear-light), painted over the island's
 *         whole footprint so bilinear filtering never bleeds to black
 *     a — terrain height, `clamp(h / LAND_MAX, 0, 1)`; 0 everywhere no island
 *         has stamped, which the shader reads as open deep sea
 *
 * Stamps are visual-only and deterministic: they re-read the island's already
 * generated terrain, never touching any RNG stream or sim state.
 */

/** heights are encoded 0..LAND_MAX; the waterline (0.2) lands at alpha 0.8 */
export const WATER_FIELD_LAND_MAX = 0.25;
/** world units covered, centred on the origin — the whole ocean plane */
export const WATER_FIELD_SPAN = 5_200;

export interface StampableTerrain {
  size: number;
  tiles: { height: number }[];
}

export interface WaterDepthField {
  texture: THREE.DataTexture;
  texels: number;
  span: number;
  /** paint one island's bathymetry + lagoon tint into the field */
  stampIsland(
    centerX: number,
    centerZ: number,
    terrain: StampableTerrain,
    tint: { r: number; g: number; b: number },
  ): void;
  /** how many islands have stamped — tooling and tests */
  stamped(): number;
  /** raw field bytes, for tests only */
  data(): Uint8Array;
}

export function createWaterDepthField(texels: number): WaterDepthField {
  const data = new Uint8Array(texels * texels * 4);
  const texture = new THREE.DataTexture(data, texels, texels, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  let stampedCount = 0;

  /** clamped bilinear read of the island's tile heights at continuous coords */
  const heightAt = (terrain: StampableTerrain, tx: number, ty: number): number => {
    const max = terrain.size - 1;
    const cx = Math.min(max, Math.max(0, tx));
    const cy = Math.min(max, Math.max(0, ty));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(max, x0 + 1);
    const y1 = Math.min(max, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const h = (x: number, y: number) => terrain.tiles[y * terrain.size + x]?.height ?? 0;
    const top = h(x0, y0) * (1 - fx) + h(x1, y0) * fx;
    const bottom = h(x0, y1) * (1 - fx) + h(x1, y1) * fx;
    return top * (1 - fy) + bottom * fy;
  };

  return {
    texture,
    texels,
    span: WATER_FIELD_SPAN,
    stampIsland(centerX, centerZ, terrain, tint) {
      const unitsPerTexel = WATER_FIELD_SPAN / texels;
      const half = terrain.size / 2;
      // two extra texels of margin keep bilinear tint lookups on-island
      const margin = 2 * unitsPerTexel;
      const toTexel = (w: number) =>
        Math.floor(((w + WATER_FIELD_SPAN / 2) / WATER_FIELD_SPAN) * texels);
      const ix0 = Math.max(0, toTexel(centerX - half - margin));
      const ix1 = Math.min(texels - 1, toTexel(centerX + half + margin));
      const iz0 = Math.max(0, toTexel(centerZ - half - margin));
      const iz1 = Math.min(texels - 1, toTexel(centerZ + half + margin));
      if (ix1 < ix0 || iz1 < iz0) return;
      const r = Math.round(Math.min(1, Math.max(0, tint.r)) * 255);
      const g = Math.round(Math.min(1, Math.max(0, tint.g)) * 255);
      const b = Math.round(Math.min(1, Math.max(0, tint.b)) * 255);
      const gridHalf = (terrain.size - 1) / 2;
      for (let iz = iz0; iz <= iz1; iz++) {
        const wz = ((iz + 0.5) / texels - 0.5) * WATER_FIELD_SPAN;
        const ty = wz - centerZ + gridHalf;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = ((ix + 0.5) / texels - 0.5) * WATER_FIELD_SPAN;
          const h = heightAt(terrain, wx - centerX + gridHalf, ty);
          const a = Math.round(Math.min(1, Math.max(0, h / WATER_FIELD_LAND_MAX)) * 255);
          const at = (iz * texels + ix) * 4;
          // islands never overlap in play; on margin ties the later stamp wins
          if (a < data[at + 3]!) continue;
          data[at] = r;
          data[at + 1] = g;
          data[at + 2] = b;
          data[at + 3] = a;
        }
      }
      stampedCount += 1;
      texture.needsUpdate = true;
    },
    stamped: () => stampedCount,
    data: () => data,
  };
}
