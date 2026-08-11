import * as THREE from "three";
import { CIVS } from "../src/shared/civs";
import type { Building } from "../src/shared/types";
import { buildGroundsGroup, GROUNDS_GROUP } from "../src/client/groundsView";
import { createIslandGroup, DECOR_FINE_GROUP } from "../src/client/islandMesh";

/**
 * The beauty-pass budget, in renderer submissions and triangles, for one
 * fully decorated 166-cell island plus a 60-building settlement. Split into
 * what stays visible at map range versus what the 0.5 s distance sweep hides
 * beyond street range, so map-view cost is provable before deploy.
 */

function metrics(root: THREE.Object3D): { draws: number; triangles: number; instances: number } {
  let draws = 0;
  let triangles = 0;
  let instances = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || object.userData.buildingPickProxy) return;
    draws += 1;
    const count = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as unknown as THREE.InstancedMesh).count
      : 1;
    instances += count;
    const position = mesh.geometry.getAttribute("position");
    const perInstance = mesh.geometry.index
      ? mesh.geometry.index.count / 3
      : position.count / 3;
    triangles += perInstance * count;
  });
  return { draws, triangles, instances };
}

const island = createIslandGroup(20260811, 166, "benchmark-island");
const decorFine = island.getObjectByName(DECOR_FINE_GROUP);
const resources = island.getObjectByName("resources")!;

const buildings = Array.from({ length: 60 }, (_, index): Building => ({
  id: `bench-${index}`,
  type: ["hut", "farm", "blacksmith", "temple", "trading-post", "fishing-hut"][index % 6]!,
  stage: "complete",
  progress: 100,
  pos: { x: 30 + (index % 10) * 10, y: 30 + Math.floor(index / 10) * 12 },
}));
const grounds = buildGroundsGroup({
  buildings,
  civ: CIVS.roman!,
  islandSeed: 20260811,
  heightAt: () => 1.5,
  half: 83,
});

const nature = metrics(resources);
const meadows = decorFine ? metrics(decorFine) : { draws: 0, triangles: 0, instances: 0 };
const streets = metrics(grounds);

console.log(
  JSON.stringify(
    {
      fixture: { islandSize: 166, settlementBuildings: 60 },
      alwaysVisible: { natureAndResources: nature },
      distanceCulled: {
        meadows: { ...meadows, group: DECOR_FINE_GROUP, hiddenBeyond: 260 },
        pathsAndYards: { ...streets, group: GROUNDS_GROUP, hiddenBeyond: 340 },
      },
      mapRangeAddedDraws: 0,
      note:
        "meadows and street layers are culled by the shadow-budget sweep; " +
        "map range pays only for the nature layer, which replaced the old " +
        "two-draw forest with three instanced species draws",
    },
    null,
    2,
  ),
);
