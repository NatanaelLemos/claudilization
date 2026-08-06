import * as THREE from "three";
import { CIVS } from "../src/shared/civs";
import type { Building } from "../src/shared/types";
import { buildBuildingBatch } from "../src/client/buildingBatch";
import { createBuildingMesh } from "../src/client/structures";

const count = Number(process.argv[2] ?? 600);
const buildings = Array.from({ length: count }, (_, index): Building => ({
  id: `dense-townhouse-${index}`,
  type: "townhouse",
  stage: "complete",
  progress: 100,
  pos: { x: 4 + (index % 30) * 4, y: 4 + Math.floor(index / 30) * 4 },
}));

const template = createBuildingMesh(buildings[0]!, CIVS.roman, "renaissance");
const batch = buildBuildingBatch({
  buildings,
  civ: CIVS.roman,
  age: "renaissance",
  heightAt: () => 0,
  half: 0,
});

function metrics(root: THREE.Object3D): { draws: number; shadowDraws: number; triangles: number } {
  let draws = 0;
  let shadowDraws = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh || object.userData.buildingPickProxy) return;
    const mesh = object as THREE.Mesh;
    draws += 1;
    if (mesh.castShadow) shadowDraws += 1;
    const position = mesh.geometry.getAttribute("position");
    const perInstance = mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
    triangles += perInstance * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
  });
  return { draws, shadowDraws, triangles };
}

const one = metrics(template);
const after = metrics(batch);
const before = {
  draws: one.draws * count,
  shadowDraws: one.shadowDraws * count,
  triangles: one.triangles * count,
};
const reduction = (beforeValue: number, afterValue: number) =>
  Number(((1 - afterValue / beforeValue) * 100).toFixed(2));

console.log(JSON.stringify({
  fixture: { buildings: count, type: "renaissance townhouse" },
  before,
  after,
  reductionPercent: {
    mainSubmissions: reduction(before.draws, after.draws),
    shadowSubmissions: reduction(before.shadowDraws, after.shadowDraws),
    triangles: reduction(before.triangles, after.triangles),
  },
}, null, 2));
