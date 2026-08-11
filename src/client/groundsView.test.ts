import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CIVS } from "../shared/civs";
import type { Building } from "../shared/types";
import {
  buildGroundsGroup,
  GROUNDS_GROUP,
  MAX_PATH_STONES,
  pathEdges,
  yardKind,
} from "./groundsView";

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

function instanceTotal(group: THREE.Group): number {
  let total = 0;
  group.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      total += (o as THREE.InstancedMesh).count;
    }
  });
  return total;
}

describe("footpath network", () => {
  it("spans every completed building exactly once", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 30, y: 5 },
      { x: 4, y: 22 },
    ];
    const edges = pathEdges(points);
    expect(edges).toHaveLength(points.length - 1);
    const connected = new Set([0]);
    for (const [a, b] of edges) {
      expect(connected.has(a) || connected.has(b)).toBe(true);
      connected.add(a);
      connected.add(b);
    }
    expect(connected.size).toBe(points.length);
  });

  it("returns no edges for a lone building", () => {
    expect(pathEdges([{ x: 3, y: 3 }])).toEqual([]);
    expect(pathEdges([])).toEqual([]);
  });
});

describe("yard vocabulary", () => {
  it("assigns a working yard from what the building does", () => {
    expect(yardKind("farm")).toBe("field");
    expect(yardKind("livestock-pen")).toBe("field");
    expect(yardKind("trading-post")).toBe("market");
    expect(yardKind("tavern")).toBe("market");
    expect(yardKind("fishing-hut")).toBe("dockyard");
    expect(yardKind("dock")).toBe("dockyard");
    expect(yardKind("bronze-forge")).toBe("workshop");
    expect(yardKind("blacksmith")).toBe("workshop");
    expect(yardKind("temple")).toBe("civic");
    expect(yardKind("cathedral")).toBe("civic");
    expect(yardKind("hut")).toBe("home");
    expect(yardKind("campfire")).toBe("none");
  });
});

describe("grounds group", () => {
  const civ = CIVS.roman!;

  it("builds paths and yards deterministically for a settlement", () => {
    const buildings = [
      building("b1", "hut", 40, 40),
      building("b2", "farm", 52, 44),
      building("b3", "blacksmith", 46, 55),
      building("b4", "temple", 60, 60),
    ];
    const a = buildGroundsGroup({
      buildings,
      civ,
      islandSeed: 7,
      heightAt: flatGround,
      half: 48,
    });
    const b = buildGroundsGroup({
      buildings,
      civ,
      islandSeed: 7,
      heightAt: flatGround,
      half: 48,
    });
    expect(a.name).toBe(GROUNDS_GROUP);
    expect(instanceTotal(a)).toBeGreaterThan(0);
    expect(instanceTotal(a)).toBe(instanceTotal(b));
    const matrices = (g: THREE.Group) => {
      const all: number[] = [];
      g.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) {
          all.push(...(o as THREE.InstancedMesh).instanceMatrix.array);
        }
      });
      return all;
    };
    expect(matrices(a)).toEqual(matrices(b));
  });

  it("ignores sites and construction and puts nothing in the sea", () => {
    const dry = buildGroundsGroup({
      buildings: [
        building("s1", "hut", 10, 10, "site"),
        building("s2", "farm", 20, 20, "construction"),
      ],
      civ,
      islandSeed: 7,
      heightAt: flatGround,
      half: 48,
    });
    expect(instanceTotal(dry)).toBe(0);
    const flooded = buildGroundsGroup({
      buildings: [building("b1", "hut", 10, 10), building("b2", "hut", 30, 30)],
      civ,
      islandSeed: 7,
      heightAt: () => 0, // under the visual waterline everywhere
      half: 48,
    });
    expect(instanceTotal(flooded)).toBe(0);
  });

  it("caps the street network for enormous cities", () => {
    const buildings = Array.from({ length: 300 }, (_, i) =>
      building(`b${i}`, "townhouse", 4 + (i % 20) * 8, 4 + Math.floor(i / 20) * 10),
    );
    const group = buildGroundsGroup({
      buildings,
      civ,
      islandSeed: 7,
      heightAt: flatGround,
      half: 90,
    });
    let stones = 0;
    group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const params = (mesh.geometry as THREE.CylinderGeometry).parameters as
        | { radiusTop?: number }
        | undefined;
      if (params?.radiusTop === 0.34) stones += mesh.count;
    });
    expect(stones).toBeLessThanOrEqual(MAX_PATH_STONES);
    expect(stones).toBeGreaterThan(0);
  });

  it("keeps props out of the island-sized shadow pass at map range", () => {
    const group = buildGroundsGroup({
      buildings: [building("b1", "blacksmith", 40, 40), building("b2", "hut", 50, 50)],
      civ,
      islandSeed: 7,
      heightAt: flatGround,
      half: 48,
    });
    group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) {
        expect(o.userData.smallBuildingBatch).toBe(true);
      }
    });
  });
});
