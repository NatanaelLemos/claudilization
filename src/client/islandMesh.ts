import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import { generateIsland } from "../shared/terrain";
import {
  CLAY_PALETTE,
  clayMaterial,
  islandPalette,
  type IslandPalette,
} from "./artDirection";
import { compactStaticMeshes } from "./meshCompaction";
import { setBatchedAssetPicks, setInstanceAssetPicks, type AssetPick } from "./picking";

/**
 * Pick one representative resource prop per world-space cell. Simulation
 * nodes remain untouched; this only stops large islands from drawing a
 * boulder for every unit of a dense underground seam.
 */
export function spatiallyThinResourceVisuals<
  T extends { nodeId: string; tile: { x: number; y: number } },
>(nodes: readonly T[], cellSize: number): T[] {
  const cells = new Map<string, T>();
  for (const node of nodes) {
    const key = `${Math.floor(node.tile.x / cellSize)},${Math.floor(node.tile.y / cellSize)}`;
    const current = cells.get(key);
    if (!current || hashString(node.nodeId) > hashString(current.nodeId)) cells.set(key, node);
  }
  return [...cells.values()].sort((a, b) =>
    a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
  );
}

const AMP = 7;
const SEA = 0.2;
const TERRAIN_LOD_DISTANCE = 240;
/** Fine decoration — meadows, blooms, shrubs — hides beyond this range. */
export const DECOR_FINE_DISTANCE = 260;
export const DECOR_FINE_GROUP = "island-decor-fine";

/**
 * Visual relief only: the same tile heights the whole game reasons about,
 * shaped so the island reads as a sculpted diorama instead of a flat disc.
 * The interior swells into soft rolling hills and the shore banks round off
 * and dip faster under the sea. Every placed thing — buildings, settlers,
 * paths, props — reads its ground through this one function, so gameplay
 * tile logic and save data never move.
 */
export function surfaceY(height: number): number {
  const base = (height - SEA) * AMP;
  if (height <= SEA) return base * 1.7;
  const t = Math.min(1, Math.max(0, (height - 0.42) / 0.58));
  const s = t * t * (3 - 2 * t);
  return base + s * 3.8;
}

/** the eight compass directions an occlusion probe walks */
const AO_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
/** probe distances in tiles — near creases, then the shadow of a whole cliff */
const AO_RADII: readonly number[] = [1, 2, 4, 7];
/** how much of a vertex's pigment the deepest crease is allowed to take */
const AO_STRENGTH = 0.46;
/** and how much a fully open ridge is allowed to gain back */
const AO_SKY_LIFT = 0.07;
/**
 * Gain on the horizon tangent before it is rolled into 0..1. Raw tangents are
 * the wrong instrument for this island: the relief is deliberately soft
 * rolling meadow, so an honest 3° slope answers 0.05 and the whole bake
 * disappears. The reference is not physically honest either — Townscaper
 * exaggerates contact darkening far past what the geometry earns, because
 * that darkening *is* the form. A gain of 6 puts a gentle meadow fold in the
 * middle of the response curve where it can be seen.
 */
const AO_TANGENT_GAIN = 6;
/** radius, in tiles, of the ring that decides whether a vertex sits in a bowl */
const AO_BOWL_RADIUS = 6;
/** how far the bowl/dome term may swing a vertex either way */
const AO_BOWL_STRENGTH = 0.055;
/** world height difference that counts as a full bowl */
const AO_BOWL_SCALE = 1.6;

/**
 * Baked sky occlusion for one island's heightfield, per tile, 0 (open sky) to
 * 1 (buried in a crease).
 *
 * This is the reference's dominant read: in Townscaper almost nothing is lit
 * by a shadow map — the form is carried by darkening where surfaces face each
 * other and brightening where they face the sky. A per-frame screen-space
 * pass would cost the one thing this world cannot spend, so the occlusion is
 * measured once at mesh time from the same tile heights the simulation uses
 * and folded into the vertex colours the terrain already carries. It is free
 * at render, it survives into the distant LOD mesh (which samples these exact
 * colours), and it is deterministic from the seed like everything else here.
 *
 * Each probe walks eight compass directions and keeps the steepest horizon it
 * finds; a tangent of 1 (a 45° wall) counts as half-occluded. Sea tiles get a
 * softened share so a lagoon under a headland still deepens without the
 * seabed turning to soot.
 */
