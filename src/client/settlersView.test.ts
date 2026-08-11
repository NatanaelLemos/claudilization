import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CivSpec, Island, Settler } from "../shared/types";
import {
  crowdUpdateHz,
  MAX_VISIBLE_SETTLERS,
  sampledSettlers,
  spreadOffset,
  updateSettlers,
} from "./settlersView";

describe("settler spread", () => {
  it("is deterministic, bounded, and distinct per settler — no more stacked dots", () => {
    const a1 = spreadOffset("island-1-s1");
    const a2 = spreadOffset("island-1-s1");
    expect(a1).toEqual(a2);

    const ids = Array.from({ length: 10 }, (_, i) => `island-1-s${i}`);
    const offsets = ids.map(spreadOffset);
    const distinct = new Set(offsets.map((o) => `${o.x.toFixed(3)},${o.z.toFixed(3)}`));
    expect(distinct.size).toBe(10);
    for (const o of offsets) {
      expect(Math.hypot(o.x, o.z)).toBeGreaterThan(0.3);
      expect(Math.hypot(o.x, o.z)).toBeLessThan(2.5);
    }
  });
});

describe("dense crowd budget", () => {
  it("uses a stable, capped sample above 1,024 population", () => {
    const population = Array.from({ length: 1_500 }, (_, i) => ({ id: `settler-${i}` }));
    const first = sampledSettlers(population);
    const second = sampledSettlers([...population].reverse());
    expect(first).toHaveLength(MAX_VISIBLE_SETTLERS);
    expect(first.map((settler) => settler.id)).toEqual(second.map((settler) => settler.id));
  });

  it("updates ordinary crowds at 30 Hz and dense crowds at 15 Hz", () => {
    expect(crowdUpdateHz(256)).toBe(30);
    expect(crowdUpdateHz(257)).toBe(15);
    expect(crowdUpdateHz(5_000)).toBe(15);
  });
});

describe("contact blobs", () => {
  it("grounds every settler with a soft instanced disc and no shadow-map cost", () => {
    const holder = new THREE.Group();
    const settler: Settler = {
      id: "s1",
      name: "Test",
      adult: true,
      bornAt: 0,
      task: { kind: "idle" } as Settler["task"],
      pos: { x: 4, y: 4 },
      hungerDays: 0,
    };
    const island = { settlers: [settler] } as unknown as Island;
    const civ = { accent: "#aa5533" } as unknown as CivSpec;
    updateSettlers(holder, island, civ, () => 1, 8);

    const blobs = holder.getObjectByName("clay-character-blobs") as THREE.InstancedMesh;
    expect(blobs).toBeTruthy();
    expect(blobs.count).toBe(1);
    expect(blobs.castShadow).toBe(false);
    const mat = blobs.material as THREE.MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });
});
