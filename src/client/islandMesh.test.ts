import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createIslandGroup,
  DECOR_FINE_GROUP,
  spatiallyThinResourceVisuals,
  surfaceY,
  terrainLodSegments,
  terrainSkyOcclusion,
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
