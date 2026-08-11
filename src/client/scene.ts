import CameraControls from "camera-controls";
import * as THREE from "three";
import { DEFAULT_BALANCE } from "../shared/balance";
import { mulberry32 } from "../shared/rng";
import { skyClock, type SkyClock } from "./skyClock";
import { EMBER, skyRig, type Rgb } from "./skyRig";
import { ART_DIRECTION, BEAUTY_MARKER, CLAY_PALETTE } from "./artDirection";
import { createPostPipeline, POST_MARKER, postEnabled } from "./postEffects";
import {
  AdaptiveRenderQuality,
  renderQualityProfile,
  ShadowRefreshBudget,
  type RenderQuality,
} from "./renderQuality";
import { createWaterSurface, type WaterSwellPose } from "./waterSurface";
import type { StampableTerrain } from "./waterDepthField";

CameraControls.install({ THREE });

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: CameraControls;
  /** Accessibility preference shared with transient world effects. */
  reducedMotion: boolean;
  flyTo(x: number, z: number): void;
  /** First-load reveal: begin above the whole island, then settle into play. */
  establishAt(x: number, z: number): void;
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
  /** A render-only camera offset. It is restored before controls update again. */
  setCameraShake(x: number, y: number, z: number, roll?: number): void;
  /** Paint a built island's bathymetry into the sea — visual only, from the
   * island's already generated terrain; shores, lagoons and foam follow it. */
  stampWater(centerX: number, centerZ: number, seed: number, terrain: StampableTerrain): void;
  waterPose(x: number, z: number): WaterSwellPose;
  /** On-demand renderer diagnostics for benchmarks; never runs in the frame loop. */
  performanceSnapshot(): StagePerformanceSnapshot;
}

export interface StagePerformanceSnapshot {
  objects: number;
  visibleObjects: number;
  meshes: number;
  instancedMeshes: number;
  sprites: number;
  lights: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  pixelRatio: number;
  drawingBuffer: { width: number; height: number };
  shadows: { enabled: boolean; mapSize: number };
  quality: RenderQuality;
  postActive: boolean;
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = ART_DIRECTION.lighting.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.userData.artDirection = ART_DIRECTION.id;
  scene.userData.beautyPass = BEAUTY_MARKER;
  canvas.dataset.artDirection = ART_DIRECTION.id;
  canvas.dataset.beauty = BEAUTY_MARKER;
  canvas.dataset.postSupport = POST_MARKER;
  document.documentElement.dataset.reducedMotion = String(REDUCED_MOTION);
  scene.background = new THREE.Color(CLAY_PALETTE.ocean);
  scene.fog = new THREE.Fog(
    CLAY_PALETTE.ocean,
    ART_DIRECTION.lighting.fogNear,
    ART_DIRECTION.lighting.fogFar,
  );

  const camera = new THREE.PerspectiveCamera(ART_DIRECTION.camera.fov, 1, 0.5, 4000);
  // start due south of the world origin so the first view faces true north
  camera.position.set(
    ART_DIRECTION.camera.start.x,
    ART_DIRECTION.camera.start.y,
    ART_DIRECTION.camera.start.z,
  );

