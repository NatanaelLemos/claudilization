import * as THREE from "three";

/**
 * Click-to-inspect for the 3D map. Camera-controls owns dragging, so a pick
 * only fires when the pointer barely moved between down and up; anything
 * longer is an orbit. Craft at sea are checked before buildings — they are
 * small, deliberate targets. Hovering a pickable turns the cursor into a
 * pointer.
 */

const CLICK_SLOP_PX = 6;

type Pick =
  | { kind: "building"; buildingId: string }
  | { kind: "boat"; islandId: string; boatId: string };

function pickOf(obj: THREE.Object3D | null): Pick | undefined {
  for (let o = obj; o; o = o.parent) {
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

  function cast(e: PointerEvent | MouseEvent): Pick | undefined {
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
    canvas.style.cursor = cast(e) ? "pointer" : "";
  });
}
