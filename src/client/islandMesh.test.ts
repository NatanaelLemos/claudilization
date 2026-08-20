import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  amplifyTerrainNormals,
  createIslandGroup,
  DECOR_FINE_GROUP,
  fieldSpread,
  groundZoneWeights,
  spatiallyThinResourceVisuals,
  surfaceY,
  terrainLodSegments,
  terrainMacroField,
  terrainSkyOcclusion,
  terrainSlopeField,
  type GroundZoneWeights,
} from "./islandMesh";

describe("terrain level of detail", () => {
  it("thins only decorative resource props deterministically", () => {
    const nodes = Array.from({ length: 40 }, (_, id) => ({
      nodeId: `node-${id}`,
      tile: { x: id % 10, y: Math.floor(id / 10) },
    }));
    const a = spatiallyThinResourceVisuals(nodes, 4);
    const b = spatiallyThinResourceVisuals([...nodes].reverse(), 4);
    expect(a.map((node) => node.nodeId)).toEqual(b.map((node) => node.nodeId));
    expect(a.length).toBeLessThan(nodes.length);
    expect(nodes).toHaveLength(40);
  });
  it("keeps the full 166-cell island while reducing distant triangles by about 16x", () => {
    const segments = terrainLodSegments(166);
    const fullTriangles = (166 - 1) ** 2 * 2;
    const distantTriangles = segments ** 2 * 2;
    expect(segments).toBe(42);
    expect(distantTriangles).toBeLessThan(fullTriangles / 15);
  });

  it("retains a useful minimum grid for small islands", () => {
    expect(terrainLodSegments(24)).toBe(16);
  });

  it("shapes visual relief without moving the tile contract", () => {
    // continuous at the waterline: no cliff seam where land meets sea
    expect(surfaceY(0.2)).toBe(0);
    expect(surfaceY(0.2 + 1e-6)).toBeCloseTo(0, 4);
    // monotonic: higher tiles always render higher
    let previous = -Infinity;
    for (let h = 0; h <= 1.0001; h += 0.01) {
      const y = surfaceY(h);
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }
    // the interior swells into hills but stays a gentle miniature
    expect(surfaceY(1)).toBeGreaterThan((1 - 0.2) * 7);
    expect(surfaceY(1)).toBeLessThanOrEqual((1 - 0.2) * 7 + 3.8);
    // shores bank away under the sea faster than they rise above it
    expect(surfaceY(0.1)).toBeLessThan((0.1 - 0.2) * 7);
  });

  it("composes groves, outcrops and meadows deterministically", () => {
    const a = createIslandGroup(7, 96, "island-7");
    const b = createIslandGroup(7, 96, "island-7");
    const names = (group: THREE.Group) => {
      const found: string[] = [];
      group.traverse((o) => {
        if (o.name) found.push(o.name);
      });
      return found.sort();
    };
    expect(names(a)).toEqual(names(b));
    // species variety: broadleaf crowns and conifers both grow
    expect(a.getObjectByName("clay-tree-crowns")).toBeTruthy();
    expect(a.getObjectByName("clay-tree-conifers")).toBeTruthy();
    expect(a.getObjectByName("clay-outcrops")).toBeTruthy();
    // grove companions are composition only: no picks, distance-culled
    const companions = a.getObjectByName("clay-grove-trunks") as THREE.InstancedMesh;
    expect(companions.count).toBeGreaterThan(0);
    expect(companions.userData.instanceAssetPicks).toBeUndefined();
    expect(companions.parent?.name).toBe(DECOR_FINE_GROUP);
    // the always-visible forest pays exactly the old budget: one per node
    const primaries = a.getObjectByName("clay-tree-trunks") as THREE.InstancedMesh;
    expect(primaries.parent?.name).toBe("resources");
    // meadow decoration exists, carries no picks, and is instance-tinted
    const decor = a.getObjectByName(DECOR_FINE_GROUP) as THREE.Group;
    expect(decor).toBeTruthy();
    const blooms = decor.getObjectByName("meadow-blooms") as THREE.InstancedMesh;
    expect(blooms.count).toBeGreaterThan(0);
    expect(blooms.instanceColor).toBeTruthy();
    expect(blooms.userData.instanceAssetPicks).toBeUndefined();
    // identical seeds produce identical placements
    const meshA = a.getObjectByName("clay-tree-trunks") as THREE.InstancedMesh;
    const meshB = b.getObjectByName("clay-tree-trunks") as THREE.InstancedMesh;
    expect(meshA.count).toBe(meshB.count);
    expect([...meshA.instanceMatrix.array]).toEqual([...meshB.instanceMatrix.array]);
  });

  it("drops fine decoration entirely when the prop budget is zero", () => {
    const island = createIslandGroup(7, 96, "island-7", { propScale: 0 });
    expect(island.getObjectByName(DECOR_FINE_GROUP)).toBeUndefined();
    // gameplay resources are untouched by the decoration budget
    expect(island.getObjectByName("clay-tree-trunks")).toBeTruthy();
  });

  it("keeps resource batch metadata and world bounds aligned", () => {
    const island = createIslandGroup(42, 166, "island-42");
    const roots = island.userData.assetRoots as THREE.Object3D[];
    const batched: THREE.BatchedMesh[] = [];
    const instanced: THREE.InstancedMesh[] = [];
    for (const root of roots) {
      root.traverse((object) => {
        if ((object as THREE.BatchedMesh).isBatchedMesh) batched.push(object as THREE.BatchedMesh);
        else if ((object as THREE.InstancedMesh).isInstancedMesh) {
          instanced.push(object as THREE.InstancedMesh);
        }
      });
    }

    expect(batched.length).toBeGreaterThan(0);
    expect(instanced.length).toBeGreaterThan(0);
    for (const mesh of batched) {
      const picks = mesh.userData.batchedAssetPicks?.picks as unknown[];
      expect(picks.filter(Boolean).length).toBeGreaterThan(0);
      expect(mesh.boundingBox?.isEmpty()).toBe(false);
      expect(mesh.boundingSphere?.isEmpty()).toBe(false);
    }
    for (const mesh of instanced) {
      // contact shadows are paint, not assets: nothing can hover or click one
      if (mesh.userData.contactShadow) {
        expect(mesh.userData.instanceAssetPicks).toBeUndefined();
        continue;
      }
      const picks = mesh.userData.instanceAssetPicks?.picks as unknown[];
      expect(picks).toHaveLength(mesh.count);
      expect(mesh.boundingBox?.isEmpty()).toBe(false);
      expect(mesh.boundingSphere?.isEmpty()).toBe(false);
    }
  });
});

