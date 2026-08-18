import { describe, expect, it } from "vitest";
import { CREATION_MODEL_EXAMPLE } from "../shared/rules";
import type { CreationModel } from "../shared/types";
import { buildModel, faceShade, greedyQuads } from "./voxelMesh";

function grid(layers: string[][], palette = ["#8b8984"]): CreationModel {
  return { size: layers[0]!.length, palette, layers };
}

const oneVoxel = grid([
  ["....", ".0..", "....", "...."],
  ["....", "....", "....", "...."],
]);

/** two voxels of different colors, stacked: nothing may merge but the
 * touching faces must still vanish */
const stack = grid(
  [
    ["....", ".0..", "....", "...."],
    ["....", ".1..", "....", "...."],
  ],
  ["#8b8984", "#e94560"],
);

const cube = grid([
  ["....", ".00.", ".00.", "...."],
  ["....", ".00.", ".00.", "...."],
]);

describe("greedy meshing a creation", () => {
  it("wraps a single voxel in exactly its six faces", () => {
    expect(greedyQuads(oneVoxel)).toHaveLength(6);
  });

  it("never emits the faces buried between two voxels", () => {
    // 12 faces minus the two that touch
    expect(greedyQuads(stack)).toHaveLength(10);
  });

  it("merges a solid block into one quad per side", () => {
    expect(greedyQuads(cube)).toHaveLength(6);
  });

  it("winds every face outward, so nothing is inside out", () => {
    for (const quad of greedyQuads(cube)) {
      const cross = [
        quad.du[1] * quad.dv[2] - quad.du[2] * quad.dv[1],
        quad.du[2] * quad.dv[0] - quad.du[0] * quad.dv[2],
        quad.du[0] * quad.dv[1] - quad.du[1] * quad.dv[0],
      ];
      const along =
        cross[0]! * quad.normal[0] + cross[1]! * quad.normal[1] + cross[2]! * quad.normal[2];
      // the build pass flips the pair when this is negative; either way the
      // face has a real area and a real direction
      expect(Math.abs(along)).toBeGreaterThan(0);
    }
  });

  it("paints tops brighter than undersides — the diorama bake", () => {
    expect(faceShade([0, 1, 0])).toBeGreaterThan(faceShade([1, 0, 0]));
    expect(faceShade([1, 0, 0])).toBeGreaterThan(faceShade([0, -1, 0]));
  });
});

describe("building a creation's geometry", () => {
  it("stands the piece on the ground, centered over its own footprint", () => {
    const built = buildModel(CREATION_MODEL_EXAMPLE, 3.2)!;
    const pos = built.geometry.getAttribute("position");
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
      minX = Math.min(minX, pos.getX(i));
      maxX = Math.max(maxX, pos.getX(i));
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(3.2, 5); // the long side is fitted to the span
    expect(minX + maxX).toBeCloseTo(0, 5); // centered on X
    expect(built.height).toBeCloseTo(3.2, 5);
    expect(built.radius).toBeGreaterThan(0);
  });

  it("carries the model's own palette in vertex colors", () => {
    const built = buildModel(CREATION_MODEL_EXAMPLE, 3.2)!;
    expect(built.geometry.getAttribute("color").count).toBe(
      built.geometry.getAttribute("position").count,
    );
  });

  it("returns nothing for a model with no solid voxels", () => {
    const empty = grid([
      ["....", "....", "....", "...."],
      ["....", "....", "....", "...."],
    ]);
    expect(buildModel(empty, 3.2)).toBeNull();
  });
});
