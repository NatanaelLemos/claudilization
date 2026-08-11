import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "./style.css";

import * as THREE from "three";
import { DEFAULT_BALANCE } from "../shared/balance";
import { civAccented, shadeCivColor } from "../shared/civColor";
import { CIVS } from "../shared/civs";
import type { Boat, CivSpec, GameEvent, Island, IslandTerrain } from "../shared/types";
import { initAmbientLife } from "./ambientLife";
import { tickBoats, updateBoats } from "./boatsView";
import {
  registerCreationSpecs,
  tickCreations,
  updateCreationBands,
  updateCreations,
} from "./creationsView";
import { ART_DIRECTION } from "./artDirection";
import {
  buildGroundsGroup,
  disposeGroundsGroup,
  GROUNDS_DISTANCE,
  GROUNDS_GROUP,
} from "./groundsView";
import {
  createIslandGroup,
  DECOR_FINE_DISTANCE,
  DECOR_FINE_GROUP,
  setIslandMood,
} from "./islandMesh";
import { Net, type IslandSummary } from "./net";
import { createStage } from "./scene";
import { initCatastropheEffects } from "./catastropheEffects";
import { setSettlerViewActive, tickSettlers, updateSettlers } from "./settlersView";
import { initPicking } from "./picking";
import { startRenderBenchmark } from "./renderBenchmark";
import { buildingRenderSignature } from "./structures";
import { setWindowGlow } from "./structures";
import { openingIslandId, townFraming, type TownFraming } from "./openingView";
import { skyRig } from "./skyRig";
import {
  buildTownEffects,
  disposeTownEffects,
  tickTownEffects,
  TOWN_EFFECTS_GROUP,
} from "./townEffects";
import {
  applyBuildingShadowDistance,
  buildBuildingBatch,
  disposeBuildingBatch,
} from "./buildingBatch";
import { hideBuildingPanel, refreshBuildingPanel, showBuildingPanel } from "./ui/buildingPanel";
import { addChatMessage, initChat } from "./ui/chat";
import { initJoinFlow } from "./ui/joinFlow";
import { initUpdateFlow } from "./ui/updateFlow";
import { updateMood } from "./ui/mood";
import { updatePopulation } from "./ui/population";
import { updateAgeProgress } from "./ui/ageProgress";
import { updateStocks } from "./ui/stocks";
import { addFeedEvents } from "./ui/feed";
import { attackAlertModel, showAttackAlert } from "./ui/alerts";
import { showBanner } from "./ui/banner";
import { pulseCatastrophe, updateCatastropheStatus } from "./ui/catastrophe";
import { showRecap } from "./ui/recap";

const key = new URLSearchParams(location.search).get("key") ?? undefined;
const canvas = document.getElementById("world") as HTMLCanvasElement;
const titleEl = document.getElementById("island-title")!;
const ageEl = document.getElementById("island-age")!;
const worldCurtain = document.getElementById("world-curtain")!;

const stage = createStage(canvas);
const catastropheEffects = initCatastropheEffects(stage);
const net = new Net();

interface IslandView {
  summary: IslandSummary;
  group: THREE.Group;
  /** terrain meshes are built on demand — false while the placeholder stands */
  terrainReady: boolean;
  buildings: THREE.Group;
  settlers: THREE.Group;
  boats: THREE.Group;
  creations: THREE.Group;
  bands: THREE.Group;
  buildingIds: string;
  /** last full pulse — the inspector reads buildings and tenants from it */
  island?: Island;
}

const views = new Map<string, IslandView>();
/** islands whose terrain still waits to be built — drained one per frame */
const terrainQueue = new Set<string>();
let focusedId: string | undefined;
let myIslandId: string | undefined;
let openingRevealed = false;

/** Frame the town, not the island: the landing shot follows the buildings the
 * world has already told us about. Before terrain exists the half-size falls
 * back to the world default, which is what the summary was generated with. */
