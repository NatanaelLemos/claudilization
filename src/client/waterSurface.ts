import * as THREE from "three";
import { CLAY_PALETTE, clayMaterial, islandPalette } from "./artDirection";
import {
  createWaterDepthField,
  WATER_FIELD_LAND_MAX,
  type StampableTerrain,
  type WaterDepthField,
} from "./waterDepthField";

export const WATER_SHADER_MARKER = "clay-water-waves-v3";

/** the sea level of the shared terrain law (`terrain.ts` WATER) */
const SEA_LEVEL = 0.2;

export interface WaterSwellPose {
  height: number;
  /** rotation around local x: bow rises into a swell travelling along z */
  pitch: number;
  /** rotation around local z: port/starboard heel along x */
  roll: number;
}

/**
 * CPU twin of the vertex shader's three broad swells. Craft use this exact
 * equation, at the exact shader time, so hulls ride the resin sea instead of
 * hovering through an unrelated sine wave. `depth01=1` is open water; the
 * amplitude calms toward a shore just like the GPU surface.
 */
/** the shader's `vertexDepth`, on the CPU: 0 at the waterline, 1 in the deep */
export function shoreDepth01(landHeight: number): number {
  return Math.min(1, Math.max(0, (SEA_LEVEL - landHeight) / SEA_LEVEL));
}

export function waterSwellPose(
  x: number,
  z: number,
  time: number,
  depth01 = 1,
): WaterSwellPose {
  const depth = Math.min(1, Math.max(0, depth01));
  const edge = Math.min(1, Math.max(0, depth / 0.45));
  const calm = 0.35 + 0.65 * edge * edge * (3 - 2 * edge);
  const a = x * 0.020 + time * 0.55;
  const b = z * 0.031 - time * 0.38;
  const c = (x + z) * 0.013 + time * 0.24;
  const swell = Math.sin(a) * 0.22 + Math.sin(b) * 0.14 + Math.sin(c) * 0.10;
  const dx = (Math.cos(a) * 0.22 * 0.020 + Math.cos(c) * 0.10 * 0.013) * calm;
  const dz = (Math.cos(b) * 0.14 * 0.031 + Math.cos(c) * 0.10 * 0.013) * calm;
  return {
    height: -0.08 + swell * calm,
    pitch: Math.atan(dz),
    roll: -Math.atan(dx),
  };
}

export interface WaterRenderProfile {
  segments: number;
  animationHz: number;
  maxTriangles: number;
  /** bathymetry texels per side — coarser on phones */
  fieldTexels: number;
  /** analytic wave normals + sun glitter — desktop only */
  sheen: boolean;
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
    fieldTexels: mobile ? 1_024 : 2_048,
    sheen: !mobile,
  };
}

export interface WaterSurface {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  material: THREE.MeshStandardMaterial;
  profile: WaterRenderProfile;
  field: WaterDepthField;
  tick(dt: number): void;
  animationTime(): number;
  /** paint one built island's bathymetry + lagoon tint into the sea */
  stampIsland(centerX: number, centerZ: number, seed: number, terrain: StampableTerrain): void;
  /** the rig's dayness — shallows, foam and glints dim with the sun */
  setDaylight(dayness: number): void;
  daylight(): number;
  /** CPU pose at the same time as the current GPU surface. */
  poseAt(x: number, z: number, depth01?: number): WaterSwellPose;
}

/**
 * One procedural GPU surface for the whole ocean — still a single draw call.
 *
 * The vertex shader rolls broad clay swells that calm as the sea shallows.
 * The fragment shader reads the world bathymetry field and paints the
 * miniature-diorama sea: each island's own lagoon turquoise banking down to
 * the rig's deep blue, a sand-warmed last metre, soft clay foam hugging the
 * real coastline with slow lapping rings rolling in, quiet crest bands out at
 * sea, and — on desktop — analytic wave normals so the warm key sun lays
 * moving satin glints across the surface. Everything is procedural math plus
 * one stamped data texture; there are no downloaded assets and no CPU-side
 * vertex updates.
 */
