/**
 * The shape of an invented thing — Claudilization's 3D asset format.
 *
 * Everything a player's Claude dreams up is built the way the rest of this
 * world is built: as a solid standing in the light, not a picture pinned to
 * the camera. A model is DATA, never code and never a file — a small palette
 * and a stack of layers, bottom to top, each layer a grid of characters. The
 * renderer turns that stack into real geometry in the island's clay material,
 * so a statue casts a shadow, a dragon has a back, and a siege engine can be
 * walked around.
 *
 * The format is deliberately the sprite grammar with a third dimension: rows
 * of "." and palette digits, which the models compose fluently — one layer per
 * height step. Legacy pixel sprites are never rendered flat again; they are
 * carved into relief by `modelFromSprite` at the gate, so every asset in the
 * world, old or new, is a solid.
 */
import { z } from "zod";
import type { CreationModel, CreationSprite } from "./types";

export const MODEL_LIMITS = {
  /** voxels per side of the footprint (X and Z) */
  minSize: 4,
  maxSize: 16,
  /** layers stacked bottom to top */
  minHeight: 2,
  maxHeight: 20,
  maxPalette: 8,
  /** solid voxels one model may spend — the geometry budget, not a style rule */
  maxVoxels: 2400,
  /** below this it is not an object, it is dust */
  minVoxels: 8,
} as const;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const CreationModelSchema = z
  .object({
    size: z.number().int().min(MODEL_LIMITS.minSize).max(MODEL_LIMITS.maxSize),
    palette: z
      .array(z.string().regex(HEX_COLOR_RE, "palette colors are #rrggbb"))
      .min(1)
      .max(MODEL_LIMITS.maxPalette),
    layers: z
      .array(z.array(z.string().max(MODEL_LIMITS.maxSize)))
      .min(MODEL_LIMITS.minHeight)
      .max(MODEL_LIMITS.maxHeight),
  })
  .superRefine((m, ctx) => {
    const rowRe = new RegExp(`^[.0-7]{${m.size}}$`);
    let solid = 0;
    m.layers.forEach((layer, y) => {
      if (layer.length !== m.size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", y],
          message: `layer ${y} is a ${m.size}x${m.size} floor — exactly ${m.size} rows`,
        });
        return;
      }
      for (let r = 0; r < layer.length; r++) {
        const row = layer[r]!;
        if (!rowRe.test(row)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["layers", y, r],
            message: `layer ${y} row ${r} must be ${m.size} characters of "." or palette digits`,
          });
          return;
        }
        for (const ch of row) {
          if (ch === ".") continue;
          if (Number(ch) >= m.palette.length) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["layers", y, r],
              message: `layer ${y} row ${r} uses palette index ${ch} but the palette has ${m.palette.length} colors`,
            });
            return;
          }
          solid++;
        }
      }
    });
    if (solid < MODEL_LIMITS.minVoxels) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layers"],
        message: `a model needs at least ${MODEL_LIMITS.minVoxels} solid voxels — this one has ${solid}`,
      });
    }
    if (solid > MODEL_LIMITS.maxVoxels) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layers"],
        message: `the carving budget is ${MODEL_LIMITS.maxVoxels} solid voxels — this one spends ${solid}`,
      });
    }
  });

/** Validate one untrusted model definition. Throws with informative issues. */
export function parseModel(input: unknown): CreationModel {
  return CreationModelSchema.parse(input) as CreationModel;
}

/**
 * Renderer-side re-check: models arrive over the wire from a public server, so
 * the client trusts nothing. Returns the model if it is buildable, null if
 * anything is off — callers fall back to a placeholder, never crash.
 */
export function drawableModel(model: unknown): CreationModel | null {
  if (!model || typeof model !== "object") return null;
  const m = model as { size?: unknown; palette?: unknown; layers?: unknown };
  const size = m.size;
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < MODEL_LIMITS.minSize ||
    size > MODEL_LIMITS.maxSize
  )
    return null;
  if (
    !Array.isArray(m.palette) ||
    m.palette.length < 1 ||
    m.palette.length > MODEL_LIMITS.maxPalette ||
    !m.palette.every((c) => typeof c === "string" && HEX_COLOR_RE.test(c))
  )
    return null;
  if (
    !Array.isArray(m.layers) ||
    m.layers.length < 1 ||
    m.layers.length > MODEL_LIMITS.maxHeight
  )
    return null;
  const rowRe = new RegExp(`^[.0-${m.palette.length - 1}]{${size}}$`);
  let solid = 0;
  for (const layer of m.layers) {
    if (!Array.isArray(layer) || layer.length !== size) return null;
    for (const row of layer) {
      if (typeof row !== "string" || !rowRe.test(row)) return null;
      for (const ch of row) if (ch !== ".") solid++;
    }
  }
  if (solid < 1 || solid > MODEL_LIMITS.maxVoxels) return null;
  return { size, palette: m.palette as string[], layers: m.layers as string[][] };
}

