import * as THREE from "three";

/**
 * Contact darkening — the cheapest thing in the frame that the reference does
 * and this world did not.
 *
 * A shadow map at island scale is one soft grey smear per object: it says an
 * object is *lit*, it never says an object is *touching the ground*. In a
 * miniature diorama the touch is the whole read — a tree is only planted if
 * the grass goes dark where the trunk enters it. So every object that meets
 * the ground gets a small painted disc under it, and the disc carries its own
 * falloff in vertex *alpha* rather than a texture, so the world still ships
 * with no downloaded assets.
 *
 * The discs are deliberately per-instance: size, ellipse, spin and strength
 * all vary, because 1,400 copies of one identical smudge is the loudest
 * "instanced" tell a frame can have.
 */

/** rings of the fan: radius as a share of 1, and the alpha carried there */
const DISC_RINGS: readonly (readonly [number, number])[] = [
  [0.0, 1.0],
  [0.3, 0.92],
  [0.62, 0.4],
  [1.0, 0.0],
];

/**
 * A flat disc in the XZ plane whose alpha falls from the middle to nothing at
 * the rim. Unit radius — scale per instance.
 */
export function contactDiscGeometry(spokes = 14): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // centre vertex
  positions.push(0, 0, 0);
  colors.push(1, 1, 1, DISC_RINGS[0]![1]);
  const ringStart: number[] = [];
  for (let r = 1; r < DISC_RINGS.length; r++) {
    ringStart.push(positions.length / 3);
    const [radius, alpha] = DISC_RINGS[r]!;
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      colors.push(1, 1, 1, alpha);
    }
  }
  // centre fan
  for (let s = 0; s < spokes; s++) {
    const a = ringStart[0]! + s;
    const b = ringStart[0]! + ((s + 1) % spokes);
    indices.push(0, b, a);
  }
  // ring quads
  for (let r = 0; r < ringStart.length - 1; r++) {
    for (let s = 0; s < spokes; s++) {
      const innerA = ringStart[r]! + s;
      const innerB = ringStart[r]! + ((s + 1) % spokes);
      const outerA = ringStart[r + 1]! + s;
      const outerB = ringStart[r + 1]! + ((s + 1) % spokes);
      indices.push(innerA, innerB, outerA, innerB, outerB, outerA);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.contactFalloff = "radial-alpha";
  return geometry;
}

/**
 * A flat annulus that darkens on its *inner* edge and fades outward. Used
 * where a paved floor meets untouched ground: the grass around a plaza is
 * trodden and shaded, the plaza itself is not.
 */
export function contactRingGeometry(innerRadius: number, spokes = 40): THREE.BufferGeometry {
  const inner = Math.max(0, Math.min(0.98, innerRadius));
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const rings: readonly (readonly [number, number])[] = [
    [inner, 1.0],
    [inner + (1 - inner) * 0.45, 0.5],
    [1.0, 0.0],
  ];
  for (const [radius, alpha] of rings) {
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      colors.push(1, 1, 1, alpha);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < spokes; s++) {
      const innerA = r * spokes + s;
      const innerB = r * spokes + ((s + 1) % spokes);
      const outerA = (r + 1) * spokes + s;
      const outerB = (r + 1) * spokes + ((s + 1) % spokes);
      indices.push(innerA, innerB, outerA, innerB, outerB, outerA);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.contactFalloff = "annulus-alpha";
  return geometry;
}

/**
 * The material a contact disc is drawn with: not a dark shape laid *over* the
 * ground, but a multiplier applied *to* it.
 *
 * Blending toward a fixed dark colour was the first attempt and it failed
 * twice over — over lit meadow an ink disc is barely a shade darker than the
 * grass, and after dusk the same disc becomes a black hole in a dark field.
 * `dst * (1 - alpha)` is what a shadow actually is: it takes a share of
 * whatever light the ground has, keeps its hue, and quietly disappears at
 * night because there is nothing left to take.
 */
export function contactShadowMaterial(strength: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: "#000000",
    transparent: true,
    opacity: Math.max(0, Math.min(1, strength)),
    depthWrite: false,
    vertexColors: true,
  });
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.ZeroFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendEquation = THREE.AddEquation;
  material.userData.artMaterial = "contact-shadow";
  return material;
}

/**
 * Bake a downward-darkening gradient into a geometry's vertex colours: the
 * underside of a canopy, the lee of a boulder. Multiplies whatever
 * per-instance colour the mesh already carries, so a thousand differently
 * tinted crowns all gain the same honest darkening where they meet their
 * trunk without a second draw call.
 */
export function bakeUndersideShade(
  geometry: THREE.BufferGeometry,
  options: { strength?: number; bias?: number } = {},
): THREE.BufferGeometry {
  const strength = options.strength ?? 0.34;
  const bias = options.bias ?? 0.15;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const min = box.min.y;
  const span = Math.max(1e-6, box.max.y - min);
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    // 0 at the lowest point of the form, 1 at its crown
    const t = (position.getY(i) - min) / span;
    const lit = 1 - strength * Math.pow(1 - Math.min(1, t + bias), 2);
    colors[i * 3] = lit;
    colors[i * 3 + 1] = lit;
    colors[i * 3 + 2] = lit;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.userData.undersideShade = strength;
  return geometry;
}

export interface ContactDiscPlacement {
  x: number;
  y: number;
  z: number;
  /** disc radius in world units before per-instance jitter */
  radius: number;
  /** 0..1 — how firmly this object sits in the ground */
  strength: number;
  rotY: number;
  /** ellipse ratio: 1 is a circle */
  squash: number;
}

/** the three strengths a contact disc can be drawn at, faint to firm */
export const CONTACT_STRENGTH_BANDS: readonly number[] = [0.26, 0.4, 0.54];

/**
 * A whole island's worth of contact discs, in three instanced meshes.
 *
 * Multiplicative blending cannot take a per-instance strength — instance
 * colour is thrown away by the blend, and instance alpha does not exist. So
 * strength is quantised into three bands, one mesh each: three draw calls for
 * an island, and no two neighbouring trees pressing the same weight into the
 * grass. Size, ellipse, spin and offset stay continuous per instance.
 */
export function contactDiscMeshes(
  placements: readonly ContactDiscPlacement[],
  options: { name: string; scale?: number; spokes?: number },
): THREE.InstancedMesh[] {
  if (!placements.length) return [];
  const scale = options.scale ?? 1;
  const bands: ContactDiscPlacement[][] = CONTACT_STRENGTH_BANDS.map(() => []);
  for (const placement of placements) {
    const band = Math.max(
      0,
      Math.min(
        bands.length - 1,
        Math.floor(Math.max(0, Math.min(0.999, placement.strength)) * bands.length),
      ),
    );
    bands[band]!.push(placement);
  }
  const geometry = contactDiscGeometry(options.spokes ?? 12);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const size = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const meshes: THREE.InstancedMesh[] = [];
  bands.forEach((band, index) => {
    if (!band.length) return;
    const mesh = new THREE.InstancedMesh(
      geometry,
      contactShadowMaterial(CONTACT_STRENGTH_BANDS[index]! * scale),
      band.length,
    );
    band.forEach((placement, i) => {
      quat.setFromEuler(euler.set(0, placement.rotY, 0));
      matrix.compose(
        pos.set(placement.x, placement.y, placement.z),
        quat,
        size.set(placement.radius, 1, placement.radius * placement.squash),
      );
      mesh.setMatrixAt(i, matrix);
    });
    mesh.name = `${options.name}-${index}`;
    mesh.userData.contactShadow = "radial-alpha";
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = -1;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  });
  return meshes;
}
