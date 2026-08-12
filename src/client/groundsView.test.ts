import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CIVS } from "../shared/civs";
import type { Building } from "../shared/types";
import { civAccented } from "../shared/civColor";
import { PIGMENT_SAT_CEILING } from "./structures";
import {
  buildGroundsGroup,
  disposeGroundsGroup,
  GROUNDS_GROUP,
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

  it("releases instance buffers without disposing shared ground assets", () => {
    const holder = new THREE.Group();
    const grounds = buildGroundsGroup({
      buildings: [building("b1", "blacksmith", 40, 40), building("b2", "hut", 50, 50)],
      civ,
      islandSeed: 7,
      heightAt: flatGround,
      half: 48,
    });
    holder.add(grounds);
    const instance = grounds.children.find(
      (child): child is THREE.InstancedMesh => (child as THREE.InstancedMesh).isInstancedMesh,
    )!;
    const releaseInstances = vi.spyOn(instance, "dispose");
    const releaseSharedGeometry = vi.spyOn(instance.geometry, "dispose");

    disposeGroundsGroup(holder);

    expect(releaseInstances).toHaveBeenCalledOnce();
    expect(releaseSharedGeometry).not.toHaveBeenCalled();
    expect(holder.getObjectByName(GROUNDS_GROUP)).toBeUndefined();
    vi.restoreAllMocks();
  });
});


describe("the banner hue on market awnings", () => {
  const vivid = civAccented(CIVS.japanese, "#22e6a0");
  const markets = [
    building("m1", "market", 20, 20),
    building("m2", "market", 30, 22),
    building("m3", "market", 24, 32),
    building("m4", "market", 34, 34),
  ];

  function canopies(group: THREE.Group): THREE.InstancedMesh[] {
    const found: THREE.InstancedMesh[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const geo = mesh.geometry as THREE.BoxGeometry;
      if (geo.type === "BoxGeometry" && geo.parameters?.width === 1.35) found.push(mesh);
    });
    return found;
  }

  it("chalks a vivid banner down to clay instead of painting fluorescent sheets", () => {
    const group = buildGroundsGroup({
      buildings: markets,
      civ: vivid,
      islandSeed: 5,
      heightAt: flatGround,
      half: 48,
    });
    const sheets = canopies(group);
    expect(sheets.length).toBeGreaterThan(0);
    const hsl = { h: 0, s: 0, l: 0 };
    for (const sheet of sheets) {
      (sheet.material as THREE.MeshStandardMaterial).color.getHSL(hsl);
      expect(hsl.s).toBeLessThanOrEqual(PIGMENT_SAT_CEILING + 1e-6);
    }
    disposeGroundsGroup(group.parent ? group : new THREE.Group().add(group));
  });

  it("gives every market its own awning shade inside one draw call", () => {
    const group = buildGroundsGroup({
      buildings: markets,
      civ: vivid,
      islandSeed: 5,
      heightAt: flatGround,
      half: 48,
    });
    const sheets = canopies(group);
    // one bucket, not one mesh per market
    expect(sheets.length).toBe(1);
    const sheet = sheets[0]!;
    expect(sheet.instanceColor).not.toBeNull();
    const shades = new Set<string>();
    const scratch = new THREE.Color();
    for (let i = 0; i < sheet.count; i++) {
      sheet.getColorAt(i, scratch);
      shades.add(scratch.getHexString());
    }
    expect(shades.size).toBe(sheet.count);
  });
});
