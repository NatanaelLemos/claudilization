import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import { buildingSpec } from "../shared/buildings";
import type { Building, CivSpec } from "../shared/types";
import { CLAY_PALETTE, clayMaterial, islandPalette } from "./artDirection";

export const GROUNDS_GROUP = "island-grounds";
/** Paths and yards hide beyond this range — they are street-level detail. */
export const GROUNDS_DISTANCE = 340;
/** A settlement never renders more than this many path stones. */
export const MAX_PATH_STONES = 900;

/**
 * The single biggest "hand-built diorama" lever: buildings stop floating in
 * a lawn. Completed buildings are joined by soft clay stepping-stone
 * footpaths (a minimum spanning tree, so the street network reads as one
 * settlement), and every building gets a small working yard — crates,
 * barrels, field rows, fences, drying racks, market awnings — chosen by what
 * the building does. Everything is deterministic from building ids and
 * instanced per prop shape, so a dense city adds a handful of draws, not a
 * handful per house.
 */

export interface GroundsOptions {
  buildings: Building[];
  civ: CivSpec;
  islandSeed: number;
  heightAt: (x: number, y: number) => number;
  half: number;
}

// shared prop geometry — one of each shape for the whole world
const stoneGeo = new THREE.CylinderGeometry(0.34, 0.4, 0.09, 7);
const crateGeo = new THREE.BoxGeometry(0.42, 0.36, 0.42);
const barrelGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.44, 8);
const sackGeo = new THREE.SphereGeometry(0.24, 6, 5);
const postGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.85, 5);
const railGeo = new THREE.BoxGeometry(1.05, 0.06, 0.06);
const rowGeo = new THREE.BoxGeometry(1.5, 0.14, 0.4);
const canopyGeo = new THREE.BoxGeometry(1.35, 0.06, 0.95);
const pennantGeo = new THREE.ConeGeometry(0.16, 0.5, 4);

// materials cached per color so rebuilds and many islands share programs
const groundsMats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string): THREE.MeshStandardMaterial {
  let m = groundsMats.get(color);
  if (!m) {
    m = clayMaterial({ color });
    groundsMats.set(color, m);
  }
  return m;
}

type PropShape =
  | "stone"
  | "crate"
  | "barrel"
  | "sack"
  | "post"
  | "rail"
  | "row"
  | "canopy"
  | "pennant";

const PROP_GEOMETRY: Record<PropShape, THREE.BufferGeometry> = {
  stone: stoneGeo,
  crate: crateGeo,
  barrel: barrelGeo,
  sack: sackGeo,
  post: postGeo,
  rail: railGeo,
  row: rowGeo,
  canopy: canopyGeo,
  pennant: pennantGeo,
};

interface PropPlacement {
  shape: PropShape;
  x: number;
  y: number;
  z: number;
  rotY: number;
  s: number;
  color: string;
}

export type YardKind =
  | "field"
  | "market"
  | "dockyard"
  | "workshop"
  | "civic"
  | "home"
  | "none";

/** What a building keeps in its yard follows from what the building does. */
export function yardKind(type: string): YardKind {
  const spec = buildingSpec(type);
  if (/farm|livestock|pen|garden|skyfarm|gristmill|windmill|watermill/.test(type)) return "field";
  if (/market|trading|exchange|bazaar|tavern|brewery|cannery/.test(type)) return "market";
  if (/dock|fishing|boat|drying/.test(type)) return "dockyard";
  if (
    /forge|smith|works|mine|quarry|kiln|maker|weaver|tanner|knapper|smokehouse|pottery|press|refinery|factory|mill|plant|derrick|lab|forge/.test(
      type,
    )
  ) {
    return "workshop";
  }
  if (/temple|shrine|monastery|cathedral|forum|senate|keep|hall|palace|library|academy|university|stone-circle|burial/.test(type)) {
    return "civic";
  }
  if (spec?.houses) return "home";
  return "none";
}

/** Minimum spanning tree over completed buildings — the street skeleton. */
export function pathEdges(points: { x: number; y: number }[]): [number, number][] {
  if (points.length < 2) return [];
  const edges: [number, number][] = [];
  const inTree = new Set<number>([0]);
  const dist = points.map((p) => Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y));
  const from = points.map(() => 0);
  while (inTree.size < points.length) {
    let best = -1;
    for (let i = 0; i < points.length; i++) {
      if (inTree.has(i)) continue;
      if (best === -1 || dist[i]! < dist[best]!) best = i;
    }
    if (best === -1) break;
    inTree.add(best);
    edges.push([from[best]!, best]);
    for (let i = 0; i < points.length; i++) {
      if (inTree.has(i)) continue;
      const d = Math.hypot(points[i]!.x - points[best]!.x, points[i]!.y - points[best]!.y);
      if (d < dist[i]!) {
        dist[i] = d;
        from[i] = best;
      }
    }
  }
  return edges;
}