export function createWaterSurface(options: {
  reducedMotion: boolean;
  mobile: boolean;
}): WaterSurface {
  const profile = waterRenderProfile(options.reducedMotion, options.mobile);
  const geometry = new THREE.PlaneGeometry(5_200, 5_200, profile.segments, profile.segments);
  const material = clayMaterial({ color: CLAY_PALETTE.oceanDeep });
  // satin resin-pour water, not matte clay: the sheen is the diorama's charm
  material.roughness = profile.sheen ? 0.5 : 0.62;
  material.metalness = 0.03;
  if (profile.sheen) material.defines = { WATER_SHEEN: "" };

  const field = createWaterDepthField(profile.fieldTexels);
  const time = { value: 0 };
  const dayness = { value: 1 };
  const foam = { value: new THREE.Color(CLAY_PALETTE.foam) };
  const sand = { value: new THREE.Color(CLAY_PALETTE.sand) };
  const fieldUniform = { value: field.texture };
  const fieldSpan = { value: field.span };
  const landMax = { value: WATER_FIELD_LAND_MAX };
  const seaLevel = { value: SEA_LEVEL };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = time;
    shader.uniforms.uWaterDaylight = dayness;
    shader.uniforms.uWaterFoam = foam;
    shader.uniforms.uWaterSand = sand;
    shader.uniforms.uWaterField = fieldUniform;
    shader.uniforms.uWaterFieldSpan = fieldSpan;
    shader.uniforms.uWaterLandMax = landMax;
    shader.uniforms.uWaterSeaLevel = seaLevel;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uWaterTime;
uniform sampler2D uWaterField;
uniform float uWaterFieldSpan;
uniform float uWaterLandMax;
uniform float uWaterSeaLevel;
varying vec3 vWaterWorld;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
// the plane lies rotated -90° about x: local (x, y) is world (x, -z)
vec2 seaXZ = vec2(position.x, -position.y);
float vertexLand = texture2D(uWaterField, seaXZ / uWaterFieldSpan + 0.5).a * uWaterLandMax;
float vertexDepth = clamp((uWaterSeaLevel - vertexLand) / uWaterSeaLevel, 0.0, 1.0);
// broad rolling swell that calms as the sea shallows toward a beach
float claySwell = sin(seaXZ.x * 0.020 + uWaterTime * 0.55) * 0.22;
claySwell += sin(seaXZ.y * 0.031 - uWaterTime * 0.38) * 0.14;
claySwell += sin((seaXZ.x + seaXZ.y) * 0.013 + uWaterTime * 0.24) * 0.10;
transformed.z += claySwell * (0.35 + 0.65 * smoothstep(0.0, 0.45, vertexDepth));`,
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
uniform float uWaterDaylight;
uniform vec3 uWaterFoam;
uniform vec3 uWaterSand;
uniform sampler2D uWaterField;
uniform float uWaterFieldSpan;
uniform float uWaterLandMax;
uniform float uWaterSeaLevel;
varying vec3 vWaterWorld;`,
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `vec4 diffuseColor = vec4( diffuse, opacity );
vec4 shoreTex = texture2D(uWaterField, vWaterWorld.xz / uWaterFieldSpan + 0.5);
float landH = shoreTex.a * uWaterLandMax;
// how far below the waterline the clay seabed lies here
float shoreDist = uWaterSeaLevel - landH;
float depth01 = clamp(shoreDist / uWaterSeaLevel, 0.0, 1.0);
float dayGlow = 0.22 + 0.78 * uWaterDaylight;
// A coast has weather. One very low-frequency field decides which stretches
// of shoreline are exposed and which lie sheltered, so the foam ring stops
// reading as a rubber gasket stamped round every island: some headlands
// break white, some coves barely wet the sand. The frequency is far below
// anything that could tile inside one bay.
float coastMood = sin(vWaterWorld.x * 0.0071 - vWaterWorld.z * 0.0052 + 1.7)
  * sin(vWaterWorld.z * 0.0094 + vWaterWorld.x * 0.0036 - 0.6);
coastMood = 0.55 + 0.85 * (coastMood * 0.5 + 0.5);
// each island's lagoon turquoise banks down to the rig's deep-sea blue,
// and the true deep keeps banking down past it — the reference's sea has a
// real value range from lagoon to horizon, not one flat field with a rim
vec3 deepCol = diffuseColor.rgb * (0.78 - 0.16 * smoothstep(0.55, 1.0, depth01));
float hasTint = step(0.01, shoreTex.r + shoreTex.g + shoreTex.b);
vec3 shallowCol = mix(diffuseColor.rgb, shoreTex.rgb, 0.85 * dayGlow * hasTint);
float bank = smoothstep(0.0, 0.75, 1.0 - depth01);
vec3 seaCol = mix(deepCol, shallowCol, bank);
// slow painterly patches keep the open sea from reading flat
float seaPatch = sin(vWaterWorld.x * 0.004 + vWaterWorld.z * 0.006 + uWaterTime * 0.05)
  * sin(vWaterWorld.x * 0.0023 - vWaterWorld.z * 0.0031 - uWaterTime * 0.03);
seaCol *= 1.0 + seaPatch * 0.055 * depth01;
// the sand floor warms the last metre of the shallows
seaCol = mix(seaCol, uWaterSand, smoothstep(0.045, 0.006, max(shoreDist, 0.0)) * 0.4 * dayGlow);
// soft clay foam hugging the real coastline, its edge breathing with the sea
float foamWobble = sin(vWaterWorld.x * 0.33 + uWaterTime * 0.7)
  * sin(vWaterWorld.z * 0.29 - uWaterTime * 0.55);
// The shore band is measured in world *height*, so a steep coast squeezed it
// to sub-pixel and a flat beach smeared it across half a bay — the reference
// frame's coastline is one crisp bright line at every angle. Widening the
// band by the local screen-space gradient of the depth pins it to a constant
// on-screen width from any camera height.
float shoreAA = fwidth(shoreDist);
float coreEdge = 0.0065 + foamWobble * 0.0022 + shoreAA * 1.6;
// the hard bright core: the wet line where the sea actually meets the clay
float shoreCore = 1.0 - smoothstep(coreEdge * 0.3, coreEdge, shoreDist);
// and the soft halo behind it, still allowed to breathe
float halo = 1.0 - smoothstep(0.004, (0.019 + foamWobble * 0.006) * coastMood, shoreDist);
halo *= (0.66 + 0.34 * sin(vWaterWorld.x * 0.21 - vWaterWorld.z * 0.17 + foamWobble))
  * clamp(coastMood, 0.4, 1.25);
float contact = max(shoreCore, halo);
// slow lapping rings rolling in toward the beach, reaching further up an
// exposed shore than into a sheltered one
float lap = sin(shoreDist * 110.0 + uWaterTime * 1.35 + foamWobble * 1.2);
float lapMask = (1.0 - smoothstep(0.012, 0.13 * coastMood, shoreDist)) * step(0.0, shoreDist);
float lapFoam = smoothstep(0.62, 0.9, lap) * lapMask * clamp(coastMood, 0.35, 1.3);
float foamAmt = clamp(contact + lapFoam * 0.8, 0.0, 1.0);
// quiet crest bands out at sea — long strokes, never polka dots
float crestA = sin(vWaterWorld.x * 0.052 + vWaterWorld.z * 0.014 + uWaterTime * 0.55);
float crestB = sin(vWaterWorld.z * 0.037 - vWaterWorld.x * 0.011 - uWaterTime * 0.4);
float crestCut = sin(vWaterWorld.x * 0.011 - vWaterWorld.z * 0.017 + uWaterTime * 0.18);
float crest = smoothstep(1.52, 1.94, crestA + crestB) * smoothstep(-0.2, 0.55, crestCut);
vec3 foamCol = uWaterFoam * (0.5 + 0.5 * dayGlow);
// the core reaches the foam colour outright — a shoreline that only ever gets
// 82% of the way there is a smudge, not a contact line
float foamMix = clamp(foamAmt * 0.8 + shoreCore * 0.45 + crest * (0.05 + 0.09 * depth01), 0.0, 1.0);
seaCol = mix(seaCol, foamCol, foamMix);
// and the wet edge catches the sun: a specular kick that lives only on the
// contact line, so the coast reads bright against the land even in shadow
seaCol += foamCol * shoreCore * uWaterDaylight * 0.26;
#ifdef WATER_SHEEN
// scattered sun glitter drifting on the open water
float glintA = sin(vWaterWorld.x * 0.83 + uWaterTime * 0.9)
  * sin(vWaterWorld.z * 1.07 - uWaterTime * 0.65);
float glintB = sin((vWaterWorld.x + vWaterWorld.z) * 0.61 + uWaterTime * 1.25);
float glitter = pow(clamp(glintA * glintB, 0.0, 1.0), 16.0)
  * uWaterDaylight * (0.3 + 0.7 * depth01);
seaCol += uWaterFoam * glitter * 0.4;
#endif
diffuseColor.rgb = seaCol;`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
#ifdef WATER_SHEEN
// analytic slope of the swell plus finer ripples: the warm sun lays soft
// moving glints across the surface without any extra geometry
vec2 sw = vWaterWorld.xz;
float slopeX = cos(sw.x * 0.020 + uWaterTime * 0.55) * 0.0044
  + cos((sw.x + sw.y) * 0.013 + uWaterTime * 0.24) * 0.0013
  + cos(sw.x * 0.141 + uWaterTime * 0.85) * 0.012
  + cos((sw.x - sw.y) * 0.094 - uWaterTime * 0.6) * 0.009;
float slopeZ = cos(sw.y * 0.031 - uWaterTime * 0.38) * 0.0043
  + cos((sw.x + sw.y) * 0.013 + uWaterTime * 0.24) * 0.0013
  + cos(sw.y * 0.118 - uWaterTime * 0.7) * 0.012
  - cos((sw.x - sw.y) * 0.094 - uWaterTime * 0.6) * 0.009;
vec3 seaNormal = normalize(vec3(-slopeX * 16.0, 1.0, -slopeZ * 16.0));
normal = normalize((viewMatrix * vec4(seaNormal, 0.0)).xyz);
#endif`,
      );
  };
  material.customProgramCacheKey = () =>
    `${WATER_SHADER_MARKER}${profile.sheen ? "+sheen" : ""}`;
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
    field,
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
    stampIsland(centerX, centerZ, seed, terrain) {
      field.stampIsland(centerX, centerZ, terrain, new THREE.Color(islandPalette(seed).lagoon));
    },
    setDaylight(value) {
      dayness.value = Math.min(1, Math.max(0, value));
    },
    daylight: () => dayness.value,
    // Default the depth from the stamped bathymetry rather than assuming open
    // ocean: every craft in the world called this without a depth, so a boat
    // moored in a lagoon heaved on the full open-water swell while the surface
    // under it lay nearly flat.
    poseAt: (x, z, depth01) =>
      waterSwellPose(x, z, time.value, depth01 ?? shoreDepth01(field.landAt(x, z))),
  };
}
