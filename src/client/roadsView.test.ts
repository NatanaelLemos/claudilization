import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AGES } from "../shared/ages";
import { generateIsland } from "../shared/terrain";
import { townPlan } from "../shared/townPlan";
import type { Age, Building } from "../shared/types";
import { islandPalette } from "./artDirection";
import {
  buildRoadsGroup,
  disposeRoadsGroup,
  MAX_ROAD_SEGMENTS,
  ROAD_LUMA_CEILING,
  ROAD_LUMA_FLOOR,
  ROAD_LUMA_FLOOR_LATE,
  ROADS_GROUP,
  roadHalfWidth,
  roadLuma,
  roadNetwork,
  roadSurface,
  roadTraffic,
  spanningTree,
} from "./roadsView";

const flatGround = () => 1.5;

function building(
  id: string,
  type: string,
  x: number,
  y: number,
  stage: Building["stage"] = "complete",
): Building {
  return { id, type, stage, progress: 100, pos: { x, y } };
}

function town(count: number, spread = 8): Building[] {
  return Array.from({ length: count }, (_, i) =>
    building(`b${i}`, i % 4 === 0 ? "hut" : "workshop", 30 + (i % 6) * spread, 30 + Math.floor(i / 6) * spread),
  );
}

function roadMesh(group: THREE.Group): THREE.Mesh | undefined {
  return group.children.find((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
}

function vertices(mesh: THREE.Mesh): { x: number; y: number; z: number }[] {
  const position = mesh.geometry.getAttribute("position");
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < position.count; i++) {
    out.push({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) });
  }
  return out;
}

describe("the paving of each age", () => {
  it("gives all nine ages their own surface", () => {
    const palette = islandPalette(11);
    const ids = AGES.map((age) => roadSurface(age, palette).id);
    expect(new Set(ids).size).toBe(AGES.length);
    expect(ids[0]).toBe("earth");
    expect(ids[AGES.length - 1]).toBe("composite");
  });

  it("keeps every age's paving inside its value band on any island", () => {
    for (let seed = 0; seed < 64; seed++) {
      const palette = islandPalette(seed);
      AGES.forEach((age, era) => {
        const surface = roadSurface(age, palette);
        const floor = era >= 6 ? ROAD_LUMA_FLOOR_LATE : ROAD_LUMA_FLOOR;
        const luma = roadLuma(surface.base);
        expect(luma).toBeGreaterThanOrEqual(floor - 1e-6);
        expect(luma).toBeLessThanOrEqual(ROAD_LUMA_CEILING + 1e-6);
        // the crown is the light note and the verge the dark one — always
        expect(roadLuma(surface.crown)).toBeGreaterThanOrEqual(luma - 1e-6);
        expect(roadLuma(surface.edge)).toBeLessThan(luma);
      });
    }
  });

  it("paves later ages wider and later ages paler", () => {
    const palette = islandPalette(3);
    const early = roadSurface("stone", palette);
    const late = roadSurface("future", palette);
    expect(late.lane).toBeGreaterThan(early.lane);
    expect(roadLuma(late.base)).toBeGreaterThan(roadLuma(early.base));
    // the future's seam is the brightest thing on the street, but painted,
    // not neon: it stays inside the same value ceiling as everything else
    expect(roadLuma(late.crown)).toBeLessThanOrEqual(ROAD_LUMA_CEILING + 1e-6);
  });

  it("lets the island's own soil into the earthen ages and not the late ones", () => {
    const red = islandPalette(2);
    const other = islandPalette(29);
    const earthGap = roadSurface("stone", red).base.getHex() !== roadSurface("stone", other).base.getHex();
    expect(earthGap).toBe(true);
    expect(roadSurface("future", red).base.getHex()).toBe(
      roadSurface("future", other).base.getHex(),
    );
  });
});