export function terrainSkyOcclusion(
  heights: Readonly<Float32Array>,
  size: number,
): Float32Array {
  const occlusion = new Float32Array(heights.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const here = heights[index]!;
      let sum = 0;
      let ring = 0;
      let ringCount = 0;
      for (const [dx, dy] of AO_DIRECTIONS) {
        // a diagonal step covers √2 tiles of ground for the same rise
        const stride = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
        let horizon = 0;
        for (const radius of AO_RADII) {
          const sx = x + dx * radius;
          const sy = y + dy * radius;
          // off the island is open sky, not a wall
          if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
          const rise = heights[sy * size + sx]! - here;
          if (rise <= 0) continue;
          const tangent = (rise / (radius * stride)) * AO_TANGENT_GAIN;
          if (tangent > horizon) horizon = tangent;
        }
        sum += horizon / (horizon + 1);
        const bx = x + dx * AO_BOWL_RADIUS;
        const by = y + dy * AO_BOWL_RADIUS;
        if (bx >= 0 && by >= 0 && bx < size && by < size) {
          ring += heights[by * size + bx]!;
          ringCount++;
        }
      }
      // Bowl vs dome: the horizon walk only sees what is above a vertex, so a
      // broad meadow saddle and a broad meadow crown answer the same. Compare
      // the vertex against the mean of a wide ring around it and the island's
      // large forms come back — hollows settle, crowns catch the sky.
      const bowl = ringCount > 0 ? (ring / ringCount - here) / AO_BOWL_SCALE : 0;
      const shaped =
        sum / AO_DIRECTIONS.length + Math.max(-1, Math.min(1, bowl)) * AO_BOWL_STRENGTH;
      occlusion[index] = Math.max(0, Math.min(1, shaped));
    }
  }
  return occlusion;
}

