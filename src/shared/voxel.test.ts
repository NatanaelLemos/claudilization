import { describe, expect, it } from "vitest";
import { parseCreationInput } from "./creations";
import { CREATION_MODEL_EXAMPLE } from "./rules";
import {
  MODEL_LIMITS,
  drawableModel,
  modelBounds,
  modelFromSprite,
  parseModel,
  voxelAt,
} from "./voxel";
import type { CreationModel, CreationSprite } from "./types";

/** A 4×4 post, two layers — the smallest honest solid. */
function post(over: Partial<CreationModel> = {}): CreationModel {
  return {
    size: 4,
    palette: ["#8b8984", "#e94560"],
    layers: [
      ["....", ".00.", ".00.", "...."],
      ["....", ".01.", ".10.", "...."],
      ["....", ".11.", ".11.", "...."],
    ],
    ...over,
  };
}

const ninjaSprite: CreationSprite = {
  size: 8,
  palette: ["#1a1a2e", "#e94560"],
  pixels: [
    "..00....",
    ".0110...",
    "..00....",
    ".0000...",
    "0.00.0..",
    "..00....",
    ".0..0...",
    "0....0..",
  ],
};

describe("the 3D asset format", () => {
  it("accepts a well-formed model and reads its voxels back", () => {
    const model = parseModel(post());
    expect(voxelAt(model, 1, 0, 1)).toBe(0);
    expect(voxelAt(model, 2, 1, 1)).toBe(1);
    expect(voxelAt(model, 0, 0, 0)).toBe(-1);
    // out of the grid entirely is air, never a crash
    expect(voxelAt(model, 99, 99, 99)).toBe(-1);
  });

  it("refuses layers that are not size rows of size characters", () => {
    expect(() => parseModel(post({ layers: [["....", ".00."], ["....", ".00."]] }))).toThrow();
    expect(() =>
      parseModel(post({ layers: [["...", ".00", ".00", "..."], ["....", ".00.", ".00.", "...."]] })),
    ).toThrow();
  });

  it("refuses a palette index no color answers to", () => {
    expect(() =>
      parseModel(
        post({
          palette: ["#8b8984"],
          layers: [
            ["....", ".00.", ".00.", "...."],
            ["....", ".01.", ".10.", "...."],
          ],
        }),
      ),
    ).toThrow();
  });

  it("refuses dust and refuses a solid block that blows the carving budget", () => {
    const empty = new Array(4).fill("....") as string[];
    expect(() => parseModel(post({ layers: [empty, empty] }))).toThrow();
    const fullRow = "0".repeat(16);
    const fullLayer = new Array(16).fill(fullRow) as string[];
    expect(() =>
      parseModel({
        size: 16,
        palette: ["#8b8984"],
        layers: new Array(20).fill(fullLayer) as string[][],
      }),
    ).toThrow();
  });

  it("the worked example in the rulebook is a buildable model", () => {
    expect(() => parseModel(CREATION_MODEL_EXAMPLE)).not.toThrow();
    const bounds = modelBounds(CREATION_MODEL_EXAMPLE)!;
    expect(bounds.maxY - bounds.minY + 1).toBe(11);
    expect(bounds.solid).toBeGreaterThan(MODEL_LIMITS.minVoxels);
  });

  it("trusts nothing off the wire", () => {
    expect(drawableModel(null)).toBeNull();
    expect(drawableModel("<script>")).toBeNull();
    expect(drawableModel({ size: 4, palette: ["red"], layers: post().layers })).toBeNull();
    expect(drawableModel({ ...post(), size: 3 })).toBeNull();
    expect(drawableModel({ ...post(), layers: [["....", ".0<.", ".00.", "...."]] })).toBeNull();
    expect(drawableModel(post())).not.toBeNull();
  });
});

describe("legacy flat art", () => {
  it("is carved into a solid with real depth, and the carving is drawable", () => {
    const model = modelFromSprite(ninjaSprite);
    expect(drawableModel(model)).not.toBeNull();
    const bounds = modelBounds(model)!;
    expect(bounds.maxZ).toBeGreaterThan(bounds.minZ); // it has a back, not just a face
    expect(bounds.minY).toBe(0); // it stands on the ground
  });

  it("carves the same model every time, for every viewer", () => {
    expect(modelFromSprite(ninjaSprite)).toEqual(modelFromSprite(ninjaSprite));
  });

  it("thickens toward the middle of a shape instead of slabbing it", () => {
    const solid: CreationSprite = {
      size: 8,
      palette: ["#8b8984"],
      pixels: new Array(8).fill("00000000") as string[],
    };
    const model = modelFromSprite(solid);
    const middleLayer = model.layers[4]!;
    const depthAtEdge = middleLayer.filter((row) => row[0] !== ".").length;
    const depthAtCenter = middleLayer.filter((row) => row[4] !== ".").length;
    expect(depthAtCenter).toBeGreaterThan(depthAtEdge);
  });
});

describe("the creation gate", () => {
  const design = {
    name: "Stone Sentinel",
    description: "a watcher cut from the quarry",
    stats: { power: 6, speed: 2, resilience: 7 },
    verbs: ["guard" as const],
    count: 1,
  };

  it("keeps the model a design was designed with", () => {
    const parsed = parseCreationInput({ ...design, model: post() });
    expect(parsed.model.layers).toEqual(post().layers);
  });

  it("carves a legacy sprite into a model and leaves the picture at the door", () => {
    const parsed = parseCreationInput({ ...design, sprite: ninjaSprite });
    expect(parsed.model).toBeDefined();
    expect(drawableModel(parsed.model)).not.toBeNull();
    expect(parsed.sprite).toBeUndefined();
  });

  it("refuses a design with no art at all", () => {
    expect(() => parseCreationInput(design)).toThrow(/model/);
  });
});