/** The palette index standing at a voxel, or -1 for open air. */
export function voxelAt(model: CreationModel, x: number, y: number, z: number): number {
  const layer = model.layers[y];
  if (!layer) return -1;
  const ch = layer[z]?.[x];
  if (!ch || ch === ".") return -1;
  return Number(ch);
}

export interface ModelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  solid: number;
}

/**
 * The occupied box, in voxels. The renderer stands a creation on its lowest
 * solid voxel and centers it on this box, so a model drawn off-center in its
 * grid still plants its feet on the ground instead of hovering.
 */
export function modelBounds(model: CreationModel): ModelBounds | null {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let solid = 0;
  for (let y = 0; y < model.layers.length; y++) {
    for (let z = 0; z < model.size; z++) {
      for (let x = 0; x < model.size; x++) {
        if (voxelAt(model, x, y, z) < 0) continue;
        solid++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  return solid ? { minX, maxX, minY, maxY, minZ, maxZ, solid } : null;
}

/**
 * Carve a legacy pixel sprite into relief.
 *
 * Old saves and stale installs still speak in flat pixels; nothing in this
 * world is drawn flat, so a sprite is extruded along Z with a depth that grows
 * toward the middle of each shape. The result is a rounded clay bas-relief —
 * a real solid with a lit top, a shaded side, and a shadow — rather than a
 * cardboard cut-out. Deterministic: the same sprite always carves the same
 * model, so a spec's look never shifts between two viewers.
 */
export function modelFromSprite(sprite: CreationSprite): CreationModel {
  const size = Math.min(MODEL_LIMITS.maxSize, Math.max(MODEL_LIMITS.minSize, sprite.size));
  const filled = (x: number, r: number): boolean => {
    if (x < 0 || r < 0 || x >= sprite.size || r >= sprite.size) return false;
    const ch = sprite.pixels[r]?.[x];
    return !!ch && ch !== ".";
  };
  // erosion distance: how many shells in from the silhouette a pixel sits
  const depthOf = (x: number, r: number): number => {
    let d = 0;
    while (
      filled(x - d - 1, r) &&
      filled(x + d + 1, r) &&
      filled(x, r - d - 1) &&
      filled(x, r + d + 1)
    )
      d++;
    return d;
  };
  const maxDepth = Math.max(2, Math.round(size * 0.38));
  const layers: string[][] = [];
  for (let r = sprite.size - 1; r >= 0; r--) {
    const layer: string[] = [];
    const rows: string[][] = [];
    for (let z = 0; z < size; z++) rows.push(new Array(size).fill("."));
    for (let x = 0; x < size && x < sprite.size; x++) {
      const ch = sprite.pixels[r]?.[x];
      if (!ch || ch === ".") continue;
      const depth = Math.min(maxDepth, 1 + depthOf(x, r) * 2);
      const start = Math.max(0, Math.floor((size - depth) / 2));
      for (let z = start; z < Math.min(size, start + depth); z++) rows[z]![x] = ch;
    }
    for (const row of rows) layer.push(row.join(""));
    layers.push(layer);
  }
  // drop dead air below and above so the carving stands on the ground
  while (layers.length > MODEL_LIMITS.minHeight && layers[0]!.every((row) => !/[0-7]/.test(row)))
    layers.shift();
  while (
    layers.length > MODEL_LIMITS.minHeight &&
    layers[layers.length - 1]!.every((row) => !/[0-7]/.test(row))
  )
    layers.pop();
  const empty = new Array(size).fill(".".repeat(size)) as string[];
  while (layers.length < MODEL_LIMITS.minHeight) layers.push([...empty]);
  return {
    size,
    palette: sprite.palette.slice(0, MODEL_LIMITS.maxPalette),
    layers: layers.slice(0, MODEL_LIMITS.maxHeight),
  };
}