describe("baked terrain occlusion", () => {
  /** a single square pit sunk into an otherwise flat plateau */
  function pit(size: number, depth: number): Float32Array {
    const heights = new Float32Array(size * size);
    const mid = Math.floor(size / 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inPit = Math.abs(x - mid) <= 1 && Math.abs(y - mid) <= 1;
        heights[y * size + x] = inPit ? -depth : 0;
      }
    }
    return heights;
  }

  it("darkens the floor of a hollow and leaves open ground alone", () => {
    const size = 33;
    const occlusion = terrainSkyOcclusion(pit(size, 3), size);
    const mid = Math.floor(size / 2);
    const floor = occlusion[mid * size + mid]!;
    const openGround = occlusion[2 * size + 2]!;
    expect(floor).toBeGreaterThan(0.5);
    expect(openGround).toBeLessThan(0.15);
    expect(floor).toBeGreaterThan(openGround * 4);
  });

  it("shades the foot of a cliff more than its crown", () => {
    const size = 33;
    const heights = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) heights[y * size + x] = x >= size / 2 ? 6 : 0;
    }
    const occlusion = terrainSkyOcclusion(heights, size);
    const row = Math.floor(size / 2);
    const foot = occlusion[row * size + (Math.floor(size / 2) - 1)]!;
    const crown = occlusion[row * size + (Math.floor(size / 2) + 1)]!;
    expect(foot).toBeGreaterThan(crown);
    expect(crown).toBeLessThan(0.2);
  });

  it("stays inside 0..1 and is deterministic for a real island", () => {
    const size = 48;
    const heights = new Float32Array(size * size);
    for (let i = 0; i < heights.length; i++) {
      heights[i] = Math.sin(i * 0.13) * 2 + Math.cos(i * 0.031) * 5;
    }
    const a = terrainSkyOcclusion(heights, size);
    const b = terrainSkyOcclusion(heights, size);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const value of a) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    // a rolling meadow must actually be modelled, not flattened by the curve
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.25);
  });
});