/** Terrain + nature for one island, regenerated deterministically from its seed. */
export function createIslandGroup(
  seed: number,
  size: number,
  islandId = "unknown-island",
  options: { propScale?: number } = {},
): THREE.Group {
  const propScale = options.propScale ?? 1;
  const terrain = generateIsland(seed, size);
  const palette = islandPalette(seed);
  const group = new THREE.Group();
  const half = size / 2;

  const geo = new THREE.PlaneGeometry(size, size, size - 1, size - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const shade = mulberry32(hashString(`${seed}|shade`));
  const tinted = new THREE.Color();
  const grassLow = new THREE.Color(palette.grassLight);
  const grassHigh = new THREE.Color(palette.grass);
  const moss = new THREE.Color(palette.canopy[1]);
  const rockWarm = new THREE.Color(palette.rock).lerp(new THREE.Color(palette.soil), 0.38);
  const rockDark = new THREE.Color(CLAY_PALETTE.stoneDark);
  const sandBase = new THREE.Color(CLAY_PALETTE.sand);
  const lagoon = new THREE.Color(CLAY_PALETTE.oceanDeep);
  const smooth = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  // one occlusion bake over the sculpted relief — the same surface the eye
  // sees, not the raw gameplay height, so a rounded shore reads rounded
  const surfaceHeights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    surfaceHeights[i] = surfaceY(terrain.tiles[i]!.height);
  }
  const occlusion = terrainSkyOcclusion(surfaceHeights, size);
  for (let i = 0; i < pos.count; i++) {
    const gx = i % size;
    const gy = Math.floor(i / size);
    const tile = terrain.tiles[gy * size + gx]!;
    pos.setY(i, surfaceY(tile.height));
    // an elevation ramp instead of four flat pots: bright meadow low, working
    // green mid, moss toward the heights, then warm banded rock — with the
    // same per-vertex jitter that keeps clay from reading as plastic
    switch (tile.kind) {
      case "water":
        tinted.copy(sandBase).lerp(lagoon, smooth(SEA, 0.04, tile.height));
        break;
      case "sand":
        tinted.copy(sandBase).offsetHSL(0, 0, smooth(0.28, SEA, tile.height) * 0.05);
        break;
      case "grass":
        tinted.copy(grassLow).lerp(grassHigh, smooth(0.3, 0.58, tile.height));
        tinted.lerp(moss, smooth(0.56, 0.7, tile.height) * 0.4);
        break;
      default: {
        // rock — warm, moss-edged clay strata rather than a single grey
        // terrain blob. High faces stay stone; low shelves belong to the same
        // painted earth as the town paths around them.
        const band = Math.sin(tile.height * 46) * 0.5 + 0.5;
        const high = smooth(0.62, 0.9, tile.height);
        tinted.copy(rockWarm).lerp(rockDark, 0.08 + band * 0.16 + high * 0.1);
        tinted.lerp(moss, (1 - high) * 0.12);
        break;
      }
    }
    tinted.offsetHSL(0, 0, (shade() - 0.5) * 0.045 + (tile.height - SEA) * 0.05);
    // baked sky occlusion: valleys, cliff feet and the inner corners of every
    // fold go down, open ridges come up. Creases also cool very slightly —
    // a shadow in a clay diorama is skylight, not an absence of light.
    const occ = occlusion[i]! * (tile.kind === "water" ? 0.45 : 1);
    const lit = 1 - AO_STRENGTH * occ + AO_SKY_LIFT * (1 - occ) * (1 - occ);
    tinted.setRGB(
      tinted.r * lit,
      tinted.g * lit,
      tinted.b * (lit + 0.05 * occ),
    );
    colors[i * 3] = tinted.r;
    colors[i * 3 + 1] = tinted.g;
    colors[i * 3 + 2] = tinted.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    clayMaterial({ color: "#ffffff", vertexColors: true }),
  );
  ground.name = "ground-high";
  ground.userData.artFamily = "clay-terrain";
  ground.receiveShadow = true;

  // At map distance a 166×166 grid spends ~54k triangles on sub-pixel detail.
  // Sample the exact same terrain and vertex colours into a coarse mesh; the
  // watched island remains full resolution and LOD switches only beyond it.
  const lowSegments = terrainLodSegments(size);
  const lowGeo = new THREE.PlaneGeometry(size, size, lowSegments, lowSegments);
  lowGeo.rotateX(-Math.PI / 2);
  const lowPos = lowGeo.attributes.position as THREE.BufferAttribute;
  const lowColors = new Float32Array(lowPos.count * 3);
  for (let i = 0; i < lowPos.count; i++) {
    const lx = i % (lowSegments + 1);
    const ly = Math.floor(i / (lowSegments + 1));
    const gx = Math.round((lx / lowSegments) * (size - 1));
    const gy = Math.round((ly / lowSegments) * (size - 1));
    const source = gy * size + gx;
    const tile = terrain.tiles[source]!;
    lowPos.setY(i, surfaceY(tile.height));
    lowColors[i * 3] = colors[source * 3]!;
    lowColors[i * 3 + 1] = colors[source * 3 + 1]!;
    lowColors[i * 3 + 2] = colors[source * 3 + 2]!;
  }
  lowGeo.setAttribute("color", new THREE.BufferAttribute(lowColors, 3));
  lowGeo.computeVertexNormals();
  const lowGround = new THREE.Mesh(
    lowGeo,
    clayMaterial({ color: "#ffffff", vertexColors: true }),
  );
  lowGround.name = "ground-low";
  lowGround.receiveShadow = true;
  const groundLod = new THREE.LOD();
  groundLod.name = "ground";
  groundLod.addLevel(ground, 0);
  groundLod.addLevel(lowGround, TERRAIN_LOD_DISTANCE);
  group.add(groundLod);
  const resources = new THREE.Group();
  resources.name = "resources";
  group.add(resources);

  const heightAt = (x: number, y: number) => {
    const tile = terrain.tiles[Math.round(y) * size + Math.round(x)];
    return tile ? surfaceY(tile.height) : 0;
  };

  // nature: instanced trees and rocks, plus wild food — grazing animals,
  // fishing shoals, apple trees, and berry bushes — at the terrain's nodes
  interface NodeVisual {
    nodeId: string;
    resource: string;
    source?: string;
    pos: THREE.Vector3;
    tile: { x: number; y: number };
  }
  const byResource = { wood: [] as NodeVisual[], stone: [] as NodeVisual[] };
  const foodNodes: (NodeVisual & { source: string })[] = [];
  const mineralNodes: NodeVisual[] = [];
  for (const node of terrain.nodes) {
    const p = new THREE.Vector3(
      node.pos.x - half,
      heightAt(node.pos.x, node.pos.y),
      node.pos.y - half,
    );
    const visual: NodeVisual = {
      nodeId: node.id,
      resource: node.resource,
      pos: p,
      tile: node.pos,
    };
    if (node.resource === "food") {
      foodNodes.push({ ...visual, source: node.source ?? "berry-bushes" });
      continue;
    }
    const list = byResource[node.resource as keyof typeof byResource];
    if (list) list.push(visual);
    else mineralNodes.push(visual);
  }

  // sized against the settlers (~1.65 tall): trees tower, rocks reach the
  // knee-to-waist, bushes sit about hip height
  const jitter = mulberry32(hashString(`${seed}|nature`));

  // ── composed groves ──────────────────────────────────────────────────────
  // Every wood node becomes a small grove: the harvestable tree stands at
  // the node in one of three species — broadleaf, pine, cypress — coloured
  // from the island's own canopy pots, and companion trees cluster around
  // it. Companions are pure composition, so they live in the distance-culled
  // decoration layer: a distant island costs exactly one tree per node, the
  // same budget the old forest paid, while a watched island reads as groves
  // with clearings between them.
  interface TreePlacement {
    node: NodeVisual;
    x: number;
    y: number;
    z: number;
    s: number;
    rotY: number;
    species: "broadleaf" | "pine" | "cypress";
    color: THREE.Color;
  }
  const decorGroup = new THREE.Group();
  decorGroup.name = DECOR_FINE_GROUP;
  const groveRng = mulberry32(hashString(`${seed}|groves`));
  const primaries: TreePlacement[] = [];
  const companions: TreePlacement[] = [];
  const canopyPots = palette.canopy.map((hex) => new THREE.Color(hex));
  for (const node of byResource.wood) {
    const count = 1 + (groveRng() < 0.7 ? 1 : 0) + (groveRng() < 0.35 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = groveRng() * Math.PI * 2;
      const r = i === 0 ? 0 : 0.7 + groveRng() * 1.4;
      const tx = node.tile.x + Math.cos(a) * r;
      const ty = node.tile.y + Math.sin(a) * r;
      const kind = terrain.tiles[Math.round(ty) * size + Math.round(tx)]?.kind;
      if (i > 0 && (kind === "water" || kind === undefined)) continue;
      const roll = groveRng();
      const species = roll < 0.55 ? "broadleaf" : roll < 0.85 ? "pine" : "cypress";
      const color = new THREE.Color(
        species === "broadleaf"
          ? canopyPots[groveRng() < 0.3 ? 2 : 0]!
          : canopyPots[groveRng() < 0.25 ? 0 : 1]!,
      ).offsetHSL(0, 0, (groveRng() - 0.5) * 0.06);
      (i === 0 ? primaries : companions).push({
        node,
        x: tx - half,
        y: heightAt(tx, ty),
        z: ty - half,
        s: (i === 0 ? 0.95 : 0.6) + groveRng() * 0.35,
        rotY: groveRng() * Math.PI * 2,
        species,
        color,
      });
    }
  }
  const plantTrees = (
    trees: TreePlacement[],
    parent: THREE.Group,
    namePrefix: string,
    withPicks: boolean,
  ): void => {
    if (!trees.length) return;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.24, 1.8, 5),
      clayMaterial({ color: CLAY_PALETTE.wood }),
      trees.length,
    );
    const round = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.05, 0),
      clayMaterial({ color: "#ffffff" }),
      trees.filter((t) => t.species === "broadleaf").length,
    );
    const cones = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 2.4, 6),
      clayMaterial({ color: "#ffffff" }),
      trees.filter((t) => t.species !== "broadleaf").length,
    );
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scl = new THREE.Vector3();
    const posV = new THREE.Vector3();
    const roundPicks: AssetPick[] = [];
    const conePicks: AssetPick[] = [];
    const trunkPicks: AssetPick[] = [];
    let roundIndex = 0;
    let coneIndex = 0;
    for (const [index, tree] of trees.entries()) {
      const pick: AssetPick = {
        kind: "resource",
        islandId,
        nodeId: tree.node.nodeId,
        resource: tree.node.resource,
        label: "Trees",
        meta: "natural resource",
      };
      quat.setFromEuler(euler.set(0, tree.rotY, 0));
      matrix.compose(
        posV.set(tree.x, tree.y + 0.9 * tree.s, tree.z),
        quat,
        scl.setScalar(tree.s),
      );
      trunks.setMatrixAt(index, matrix);
      trunkPicks.push(pick);
      if (tree.species === "broadleaf") {
        matrix.compose(
          posV.set(tree.x, tree.y + 2.5 * tree.s, tree.z),
          quat,
          scl.set(1.15 * tree.s, 1.0 * tree.s, 1.15 * tree.s),
        );
        round.setMatrixAt(roundIndex, matrix);
        round.setColorAt(roundIndex, tree.color);
        roundPicks.push(pick);
        roundIndex += 1;
      } else if (tree.species === "pine") {
        matrix.compose(
          posV.set(tree.x, tree.y + 2.3 * tree.s, tree.z),
          quat,
          scl.set(0.95 * tree.s, 1.15 * tree.s, 0.95 * tree.s),
        );
        cones.setMatrixAt(coneIndex, matrix);
        cones.setColorAt(coneIndex, tree.color);
        conePicks.push(pick);
        coneIndex += 1;
      } else {
        matrix.compose(
          posV.set(tree.x, tree.y + 2.9 * tree.s, tree.z),
          quat,
          scl.set(0.52 * tree.s, 1.65 * tree.s, 0.52 * tree.s),
        );
        cones.setMatrixAt(coneIndex, matrix);
        cones.setColorAt(coneIndex, tree.color);
        conePicks.push(pick);
        coneIndex += 1;
      }
    }
    for (const [mesh, picks, suffix] of [
      [trunks, trunkPicks, "trunks"],
      [round, roundPicks, "crowns"],
      [cones, conePicks, "conifers"],
    ] as const) {
      if (!mesh.count) {
        mesh.dispose();
        continue;
      }
      mesh.name = `${namePrefix}-${suffix}`;
      mesh.castShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      if (withPicks) setInstanceAssetPicks(mesh, picks);
      parent.add(mesh);
    }
  };
  plantTrees(primaries, resources, "clay-tree", true);
  if (propScale > 0) plantTrees(companions, decorGroup, "clay-grove", false);

  // ── sculpted outcrops ────────────────────────────────────────────────────
  // Stone reads as a few large rounded boulders with a companion stone, not
  // a field of identical pebbles. Two instanced meshes for the whole island.
  const stoneVisuals = spatiallyThinResourceVisuals(byResource.stone, 7);
  if (stoneVisuals.length) {
    const outcropRng = mulberry32(hashString(`${seed}|outcrops`));
    const rockMatWarm = clayMaterial({ color: palette.rock });
    const rockMatDark = clayMaterial({ color: CLAY_PALETTE.stoneDark });
    const bigRocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.95, 1),
      rockMatWarm,
      stoneVisuals.length,
    );
    const smallRocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      rockMatDark,
      stoneVisuals.length,
    );
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scl = new THREE.Vector3();
    const posV = new THREE.Vector3();
    const picks: AssetPick[] = [];
    stoneVisuals.forEach((node, index) => {
      const s = 0.58 + outcropRng() * 0.36;
      quat.setFromEuler(euler.set(0, outcropRng() * Math.PI * 2, 0));
      matrix.compose(
        posV.set(node.pos.x, node.pos.y + 0.5 * s, node.pos.z),
        quat,
        scl.set((1.18 + outcropRng() * 0.38) * s, (0.68 + outcropRng() * 0.28) * s, (0.95 + outcropRng() * 0.34) * s),
      );
      bigRocks.setMatrixAt(index, matrix);
      const a = outcropRng() * Math.PI * 2;
      const r = 1.0 + outcropRng() * 0.5;
      const s2 = (0.55 + outcropRng() * 0.4) * s;
      quat.setFromEuler(euler.set(0, outcropRng() * Math.PI * 2, 0));
      matrix.compose(
        posV.set(node.pos.x + Math.cos(a) * r, node.pos.y + 0.24 * s2, node.pos.z + Math.sin(a) * r),
        quat,
        scl.set(s2, s2 * 0.8, s2),
      );
      smallRocks.setMatrixAt(index, matrix);
      picks.push({
        kind: "resource",
        islandId,
        nodeId: node.nodeId,
        resource: node.resource,
        label: "Stone Outcrop",
        meta: "natural resource",
      });
    });
    for (const mesh of [bigRocks, smallRocks]) {
      mesh.name = mesh === bigRocks ? "clay-outcrops" : "clay-outcrop-stones";
      mesh.castShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      setInstanceAssetPicks(mesh, picks);
      resources.add(mesh);
    }
  }

  const mats = {
    trunk: clayMaterial({ color: CLAY_PALETTE.wood }),
    canopy: clayMaterial({ color: palette.canopy[2] }),
    apple: clayMaterial({ color: CLAY_PALETTE.terracotta }),
    bush: clayMaterial({ color: palette.canopy[0] }),
    berry: clayMaterial({ color: "#7d587e" }),
    hide: clayMaterial({ color: "#987555" }),
    fin: clayMaterial({ color: "#9abcc5" }),
    ripple: clayMaterial({
      color: CLAY_PALETTE.foam,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  };
  const foodBatches = new Map<
    THREE.Material,
    { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; pick: AssetPick }[]
  >();
  const kindAt = (x: number, y: number) =>
    terrain.tiles[Math.round(y) * size + Math.round(x)]?.kind;
  for (const node of foodNodes) {
    const piece = compactStaticMeshes(createFoodSource(node.source, jitter, mats));
    const s = 0.85 + jitter() * 0.4;
    piece.scale.multiplyScalar(s);
    piece.rotation.y = jitter() * Math.PI * 2;
    if (node.source === "fish") {
      // the shoal sits just offshore: nudged from the beach node into the water
      let off = { x: 0, z: 0 };
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (kindAt(node.tile.x + dx, node.tile.y + dy) === "water") {
          off = { x: dx * 1.4, z: dy * 1.4 };
          break;
        }
      }
      piece.position.set(node.pos.x + off.x, 0.02, node.pos.z + off.z);
    } else {
      piece.position.copy(node.pos);
    }
    const pick: AssetPick = {
      kind: "resource",
      islandId,
      nodeId: node.nodeId,
      resource: node.resource,
      source: node.source,
      label: node.source,
      meta: "food source",
    };
    piece.updateMatrix();
    for (const child of piece.children) {
      if (!(child as THREE.Mesh).isMesh) continue;
      const mesh = child as THREE.Mesh;
      if (Array.isArray(mesh.material)) continue;
      const items = foodBatches.get(mesh.material) ?? [];
      items.push({ geometry: mesh.geometry, matrix: piece.matrix.clone(), pick });
      foodBatches.set(mesh.material, items);
    }
  }
  for (const [material, items] of foodBatches) {
    const vertexCapacity = items.reduce(
      (sum, item) => sum + item.geometry.getAttribute("position").count,
      0,
    );
    const indexCapacity = items.reduce(
      (sum, item) => sum + (item.geometry.index?.count ?? 0),
      0,
    );
    const batch = new THREE.BatchedMesh(items.length, vertexCapacity, indexCapacity, material);
    const picks: AssetPick[] = [];
    for (const item of items) {
      const geometryId = batch.addGeometry(item.geometry);
      const instanceId = batch.addInstance(geometryId);
      batch.setMatrixAt(instanceId, item.matrix);
      picks[instanceId] = item.pick;
    }
    batch.castShadow = true;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    setBatchedAssetPicks(batch, picks);
    resources.add(batch);
  }

  // mineral lodes: a grey outcrop shot through with the ore's own color —
  // the exotic finds of the late ages glow faintly where they break ground
  const mineralChunkGeo = new THREE.IcosahedronGeometry(0.36);
  const chunks = new Map<
    string,
    { matrices: THREE.Matrix4[]; picks: Parameters<typeof setInstanceAssetPicks>[1] }
  >();
  const mineralPosition = new THREE.Vector3();
  const mineralScale = new THREE.Vector3();
  const mineralRotation = new THREE.Quaternion();
  const mineralEuler = new THREE.Euler();
  const mineralVisuals = spatiallyThinResourceVisuals(mineralNodes, 7);
  for (const node of mineralVisuals) {
    const meta = MINERALS[node.resource];
    if (!meta) continue;
    const s = 0.62 + jitter() * 0.28;
    const rotationY = jitter() * Math.PI * 2;
    mineralRotation.setFromEuler(mineralEuler.set(0, rotationY, 0));
    mineralScale.setScalar(s);
    let oreMat = mineralMats.get(node.resource);
    if (!oreMat) {
      oreMat = clayMaterial({ color: meta.color, emissive: meta.emissive });
      mineralMats.set(node.resource, oreMat);
    }
    const pick = {
      kind: "resource" as const,
      islandId,
      nodeId: node.nodeId,
      resource: node.resource,
      label: `${node.resource} deposit`,
      meta: "natural resource",
    };
    let resourceChunks = chunks.get(node.resource);
    if (!resourceChunks) {
      resourceChunks = { matrices: [], picks: [] };
      chunks.set(node.resource, resourceChunks);
    }
    mineralRotation.setFromEuler(mineralEuler.set(0, jitter() * Math.PI * 2, 0));
    resourceChunks.matrices.push(
      new THREE.Matrix4().compose(
        mineralPosition.set(
          node.pos.x + 0.3 * s,
          node.pos.y + 0.5 * s,
          node.pos.z + 0.12 * s,
        ),
        mineralRotation,
        mineralScale,
      ),
    );
    resourceChunks.picks.push(pick);
  }
  for (const [resource, batch] of chunks) {
    const material = mineralMats.get(resource);
    if (!material || !batch.matrices.length) continue;
    const mesh = new THREE.InstancedMesh(mineralChunkGeo, material, batch.matrices.length);
    batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.castShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    setInstanceAssetPicks(mesh, batch.picks);
    resources.add(mesh);
  }

  // ── meadows ──────────────────────────────────────────────────────────────
  // Pure decoration, deterministic from the seed: a handful of flowering
  // clearings with clay blooms and shrubs, leaving deliberate negative space
  // between the groves. No picks, no gameplay, hidden beyond map range.
  if (propScale > 0) {
    buildMeadows(decorGroup, terrain, size, half, heightAt, seed, palette, propScale);
  }
  if (decorGroup.children.length) group.add(decorGroup);

  group.userData.heightAt = heightAt;
  group.userData.half = half;
  group.userData.palette = palette;
  group.userData.assetRoots = [resources];
  // the water's bathymetry stamp re-reads this exact terrain — no second
  // generateIsland, no extra RNG, the same tiles the island itself renders
  group.userData.terrain = terrain;
  return group;
}