  const controls = new CameraControls(camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = ART_DIRECTION.camera.minDistance;
  controls.maxDistance = 1200;
  // panning slides over the map only — a vertical drag walks the view
  // forward across the sea instead of lifting it off the ground plane
  controls.verticalDragToForward = true;
  const flatTarget = new THREE.Vector3();

  // golden-hour rig: cool sky above, warm earth bounce below, warm key sun —
  // the hemisphere split is what keeps flat-shaded faces from reading flat
  const hemi = new THREE.HemisphereLight(
    ART_DIRECTION.lighting.sky,
    ART_DIRECTION.lighting.groundBounce,
    1.35,
  );
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(
    ART_DIRECTION.lighting.key,
    ART_DIRECTION.lighting.keyIntensity,
  );
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
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  // by day a cool bounce off the sea; by night it turns moon
  const fill = new THREE.DirectionalLight(ART_DIRECTION.lighting.coolFill, 0.46);
  fill.position.set(-140, 90, -100);
  scene.add(fill);

  // the endless ocean
  const water = createWaterSurface({
    reducedMotion: REDUCED_MOTION,
    mobile: window.innerWidth <= 640,
  });
  const oceanMat = water.material;
  scene.userData.waterShader = water.mesh.userData.waterShader;
  canvas.dataset.water = water.mesh.userData.waterShader as string;
  scene.add(water.mesh);

  // A few hand-shaped clouds, instanced into one draw call. They drift on the
  // world clock, not frame accumulation, and freeze for reduced-motion users.
  const cloudCount = window.innerWidth <= 640 ? 12 : 21;
  const cloudGeometry = new THREE.DodecahedronGeometry(1, 0);
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: "#edf1ed",
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    fog: true,
  });
  const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, cloudCount);
  clouds.name = "drifting-clay-clouds";
  clouds.frustumCulled = false;
  clouds.renderOrder = -2;
  scene.add(clouds);
  const cloudSeeds = Array.from({ length: Math.ceil(cloudCount / 3) }, (_, i) => {
    const rand = mulberry32(20260811 + i * 97);
    return {
      x: rand() * 1_600 - 800,
      z: rand() * 1_500 - 750,
      y: 96 + rand() * 46,
      speed: 1.2 + rand() * 1.1,
      scale: 8 + rand() * 7,
    };
  });
  const cloudMatrix = new THREE.Matrix4();
  const cloudPos = new THREE.Vector3();
  const cloudQuat = new THREE.Quaternion();
  const cloudScale = new THREE.Vector3();
  let cloudTickIn = 0;

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

    // the key sun rides lower than the old rig — the long soft shadows of a
    // studio-lit miniature, even at the height of the day
    SUN_OFFSET.set(Math.cos(a) * 150, 34 + Math.max(0, rig.elevation) * 112, 60);
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
    // shallows, foam and sun glints breathe with the same day the lights obey
    water.setDaylight(rig.dayness);
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
  const drawingBufferSize = new THREE.Vector2();
  const qualityController = new AdaptiveRenderQuality();
  const shadowBudget = new ShadowRefreshBudget();
  const post = createPostPipeline(renderer);
  const previousShadowCameraPosition = new THREE.Vector3().copy(camera.position);
  const previousShadowCameraQuaternion = new THREE.Quaternion().copy(camera.quaternion);
  const renderCameraPosition = new THREE.Vector3();
  const renderCameraQuaternion = new THREE.Quaternion();
  const shakeOffset = new THREE.Vector3();
  let shakeRoll = 0;

  function applyQuality(quality: RenderQuality): void {
    const profile = renderQualityProfile(quality, window.devicePixelRatio);
    renderer.setPixelRatio(profile.pixelRatio);
    if (sun.shadow.mapSize.x !== profile.shadowMapSize) {
      sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    shadowBudget.invalidate();
    // the miniature post pass runs only where it is free: desktop, full
    // quality, and no reduced-motion request — everyone else renders direct.
    // ?post=1/0 pins it for screenshot tooling and slow headless GPUs.
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pin = new URLSearchParams(location.search).get("post");
    const enabled =
      pin === "1" ? true : pin === "0" ? false : postEnabled(quality, w <= 640, REDUCED_MOTION);
    post.setEnabled(enabled);
    post.setSize(w, h, profile.pixelRatio);
    canvas.dataset.post = post.enabled() ? POST_MARKER : "off";
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    applyQuality(qualityController.current());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w <= 640 ? ART_DIRECTION.camera.fov + 5 : ART_DIRECTION.camera.fov;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  renderer.setAnimationLoop((nowMs) => {
    const dt = frameClock.getDelta();
    water.tick(dt);
    const nextQuality = qualityController.sample(dt * 1_000);
    if (nextQuality) applyQuality(nextQuality);
    controls.update(dt);
    const cameraMoved =
      camera.position.distanceToSquared(previousShadowCameraPosition) > 1e-4 ||
      1 - Math.abs(camera.quaternion.dot(previousShadowCameraQuaternion)) > 1e-7;
    previousShadowCameraPosition.copy(camera.position);
    previousShadowCameraQuaternion.copy(camera.quaternion);
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
    cloudTickIn -= dt;
    if (cloudTickIn <= 0) {
      cloudTickIn = window.innerWidth <= 640 ? 0.12 : 0.08;
      const driftTime = REDUCED_MOTION ? 0 : clock.worldTime();
      for (let i = 0; i < cloudCount; i++) {
        const seed = cloudSeeds[Math.floor(i / 3)]!;
        const lobe = i % 3;
        const wrap = ((seed.x + driftTime * seed.speed + 900) % 1_800 + 1_800) % 1_800 - 900;
        const offsets = [[-0.72, 0, 0], [0.45, 0.12, 0.15], [0, -0.08, 0.52]] as const;
        const off = offsets[lobe]!;
        const scale = seed.scale * (lobe === 0 ? 1 : lobe === 1 ? 0.78 : 0.66);
        cloudMatrix.compose(
          cloudPos.set(wrap + off[0] * scale, seed.y + off[1] * scale, seed.z + off[2] * scale),
          cloudQuat,
          cloudScale.set(scale * 1.65, scale * 0.42, scale),
        );
        clouds.setMatrixAt(i, cloudMatrix);
      }
      clouds.instanceMatrix.needsUpdate = true;
    }
    sun.target.position.copy(lookTarget);
    sun.position.copy(lookTarget).add(SUN_OFFSET);
    stars.position.copy(lookTarget);
    for (const fn of frameFns) fn(dt);
    renderer.shadowMap.needsUpdate = shadowBudget.shouldRefresh(
      nowMs,
      controls.active || cameraMoved,
    );
    // Catastrophe shake is applied only for the draw. CameraControls never
    // observes it, so there is no drift and cleanup always lands exactly on
    // the user's prior view.
    renderCameraPosition.copy(camera.position);
    renderCameraQuaternion.copy(camera.quaternion);
    camera.position.add(shakeOffset);
    if (shakeRoll) camera.rotateZ(shakeRoll);
    post.render(scene, camera);
    camera.position.copy(renderCameraPosition);
    camera.quaternion.copy(renderCameraQuaternion);
  });

  return {
    scene,
    camera,
    controls,
    reducedMotion: REDUCED_MOTION,
    flyTo(x, z) {
      // approach from due south — every landing faces true north (-Z)
      const mobile = window.innerWidth <= 640;
      void controls.setLookAt(
        x,
        ART_DIRECTION.camera.landing.y + (mobile ? 12 : 0),
        z + ART_DIRECTION.camera.landing.z + (mobile ? 18 : 0),
        x,
        0,
        z,
        !REDUCED_MOTION,
      );
    },
    establishAt(x, z) {
      const mobile = window.innerWidth <= 640;
      const highY = mobile ? 150 : 132;
      const highZ = mobile ? 196 : 180;
      void controls.setLookAt(x, highY, z + highZ, x, 0, z, false).then(() =>
        controls.setLookAt(
          x,
          ART_DIRECTION.camera.landing.y + (mobile ? 12 : 0),
          z + ART_DIRECTION.camera.landing.z + (mobile ? 18 : 0),
          x,
          0,
          z,
          !REDUCED_MOTION,
        ),
      );
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
    setCameraShake(x, y, z, roll = 0) {
      shakeOffset.set(x, y, z);
      shakeRoll = roll;
    },
    stampWater(centerX, centerZ, seed, terrain) {
      water.stampIsland(centerX, centerZ, seed, terrain);
    },
    waterPose(x, z) {
      return water.poseAt(x, z);
    },
    performanceSnapshot() {
      let objects = 0;
      let visibleObjects = 0;
      let meshes = 0;
      let instancedMeshes = 0;
      let sprites = 0;
      let lights = 0;
      scene.traverse((object) => {
        objects += 1;
        if (object.visible) visibleObjects += 1;
        if ((object as THREE.Mesh).isMesh) meshes += 1;
        if ((object as THREE.InstancedMesh).isInstancedMesh) instancedMeshes += 1;
        if ((object as THREE.Sprite).isSprite) sprites += 1;
        if ((object as THREE.Light).isLight) lights += 1;
      });
      renderer.getDrawingBufferSize(drawingBufferSize);
      return {
        objects,
        visibleObjects,
        meshes,
        instancedMeshes,
        sprites,
        lights,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
        pixelRatio: renderer.getPixelRatio(),
        drawingBuffer: { width: drawingBufferSize.x, height: drawingBufferSize.y },
        shadows: { enabled: renderer.shadowMap.enabled, mapSize: sun.shadow.mapSize.x },
        quality: qualityController.current(),
        postActive: post.enabled(),
      };
    },
  };
}
