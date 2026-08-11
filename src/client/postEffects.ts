import * as THREE from "three";
import type { RenderQuality } from "./renderQuality";

export const POST_MARKER = "tilt-shift-post-v1";

/**
 * The studio-miniature finish: one full-screen pass over the rendered frame
 * adds a tilt-shift focus band, a soft vignette and a gentle warm grade —
 * the photographic half of the Scroll World look. It is a single extra draw
 * with no depth texture and no intermediate blur chain, so the whole cost is
 * one screen-sized render target plus nine texture taps.
 *
 * The pass runs only when the machine can afford it: desktop, full quality,
 * and no reduced-motion request. Everywhere else the renderer draws straight
 * to the canvas exactly as before.
 */
export function postEnabled(
  quality: RenderQuality,
  mobile: boolean,
  reducedMotion: boolean,
): boolean {
  return quality === "high" && !mobile && !reducedMotion;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uFocusY;
uniform float uBandWidth;
uniform float uMaxBlur;
uniform float uVignette;
uniform vec3 uWarm;
varying vec2 vUv;

void main() {
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
  // gentle warm studio grade with a whisper more saturation
  color *= uWarm;
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(grey), color, 1.06);
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
    fragmentShader: FRAGMENT,
    uniforms: {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uFocusY: { value: 0.52 },
      uBandWidth: { value: 0.14 },
      uMaxBlur: { value: 3.4 },
      uVignette: { value: 0.55 },
      uWarm: { value: new THREE.Vector3(1.035, 1.005, 0.955) },
    },
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

  return {
    enabled: () => on,
    setEnabled(next) {
      on = next;
      if (!next) {
        target?.dispose();
        target = undefined;
      }
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
