import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  bakeUndersideShade,
  CONTACT_STRENGTH_BANDS,
  contactDiscGeometry,
  contactDiscMeshes,
  contactRingGeometry,
  contactShadowMaterial,
  type ContactDiscPlacement,
} from "./contactShadows";

function alphas(geometry: THREE.BufferGeometry): number[] {
  const color = geometry.getAttribute("color") as THREE.BufferAttribute;
  expect(color.itemSize).toBe(4);
  return Array.from({ length: color.count }, (_, i) => color.getW(i));
}

function radii(geometry: THREE.BufferGeometry): number[] {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  return Array.from({ length: position.count }, (_, i) =>
    Math.hypot(position.getX(i), position.getZ(i)),
  );
}

describe("contact shadows", () => {
  it("carries its falloff in vertex alpha, so the world still downloads no textures", () => {
    const disc = contactDiscGeometry(12);
    const a = alphas(disc);
    const r = radii(disc);

    // flat in the XZ plane: a shadow lies on the ground, it is not a volume
    const position = disc.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) expect(position.getY(i)).toBe(0);
    // unit radius — every instance scales this one geometry
    expect(Math.max(...r)).toBeCloseTo(1, 5);
    // darkest in the middle, gone at the rim
    expect(a[0]).toBe(1);
    for (let i = 0; i < a.length; i++) {
      if (r[i]! > 0.99) expect(a[i]).toBe(0);
    }
    // monotonic: alpha never climbs back up on the way out
    const byRadius = r.map((radius, i) => [radius, a[i]!] as const).sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < byRadius.length; i++) {
      expect(byRadius[i]![1]).toBeLessThanOrEqual(byRadius[i - 1]![1]! + 1e-6);
    }
    expect(disc.index).not.toBeNull();
  });

  it("darkens a plaza's skirt on its inner edge and fades out into the meadow", () => {
    const ring = contactRingGeometry(0.6, 8);
    const a = alphas(ring);
    const r = radii(ring);

    // nothing is drawn inside the paving — the ring starts where the floor ends
    expect(Math.min(...r)).toBeCloseTo(0.6, 5);
    expect(Math.max(...r)).toBeCloseTo(1, 5);
    // firmest against the paving, nothing at the outer rim: the reverse of a disc
    for (let i = 0; i < a.length; i++) {
      if (r[i]! < 0.61) expect(a[i]).toBe(1);
      if (r[i]! > 0.99) expect(a[i]).toBe(0);
    }
  });

  it("multiplies the ground's own light instead of laying ink over it", () => {
    const material = contactShadowMaterial(0.4);

    // dst * (1 - srcAlpha): a shadow takes a share of the light that is
    // there. It keeps the ground's hue over lit meadow and quietly vanishes
    // at night, where a fixed dark colour became a black hole.
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.ZeroFactor);
    expect(material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(material.vertexColors).toBe(true);
    // never occludes what stands in it, and never writes depth
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.4, 5);
    expect(contactShadowMaterial(9).opacity).toBe(1);
  });

  it("bakes a canopy's underside dark where it meets its own trunk", () => {
    const geometry = bakeUndersideShade(new THREE.ConeGeometry(1, 2.4, 6), { strength: 0.3 });
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const color = geometry.getAttribute("color") as THREE.BufferAttribute;
    expect(color.itemSize).toBe(3);

    let lowest = { y: Infinity, lit: 1 };
    let highest = { y: -Infinity, lit: 1 };
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const lit = color.getX(i);
      // it is a multiplier on whatever tint the instance already carries
      expect(lit).toBeGreaterThan(0);
      expect(lit).toBeLessThanOrEqual(1);
      expect(color.getY(i)).toBeCloseTo(lit, 6);
      expect(color.getZ(i)).toBeCloseTo(lit, 6);
      if (y < lowest.y) lowest = { y, lit };
      if (y > highest.y) highest = { y, lit };
    }
    expect(highest.lit).toBeCloseTo(1, 3);
    expect(lowest.lit).toBeLessThan(highest.lit - 0.1);
  });

  it("varies every disc, because one identical smudge is the loudest instancing tell", () => {
    const placements: ContactDiscPlacement[] = Array.from({ length: 60 }, (_, i) => ({
      x: i,
      y: 0,
      z: i * 0.5,
      radius: 0.6 + (i % 7) * 0.1,
      strength: (i % 10) / 10,
      rotY: (i / 60) * Math.PI * 2,
      squash: 0.8 + (i % 5) * 0.08,
    }));
    const meshes = contactDiscMeshes(placements, { name: "trees-contact" });

    // strength quantises into bands — instanced alpha does not exist under a
    // custom blend, so a band per weight is what buys varied firmness
    expect(meshes.length).toBeGreaterThan(1);
    expect(meshes.length).toBeLessThanOrEqual(CONTACT_STRENGTH_BANDS.length);
    expect(meshes.reduce((total, mesh) => total + mesh.count, 0)).toBe(placements.length);
    const opacities = meshes.map((mesh) => (mesh.material as THREE.Material).opacity);
    expect(new Set(opacities).size).toBe(meshes.length);

    const scales = new Set<string>();
    for (const mesh of meshes) {
      expect(mesh.name.startsWith("trees-contact")).toBe(true);
      // paint, never an asset: nothing can hover, click or select a shadow
      expect(mesh.userData.contactShadow).toBe("radial-alpha");
      expect(mesh.userData.instanceAssetPicks).toBeUndefined();
      // drawn under everything else that stands on the ground
      expect(mesh.renderOrder).toBeLessThan(0);
      expect(mesh.boundingSphere).not.toBeNull();
      const matrix = new THREE.Matrix4();
      const scale = new THREE.Vector3();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        scales.add(`${scale.x.toFixed(3)}:${scale.z.toFixed(3)}`);
      }
    }
    // size and ellipse stay continuous per instance
    expect(scales.size).toBeGreaterThan(10);
    // and all bands share one geometry: three draw calls for a whole island
    expect(new Set(meshes.map((mesh) => mesh.geometry.uuid)).size).toBe(1);
  });

  it("draws nothing at all when there is nothing standing on the ground", () => {
    expect(contactDiscMeshes([], { name: "empty" })).toEqual([]);
  });
});