describe("ground shading", () => {
  it("paints the island in low-frequency patches, deterministically per seed", () => {
    const size = 96;
    const a = terrainMacroField(11, size);
    const b = terrainMacroField(11, size);
    const other = terrainMacroField(12, size);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(other));

    // a real value range, or the zones it steers never move
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.3);
    for (const value of a) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }

    // low frequency is the whole point: neighbours agree, hectares differ.
    // Per-vertex noise would just look like dirt on the lens.
    let neighbour = 0;
    let distant = 0;
    let samples = 0;
    for (let y = 20; y < size - 20; y += 3) {
      for (let x = 20; x < size - 20; x += 3) {
        const here = a[y * size + x]!;
        neighbour += Math.abs(here - a[y * size + x + 1]!);
        distant += Math.abs(here - a[y * size + x + 18]!);
        samples++;
      }
    }
    expect(neighbour / samples).toBeLessThan(0.02);
    expect(distant / samples).toBeGreaterThan((neighbour / samples) * 4);
  });

  it("measures steepness as rise per tile", () => {
    const size = 16;
    const flat = new Float32Array(size * size);
    expect(Math.max(...terrainSlopeField(flat, size))).toBe(0);

    const ramp = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) ramp[y * size + x] = x * 0.5;
    }
    const slope = terrainSlopeField(ramp, size);
    expect(slope[8 * size + 8]).toBeCloseTo(0.5, 5);
  });

  it("stretches its thresholds over the ground each island actually has", () => {
    // an island whose whole interior sits in a narrow band was the bug: with
    // absolute thresholds it landed in one zone and painted itself one colour
    const values = new Float32Array([0.4, 0.42, 0.45, 0.48, 0.5, 0.52, 0.55, 9]);
    const indices = Array.from(values, (_, i) => i);
    const spread = fieldSpread(values, indices);
    // trimmed at both ends — the span is the ground, not the extremes
    expect(spread.low).toBeGreaterThanOrEqual(0.4);
    expect(spread.low).toBeLessThan(0.48);
    // and the lone summit must not decide what "high" means for the meadow
    expect(spread.high).toBeLessThan(1);
    expect(spread.high).toBeGreaterThan(spread.low);
    // degenerate input still yields a usable span rather than a divide by zero
    const flat = fieldSpread(new Float32Array([2, 2, 2]), [0, 1, 2]);
    expect(flat.high).toBeGreaterThan(flat.low);
    expect(fieldSpread(new Float32Array(), [])).toEqual({ low: 0, high: 1 });
  });

  it("splits ground into three tonal zones where height and slope argue", () => {
    const sum = (z: GroundZoneWeights) => z.hollow + z.meadow + z.crown;
    const damp = groundZoneWeights(0, 0, 0);
    const working = groundZoneWeights(0.5, 0.5, 0.5);
    const bleached = groundZoneWeights(1, 1, 1);
    for (const zone of [damp, working, bleached]) expect(sum(zone)).toBeCloseTo(1, 6);

    // low, flat and damp reads dark; high, steep and dry reads bleached
    expect(damp.hollow).toBeGreaterThan(0.5);
    expect(bleached.crown).toBeGreaterThan(0.9);
    expect(working.meadow).toBeGreaterThan(working.crown);
    expect(working.meadow).toBeGreaterThan(working.hollow);

    // slope is a real driver, not a tiebreaker: a steep bank at the same
    // height dries out, which is what stops the zones drawing contour bands
    const flatBank = groundZoneWeights(0.62, 0, 0.62);
    const steepBank = groundZoneWeights(0.62, 1, 0.62);
    expect(steepBank.crown).toBeGreaterThan(flatBank.crown + 0.15);
    // and the macro mask shoves the boundary around at a fixed height
    expect(groundZoneWeights(0.5, 0.3, 1).crown).toBeGreaterThan(
      groundZoneWeights(0.5, 0.3, 0).crown + 0.3,
    );
  });

  it("tilts terrain normals so a three-degree hill still catches the sun", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute([0, 1, 0, 0.05, 0.9987, 0, -0.05, 0.9987, 0], 3),
    );
    amplifyTerrainNormals(geometry, 3.1);
    const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;

    // flat ground stays flat — only slopes are exaggerated
    expect(normals.getX(0)).toBe(0);
    expect(normals.getY(0)).toBeCloseTo(1, 6);
    // the gentle fold now has a real lit face and a real shaded one
    expect(normals.getX(1)).toBeGreaterThan(0.05 * 2.5);
    expect(normals.getX(2)).toBeLessThan(-0.05 * 2.5);
    // and every normal is still a unit vector, or the lighting goes wrong
    for (let i = 0; i < normals.count; i++) {
      expect(
        Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)),
      ).toBeCloseTo(1, 5);
    }
  });

  it("gives a real island's meadow a value range instead of one flat green", () => {
    const size = 96;
    const group = createIslandGroup(23, size, "island-23");
    let ground: THREE.Mesh | undefined;
    group.traverse((o) => {
      if (o.name === "ground-high") ground = o as THREE.Mesh;
    });
    const color = ground!.geometry.getAttribute("color") as THREE.BufferAttribute;
    const position = ground!.geometry.getAttribute("position") as THREE.BufferAttribute;

    // sample the interior, where the meadow lives, away from rock and surf
    const samples: { luma: number; radius: number }[] = [];
    for (let i = 0; i < color.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const radius = Math.hypot(x, z);
      if (radius > size * 0.22) continue;
      samples.push({
        luma: color.getX(i) * 0.3 + color.getY(i) * 0.59 + color.getZ(i) * 0.11,
        radius,
      });
    }
    expect(samples.length).toBeGreaterThan(200);
    const lumas = samples.map((s) => s.luma).sort((a, b) => a - b);
    const at = (share: number) => lumas[Math.round(share * (lumas.length - 1))]!;

    // the critic's headline: "almost no albedo or value variation". A real
    // painted landmass carries a spread the eye can read.
    expect(at(0.95) - at(0.05)).toBeGreaterThan(0.1);

    // and it must not be a radial vignette — ground at one distance from the
    // island's middle has to vary as much as the island does overall
    const band = samples.filter((s) => s.radius > size * 0.12 && s.radius < size * 0.15);
    expect(band.length).toBeGreaterThan(40);
    const bandLumas = band.map((s) => s.luma).sort((a, b) => a - b);
    const bandSpread =
      bandLumas[Math.round(0.9 * (bandLumas.length - 1))]! -
      bandLumas[Math.round(0.1 * (bandLumas.length - 1))]!;
    expect(bandSpread).toBeGreaterThan((at(0.9) - at(0.1)) * 0.4);
  });
});
