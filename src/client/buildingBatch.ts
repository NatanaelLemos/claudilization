import * as THREE from "three";
import type { Age, Building, CivSpec, IslandTerrain } from "../shared/types";
import { buildingFacing, townPlan, type TownPlan } from "../shared/townPlan";
import { CLAY_PALETTE, clayMaterial } from "./artDirection";
import { setInstanceAssetPicks } from "./picking";
import {
  buildingInstanceKey,
  buildingModelSpec,
  buildingVisualTransform,
  createBuildingMesh,
  isRoofMaterial,
  isWallMaterial,
  resolveModelAge,
  roofInstanceTint,
  wallInstanceTint,
} from "./structures";

const pickGeometry = new THREE.BoxGeometry(1, 1, 1);
const pickMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});
/** One shared clay block underneath every slope-perched building. */
const plinthGeometry = new THREE.BoxGeometry(1, 1, 1);
const plinthMaterial = clayMaterial({ color: CLAY_PALETTE.stoneDark });
const materialReferences = new WeakMap<THREE.Material, number>();

const rootMatrix = new THREE.Matrix4();
const localMatrix = new THREE.Matrix4();
const instanceMatrix = new THREE.Matrix4();
const bounds = new THREE.Box3();
const boundsCenter = new THREE.Vector3();
const boundsSize = new THREE.Vector3();
const composeQuat = new THREE.Quaternion();
const composeEuler = new THREE.Euler();
const composePos = new THREE.Vector3();
const composeScale = new THREE.Vector3();
const tintColor = new THREE.Color();
const hslScratch = { h: 0, s: 0, l: 0 };

export interface BuildingBatchOptions {
  buildings: Building[];
  civ: CivSpec;
  age: Age;
  heightAt: (x: number, y: number) => number;
  half: number;
  /** Terrain + seed switch on town-plan facings and slope terraces. */
  terrain?: IslandTerrain;
  islandSeed?: number;
}

interface BuildingGrounding {
  matrix: THREE.Matrix4;
  /** A terrace under the downhill side, when the slope demands one. */
  plinth?: { x: number; z: number; topY: number; depth: number; sx: number; sz: number; rotY: number };
}

/**
 * Where a building meets the ground. The root position samples the terrain at
 * the center and at the model's four footprint corners: the building stands on
 * the highest of them (nothing sinks a wall into the hill), and when the
 * lowest corner hangs more than a step below, a clay foundation terrace fills
 * the gap so nothing floats — the diorama way of building on a slope.
 */
function groundBuilding(
  building: Building,
  heightAt: (x: number, y: number) => number,
  half: number,
  footX: number,
  footZ: number,
  facing: number | undefined,
  ownsTerraces: boolean,
): BuildingGrounding {
  const root = buildingVisualTransform(building, new THREE.Object3D(), facing);
  const scale = root.scale.x;
  const rotY = root.rotation.y;
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  // the load-bearing footprint, not the full visual bounds: porticos, banner
  // poles and yard braziers overhang the walls, and the eaves overhang the
  // foundation — a terrace wider than the roofline reads as a parking lot
  const hx = Math.min(2.6, Math.max(0.6, (footX * scale * 0.6) / 2));
  const hz = Math.min(2.6, Math.max(0.6, (footZ * scale * 0.6) / 2));
  const centerG = heightAt(building.pos.x, building.pos.y);
  let base = centerG;
  let lowest = centerG;
  for (const [cx, cz] of [
    [-hx, -hz],
    [-hx, hz],
    [hx, -hz],
    [hx, hz],
  ] as const) {
    // rotate the local corner into island coordinates before sampling
    const wx = building.pos.x + cx * cos + cz * sin;
    const wy = building.pos.y - cx * sin + cz * cos;
    const g = heightAt(wx, wy);
    base = Math.max(base, g);
    lowest = Math.min(lowest, g);
  }
  base = Math.max(0.05, base);
  root.position.set(building.pos.x - half, base, building.pos.y - half);
  root.updateMatrix();
  const grounding: BuildingGrounding = { matrix: root.matrix.clone() };
  const depth = base - lowest;
  // a terrace only where the slope truly drops away — wonders bring their own
  if (depth > 0.24 && !ownsTerraces) {
    grounding.plinth = {
      x: building.pos.x - half,
      z: building.pos.y - half,
      topY: base + 0.02,
      depth: depth + 0.3,
      sx: hx * 2 + 0.35,
      sz: hz * 2 + 0.35,
      rotY,
    };
  }
  return grounding;
}

/**
 * Repeated building models become one instanced draw per authored material
 * part. A dense street keeps its per-building rotation/scale and exact model,
 * while hundreds of copies stop becoming thousands of renderer submissions.
 */