function buildMeadows(
  decor: THREE.Group,
  terrain: ReturnType<typeof generateIsland>,
  size: number,
  half: number,
  heightAt: (x: number, y: number) => number,
  seed: number,
  palette: IslandPalette,
  propScale: number,
): void {
  if (propScale <= 0) return;
  const rng = mulberry32(hashString(`${seed}|meadow`));
  const nodeTiles = new Set(terrain.nodes.map((n) => `${n.pos.x},${n.pos.y}`));
  const grassTiles = terrain.tiles.filter(
    (t) => t.kind === "grass" && !nodeTiles.has(`${t.x},${t.y}`),
  );
  if (!grassTiles.length) return;
  const patchCount = Math.min(
    10,
    Math.max(4, Math.round((grassTiles.length / 1500) * propScale)),
  );
  interface Sprout {
    x: number;
    y: number;
    z: number;
    s: number;
    color: THREE.Color;
  }
  const blooms: Sprout[] = [];
  const shrubs: Sprout[] = [];
  const bloomPots = palette.bloom.map((hex) => new THREE.Color(hex));
  const shrubPots = [new THREE.Color(palette.canopy[0]), new THREE.Color(palette.canopy[1])];
  const kindAt = (x: number, y: number) =>
    terrain.tiles[Math.round(y) * size + Math.round(x)]?.kind;
  for (let p = 0; p < patchCount; p++) {
    const centre = grassTiles[Math.floor(rng() * grassTiles.length)]!;
    const flowerCount = Math.round((9 + rng() * 8) * propScale);
    for (let i = 0; i < flowerCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * rng() * 4.5;
      const tx = centre.x + Math.cos(a) * r;
      const ty = centre.y + Math.sin(a) * r;
      if (kindAt(tx, ty) !== "grass") continue;
      blooms.push({
        x: tx - half,
        y: heightAt(tx, ty),
        z: ty - half,
        s: 0.7 + rng() * 0.6,
        color: bloomPots[Math.floor(rng() * bloomPots.length)]!,
      });
    }
    const shrubCount = Math.round((2 + rng() * 3) * propScale);
    for (let i = 0; i < shrubCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = 1 + rng() * 5;
      const tx = centre.x + Math.cos(a) * r;
      const ty = centre.y + Math.sin(a) * r;
      if (kindAt(tx, ty) !== "grass") continue;
      shrubs.push({
        x: tx - half,
        y: heightAt(tx, ty),
        z: ty - half,
        s: 0.55 + rng() * 0.5,
        color: shrubPots[Math.floor(rng() * shrubPots.length)]!
          .clone()
          .offsetHSL(0, 0, (rng() - 0.5) * 0.05),
      });
    }
  }
  if (!blooms.length && !shrubs.length) return;
  const matrix = new THREE.Matrix4();
  const place = (
    list: Sprout[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
    lift: number,
    tint = true,
  ) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((item, index) => {
      matrix.makeScale(item.s, item.s, item.s);
      matrix.setPosition(item.x, item.y + lift * item.s, item.z);
      mesh.setMatrixAt(index, matrix);
      if (tint) mesh.setColorAt(index, item.color);
    });
    mesh.name = name;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    decor.add(mesh);
  };
  place(
    blooms,
    new THREE.SphereGeometry(0.11, 5, 4),
    clayMaterial({ color: "#ffffff" }),
    "meadow-blooms",
    0.34,
  );
  place(
    blooms,
    new THREE.ConeGeometry(0.045, 0.4, 4),
    clayMaterial({ color: palette.canopy[1] }),
    "meadow-stems",
    0.18,
    false,
  );
  place(
    shrubs,
    new THREE.DodecahedronGeometry(0.42, 0),
    clayMaterial({ color: "#ffffff" }),
    "meadow-shrubs",
    0.28,
  );
}