export function buildGroundsGroup({
  buildings,
  civ,
  islandSeed,
  heightAt,
  half,
}: GroundsOptions): THREE.Group {
  const holder = new THREE.Group();
  holder.name = GROUNDS_GROUP;
  const palette = islandPalette(islandSeed);
  const complete = buildings
    .filter((b) => b.stage === "complete")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!complete.length) return holder;

  const props: PropPlacement[] = [];
  const soil = palette.soil;
  const soilDark = `#${new THREE.Color(palette.soil).offsetHSL(0, 0, -0.06).getHexString()}`;

  // ── footpaths ────────────────────────────────────────────────────────────
  const points = complete.map((b) => ({ x: b.pos.x, y: b.pos.y }));
  let stones = 0;
  for (const [a, b] of pathEdges(points)) {
    if (stones >= MAX_PATH_STONES) break;
    const start = points[a]!;
    const end = points[b]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.round(length / 0.85));
    const wobble = mulberry32(hashString(`${complete[a]!.id}|${complete[b]!.id}|path`));
    for (let i = 1; i < steps; i++) {
      if (stones >= MAX_PATH_STONES) break;
      const t = i / steps;
      // a gentle deterministic S-curve so streets read laid, not ruled
      const sway = Math.sin(t * Math.PI) * (wobble() - 0.5) * 1.4;
      const dx = (end.x - start.x) / length;
      const dy = (end.y - start.y) / length;
      const px = start.x + (end.x - start.x) * t - dy * sway;
      const py = start.y + (end.y - start.y) * t + dx * sway;
      // leave a clear yard at each doorstep instead of poking through walls
      if (
        Math.hypot(px - start.x, py - start.y) < 1.6 ||
        Math.hypot(px - end.x, py - end.y) < 1.6
      ) {
        continue;
      }
      const ground = heightAt(px, py);
      if (ground < 0.12) continue; // paths never wade into the sea
      props.push({
        shape: "stone",
        x: px - half,
        y: ground + 0.05,
        z: py - half,
        rotY: wobble() * Math.PI,
        s: 0.75 + wobble() * 0.5,
        color: wobble() < 0.5 ? soil : soilDark,
      });
      stones += 1;
    }
  }

  // ── yards ────────────────────────────────────────────────────────────────
  const trim = civ.architecture.trim;
  for (const building of complete) {
    const kind = yardKind(building.type);
    if (kind === "none") continue;
    const rand = mulberry32(hashString(`${building.id}|yard`));
    const bx = building.pos.x;
    const by = building.pos.y;
    const place = (shape: PropShape, r: number, color: string, s = 1, lift = 0) => {
      const a = rand() * Math.PI * 2;
      const px = bx + Math.cos(a) * r;
      const py = by + Math.sin(a) * r;
      const ground = heightAt(px, py);
      if (ground < 0.12) return;
      props.push({
        shape,
        x: px - half,
        y: ground + lift,
        z: py - half,
        rotY: rand() * Math.PI * 2,
        s: s * (0.85 + rand() * 0.3),
        color,
      });
    };
    switch (kind) {
      case "field": {
        // three tilled rows beside the farm, fenced on one side
        const a = rand() * Math.PI * 2;
        const cx = bx + Math.cos(a) * 3.1;
        const cy = by + Math.sin(a) * 3.1;
        for (let i = -1; i <= 1; i++) {
          const px = cx + Math.cos(a + Math.PI / 2) * i * 0.75;
          const py = cy + Math.sin(a + Math.PI / 2) * i * 0.75;
          const ground = heightAt(px, py);
          if (ground < 0.12) continue;
          props.push({
            shape: "row",
            x: px - half,
            y: ground + 0.07,
            z: py - half,
            rotY: -a,
            s: 0.9 + rand() * 0.2,
            color: i === 0 ? soilDark : soil,
          });
        }
        place("post", 2.1, CLAY_PALETTE.woodDark, 1, 0.4);
        place("post", 2.3, CLAY_PALETTE.woodDark, 1, 0.4);
        place("rail", 2.2, CLAY_PALETTE.wood, 1, 0.62);
        break;
      }
      case "market": {
        // a canted market awning in the civ's colors plus goods
        const a = rand() * Math.PI * 2;
        const px = bx + Math.cos(a) * 2.4;
        const py = by + Math.sin(a) * 2.4;
        const ground = heightAt(px, py);
        if (ground >= 0.12) {
          props.push({
            shape: "canopy",
            x: px - half,
            y: ground + 1.05,
            z: py - half,
            rotY: rand() * Math.PI * 2,
            s: 0.9 + rand() * 0.25,
            color: trim,
          });
          props.push({
            shape: "post",
            x: px - half - 0.5,
            y: ground + 0.42,
            z: py - half - 0.3,
            rotY: 0,
            s: 1,
            color: CLAY_PALETTE.woodDark,
          });
          props.push({
            shape: "post",
            x: px - half + 0.5,
            y: ground + 0.42,
            z: py - half + 0.3,
            rotY: 0,
            s: 1,
            color: CLAY_PALETTE.woodDark,
          });
        }
        place("crate", 1.8, CLAY_PALETTE.wood, 1, 0.18);
        place("sack", 1.6, "#c9b183", 0.9, 0.16);
        place("barrel", 2.0, CLAY_PALETTE.woodDark, 1, 0.22);
        break;
      }
      case "dockyard": {
        // a drying rack and the day's catch in crates
        place("post", 1.9, CLAY_PALETTE.woodDark, 1, 0.4);
        place("post", 2.15, CLAY_PALETTE.woodDark, 1, 0.4);
        place("rail", 2.0, CLAY_PALETTE.wood, 1, 0.75);
        place("crate", 1.6, CLAY_PALETTE.wood, 0.9, 0.18);
        place("barrel", 1.8, CLAY_PALETTE.woodDark, 0.9, 0.22);
        break;
      }
      case "workshop": {
        place("crate", 1.7, CLAY_PALETTE.wood, 1, 0.18);
        place("crate", 2.0, CLAY_PALETTE.wood, 0.85, 0.16);
        place("barrel", 1.9, CLAY_PALETTE.woodDark, 1, 0.22);
        place("sack", 1.6, "#a99a80", 0.9, 0.14);
        break;
      }
      case "civic": {
        // banner poles flying the civilization's pennant
        for (const side of [-1, 1]) {
          const a = rand() * Math.PI * 2;
          const px = bx + Math.cos(a) * 2.2 * side;
          const py = by + Math.sin(a) * 2.2;
          const ground = heightAt(px, py);
          if (ground < 0.12) continue;
          props.push({
            shape: "post",
            x: px - half,
            y: ground + 0.55,
            z: py - half,
            rotY: 0,
            s: 1.35,
            color: CLAY_PALETTE.woodDark,
          });
          props.push({
            shape: "pennant",
            x: px - half,
            y: ground + 1.35,
            z: py - half,
            rotY: rand() * Math.PI * 2,
            s: 1,
            color: trim,
          });
        }
        break;
      }
      default: {
        // home: modest domestic clutter
        place("crate", 1.7, CLAY_PALETTE.wood, 0.8, 0.15);
        if (rand() < 0.6) place("sack", 1.5, "#c9b183", 0.8, 0.13);
        if (rand() < 0.4) place("barrel", 1.9, CLAY_PALETTE.woodDark, 0.85, 0.19);
        break;
      }
    }
  }

  // ── one instanced mesh per shape+color ───────────────────────────────────
  const buckets = new Map<string, PropPlacement[]>();
  for (const prop of props) {
    const key = `${prop.shape}|${prop.color}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(prop);
    else buckets.set(key, [prop]);
  }
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scl = new THREE.Vector3();
  const posV = new THREE.Vector3();
  for (const bucket of buckets.values()) {
    const first = bucket[0]!;
    const mesh = new THREE.InstancedMesh(
      PROP_GEOMETRY[first.shape],
      mat(first.color),
      bucket.length,
    );
    bucket.forEach((prop, index) => {
      quat.setFromEuler(euler.set(0, prop.rotY, 0));
      matrix.compose(posV.set(prop.x, prop.y, prop.z), quat, scl.setScalar(prop.s));
      mesh.setMatrixAt(index, matrix);
    });
    mesh.castShadow = first.shape !== "stone" && first.shape !== "row";
    mesh.receiveShadow = true;
    mesh.userData.buildingShadowBatch = mesh.castShadow;
    mesh.userData.smallBuildingBatch = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    holder.add(mesh);
  }
  return holder;
}