function viewFraming(view: IslandView): TownFraming {
  const half =
    (view.group.userData.half as number | undefined) ??
    (view.summary.size ?? DEFAULT_BALANCE.islandSize) / 2;
  return townFraming(view.summary.buildings, half);
}

/**
 * Register an island without paying for its terrain. The heavy work —
 * 166×166 noise, geometry, normals, nature meshes — used to run for every
 * island synchronously on the first world frame, freezing the initial load
 * for the whole ocean. Now each island starts as an empty, positioned group
 * and the terrain builder fills it in on demand: the watched island first,
 * then the rest nearest-first, one per frame, cached forever after.
 */
function ensureView(summary: IslandSummary): IslandView {
  let view = views.get(summary.id);
  if (!view) {
    const group = new THREE.Group();
    group.position.set(summary.position.x, 0, summary.position.y);
    stage.scene.add(group);
    const buildings = new THREE.Group();
    const settlers = new THREE.Group();
    const creations = new THREE.Group();
    group.add(buildings, settlers, creations);
    const boats = new THREE.Group();
    const bands = new THREE.Group();
    stage.scene.add(boats, bands); // boats and bands travel in world space
    view = {
      summary,
      group,
      terrainReady: false,
      buildings,
      settlers,
      boats,
      creations,
      bands,
      buildingIds: "",
    };
    views.set(summary.id, view);
    terrainQueue.add(summary.id);
  }
  view.summary = summary;
  return view;
}

/** Build one island's terrain now and move its content groups onto the land. */
function buildTerrain(view: IslandView): void {
  const s = view.summary;
  const ground = createIslandGroup(s.seed, s.size ?? DEFAULT_BALANCE.islandSize, s.id, {
    propScale: window.innerWidth <= 640 ? ART_DIRECTION.density.mobilePropScale : 1,
  });
  ground.position.copy(view.group.position);
  ground.add(view.buildings, view.settlers, view.creations);
  stage.scene.remove(view.group);
  stage.scene.add(ground);
  view.group = ground;
  view.terrainReady = true;
  // the sea learns this island's real shoreline: lagoon color, banked depth
  // and coast-hugging foam all read the bathymetry stamped here
  stage.stampWater(s.position.x, s.position.y, s.seed, ground.userData.terrain as IslandTerrain);
  if (s.ruins) setIslandMood(ground, true, false);
  // the world already told us what stands here — fill the fresh land in
  applySummaryVisuals(view, s);
  if (view.island) applyIslandDetail(view, view.island);
  if (s.id === focusedId && !openingRevealed) {
    openingRevealed = true;
    stage.establishAt(s.position.x, s.position.y, viewFraming(view));
    requestAnimationFrame(() => worldCurtain.classList.add("ready"));
  }
}

