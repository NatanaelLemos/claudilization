import CameraControls from "camera-controls";
import * as THREE from "three";
import { DEFAULT_BALANCE } from "../shared/balance";
import { mulberry32 } from "../shared/rng";
import { skyClock, type SkyClock } from "./skyClock";
import { EMBER, skyRig, type Rgb } from "./skyRig";

CameraControls.install({ THREE });

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: CameraControls;
  flyTo(x: number, z: number): void;
  onFrame(fn: (dt: number) => void): void;
  /** anchor the sky to the world's clock; it free-runs between world frames */
  setWorldClock(worldSeconds: number, daySeconds: number, daylightShare?: number): void;
  /** pin the sky to a fraction of the day — debugging and screenshots */
  setDayFraction(f: number): void;
  /** the fraction of the day currently on screen (tests and tooling) */
  dayFraction(): number;
  /** the world's clock as this viewer projects it — ambient life is a pure
   * function of this value, so nothing a viewer does can reseed it */
  worldTime(): number;
}

/** dawn and dusk each burn a while; the share is server law — the same
 * fraction that sends the settlers home to their beds. The compiled-in value
 * is only a seed: the first world frame replaces it with the world's own. */
const DEFAULT_SHARE = DEFAULT_BALANCE.daylightShare;

/** three.js colour from the rig's plain rgb. */
function toColor(target: THREE.Color, c: Rgb): THREE.Color {
  return target.setRGB(c.r, c.g, c.b);
}

