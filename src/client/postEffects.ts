import * as THREE from "three";
import type { RenderQuality } from "./renderQuality";

export const POST_MARKER = "tilt-shift-post-v1";

/**
 * The studio-miniature finish: one full-screen pass over the rendered frame.
 *
 * The pass has two halves with very different costs:
 *
 * - The **grade** — split-toned warm highlights and cool shadows, a whisper
 *   of extra saturation, a soft vignette and a four-tap lamp glow. Five
 *   texture taps total. This is the photographic half of the Scroll World
 *   look and it is close to free, so every desktop keeps it at every quality
 *   tier. Dropping it was the single most visible thing an adaptive quality
 *   step used to throw away.
 * - The **tilt-shift band** — eight more taps that defocus everything outside
 *   the focus band, the cue that sells "miniature". Only full quality pays.
 *
 * Phones and reduced-motion viewers still render straight to the canvas.
 */
export function postEnabled(
  quality: RenderQuality,
  mobile: boolean,
  reducedMotion: boolean,
): boolean {
  void quality;
  return !mobile && !reducedMotion;
}

/** The expensive half: the defocus band is full-quality desktop only. */
export function tiltShiftEnabled(
  quality: RenderQuality,
  mobile: boolean,
  reducedMotion: boolean,
): boolean {
  return quality === "high" && postEnabled(quality, mobile, reducedMotion);
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uFocusY;
uniform float uBandWidth;
uniform float uMaxBlur;
uniform float uVignette;
uniform vec3 uWarm;
uniform vec3 uShadowTint;
uniform float uGlow;
varying vec2 vUv;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

void main() {
#ifdef TILT_SHIFT
  // blur strength grows with distance from the horizontal focus band
  float band = abs(vUv.y - uFocusY);
  float blur = smoothstep(uBandWidth, 0.5, band) * uMaxBlur;
  vec2 r = uTexel * blur;
  vec3 color = texture2D(tDiffuse, vUv).rgb * 0.28;
  color += texture2D(tDiffuse, vUv + vec2( 0.9,  0.4) * r).rgb * 0.09;
  color += texture2D(tDiffuse, vUv + vec2(-0.9, -0.4) * r).rgb * 0.09;
  color += texture2D(tDiffuse, vUv + vec2( 0.4, -0.9) * r).rgb * 0.09;
  color += texture2D(tDiffuse, vUv + vec2(-0.4,  0.9) * r).rgb * 0.09;
  color += texture2D(tDiffuse, vUv + vec2( 1.3, -0.6) * r).rgb * 0.09;
  color += texture2D(tDiffuse, vUv + vec2(-1.3,  0.6) * r).rgb * 0.09;
  color += texture2D(tDiffuse, vUv + vec2( 0.6,  1.3) * r).rgb * 0.09;
  color += texture2D(tDiffuse, vUv + vec2(-0.6, -1.3) * r).rgb * 0.09;
#else
  vec3 color = texture2D(tDiffuse, vUv).rgb;
#endif

  // lamp glow: four wide taps, and only what is brighter than its
  // surroundings blooms — lit windows, braziers, sun glint on the swell
  vec2 g = uTexel * 7.0;
  vec3 wide = texture2D(tDiffuse, vUv + vec2( g.x,  g.y)).rgb;
  wide += texture2D(tDiffuse, vUv + vec2(-g.x,  g.y)).rgb;
  wide += texture2D(tDiffuse, vUv + vec2( g.x, -g.y)).rgb;
  wide += texture2D(tDiffuse, vUv + vec2(-g.x, -g.y)).rgb;
  wide *= 0.25;
  vec3 bloom = max(wide - 0.62, 0.0);
  // glow is light, not pigment: a saturated source (a future age's lit panel)
  // used to bloom in its own hue and clip to neon, so the bloom is pulled
  // most of the way to its own luminance and rolled off before it is added
  float bloomLuma = dot(bloom, LUMA);
  bloom = mix(vec3(bloomLuma), bloom, 0.4);
  bloom = bloom / (1.0 + bloom * 1.6);
  color += bloom * uGlow;

  // split tone: the key stays warm, the shade cools — the painted separation
  // that keeps flat clay faces from reading as one plastic hue
  float luma = dot(color, LUMA);
  vec3 tone = mix(uShadowTint, uWarm, smoothstep(0.08, 0.62, luma));
  color *= tone;
  color = mix(vec3(luma), color, 1.11);
  // painted highlights: past a hot threshold the brightest faces bend toward
  // white instead of clipping one channel — gouache, not a light-up sign
  float hot = smoothstep(0.78, 1.15, dot(color, LUMA));
  color = mix(color, mix(color, vec3(1.0), 0.42), hot);
  // soft vignette pools the eye toward the diorama
  vec2 fromCentre = vUv - 0.5;
  float vignette = 1.0 - dot(fromCentre, fromCentre) * uVignette;
  gl_FragColor = vec4(color * vignette, 1.0);
  #include <colorspace_fragment>
}
`;

export interface PostPipeline {
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** Toggle the expensive defocus band without disturbing the grade. */
  setTiltShift(on: boolean): void;
  tiltShift(): boolean;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Draw the scene through the pass — or straight through when disabled. */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export function createPostPipeline(renderer: THREE.WebGLRenderer): PostPipeline {
  let on = false;
  let target: THREE.WebGLRenderTarget | undefined;
  let width = 1;
  let height = 1;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: POST_FRAGMENT,
    uniforms: {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uFocusY: { value: 0.52 },
      uBandWidth: { value: 0.14 },
      uMaxBlur: { value: 3.4 },
      uVignette: { value: 0.62 },
      uWarm: { value: new THREE.Vector3(1.045, 1.008, 0.948) },
      uShadowTint: { value: new THREE.Vector3(0.955, 0.985, 1.055) },
      uGlow: { value: 0.85 },
    },
    defines: { TILT_SHIFT: "" },
    depthTest: false,
    depthWrite: false,
  });
  // one full-screen triangle — no quad seam, no index buffer
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
  );
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const passScene = new THREE.Scene();
  passScene.add(quad);
  const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function ensureTarget(): THREE.WebGLRenderTarget {
    if (!target || target.width !== width || target.height !== height) {
      target?.dispose();
      // linear half-float keeps the tone-mapped scene unbanded; the final
      // pass applies the sRGB output transform itself (colorspace_fragment)
      target = new THREE.WebGLRenderTarget(width, height, {
        samples: renderer.capabilities.isWebGL2 ? 4 : 0,
        type: THREE.HalfFloatType,
      });
      (material.uniforms.uTexel!.value as THREE.Vector2).set(1 / width, 1 / height);
    }
    return target;
  }

  let tilt = true;

  return {
    enabled: () => on,
    tiltShift: () => tilt,
    setEnabled(next) {
      on = next;
      if (!next) {
        target?.dispose();
        target = undefined;
      }
    },
    setTiltShift(next) {
      if (next === tilt) return;
      tilt = next;
      if (next) material.defines = { TILT_SHIFT: "" };
      else material.defines = {};
      material.needsUpdate = true;
    },
    setSize(w, h, pixelRatio) {
      width = Math.max(1, Math.round(w * pixelRatio));
      height = Math.max(1, Math.round(h * pixelRatio));
    },
    render(scene, camera) {
      if (!on) {
        renderer.render(scene, camera);
        return;
      }
      const rt = ensureTarget();
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      material.uniforms.tDiffuse!.value = rt.texture;
      renderer.render(passScene, passCamera);
    },
    dispose() {
      target?.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
