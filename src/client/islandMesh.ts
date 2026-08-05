import * as THREE from "three";
import { hashString, mulberry32 } from "../shared/rng";
import { generateIsland } from "../shared/terrain";

const AMP = 7;
const SEA = 0.2;

const KIND_COLORS: Record<string, THREE.Color> = {
  water: new THREE.Color("#11475d"),
  sand: new THREE.Color("#e6d3a3"),
  grass: new THREE.Color("#7fa15a"),
  rock: new THREE.Color("#8d8d93"),
};

/** Terrain + nature for one island, regenerated deterministically from its seed. */
export function createIslandGroup(seed: number, size: number): THREE.Group {
  const terrain = generateIsland(seed, size);
  const group = new THREE.Group();
  const half = size / 2;

  const geo = new THREE.PlaneGeometry(size, size, size - 1, size - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const shade = mulberry32(hashString(`${seed}|shade`));
  const tinted = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const gx = i % size;
    const gy = Math.floor(i / size);
    const tile = terrain.tiles[gy * size + gx]!;
    pos.setY(i, (tile.height - SEA) * AMP);
    // per-vertex lightness jitter breaks up flat color fields; higher ground
    // sits a hair brighter so slopes read even under flat shading
    tinted
      .copy(KIND_COLORS[tile.kind]!)
      .offsetHSL(0, 0, (shade() - 0.5) * 0.045 + (tile.height - SEA) * 0.06);
    colors[i * 3] = tinted.r;
    colors[i * 3 + 1] = tinted.g;
    colors[i * 3 + 2] = tinted.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  ground.name = "ground";
  ground.receiveShadow = true;
  group.add(ground);

  const heightAt = (x: number, y: number) => {
    const tile = terrain.tiles[Math.round(y) * size + Math.round(x)];
    return tile ? (tile.height - SEA) * AMP : 0;
  };

  // nature: instanced trees and rocks, plus wild food — grazing animals,
  // fishing shoals, apple trees, and berry bushes — at the terrain's nodes
  const byResource = { wood: [] as THREE.Vector3[], stone: [] as THREE.Vector3[] };
  const foodNodes: { source: string; pos: THREE.Vector3; tile: { x: number; y: number } }[] = [];
  const mineralNodes: { resource: string; pos: THREE.Vector3 }[] = [];
  for (const node of terrain.nodes) {
    const p = new THREE.Vector3(
      node.pos.x - half,
      heightAt(node.pos.x, node.pos.y),
      node.pos.y - half,
    );
    if (node.resource === "food") {
      foodNodes.push({ source: node.source ?? "berry-bushes", pos: p, tile: node.pos });
      continue;
    }
    const list = byResource[node.resource as keyof typeof byResource];
    if (list) list.push(p);
    else mineralNodes.push({ resource: node.resource, pos: p });
  }

  // sized against the settlers (~1.65 tall): trees tower, rocks reach the
  // knee-to-waist, bushes sit about hip height
  const nature: [THREE.BufferGeometry, THREE.Material, THREE.Vector3[], number][] = [
    [
      new THREE.ConeGeometry(1.05, 3.8, 6),
      new THREE.MeshLambertMaterial({ color: "#3f6b35" }),
      byResource.wood,
      1.9,
    ],
    [
      new THREE.IcosahedronGeometry(0.8),
      new THREE.MeshLambertMaterial({ color: "#75757c" }),
      byResource.stone,
      0.45,
    ],
  ];
  const jitter = mulberry32(hashString(`${seed}|nature`));
  for (const [geometry, material, points, lift] of nature) {
    if (!points.length) continue;
    const instanced = new THREE.InstancedMesh(geometry, material, points.length);
    instanced.castShadow = true;
    const m = new THREE.Matrix4();
    points.forEach((p, i) => {
      const s = 0.85 + jitter() * 0.4;
      m.makeScale(s, s, s);
      m.setPosition(p.x, p.y + lift * s, p.z);
      instanced.setMatrixAt(i, m);
    });
    group.add(instanced);
  }

  const mats = {
    trunk: new THREE.MeshLambertMaterial({ color: "#6b4f2a" }),
    canopy: new THREE.MeshLambertMaterial({ color: "#5d8a3e" }),
    apple: new THREE.MeshLambertMaterial({ color: "#c0392b" }),
    bush: new THREE.MeshLambertMaterial({ color: "#4c6e35" }),
    berry: new THREE.MeshLambertMaterial({ color: "#7b4a94" }),
    hide: new THREE.MeshLambertMaterial({ color: "#8a6a48" }),
    fin: new THREE.MeshLambertMaterial({ color: "#a8c3d1" }),
  };
  const kindAt = (x: number, y: number) =>
    terrain.tiles[Math.round(y) * size + Math.round(x)]?.kind;
  for (const node of foodNodes) {
    const piece = createFoodSource(node.source, jitter, mats);
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
    piece.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) obj.castShadow = true;
    });
    group.add(piece);
  }

  // mineral lodes: a grey outcrop shot through with the ore's own color —
  // the exotic finds of the late ages glow faintly where they break ground
  const rockMat = new THREE.MeshLambertMaterial({ color: "#75757c" });
  for (const node of mineralNodes) {
    const meta = MINERALS[node.resource];
    if (!meta) continue;
    const s = 0.8 + jitter() * 0.4;
    const base = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55), rockMat);
    base.position.set(node.pos.x, node.pos.y + 0.3 * s, node.pos.z);
    base.scale.setScalar(s);
    base.rotation.y = jitter() * Math.PI * 2;
    let oreMat = mineralMats.get(node.resource);
    if (!oreMat) {
      oreMat = new THREE.MeshLambertMaterial({ color: meta.color, flatShading: true });
      if (meta.emissive) {
        oreMat.emissive = new THREE.Color(meta.emissive);
        oreMat.emissiveIntensity = 0.7;
      }
      mineralMats.set(node.resource, oreMat);
    }
    const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36), oreMat);
    chunk.position.set(
      node.pos.x + 0.3 * s,
      node.pos.y + 0.5 * s,
      node.pos.z + 0.12 * s,
    );
    chunk.scale.setScalar(s);
    chunk.rotation.y = jitter() * Math.PI * 2;
    base.castShadow = chunk.castShadow = true;
    group.add(base, chunk);
  }

  group.userData.heightAt = heightAt;
  group.userData.half = half;
  return group;
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
const mineralMats = new Map<string, THREE.MeshLambertMaterial>();

interface FoodMats {
  trunk: THREE.Material;
  canopy: THREE.Material;
  apple: THREE.Material;
  bush: THREE.Material;
  berry: THREE.Material;
  hide: THREE.Material;
  fin: THREE.Material;
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
        new THREE.MeshLambertMaterial({ color: "#bfe3ef", transparent: true, opacity: 0.5 }),
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
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial | undefined;
    if (!mat || !("color" in mat)) return;
    if (ruins) {
      mat.color.offsetHSL(0, -1, 0);
    }
  });
  group.visible = true;
  const scale = dormant ? 0.999 : 1;
  group.scale.setScalar(scale);
}