export function createStage(canvas: HTMLCanvasElement, clock: SkyClock = skyClock()): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#16455c");
  scene.fog = new THREE.Fog("#16455c", 260, 1500);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
  // start due south of the world origin so the first view faces true north
  camera.position.set(0, 90, 165);

  const controls = new CameraControls(camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 25;
  controls.maxDistance = 1200;
  // panning slides over the map only — a vertical drag walks the view
  // forward across the sea instead of lifting it off the ground plane
  controls.verticalDragToForward = true;
  const flatTarget = new THREE.Vector3();

  // golden-hour rig: cool sky above, warm earth bounce below, warm key sun —
  // the hemisphere split is what keeps flat-shaded faces from reading flat
  const hemi = new THREE.HemisphereLight("#cde6f7", "#7a6647", 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#ffdca8", 2.6);
  sun.position.set(120, 170, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 600;
  const SHADOW_SPAN = 110;
  sun.shadow.camera.left = -SHADOW_SPAN;
  sun.shadow.camera.right = SHADOW_SPAN;
  sun.shadow.camera.top = SHADOW_SPAN;
  sun.shadow.camera.bottom = -SHADOW_SPAN;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.12;
  scene.add(sun, sun.target);
  // by day a cool bounce off the sea; by night it turns moon
  const fill = new THREE.DirectionalLight("#7fa9c9", 0.4);
  fill.position.set(-140, 90, -100);
  scene.add(fill);

  // the endless ocean
  const oceanMat = new THREE.MeshPhongMaterial({
    color: "#0f4258",
    shininess: 90,
    specular: "#3d7d95",
  });
  const ocean = new THREE.Mesh(new THREE.CircleGeometry(2600, 64), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.receiveShadow = true;
  scene.add(ocean);

  // stars pinned to a far dome, revealed as the daylight drains away
  const starRng = mulberry32(20260730);
  const starPos = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i++) {
    const az = starRng() * Math.PI * 2;
    const alt = Math.asin(0.06 + starRng() * 0.94);
    const r = 1900;
    starPos[i * 3] = Math.cos(az) * Math.cos(alt) * r;
    starPos[i * 3 + 1] = Math.sin(alt) * r;
    starPos[i * 3 + 2] = Math.sin(az) * Math.cos(alt) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: "#dfe8ff",
    size: 2.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // the sun and moon themselves — discs on the far sky that visibly climb
  // out of the sea at dawn and sink back into it at dusk
  const sunDiscMat = new THREE.MeshBasicMaterial({ color: "#ffd27a", fog: false });
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), sunDiscMat);
  const moonDiscMat = new THREE.MeshBasicMaterial({ color: "#e8eef7", fog: false });
  const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(19, 14, 10), moonDiscMat);
  scene.add(sunDisc, moonDisc);

  // ── the turning of the day ────────────────────────────────────────────────
  // Read, never stored: every frame asks the world clock where the day stands.
  // Nothing here accumulates, so no remount, no island switch and no dropped
  // frame can leave the sky stranded in the dark.
  const skyC = new THREE.Color();
  const emberC = new THREE.Color().setRGB(EMBER.r, EMBER.g, EMBER.b);
  /** the world's own daylight share, replaced by the first world frame */
  let daylightShare = DEFAULT_SHARE;

  function applyTimeOfDay(target: THREE.Vector3): void {
    const rig = skyRig(clock.phase(), daylightShare);
    const a = rig.angle;

    SUN_OFFSET.set(Math.cos(a) * 150, 40 + Math.max(0, rig.elevation) * 150, 60);
    sun.intensity = rig.sunIntensity;
    toColor(sun.color, rig.sunColor);

    hemi.intensity = rig.hemiIntensity;
    toColor(hemi.color, rig.hemiSky);
    toColor(hemi.groundColor, rig.hemiGround);
    // the fill turns moonlight after dark so shapes never go fully flat — and
    // it swings to the moon's side of the sky, so night keeps its modelling
    fill.intensity = rig.fillIntensity;
    toColor(fill.color, rig.fillColor);
    // the fill has no shadow frustum to follow, so it stays world-anchored:
    // only its direction turns, swinging round to the moon's side of the sky
    const moonA = a + Math.PI;
    fill.position.set(Math.cos(moonA) * 140, 90 + Math.max(0, Math.sin(moonA)) * 90, -100);

    toColor(skyC, rig.skyColor);
    (scene.background as THREE.Color).copy(skyC);
    (scene.fog as THREE.Fog).color.copy(skyC);
    toColor(oceanMat.color, rig.oceanColor);
    starMat.opacity = rig.starOpacity;

    // the discs ride a far arc around whatever the camera watches; near the
    // horizon the sun swells and reddens, half-sunk in the sea
    sunDisc.position.set(
      target.x + Math.cos(a) * 1500,
      Math.sin(a) * 1100,
      target.z - 500,
    );
    sunDisc.visible = rig.sunVisible;
    sunDiscMat.color.set("#ffd27a").lerp(emberC, rig.ember * 0.9);
    sunDisc.scale.setScalar(1 + rig.ember * 0.5);
    moonDisc.position.set(
      target.x + Math.cos(moonA) * 1500,
      Math.sin(moonA) * 1100,
      target.z - 500,
    );
    moonDisc.visible = rig.moonVisible;
  }

  const frameFns: ((dt: number) => void)[] = [];
  const frameClock = new THREE.Clock();
  const lookTarget = new THREE.Vector3();
  const SUN_OFFSET = new THREE.Vector3(120, 170, 80);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  renderer.setAnimationLoop(() => {
    const dt = frameClock.getDelta();
    controls.update(dt);
    // the look target lives on the sea — no gesture may lift it off the plane
    controls.getTarget(flatTarget);
    if (Math.abs(flatTarget.y) > 1e-4) {
      controls.setTarget(flatTarget.x, 0, flatTarget.z, false);
      controls.update(0);
    }
    // the shadow frustum is island-sized, so the sun rig follows the view;
    // the stars ride along so their dome never drifts off-centre
    controls.getTarget(lookTarget);
    applyTimeOfDay(lookTarget);
    sun.target.position.copy(lookTarget);
    sun.position.copy(lookTarget).add(SUN_OFFSET);
    stars.position.copy(lookTarget);
    for (const fn of frameFns) fn(dt);
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    controls,
    flyTo(x, z) {
      // approach from due south — every landing faces true north (-Z)
      void controls.setLookAt(x, 65, z + 110, x, 0, z, !REDUCED_MOTION);
    },
    onFrame(fn) {
      frameFns.push(fn);
    },
    setWorldClock(worldSeconds, daySeconds, share) {
      // the world's law wins over the constant this client was built with
      if (share !== undefined && share > 0 && share < 1) daylightShare = share;
      clock.sync(worldSeconds, daySeconds);
    },
    setDayFraction(f) {
      clock.pin(f);
    },
    dayFraction() {
      return clock.phase();
    },
    worldTime() {
      return clock.worldTime();
    },
  };
}