// the terrain builder: one island per frame keeps every frame fluid while
// the ocean streams in — the watched island first, then nearest to the camera
const buildTargetV3 = new THREE.Vector3();
stage.onFrame(() => {
  if (!terrainQueue.size) return;
  stage.controls.getTarget(buildTargetV3);
  let bestId: string | undefined;
  let bestD = Infinity;
  for (const id of terrainQueue) {
    const v = views.get(id);
    if (!v) {
      terrainQueue.delete(id);
      continue;
    }
    const d =
      id === focusedId
        ? -1
        : Math.hypot(
            v.summary.position.x - buildTargetV3.x,
            v.summary.position.y - buildTargetV3.z,
          );
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  if (!bestId) return;
  terrainQueue.delete(bestId);
  buildTerrain(views.get(bestId)!);
});

/** islands whose full detail arrives by subscription — summaries stand back */
function subscribedIds(): Set<string> {
  const ids = new Set<string>();
  if (focusedId) ids.add(focusedId);
  if (chase) ids.add(chase.islandId);
  return ids;
}

function rebuildBuildings(
  view: IslandView,
  buildings: Island["buildings"],
  civ: CivSpec,
  age: Island["age"],
  enhanced: boolean,
): void {
  // the civ's accent is part of the look — a conquest that recolors an island
  // must rebuild its roofs even when the building list is unchanged
  const signature = `${civ.accent}|${enhanced ? "town" : "map"}|${buildingRenderSignature(buildings, age)}`;
  if (signature === view.buildingIds) return;
  view.buildingIds = signature;
  disposeTownEffects(view.buildings);
  disposeGroundsGroup(view.buildings);
  disposeBuildingBatch(view.buildings);
  const heightAt = view.group.userData.heightAt as (x: number, y: number) => number;
  const half = view.group.userData.half as number;
  // the town plan (same shared module the server places with) orients every
  // building toward its street, plaza, or the sea, and grounds it on slopes
  const terrain = enhanced
    ? (view.group.userData.terrain as IslandTerrain | undefined)
    : undefined;
  view.buildings.add(
    buildBuildingBatch({
      buildings,
      civ,
      age,
      heightAt,
      half,
      terrain,
      islandSeed: view.summary.seed,
    }),
  );
  if (enhanced) {
    view.buildings.add(
      buildTownEffects({
        buildings,
        civ,
        terrain,
        islandSeed: view.summary.seed,
        heightAt,
        half,
      }),
    );
  }
  // the settlement's street layer: clay footpaths between finished buildings
  // and a small working yard per building — same lifecycle as the batch
  if (enhanced) {
    view.buildings.add(
      buildGroundsGroup({
        buildings,
        civ,
        islandSeed: view.summary.seed,
        heightAt,
        half,
        terrain,
      }),
    );
  }
}

/** Summary-driven meshes for an unfocused island — needs its terrain built. */
function applySummaryVisuals(view: IslandView, s: IslandSummary): void {
  if (!view.terrainReady) return;
  const heightAt = view.group.userData.heightAt as (x: number, y: number) => number;
  const half = view.group.userData.half as number;
  const civ = civAccented(CIVS[s.civ], s.color);
  rebuildBuildings(view, s.buildings ?? [], civ, s.age, s.id === focusedId);
  updateBoats(
    view.boats,
    { id: s.id, boats: s.boats ?? [] } as unknown as Island,
    civ,
  );
  updateCreations(view.creations, s.creationSpecs, s.creations, heightAt, half);
}

/** Full-detail meshes for a subscribed island — needs its terrain built. */
function applyIslandDetail(view: IslandView, island: Island): void {
  if (!view.terrainReady) return;
  // colonies fly their ruler's color, which only the summary resolves
  const civ = civAccented(CIVS[island.civ], view.summary.color ?? island.color);
  const heightAt = view.group.userData.heightAt as (x: number, y: number) => number;
  const half = view.group.userData.half as number;
  rebuildBuildings(view, island.buildings, civ, island.age, island.id === focusedId);
  updateSettlers(view.settlers, island, civ, heightAt, half, island.id === focusedId);
  updateBoats(view.boats, island, civ);
  updateCreations(view.creations, island.creationSpecs, island.creations, heightAt, half);
  updateCreationBands(view.bands, island.creationBands);
}

function ageLabel(s: IslandSummary): string {
  if (s.kind === "wild") return "uncharted · uninhabited";
  const owner = s.kind === "colony" ? " colony" : "";
  return `${s.age} age · ${CIVS[s.civ].label}${owner}${s.dormant ? " · sleeping" : ""}`;
}

/** The corner name wears the civilization's color, lifted for legibility. */
function tintTitle(color?: string): void {
  titleEl.style.color = color ? shadeCivColor(color, 0.22) : "";
}

/** Point the corner name (and the detail stream) at an island — no camera motion. */
function watchIsland(id: string): void {
  focusedId = id;
  for (const [viewId, view] of views) setSettlerViewActive(view.settlers, viewId === id);
  hideBuildingPanel();
  const view = views.get(id);
  if (!view) return;
  net.subscribe([id]);
  titleEl.textContent = view.summary.name;
  tintTitle(view.summary.color);
  ageEl.textContent = ageLabel(view.summary);
}

function focusIsland(id: string): void {
  if (focusedId === id) return;
  stopChase();
  watchIsland(id);
  const view = views.get(id);
  if (view) {
    stage.flyTo(view.summary.position.x, view.summary.position.y, viewFraming(view));
  }
}

// the sun belongs to the world, not to whichever island is on screen: the sky
// is anchored on world frames alone, so focusing, peeking and subscribing
// cannot touch the hour
net.onWorldClock = (worldSeconds, daySeconds, daylightShare) =>
  stage.setWorldClock(worldSeconds, daySeconds, daylightShare);
net.onCatastrophe = (status, worldSeconds) => {
  updateCatastropheStatus(status, worldSeconds);
  catastropheEffects.update(status);
};

// ambient life — trade sails, strollers, gulls, shoreline skirmishes — is a
// pure function of the same world clock, so nothing a viewer does reseeds it
const ambient = initAmbientLife(stage, {
  anchor: (id) => {
    const v = views.get(id);
    if (!v || !v.terrainReady) return undefined;
    return {
      group: v.group,
      heightAt: v.group.userData.heightAt as (x: number, y: number) => number,
      half: v.group.userData.half as number,
    };
  },
  law: () => ({
    daySeconds: net.daySeconds ?? DEFAULT_BALANCE.daySeconds,
    daylightShare: net.daylightShare ?? DEFAULT_BALANCE.daylightShare,
  }),
});

net.onWorld = (summaries) => {
  const detailed = subscribedIds();
  // every design in the world registers first, so colony garrisons and bands
  // can resolve sprites owned by another island in the same frame
  for (const s of summaries) registerCreationSpecs(s.creationSpecs);
  for (const s of summaries) {
    const view = ensureView(s);
    if (s.ruins && view.terrainReady) setIslandMood(view.group, true, false);
    // unfocused islands live off the summary: their villages and ships stay
    // on the map across refreshes instead of waiting for a subscription
    if (!detailed.has(s.id)) applySummaryVisuals(view, s);
    updateCreationBands(view.bands, s.creationBands);
  }
  if (!focusedId && summaries.length) {
    // spectators never see dead air: land on the most recently active island
    const target = openingIslandId(summaries, myIslandId);
    if (target) focusIsland(target);
  }
  if (focusedId) {
    const s = summaries.find((x) => x.id === focusedId);
    if (s) {
      titleEl.textContent = s.name;
      tintTitle(s.color);
      ageEl.textContent = ageLabel(s);
    }
  }
  ambient.updateWorld(summaries);
};

net.onIsland = (island: Island) => {
  const view = views.get(island.id);
  if (!view) return;
  view.island = island;
  applyIslandDetail(view, island);
  if (island.id === focusedId) refreshBuildingPanel(island);
  if (chase && chase.islandId === island.id) {
    const boat = island.boats.find((b) => b.id === chase!.boatId);
    const underway = boat && boat.state === chase.state && boat.state !== "docked";
    if (!underway) {
      // the leg we were riding has ended — settle on wherever it arrived
      const arrivedAt = chase.state === "returning" ? island.id : boat?.dest;
      stopChase();
      const port = arrivedAt ? views.get(arrivedAt) : undefined;
      if (port && arrivedAt !== focusedId) focusIsland(arrivedAt!);
      else if (port) {
        stage.flyTo(port.summary.position.x, port.summary.position.y, viewFraming(port));
      }
    }
  }
  if (island.id === myIslandId) {
    updateStocks(island);
    updatePopulation(island);
    updateMood(island);
    updateAgeProgress(island);
  }
  if (island.ruins && view.terrainReady) setIslandMood(view.group, true, island.dormant);
};

net.onEvents = (events: GameEvent[]) => {
  addFeedEvents(events);
  for (const e of events) {
    if (e.type === "catastrophe-start" && e.catastropheId) {
      pulseCatastrophe(e.catastropheId);
    }
    // an island under attack gets the tocsin card — names in banner colors and
    // a button any viewer can click to fly to the fight
    const alert = attackAlertModel(e, (id) => {
      const s = views.get(id)?.summary;
      return s ? { name: s.name, color: s.color } : undefined;
    });
    if (alert) {
      showAttackAlert(alert, () => focusIsland(alert.defenderId));
      continue; // the card is the louder element — no doubled banner
    }
    if (e.world) showBanner(e.text);
  }
};

net.onChat = addChatMessage;

net.onHello = (reply) => {
  myIslandId = reply.islandId;
  focusIsland(reply.islandId);
  if (reply.recap) showRecap(reply.recap);
};

initChat(Boolean(key), (text) => net.chat(text));
stage.onFrame(tickSettlers);
stage.onFrame(tickCreations);
stage.onFrame((dt) => tickBoats(dt, stage.waterPose));

// Re-evaluate the shadow caster budget twice a second while the camera roams.
// The same sweep hides street-level detail — meadows, paths, yards — on
// islands far from the eye, so the beauty pass never taxes the map view.
const shadowTarget = new THREE.Vector3();
let shadowBudgetIn = 0;
let townLifeIn = 0;
stage.onFrame((dt) => {
  shadowBudgetIn -= dt;
  if (shadowBudgetIn > 0) return;
  shadowBudgetIn = 0.5;
  stage.controls.getTarget(shadowTarget);
  for (const view of views.values()) {
    const distance = Math.hypot(
      view.summary.position.x - shadowTarget.x,
      view.summary.position.y - shadowTarget.z,
    );
    applyBuildingShadowDistance(view.buildings, distance);
    const decorFine = view.group.getObjectByName(DECOR_FINE_GROUP);
    if (decorFine) decorFine.visible = distance <= DECOR_FINE_DISTANCE;
    const grounds = view.buildings.getObjectByName(GROUNDS_GROUP);
    if (grounds) grounds.visible = distance <= GROUNDS_DISTANCE;
    const effects = view.buildings.getObjectByName(TOWN_EFFECTS_GROUP);
    if (effects) effects.visible = distance <= GROUNDS_DISTANCE;
  }
});

// Windows wake after dusk; smoke and pennants move at a bounded 20 Hz. All
// timing reads the one world clock and freezes cleanly for reduced motion.
stage.onFrame((dt) => {
  townLifeIn -= dt;
  if (townLifeIn > 0) return;
  townLifeIn = 0.05;
  const share = net.daylightShare ?? DEFAULT_BALANCE.daylightShare;
  const dayness = skyRig(stage.dayFraction(), share).dayness;
  setWindowGlow(dayness);
  for (const view of views.values()) {
    const effects = view.buildings.getObjectByName(TOWN_EFFECTS_GROUP);
    if (effects?.visible) {
      tickTownEffects(view.buildings, stage.worldTime(), dayness, stage.reducedMotion);
    }
  }
});

// the compass: world north is -Z for every viewer — the dial turns with the
// camera so N always points at the same true north no matter who is looking
const compassDial = document.getElementById("compass-dial");
const NORTH = new THREE.Vector3(0, 0, -1);
const northOnScreen = new THREE.Vector3();
const invQuat = new THREE.Quaternion();
stage.onFrame(() => {
  if (!compassDial) return;
  invQuat.copy(stage.camera.quaternion).invert();
  northOnScreen.copy(NORTH).applyQuaternion(invQuat);
  const angle = Math.atan2(northOnScreen.x, northOnScreen.y);
  compassDial.style.transform = `rotate(${angle}rad)`;
});

// ── the chase camera: click a craft at sea and ride along until it arrives ──
const followPill = document.getElementById("follow-pill");
interface Chase {
  islandId: string;
  boatId: string;
  /** the leg being ridden — when the boat's state changes, it has arrived */
  state: Boat["state"];
}
let chase: Chase | undefined;
const chasePos = new THREE.Vector3();

function chasedMesh(): THREE.Object3D | undefined {
  if (!chase) return undefined;
  return views
    .get(chase.islandId)
    ?.boats.children.find((c) => c.userData.boatId === chase!.boatId);
}

function startChase(islandId: string, boatId: string): void {
  const boat = views.get(islandId)?.island?.boats.find((b) => b.id === boatId);
  hideBuildingPanel();
  chase = { islandId, boatId, state: boat?.state ?? "sailing" };
  const mesh = chasedMesh();
  if (!mesh) {
    chase = undefined;
    return;
  }
  chasePos.copy(mesh.position);
  if (followPill) {
    followPill.textContent = `${
      boat?.craft === "plane" ? "✈ Following the plane" : "⛵ Following the ship"
    } — click anywhere to let go`;
    followPill.hidden = false;
  }
  // keep the craft's home island pulsing even while watching another
  if (focusedId && islandId !== focusedId) net.subscribe([focusedId, islandId]);
  if (stage.controls.distance > 220) void stage.controls.dollyTo(110, true);
}

function stopChase(): void {
  if (!chase) return;
  chase = undefined;
  if (followPill) followPill.hidden = true;
  if (focusedId) net.subscribe([focusedId]);
}

stage.onFrame((dt) => {
  if (!chase) return;
  const mesh = chasedMesh();
  if (!mesh) return; // arrivals are judged on pulses, not on missing meshes
  // pulses land once a second, so the craft hops — the camera glides after it
  chasePos.lerp(mesh.position, 1 - Math.exp(-2.5 * dt));
  // aim at the sea beneath the craft — the look target stays on the plane
  void stage.controls.moveTo(chasePos.x, 0, chasePos.z, false);
});

// ── arrow keys pan the camera: hold to glide across the sea ────────────────
// Left/right slide the view sideways; up/down walk it forward and back over
// the water, matching the drag gesture. Keys are ignored while typing in any
// input so chat never fights the camera.
const heldPanKeys = new Set<string>();
const PAN_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

window.addEventListener("keydown", (e) => {
  if (!PAN_KEYS.has(e.key) || isTyping(e.target)) return;
  e.preventDefault(); // the page must never scroll underneath the map
  if (!heldPanKeys.has(e.key)) {
    heldPanKeys.add(e.key);
    stopChase(); // taking the wheel lets go of any followed craft
  }
});
window.addEventListener("keyup", (e) => heldPanKeys.delete(e.key));
window.addEventListener("blur", () => heldPanKeys.clear());

stage.onFrame((dt) => {
  if (!heldPanKeys.size) return;
  const right =
    (heldPanKeys.has("ArrowRight") ? 1 : 0) - (heldPanKeys.has("ArrowLeft") ? 1 : 0);
  const ahead =
    (heldPanKeys.has("ArrowUp") ? 1 : 0) - (heldPanKeys.has("ArrowDown") ? 1 : 0);
  if (!right && !ahead) return;
  // pace scales with height: the view crosses the same screen fraction per
  // second whether the camera hugs an island or surveys the whole ocean
  const step = stage.controls.distance * 0.9 * dt;
  if (right) stage.controls.truck(right * step, 0, false);
  if (ahead) stage.controls.forward(ahead * step, false);
});

// the corner name follows the camera: pan up to an island and it becomes the
// one you are watching. The camera must be at rest, and the same island must
// win two half-second looks in a row, so a fly-by never steals the title.
const FOCUS_RADIUS = 110;
const camTarget = new THREE.Vector3();
let focusPollIn = 0.5;
let focusCandidate: string | null = null;
stage.onFrame((dt) => {
  focusPollIn -= dt;
  if (focusPollIn > 0) return;
  focusPollIn = 0.5;
  if (chase || stage.controls.active) return; // riding a boat or still moving
  stage.controls.getTarget(camTarget);
  let nearest: IslandView | undefined;
  let nearestD = Infinity;
  for (const view of views.values()) {
    const d = Math.hypot(
      view.summary.position.x - camTarget.x,
      view.summary.position.y - camTarget.z,
    );
    if (d < nearestD) {
      nearestD = d;
      nearest = view;
    }
  }
  const id = nearest && nearestD <= FOCUS_RADIUS ? nearest.summary.id : null;
  if (!id || id === focusedId) {
    focusCandidate = null;
    return;
  }
  if (focusCandidate === id) {
    focusCandidate = null;
    watchIsland(id);
  } else {
    focusCandidate = id;
  }
});

initPicking(
  canvas,
  stage.camera,
  () => (focusedId ? views.get(focusedId)?.buildings : undefined),
  () => [...views.values()].map((v) => v.boats),
  (buildingId, at) => {
    stopChase();
    const view = focusedId ? views.get(focusedId) : undefined;
    const building = view?.island?.buildings.find((b) => b.id === buildingId);
    if (view?.island && building) showBuildingPanel(view.island, building, at);
  },
  startChase,
  () => {
    stopChase();
    hideBuildingPanel();
  },
);

// let the console (and screenshot tooling) spin the sun by hand, find the
// craft at sea on screen, and read where the camera is looking
(window as unknown as { __day?: (f: number) => void }).__day = (f) =>
  stage.setDayFraction(f);
// what the sky actually reads right now — the world's day, not any island's
(window as unknown as { __dayFrac?: () => number }).__dayFrac = () =>
  stage.dayFraction();
(window as unknown as { __worldTime?: () => number | undefined }).__worldTime = () =>
  net.worldTime;
(window as unknown as { __boats?: () => unknown }).__boats = () => {
  const v3 = new THREE.Vector3();
  const out: { islandId: string; boatId: string; x: number; y: number }[] = [];
  for (const view of views.values())
    for (const c of view.boats.children) {
      v3.copy(c.position).project(stage.camera);
      out.push({
        islandId: c.userData.islandId as string,
        boatId: c.userData.boatId as string,
        x: (v3.x * 0.5 + 0.5) * canvas.clientWidth,
        y: (-v3.y * 0.5 + 0.5) * canvas.clientHeight,
      });
    }
  return out;
};
(window as unknown as { __chasing?: () => unknown }).__chasing = () => chase?.boatId;
(window as unknown as { __focused?: () => unknown }).__focused = () => ({
  id: focusedId,
  title: titleEl.textContent,
});
(window as unknown as { __buildings?: (id: string) => unknown }).__buildings = (id) =>
  views.get(id)?.buildings.children.length;
(window as unknown as { __target?: () => unknown }).__target = () =>
  stage.controls.getTarget(new THREE.Vector3()).toArray();
// how much of the ocean's terrain is built — the on-demand loader's gauge
(window as unknown as { __terrain?: () => unknown }).__terrain = () => ({
  built: [...views.values()].filter((v) => v.terrainReady).length,
  pending: terrainQueue.size,
});
(window as unknown as { __perf?: () => unknown }).__perf = () =>
  stage.performanceSnapshot();
(window as unknown as { __catastropheEffect?: () => unknown }).__catastropheEffect = () =>
  catastropheEffects.snapshot();
(window as unknown as { __lookAt?: (x: number, z: number) => void }).__lookAt = (x, z) =>
  stage.flyTo(x, z);

startRenderBenchmark({
  scene: stage.scene,
  terrainReady: () => terrainQueue.size === 0,
  snapshot: () => stage.performanceSnapshot(),
});

// spectators get the Play button and the rulebook editor; players live here —
// and the owner's edit link (playerUrl + &edit=1) opens the visual updater
if (!key) initJoinFlow();
else if (new URLSearchParams(location.search).get("edit") === "1")
  void initUpdateFlow(key);
net.connect(key);
