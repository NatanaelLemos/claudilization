import * as THREE from "three";
import { modelBounds, voxelAt, type ModelBounds } from "../shared/voxel";
import type { CreationModel } from "../shared/types";

/**
 * Invented things, built as solids.
 *
 * A creation's model is a stack of voxels; this turns that stack into one
 * piece of geometry the island can light and cast shadows from. Two things
 * keep it from looking like a foreign game dropped into the diorama:
 *
 * 1. Greedy meshing. Neighbouring voxels of one color merge into single
 *    quads and interior faces are never emitted, so a 12-high statue is a few
 *    dozen triangles with clean, wide facets rather than a wall of cubes.
 * 2. A painted bake. Every face is tinted by which way it looks — tops catch
 *    the warm key, undersides fall into shadow — and each facet takes a tiny
 *    deterministic wobble in lightness. That is what makes the clay of this
 *    world read as hand-finished instead of flat-shaded plastic.
 *
 * Pure and side-effect free apart from the geometry it returns: the quad pass
 * is exported on its own so the mesher is testable without a canvas.
 */

export interface VoxelQuad {
  /** lower corner in voxel space */
  origin: [number, number, number];
  /** the two in-plane edges, already sized by the merge */
  du: [number, number, number];
  dv: [number, number, number];
  normal: [number, number, number];
  /** index into the model's palette */
  color: number;
}

/**
 * Greedy meshing: for each of the three axes, sweep slice by slice, mark the
 * faces that are actually exposed, and merge equal-colored neighbours into the
 * largest rectangles that fit. Interior faces never reach the GPU.
 */
export function greedyQuads(model: CreationModel): VoxelQuad[] {
  const dims: [number, number, number] = [model.size, model.layers.length, model.size];
  const quads: VoxelQuad[] = [];
  const at = (p: number[]): number => voxelAt(model, p[0]!, p[1]!, p[2]!);

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du_ = dims[u]!;
    const dv_ = dims[v]!;
    const dd = dims[d]!;
    const x = [0, 0, 0];
    const mask = new Int32Array(du_ * dv_);

    for (let slice = -1; slice < dd; ) {
      let n = 0;
      for (let j = 0; j < dv_; j++) {
        for (let i = 0; i < du_; i++, n++) {
          x[d] = slice;
          x[u] = i;
          x[v] = j;
          const a = slice >= 0 ? at(x) : -1;
          x[d] = slice + 1;
          const b = slice < dd - 1 ? at(x) : -1;
          // + = face looking along the axis, − = face looking back down it
          mask[n] = a >= 0 && b < 0 ? a + 1 : b >= 0 && a < 0 ? -(b + 1) : 0;
        }
      }
      slice++;
      x[d] = slice;

      n = 0;
      for (let j = 0; j < dv_; j++) {
        for (let i = 0; i < du_; ) {
          const c = mask[n]!;
          if (!c) {
            i++;
            n++;
            continue;
          }
          let w = 1;
          while (i + w < du_ && mask[n + w] === c) w++;
          let h = 1;
          grow: while (j + h < dv_) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * du_] !== c) break grow;
            h++;
          }
          x[u] = i;
          x[v] = j;
          const du: [number, number, number] = [0, 0, 0];
          du[u] = w;
          const dv: [number, number, number] = [0, 0, 0];
          dv[v] = h;
          const normal: [number, number, number] = [0, 0, 0];
          normal[d] = c > 0 ? 1 : -1;
          quads.push({
            origin: [x[0]!, x[1]!, x[2]!],
            du,
            dv,
            normal,
            color: Math.abs(c) - 1,
          });
          for (let l = 0; l < h; l++)
            for (let k = 0; k < w; k++) mask[n + k + l * du_] = 0;
          i += w;
          n += w;
        }
      }
    }
  }
  return quads;
}

/**
 * How much light a facet keeps, by the way it faces. Warm above, deep below,
 * the two side pairs a touch apart so a silhouette never flattens out.
 */
export function faceShade(normal: [number, number, number]): number {
  if (normal[1] > 0) return 1.07; // sun-facing top
  if (normal[1] < 0) return 0.62; // underside
  if (normal[0] !== 0) return normal[0] > 0 ? 0.94 : 0.86;
  return normal[2] > 0 ? 1.0 : 0.82;
}

/** A small, stable wobble per facet — the fingerprints in the clay. */
function wobble(x: number, y: number, z: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return 0.97 + (h - Math.floor(h)) * 0.06;
}

export interface BuiltModel {
  geometry: THREE.BufferGeometry;
  /** world height of the finished piece, for bobbing and shadow sizing */
  height: number;
  /** world footprint radius, for the contact shadow */
  radius: number;
}

/**
 * Build one creation's geometry. `span` is the world size the model's largest
 * occupied dimension is fitted to, so a squat golem and a long dragon end up
 * at comparable, diorama-scale weights. The piece is centered over its own
 * footprint and stands on y = 0, whatever corner of the grid it was drawn in.
 */
export function buildModel(model: CreationModel, span: number): BuiltModel | null {
  const bounds: ModelBounds | null = modelBounds(model);
  if (!bounds) return null;
  const extentX = bounds.maxX - bounds.minX + 1;
  const extentY = bounds.maxY - bounds.minY + 1;
  const extentZ = bounds.maxZ - bounds.minZ + 1;
  const unit = span / Math.max(extentX, extentY, extentZ);
  const cx = (bounds.minX + bounds.maxX + 1) / 2;
  const cz = (bounds.minZ + bounds.maxZ + 1) / 2;
  const floor = bounds.minY;

  const quads = greedyQuads(model);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const paint = model.palette.map((hex) => new THREE.Color(hex));
  const fallback = new THREE.Color("#b9a389");
  const tmp = new THREE.Color();

  for (const quad of quads) {
    let { du, dv } = quad;
    // wind each face outward: if the edge pair crosses against the normal,
    // swap them so front faces are front faces from every angle
    const cross: [number, number, number] = [
      du[1]! * dv[2]! - du[2]! * dv[1]!,
      du[2]! * dv[0]! - du[0]! * dv[2]!,
      du[0]! * dv[1]! - du[1]! * dv[0]!,
    ];
    const facing =
      cross[0]! * quad.normal[0]! + cross[1]! * quad.normal[1]! + cross[2]! * quad.normal[2]!;
    if (facing < 0) [du, dv] = [dv, du];

    const base = positions.length / 3;
    const corners: [number, number, number][] = [
      [quad.origin[0], quad.origin[1], quad.origin[2]],
      [quad.origin[0] + du[0]!, quad.origin[1] + du[1]!, quad.origin[2] + du[2]!],
      [
        quad.origin[0] + du[0]! + dv[0]!,
        quad.origin[1] + du[1]! + dv[1]!,
        quad.origin[2] + du[2]! + dv[2]!,
      ],
      [quad.origin[0] + dv[0]!, quad.origin[1] + dv[1]!, quad.origin[2] + dv[2]!],
    ];
    const shade =
      faceShade(quad.normal) * wobble(quad.origin[0], quad.origin[1], quad.origin[2]);
    tmp.copy(paint[quad.color] ?? fallback).multiplyScalar(shade);
    for (const [vx, vy, vz] of corners) {
      positions.push((vx - cx) * unit, (vy - floor) * unit, (vz - cz) * unit);
      normals.push(quad.normal[0], quad.normal[1], quad.normal[2]);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return {
    geometry,
    height: extentY * unit,
    radius: (Math.max(extentX, extentZ) * unit) / 2,
  };
}
