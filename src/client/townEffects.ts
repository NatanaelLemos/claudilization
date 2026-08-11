import * as THREE from "three";
import { buildingSpec } from "../shared/buildings";
import { buildingFacing, townPlan } from "../shared/townPlan";
import type { Building, CivSpec, IslandTerrain } from "../shared/types";
import { clayMaterial } from "./artDirection";

export const TOWN_EFFECTS_GROUP = "town-life-effects";

const SMOKE_TYPES =
  /forge|smith|kiln|smokehouse|charcoal|factory|mill|plant|refinery|steam|coking|works|bakery|brewery|pottery/;
const FLAG_TYPES = /dock|tower|hall|keep|forum|castle|palace|stadium|tourney/;
const MAX_SMOKE_SOURCES = 10;
const MAX_FLAGS = 12;
const smokeGeometry = new THREE.DodecahedronGeometry(0.22, 0);
const smokeMaterial = clayMaterial({
  color: "#d8d3c9",
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
});
const flagGeometry = new THREE.BoxGeometry(0.68, 0.34, 0.035);

export function isSmokeBuilding(type: string): boolean {
  return SMOKE_TYPES.test(type);
}

export function townEffectCounts(buildings: readonly Building[]): {
  smokeSources: number;
  flags: number;
} {
  const complete = buildings.filter((building) => building.stage === "complete");
  return {
    smokeSources: Math.min(MAX_SMOKE_SOURCES, complete.filter((b) => isSmokeBuilding(b.type)).length),
    flags: Math.min(
      MAX_FLAGS,
      complete.filter((b) => buildingSpec(b.type)?.wonder || FLAG_TYPES.test(b.type)).length,
    ),
  };
}

interface SmokeSource {
  x: number;
  y: number;
  z: number;
  phase: number;
}

interface FlagSource {
  x: number;
  y: number;
  z: number;
  facing: number;
  phase: number;
}

interface EffectData {
  smoke?: THREE.InstancedMesh;
  smokeSources: SmokeSource[];
  flags?: THREE.InstancedMesh;
  flagSources: FlagSource[];
  ownedMaterials: THREE.Material[];
}

/** One smoke and one pennant submission per watched town, irrespective of density. */
export function buildTownEffects(options: {
  buildings: Building[];
  civ: CivSpec;
  terrain?: IslandTerrain;
  islandSeed: number;
  heightAt: (x: number, y: number) => number;
  half: number;
}): THREE.Group {
  const { buildings, civ, terrain, islandSeed, heightAt, half } = options;
  const holder = new THREE.Group();
  holder.name = TOWN_EFFECTS_GROUP;
  const data: EffectData = { smokeSources: [], flagSources: [], ownedMaterials: [] };
  const complete = buildings.filter((building) => building.stage === "complete");
  for (const building of complete) {
    if (data.smokeSources.length >= MAX_SMOKE_SOURCES) break;
    if (!isSmokeBuilding(building.type)) continue;
    data.smokeSources.push({
      x: building.pos.x - half + 0.45,
      y: heightAt(building.pos.x, building.pos.y) + 4.0,
      z: building.pos.y - half - 0.25,
      phase: (building.id.length * 0.73 + building.pos.x * 0.11) % 1,
    });
  }
  if (data.smokeSources.length) {
    data.smoke = new THREE.InstancedMesh(
      smokeGeometry,
      smokeMaterial,
      data.smokeSources.length * 3,
    );
    data.smoke.name = "town-chimney-smoke";
    data.smoke.castShadow = false;
    data.smoke.renderOrder = 2;
    holder.add(data.smoke);
  }

  const plan = terrain ? townPlan(terrain, islandSeed) : undefined;
  for (const building of complete) {
    if (data.flagSources.length >= MAX_FLAGS) break;
    if (!buildingSpec(building.type)?.wonder && !FLAG_TYPES.test(building.type)) continue;
    data.flagSources.push({
      x: building.pos.x - half + 0.8,
      y: heightAt(building.pos.x, building.pos.y) + (buildingSpec(building.type)?.wonder ? 7.2 : 4.2),
      z: building.pos.y - half,
      facing: plan && terrain ? buildingFacing(plan, terrain, building) : 0,
      phase: (building.pos.y * 0.17 + building.id.length * 0.31) % (Math.PI * 2),
    });
  }
  if (data.flagSources.length) {
    const material = clayMaterial({ color: civ.accent, side: THREE.DoubleSide });
    data.ownedMaterials.push(material);
    data.flags = new THREE.InstancedMesh(flagGeometry, material, data.flagSources.length);
    data.flags.name = "town-fluttering-pennants";
    data.flags.castShadow = false;
    holder.add(data.flags);
  }
  holder.userData.effectData = data;
  tickTownEffects(holder, 0, 1, true);
  return holder;
}

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();

export function tickTownEffects(
  holder: THREE.Group,
  worldTime: number,
  dayness: number,
  reducedMotion: boolean,
): void {
  const effects = holder.getObjectByName(TOWN_EFFECTS_GROUP) as THREE.Group | undefined;
  const data = effects?.userData.effectData as EffectData | undefined;
  if (!data) return;
  const time = reducedMotion ? 0 : worldTime;
  if (data.smoke) {
    let index = 0;
    for (const source of data.smokeSources) {
      for (let puff = 0; puff < 3; puff++) {
        const cycle = ((time * 0.13 + source.phase + puff / 3) % 1 + 1) % 1;
        const size = 0.72 + cycle * 1.7;
        matrix.compose(
          position.set(
            source.x + Math.sin(time * 0.42 + source.phase * 9 + puff) * cycle * 0.48,
            source.y + cycle * 4.0,
            source.z + Math.cos(time * 0.35 + source.phase * 7 + puff) * cycle * 0.32,
          ),
          quaternion,
          scale.set(size * 1.15, size, size),
        );
        data.smoke.setMatrixAt(index++, matrix);
      }
    }
    data.smoke.instanceMatrix.needsUpdate = true;
    data.smoke.visible = dayness > 0.08 || data.smokeSources.length > 0;
  }
  if (data.flags) {
    data.flagSources.forEach((flag, index) => {
      const flutter = reducedMotion ? 0 : Math.sin(time * 3.1 + flag.phase) * 0.12;
      quaternion.setFromEuler(euler.set(0, flag.facing, flutter));
      matrix.compose(
        position.set(flag.x, flag.y, flag.z),
        quaternion,
        scale.set(0.9 + Math.abs(flutter) * 0.8, 1, 1),
      );
      data.flags!.setMatrixAt(index, matrix);
    });
    data.flags.instanceMatrix.needsUpdate = true;
  }
}

export function disposeTownEffects(holder: THREE.Group): void {
  const effects = holder.getObjectByName(TOWN_EFFECTS_GROUP) as THREE.Group | undefined;
  const data = effects?.userData.effectData as EffectData | undefined;
  if (!effects || !data) return;
  data.smoke?.dispose();
  data.flags?.dispose();
  for (const material of data.ownedMaterials) material.dispose();
  effects.parent?.remove(effects);
}
