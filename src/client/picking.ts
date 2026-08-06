import * as THREE from "three";

/**
 * Click-to-inspect for the 3D map. Camera-controls owns dragging, so a pick
 * only fires when the pointer barely moved between down and up; anything
 * longer is an orbit. Craft at sea are checked before buildings — they are
 * small, deliberate targets. Hovering a pickable turns the cursor into a
 * pointer.
 */

const CLICK_SLOP_PX = 6;
const HOVER_INTERVAL_MS = 50;

export type AssetPick =
  | { kind: "building"; buildingId: string; islandId?: string; label?: string; meta?: string }
  | { kind: "boat"; islandId: string; boatId: string; label?: string; meta?: string }
  | {
      kind: "resource";
      islandId: string;
      nodeId: string;
      resource: string;
      source?: string;
      label?: string;
      meta?: string;
    }
  | { kind: "asset"; islandId?: string; assetId?: string; label?: string; meta?: string };

interface InstanceAssetPicks {
  picks: AssetPick[];
  instancesPerAsset: number;
}

export function setInstanceAssetPicks(
  object: THREE.InstancedMesh,
  picks: AssetPick[],
  instancesPerAsset = 1,
): void {
  object.userData.instanceAssetPicks = {
    picks,
    instancesPerAsset: Math.max(1, Math.floor(instancesPerAsset)),
  } satisfies InstanceAssetPicks;
}

export function setBatchedAssetPicks(object: THREE.BatchedMesh, picks: AssetPick[]): void {
  object.userData.batchedAssetPicks = { picks };
}

export function pickOf(
  hit:
    | (Pick<THREE.Intersection, "object" | "instanceId"> & { batchId?: number })
    | THREE.Object3D
    | null,
): AssetPick | undefined {
  if (!hit) return undefined;
  const obj = "object" in hit ? hit.object : hit;
  const instanceId = "object" in hit ? hit.instanceId : undefined;
  const batchId = "object" in hit ? hit.batchId : undefined;
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (o === obj && typeof instanceId === "number") {
      const indexed = o.userData.instanceAssetPicks as InstanceAssetPicks | undefined;
      const pick = indexed?.picks[Math.floor(instanceId / (indexed.instancesPerAsset || 1))];
      if (pick) return pick;
    }
    if (o === obj && typeof batchId === "number") {
      const pick = (o.userData.batchedAssetPicks as { picks?: AssetPick[] } | undefined)
        ?.picks?.[batchId];
      if (pick) return pick;
    }
    const assetPick = o.userData.assetPick as AssetPick | undefined;
    if (assetPick) return assetPick;
    const buildingId = o.userData.buildingId as string | undefined;
    if (buildingId) return { kind: "building", buildingId };
    const boatId = o.userData.boatId as string | undefined;
    if (boatId)
      return { kind: "boat", islandId: o.userData.islandId as string, boatId };
  }
  return undefined;
}

export function initPicking(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  getBuildings: () => THREE.Group | undefined,
  getBoatGroups: () => THREE.Group[],
  onPickBuilding: (buildingId: string, at: { x: number; y: number }) => void,
  onPickBoat: (islandId: string, boatId: string) => void,
  onMiss: () => void,
): void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number } | undefined;
  let lastHoverAt = -Infinity;
  let hoverQueued = false;
  let hoverPoint = { x: 0, y: 0 };

  function cast(e: PointerEvent | MouseEvent): AssetPick | undefined {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const craft = getBoatGroups().flatMap((g) => g.children);
    const atSea = pickOf(raycaster.intersectObjects(craft, true)[0]?.object ?? null);
    if (atSea) return atSea;
    const buildings = getBuildings();
    if (!buildings) return undefined;
    return pickOf(raycaster.intersectObjects(buildings.children, true)[0]?.object ?? null);
  }

  canvas.addEventListener("pointerdown", (e) => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : undefined;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = undefined;
    if (moved > CLICK_SLOP_PX) return;
    const pick = cast(e);
    if (pick?.kind === "boat") onPickBoat(pick.islandId, pick.boatId);
    else if (pick?.kind === "building") onPickBuilding(pick.buildingId, { x: e.clientX, y: e.clientY });
    else onMiss();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (down) return; // mid-drag: the cursor belongs to the camera
    hoverPoint = { x: e.clientX, y: e.clientY };
    if (hoverQueued) return;
    hoverQueued = true;
    const delay = Math.max(0, HOVER_INTERVAL_MS - (performance.now() - lastHoverAt));
    window.setTimeout(() => {
      hoverQueued = false;
      lastHoverAt = performance.now();
      canvas.style.cursor = cast({ clientX: hoverPoint.x, clientY: hoverPoint.y } as MouseEvent)
        ? "pointer"
        : "";
    }, delay);
  });
}