export function buildBuildingBatch({
  buildings,
  civ,
  age,
  heightAt,
  half,
  terrain,
  islandSeed,
}: BuildingBatchOptions): THREE.Group {
  const holder = new THREE.Group();
  const roofHue = new THREE.Color(civ.architecture.trim).getHSL(hslScratch).h;
  const wallHue = new THREE.Color(civ.architecture.primary).getHSL(hslScratch).h;
  const plan: TownPlan | undefined =
    terrain && islandSeed !== undefined ? townPlan(terrain, islandSeed) : undefined;
  const batches = new Map<string, Building[]>();
  for (const building of buildings) {
    const key = buildingInstanceKey(building, age);
    const batch = batches.get(key);
    if (batch) batch.push(building);
    else batches.set(key, [building]);
  }

  const pickMatrices: THREE.Matrix4[] = [];
  const picks: { kind: "building"; buildingId: string }[] = [];
  const materials = new Set<THREE.Material>();
  const plinths: NonNullable<BuildingGrounding["plinth"]>[] = [];

  for (const batch of batches.values()) {
    const first = batch[0]!;
    const template = createBuildingMesh(first, civ, age);
    template.position.set(0, 0, 0);
    template.rotation.set(0, 0, 0);
    template.scale.set(1, 1, 1);
    template.updateMatrixWorld(true);
    bounds.setFromObject(template).getCenter(boundsCenter);
    bounds.getSize(boundsSize);
    const small = !buildingModelSpec(first.type, resolveModelAge(first, age)).wonder;

    const groundings = batch.map((building) =>
      groundBuilding(
        building,
        heightAt,
        half,
        boundsSize.x,
        boundsSize.z,
        plan && terrain ? buildingFacing(plan, terrain, building) : undefined,
        buildingModelSpec(building.type, resolveModelAge(building, age)).wonder === true,
      ),
    );
    for (const grounding of groundings) {
      if (grounding.plinth) plinths.push(grounding.plinth);
    }

    template.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
      }
      const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, batch.length);
      // one roof colour per block: the same model repeated down a street is
      // still one draw call, but no two roofs land on the same shade
      if (isRoofMaterial(mesh.material)) {
        batch.forEach((building, index) => {
          instanced.setColorAt(index, roofInstanceTint(building.id, roofHue, tintColor));
        });
        if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      } else if (isWallMaterial(mesh.material)) {
        // walls carry the town's other half of the mosaic, gentler than roofs
        batch.forEach((building, index) => {
          instanced.setColorAt(index, wallInstanceTint(building.id, wallHue, tintColor));
        });
        if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      }
      instanced.castShadow = mesh.castShadow;
      instanced.receiveShadow = mesh.receiveShadow;
      instanced.renderOrder = mesh.renderOrder;
      instanced.userData.buildingShadowBatch = mesh.castShadow;
      instanced.userData.smallBuildingBatch = small;
      groundings.forEach((grounding, index) => {
        rootMatrix.copy(grounding.matrix);
        localMatrix.copy(mesh.matrixWorld);
        instanceMatrix.multiplyMatrices(rootMatrix, localMatrix);
        instanced.setMatrixAt(index, instanceMatrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingBox();
      instanced.computeBoundingSphere();
      holder.add(instanced);
    });

    batch.forEach((building, index) => {
      rootMatrix.copy(groundings[index]!.matrix);
      localMatrix.makeTranslation(boundsCenter.x, boundsCenter.y, boundsCenter.z);
      localMatrix.scale(boundsSize);
      pickMatrices.push(new THREE.Matrix4().multiplyMatrices(rootMatrix, localMatrix));
      picks.push({ kind: "building", buildingId: building.id });
    });
  }

  if (plinths.length) {
    const terraceMesh = new THREE.InstancedMesh(plinthGeometry, plinthMaterial, plinths.length);
    plinths.forEach((plinth, index) => {
      composeQuat.setFromEuler(composeEuler.set(0, plinth.rotY, 0));
      instanceMatrix.compose(
        composePos.set(plinth.x, plinth.topY - plinth.depth / 2, plinth.z),
        composeQuat,
        composeScale.set(plinth.sx, plinth.depth, plinth.sz),
      );
      terraceMesh.setMatrixAt(index, instanceMatrix);
    });
    terraceMesh.castShadow = false;
    terraceMesh.receiveShadow = true;
    terraceMesh.userData.smallBuildingBatch = true;
    terraceMesh.instanceMatrix.needsUpdate = true;
    terraceMesh.computeBoundingBox();
    terraceMesh.computeBoundingSphere();
    terraceMesh.name = "building-terraces";
    holder.add(terraceMesh);
  }

  if (pickMatrices.length) {
    const pickProxy = new THREE.InstancedMesh(pickGeometry, pickMaterial, pickMatrices.length);
    pickMatrices.forEach((matrix, index) => pickProxy.setMatrixAt(index, matrix));
    pickProxy.instanceMatrix.needsUpdate = true;
    pickProxy.visible = false;
    pickProxy.userData.buildingPickProxy = true;
    setInstanceAssetPicks(pickProxy, picks);
    pickProxy.computeBoundingBox();
    pickProxy.computeBoundingSphere();
    holder.add(pickProxy);
  }

  holder.userData.buildingMaterials = [...materials];
  for (const material of materials) {
    materialReferences.set(material, (materialReferences.get(material) ?? 0) + 1);
  }

  return holder;
}

export function buildingPickTargets(holder: THREE.Group): THREE.Object3D[] {
  return holder.children.filter((child) => child.userData.buildingPickProxy);
}

/** Small building shadows leave the island-sized shadow pass at map range. */
export function applyBuildingShadowDistance(holder: THREE.Group, distance: number): void {
  const smallShadows = distance <= 180;
  holder.traverse((object) => {
    if (!object.userData.buildingShadowBatch) return;
    object.castShadow = !object.userData.smallBuildingBatch || smallShadows;
  });
}

/** Release per-batch geometry and instance buffers before replacing a view. */
export function disposeBuildingBatch(holder: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  holder.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && mesh.geometry !== pickGeometry && mesh.geometry !== plinthGeometry) {
      geometries.add(mesh.geometry);
    }
    if ((object as THREE.InstancedMesh).isInstancedMesh) {
      (object as THREE.InstancedMesh).dispose();
    }
  });
  for (const geometry of geometries) geometry.dispose();
  holder.traverse((object) => {
    const materials = object.userData.buildingMaterials as THREE.Material[] | undefined;
    for (const material of materials ?? []) {
      const references = (materialReferences.get(material) ?? 1) - 1;
      if (references <= 0) {
        materialReferences.delete(material);
        material.dispose();
      } else {
        materialReferences.set(material, references);
      }
    }
  });
  holder.clear();
}
