import * as THREE from "three";
import { CLAY_PALETTE, clayMaterial } from "./artDirection";

export const WATER_SHADER_MARKER = "clay-water-waves-v1";

export interface WaterRenderProfile {
  segments: number;
  animationHz: number;
  maxTriangles: number;
}

export function waterRenderProfile(
  reducedMotion: boolean,
  mobile: boolean,
): WaterRenderProfile {
  const segments = mobile ? 48 : 80;
  return {
    segments,
    animationHz: reducedMotion ? 0 : mobile ? 20 : 30,
    maxTriangles: segments * segments * 2,
  };
}

export interface WaterSurface {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  material: THREE.MeshStandardMaterial;
  profile: WaterRenderProfile;
  tick(dt: number): void;
  animationTime(): number;
}

/**
 * One procedural GPU surface for the whole ocean. The vertex shader supplies
 * broad, low clay swells while the fragment shader lays translucent crossing
 * ripple/foam bands over the current daylight color. There are no downloaded
 * textures and no CPU-side vertex updates.
 */
export function createWaterSurface(options: {
  reducedMotion: boolean;
  mobile: boolean;
}): WaterSurface {
  const profile = waterRenderProfile(options.reducedMotion, options.mobile);
  const geometry = new THREE.PlaneGeometry(5_200, 5_200, profile.segments, profile.segments);
  const material = clayMaterial({ color: CLAY_PALETTE.oceanDeep });
  material.roughness = 0.64;
  material.metalness = 0.025;

  const time = { value: 0 };
  const foam = { value: new THREE.Color(CLAY_PALETTE.foam) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = time;
    shader.uniforms.uWaterFoam = foam;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uWaterTime;
varying vec3 vWaterWorld;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float claySwell = sin(position.x * 0.020 + uWaterTime * 0.55) * 0.22;
claySwell += sin(position.y * 0.031 - uWaterTime * 0.38) * 0.14;
claySwell += sin((position.x + position.y) * 0.013 + uWaterTime * 0.24) * 0.10;
transformed.z += claySwell;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vWaterWorld = worldPosition.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uWaterTime;
uniform vec3 uWaterFoam;
varying vec3 vWaterWorld;`,
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `vec4 diffuseColor = vec4( diffuse, opacity );
float clayRippleA = sin(vWaterWorld.x * 0.16 + vWaterWorld.z * 0.05 + uWaterTime * 0.9);
float clayRippleB = sin(vWaterWorld.z * 0.12 - vWaterWorld.x * 0.035 - uWaterTime * 0.7);
float clayRipple = smoothstep(1.34, 1.88, clayRippleA + clayRippleB);
float clayGlint = 0.5 + 0.5 * sin((vWaterWorld.x - vWaterWorld.z) * 0.035 + uWaterTime * 0.34);
diffuseColor.rgb = mix(diffuseColor.rgb, uWaterFoam, clayRipple * (0.10 + clayGlint * 0.10));`,
      );
  };
  material.customProgramCacheKey = () => WATER_SHADER_MARKER;
  material.needsUpdate = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "procedural-clay-ocean";
  mesh.userData.waterShader = WATER_SHADER_MARKER;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.08;
  mesh.receiveShadow = true;

  let accumulated = 0;
  let elapsed = 0;
  return {
    mesh,
    material,
    profile,
    tick(dt) {
      if (profile.animationHz === 0 || !Number.isFinite(dt) || dt <= 0) return;
      accumulated += Math.min(dt, 0.1);
      const interval = 1 / profile.animationHz;
      if (accumulated < interval) return;
      elapsed += accumulated;
      accumulated = 0;
      time.value = elapsed;
    },
    animationTime: () => time.value,
  };
}