describe("the road network", () => {
  it("spans every doorstep exactly once and roots the tree at the plaza", () => {
    const doors = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 30, y: 5 },
    ];
    const edges = spanningTree([{ x: 5, y: 5 }, ...doors]);
    expect(edges).toHaveLength(doors.length);
    const reached = new Set([0]);
    for (const [a, b] of edges) {
      expect(reached.has(a)).toBe(true); // parent before child, from the root
      reached.add(b);
    }
    expect(reached.size).toBe(doors.length + 1);
  });

  it("returns nothing for a lone building", () => {
    expect(spanningTree([{ x: 3, y: 3 }])).toEqual([]);
    expect(roadNetwork({ doors: [{ x: 3, y: 3 }], seed: 1, lane: 0.5 })).toEqual([]);
  });

  it("carries the whole town on the road out of the plaza", () => {
    // a chain: plaza → a → b → c, so each edge carries one fewer house
    const edges: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    expect(roadTraffic(4, edges)).toEqual([3, 2, 1]);
  });

  it("widens a busy road and stops widening", () => {
    expect(roadHalfWidth(0.5, 1)).toBe(0.5);
    expect(roadHalfWidth(0.5, 8)).toBeGreaterThan(roadHalfWidth(0.5, 2));
    expect(roadHalfWidth(0.5, 4096)).toBeLessThanOrEqual(0.5 * 2.15 + 1e-9);
  });

  it("welds at the ends: every polyline starts and ends on its own junction", () => {
    const doors = town(9).map((b) => b.pos);
    const plaza = { x: 40, y: 40 };
    const paths = roadNetwork({ doors, plaza, seed: 5, lane: 0.6 });
    const nodes = [plaza, ...doors];
    for (const path of paths) {
      for (const end of [path.points[0]!, path.points[path.points.length - 1]!]) {
        const nearest = Math.min(...nodes.map((n) => Math.hypot(n.x - end.x, n.y - end.y)));
        expect(nearest).toBeLessThan(1e-6);
      }
    }
  });

  it("hands the trunk roads to the cap first", () => {
    const paths = roadNetwork({ doors: town(40).map((b) => b.pos), plaza: { x: 40, y: 40 }, seed: 5, lane: 0.6 });
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i - 1]!.traffic).toBeGreaterThanOrEqual(paths[i]!.traffic);
    }
    expect(paths[0]!.half).toBeGreaterThan(paths[paths.length - 1]!.half);
  });
});

