import * as THREE from "three";
import type { Age, Building, CivSpec } from "../shared/types";
import { setInstanceAssetPicks } from "./picking";
import {
  buildingInstanceKey,
  buildingModelSpec,
  buildingVisualTransform,
  createBuildingMesh,
  resolveModelAge,
} from "./structures";

const pickGeometry = new THREE.BoxGeometry(1, 1, 1);
const pickMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});
const materialReferences = new WeakMap<THREE.Material, number>();

const rootMatrix = new THREE.Matrix4();
const localMatrix = new THREE.Matrix4();
const instanceMatrix = new THREE.Matrix4();
const bounds = new THREE.Box3();
const boundsCenter = new THREE.Vector3();
const boundsSize = new THREE.Vector3();

export interface BuildingBatchOptions {
  buildings: Building[];
  civ: CivSpec;
  age: Age;
  heightAt: (x: number, y: number) => number;
  half: number;
}

function buildingRootMatrix(
  building: Building,
  heightAt: (x: number, y: number) => number,
  half: number,
): THREE.Matrix4 {
  const root = buildingVisualTransform(building, new THREE.Object3D());
  root.position.set(
    building.pos.x - half,
    Math.max(0.05, heightAt(building.pos.x, building.pos.y)),
    building.pos.y - half,
  );
  root.updateMatrix();
  return rootMatrix.copy(root.matrix);
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
}: BuildingBatchOptions): THREE.Group {
  const holder = new THREE.Group();
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

    template.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
      }
      const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, batch.length);
      instanced.castShadow = mesh.castShadow;
      instanced.receiveShadow = mesh.receiveShadow;
      instanced.renderOrder = mesh.renderOrder;
      instanced.userData.buildingShadowBatch = mesh.castShadow;
      instanced.userData.smallBuildingBatch = small;
      batch.forEach((building, index) => {
        buildingRootMatrix(building, heightAt, half);
        localMatrix.copy(mesh.matrixWorld);
        instanceMatrix.multiplyMatrices(rootMatrix, localMatrix);
        instanced.setMatrixAt(index, instanceMatrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingBox();
      instanced.computeBoundingSphere();
      holder.add(instanced);
    });

    batch.forEach((building) => {
      buildingRootMatrix(building, heightAt, half);
      localMatrix.makeTranslation(boundsCenter.x, boundsCenter.y, boundsCenter.z);
      localMatrix.scale(boundsSize);
      pickMatrices.push(new THREE.Matrix4().multiplyMatrices(rootMatrix, localMatrix));
      picks.push({ kind: "building", buildingId: building.id });
    });
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
    if (mesh.geometry && mesh.geometry !== pickGeometry) geometries.add(mesh.geometry);
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
