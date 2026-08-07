import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { ActiveCatastrophe, CatastropheStatus } from "../shared/catastrophes";
import {
  CatastropheEffects,
  catastropheEffectProgress,
} from "./catastropheEffects";

function active(
  id: ActiveCatastrophe["id"],
  sequence = 1,
): ActiveCatastrophe {
  return {
    id,
    sequence,
    scheduledAt: 10,
    startedAt: 10,
    endsAt: 55,
    impact: {
      inhabitedIslands: 2,
      mapIslands: 3,
      resourcesLost: 100,
      workPointsLost: 20,
      reservesLost: 0,
      buildingsDamaged: 4,
      boatsDestroyed: 1,
      creationsLost: 0,
    },
  };
}

function status(event?: ActiveCatastrophe): CatastropheStatus {
  return { nextAt: 3_600, intervalSeconds: 3_600, warningSeconds: 300, active: event };
}

function harness(reducedMotion = false) {
  let now = 10;
  const scene = new THREE.Scene();
  const shake = vi.fn();
  const stage = {
    scene,
    controls: { getTarget: (target: THREE.Vector3) => target.set(20, 0, 30) },
    worldTime: () => now,
    onFrame: vi.fn(),
    setCameraShake: shake,
    reducedMotion,
  };
  return {
    scene,
    shake,
    effects: new CatastropheEffects(stage as never),
    at(value: number) {
      now = value;
    },
  };
}

describe("physical catastrophe effects", () => {
  it("derives reconnect progress from canonical world time", () => {
    const event = active("tsunami");
    expect(catastropheEffectProgress(event, 10)).toBe(0);
    expect(catastropheEffectProgress(event, 32.5)).toBe(0.5);
    expect(catastropheEffectProgress(event, 55)).toBe(1);
  });

  it("mounts one bounded wave and replaces it cleanly when sequence changes", () => {
    const h = harness();
    h.effects.update(status(active("tsunami")));
    h.effects.tick();
    expect(h.scene.getObjectByName("catastrophe-tsunami")).toBeTruthy();
    expect(h.effects.snapshot().objects).toBe(5);

    h.effects.update(status(active("tsunami")));
    expect(h.scene.children.filter((child) => child.name === "catastrophe-tsunami")).toHaveLength(1);

    h.effects.update(status(active("godzilla", 2)));
    expect(h.scene.getObjectByName("catastrophe-tsunami")).toBeUndefined();
    expect(h.scene.getObjectByName("catastrophe-godzilla")).toBeTruthy();
    expect(h.effects.snapshot().objects).toBeLessThan(50);
  });

  it("disposes transient geometry and clears camera offsets at the exact end", () => {
    const h = harness();
    const event = active("tsunami");
    h.effects.update(status(event));
    const wave = h.scene.getObjectByName("wave-wall") as THREE.Mesh;
    const disposed = vi.spyOn(wave.geometry, "dispose");
    h.at(event.endsAt);
    h.effects.tick();
    expect(disposed).toHaveBeenCalledOnce();
    expect(h.effects.snapshot()).toEqual({ sequence: undefined, id: undefined, objects: 0 });
    expect(h.scene.getObjectByName("catastrophe-tsunami")).toBeUndefined();
    expect(h.shake).toHaveBeenLastCalledWith(0, 0, 0, 0);
  });

  it("shakes strongly at earthquake impact, settles, and honors reduced motion", () => {
    const moving = harness();
    moving.effects.update(status(active("earthquake")));
    moving.at(10.25);
    moving.effects.tick();
    expect(moving.shake).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(moving.shake.mock.calls.at(-1)!.slice(0, 3).some((value) => Math.abs(value) > 0.2)).toBe(true);
    moving.at(24);
    moving.effects.tick();
    expect(moving.shake).toHaveBeenLastCalledWith(0, 0, 0, 0);

    const reduced = harness(true);
    reduced.effects.update(status(active("earthquake")));
    reduced.at(10.25);
    reduced.effects.tick();
    expect(reduced.shake).toHaveBeenLastCalledWith(0, 0, 0, 0);
  });
});