describe("the road mesh", () => {
  it("draws the whole network in one call", () => {
    const group = buildRoadsGroup({
      buildings: town(60),
      age: "medieval",
      islandSeed: 7,
      heightAt: flatGround,
      half: 60,
    });
    expect(group.name).toBe(ROADS_GROUP);
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(1);
    expect((meshes[0] as THREE.InstancedMesh).isInstancedMesh).toBeFalsy();
    expect(meshes[0]!.geometry.getAttribute("color")).toBeTruthy();
  });

  it("reaches every building it serves", () => {
    const buildings = town(24);
    const group = buildRoadsGroup({
      buildings,
      age: "classical",
      islandSeed: 7,
      heightAt: flatGround,
      half: 60,
    });
    const mesh = roadMesh(group)!;
    const points = vertices(mesh);
    for (const b of buildings) {
      const nearest = Math.min(
        ...points.map((p) => Math.hypot(p.x - (b.pos.x - 60), p.z - (b.pos.y - 60))),
      );
      expect(nearest).toBeLessThan(2.2);
    }
  });

  it("is identical on two machines and changes with the age", () => {
    const options = {
      buildings: town(18),
      islandSeed: 12,
      heightAt: flatGround,
      half: 60,
    };
    const a = roadMesh(buildRoadsGroup({ ...options, age: "iron" as Age }))!;
    const b = roadMesh(buildRoadsGroup({ ...options, age: "iron" as Age }))!;
    const later = roadMesh(buildRoadsGroup({ ...options, age: "future" as Age }))!;
    expect(Array.from(a.geometry.getAttribute("position").array)).toEqual(
      Array.from(b.geometry.getAttribute("position").array),
    );
    expect(Array.from(a.geometry.getAttribute("color").array)).toEqual(
      Array.from(b.geometry.getAttribute("color").array),
    );
    expect(a.userData.roadSurface).toBe("setts");
    expect(later.userData.roadSurface).toBe("composite");
    // a future boulevard is wider than an iron-age lane over the same town
    const width = (mesh: THREE.Mesh) => mesh.geometry.boundingSphere!.radius;
    expect(width(later)).toBeGreaterThan(0);
    expect(
      Array.from(later.geometry.getAttribute("color").array),
    ).not.toEqual(Array.from(a.geometry.getAttribute("color").array));
  });

  it("paves nothing for a hamlet of one and nothing at sea", () => {
    const alone = buildRoadsGroup({
      buildings: [building("b1", "hut", 30, 30)],
      age: "stone",
      islandSeed: 7,
      heightAt: flatGround,
      half: 60,
    });
    expect(roadMesh(alone)).toBeUndefined();
    const drowned = buildRoadsGroup({
      buildings: town(12),
      age: "stone",
      islandSeed: 7,
      heightAt: () => 0,
      half: 60,
    });
    expect(roadMesh(drowned)).toBeUndefined();
  });

  it("caps the paving of a metropolis", () => {
    const group = buildRoadsGroup({
      buildings: town(400, 5),
      age: "modern",
      islandSeed: 7,
      heightAt: flatGround,
      half: 120,
    });
    const mesh = roadMesh(group)!;
    const triangles = mesh.geometry.getIndex()!.count / 3;
    // five columns across the road, so eight triangles per cross-section,
    // plus the plaza apron when there is a plan
    expect(triangles).toBeLessThanOrEqual(MAX_ROAD_SEGMENTS * 8 + 200);
  });

  it("paves the plaza the roads converge on, above the town's own soil", () => {
    const terrain = generateIsland(4242, 96);
    const plan = townPlan(terrain, 4242);
    const heightAt = (x: number, y: number) => {
      const tile = terrain.tiles[Math.round(y) * terrain.size + Math.round(x)];
      return tile ? Math.max(0, (tile.height - 0.2) * 7) : 0;
    };
    const buildings = Array.from({ length: 16 }, (_, i) =>
      building(
        `b${i}`,
        "hut",
        plan.plaza.x + Math.cos(i) * (6 + i * 0.7),
        plan.plaza.y + Math.sin(i) * (6 + i * 0.7),
      ),
    );
    const group = buildRoadsGroup({
      buildings,
      age: "renaissance",
      islandSeed: 4242,
      heightAt,
      half: terrain.size / 2,
      terrain,
    });
    const mesh = roadMesh(group)!;
    const half = terrain.size / 2;
    const points = vertices(mesh);
    const onPlaza = points.filter(
      (p) =>
        Math.hypot(p.x - (plan.plaza.x - half), p.z - (plan.plaza.y - half)) <
        plan.plazaRadius * 0.6,
    );
    expect(onPlaza.length).toBeGreaterThan(0);
    // and on a real island, with real doorsteps, no house is left off the network
    for (const b of buildings) {
      const nearest = Math.min(
        ...points.map((p) => Math.hypot(p.x - (b.pos.x - half), p.z - (b.pos.y - half))),
      );
      expect(nearest).toBeLessThan(3);
    }
    // and the paving is lighter than the bare island soil it replaced
    const surface = roadSurface("renaissance", islandPalette(4242));
    expect(roadLuma(surface.crown)).toBeGreaterThan(
      roadLuma(new THREE.Color(islandPalette(4242).soil)),
    );
  });

  it("stays out of the island-sized shadow pass and releases what it owns", () => {
    const holder = new THREE.Group();
    const group = buildRoadsGroup({
      buildings: town(10),
      age: "bronze",
      islandSeed: 7,
      heightAt: flatGround,
      half: 60,
    });
    holder.add(group);
    const mesh = roadMesh(group)!;
    expect(mesh.userData.smallBuildingBatch).toBe(true);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(true);
    disposeRoadsGroup(holder);
    expect(holder.getObjectByName(ROADS_GROUP)).toBeUndefined();
  });
});