export function terrainLodSegments(size: number): number {
  return Math.max(16, Math.ceil((Math.max(2, size) - 1) / 4));
}

/** each ore breaks ground in its own color; late-age finds get a glow */
const MINERALS: Record<string, { color: string; emissive?: string }> = {
  copper: { color: "#c47b3d" },
  tin: { color: "#a7b0b8" },
  iron: { color: "#5d626b" },
  marble: { color: "#efeae2" },
  gold: { color: "#e3b544" },
  silver: { color: "#d6dbe2" },
  preciousMetals: { color: "#e0a458" },
  gems: { color: "#8a5fc9", emissive: "#3d2266" },
  coal: { color: "#2f3136" },
  oil: { color: "#23232b" },
  gas: { color: "#9fb8ad" },
  plutonium: { color: "#7fd44f", emissive: "#2f8f1f" },
  antimatter: { color: "#d16fff", emissive: "#7a28c4" },
};
const mineralMats = new Map<string, THREE.MeshStandardMaterial>();

interface FoodMats {
  trunk: THREE.Material;
  canopy: THREE.Material;
  apple: THREE.Material;
  bush: THREE.Material;
  berry: THREE.Material;
  hide: THREE.Material;
  fin: THREE.Material;
  ripple: THREE.Material;
}

function foodPart(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

/**
 * One wild food node as a small vignette: a berry patch, an apple tree, a
 * pair of grazing animals, or a fish shoal breaking the surface offshore.
 */
function createFoodSource(source: string, jitter: () => number, mats: FoodMats): THREE.Group {
  const g = new THREE.Group();
  switch (source) {
    case "fish": {
      const fin = new THREE.ConeGeometry(0.1, 0.28, 4);
      for (let i = 0; i < 4; i++) {
        const a = jitter() * Math.PI * 2;
        const f = foodPart(
          g,
          fin,
          mats.fin,
          Math.cos(a) * (0.3 + jitter() * 0.5),
          0.08,
          Math.sin(a) * (0.3 + jitter() * 0.5),
        );
        f.rotation.z = 0.5 + jitter() * 0.4;
        f.rotation.y = a;
      }
      const ripple = foodPart(
        g,
        new THREE.TorusGeometry(0.55, 0.02, 4, 16),
        mats.ripple,
        0,
        0.03,
        0,
      );
      ripple.rotation.x = Math.PI / 2;
      break;
    }
    case "apple-trees": {
      foodPart(g, new THREE.CylinderGeometry(0.12, 0.16, 1.0, 5), mats.trunk, 0, 0.5, 0);
      const crown = foodPart(g, new THREE.SphereGeometry(0.85, 7, 6), mats.canopy, 0, 1.45, 0);
      crown.scale.y = 0.85;
      foodPart(g, new THREE.SphereGeometry(0.5, 6, 5), mats.canopy, 0.45, 1.1, 0.3);
      const apple = new THREE.SphereGeometry(0.08, 5, 4);
      for (let i = 0; i < 4; i++) {
        const a = jitter() * Math.PI * 2;
        foodPart(g, apple, mats.apple, Math.cos(a) * 0.65, 1.15 + jitter() * 0.5, Math.sin(a) * 0.65);
      }
      break;
    }
    case "animals": {
      for (let i = 0; i < 2; i++) {
        const x = -0.35 + i * 0.7;
        const z = (jitter() - 0.5) * 0.6;
        const body = foodPart(g, new THREE.SphereGeometry(0.24, 6, 5), mats.hide, x, 0.32, z);
        body.scale.set(1.35, 1, 0.9);
        foodPart(g, new THREE.SphereGeometry(0.12, 5, 4), mats.hide, x + 0.34, 0.46, z);
        const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.24, 4);
        foodPart(g, legGeo, mats.trunk, x - 0.12, 0.12, z + 0.08);
        foodPart(g, legGeo, mats.trunk, x + 0.12, 0.12, z - 0.08);
      }
      break;
    }
    default: {
      // berry-bushes
      const bush = new THREE.SphereGeometry(0.42, 6, 5);
      const berry = new THREE.SphereGeometry(0.05, 4, 3);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + jitter();
        const bx = Math.cos(a) * 0.35;
        const bz = Math.sin(a) * 0.35;
        const b = foodPart(g, bush, mats.bush, bx, 0.3, bz);
        b.scale.setScalar(0.75 + jitter() * 0.5);
        for (let j = 0; j < 3; j++) {
          foodPart(
            g,
            berry,
            mats.berry,
            bx + (jitter() - 0.5) * 0.5,
            0.35 + jitter() * 0.3,
            bz + (jitter() - 0.5) * 0.5,
          );
        }
      }
    }
  }
  return g;
}

/** Ruins are remembered, not erased: the island grays and dims. */
export function setIslandMood(group: THREE.Group, ruins: boolean, dormant: boolean): void {
  const tint = new THREE.Color();
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as (THREE.Material & { color: THREE.Color }) | undefined;
    if (!mat || !("color" in mat)) return;
    if (ruins) {
      mat.color.offsetHSL(0, -1, 0);
      // per-instance tints — canopies, blooms, shrubs — gray with the island
      const instanced = mesh as unknown as THREE.InstancedMesh;
      if (instanced.isInstancedMesh && instanced.instanceColor) {
        for (let i = 0; i < instanced.count; i++) {
          instanced.getColorAt(i, tint);
          tint.offsetHSL(0, -1, 0);
          instanced.setColorAt(i, tint);
        }
        instanced.instanceColor.needsUpdate = true;
      }
    }
  });
  group.visible = true;
  const scale = dormant ? 0.999 : 1;
  group.scale.setScalar(scale);
}
