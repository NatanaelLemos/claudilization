import * as THREE from "three";
import type { ActiveCatastrophe, CatastropheStatus } from "../shared/catastrophes";
import type { Stage } from "./scene";

type EffectStage = Pick<
  Stage,
  "scene" | "controls" | "worldTime" | "onFrame" | "setCameraShake" | "reducedMotion"
>;

export interface CatastropheEffectSnapshot {
  sequence?: number;
  id?: ActiveCatastrophe["id"];
  objects: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const x = clamp01(n);
  return x * x * (3 - 2 * x);
};

/** Canonical animation progress: reconnects render the same instant, not frame zero. */
export function catastropheEffectProgress(
  active: ActiveCatastrophe,
  worldSeconds: number,
): number {
  return clamp01(
    (worldSeconds - active.startedAt) / Math.max(0.001, active.endsAt - active.startedAt),
  );
}

function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.clear();
}

function waveEffect(): THREE.Group {
  const root = new THREE.Group();
  root.name = "catastrophe-tsunami";
  const water = new THREE.MeshPhongMaterial({
    color: "#168fba",
    emissive: "#073b50",
    transparent: true,
    opacity: 0.82,
    shininess: 105,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const foam = new THREE.MeshLambertMaterial({
    color: "#dffbff",
    emissive: "#75d8e9",
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(250, 42, 28, 5), water);
  wall.name = "wave-wall";
  wall.position.y = 20;
  root.add(wall);

  const curl = new THREE.Mesh(new THREE.TorusGeometry(13, 4.2, 7, 48, Math.PI), foam);
  curl.name = "wave-crest";
  curl.scale.x = 9.6;
  curl.position.y = 35;
  curl.rotation.z = Math.PI;
  root.add(curl);

  const wash = new THREE.Mesh(new THREE.BoxGeometry(250, 0.9, 72), water.clone());
  wash.name = "wave-wash";
  wash.position.set(0, 0.6, 28);
  root.add(wash);

  const sprayPositions = new Float32Array(90 * 3);
  for (let i = 0; i < 90; i++) {
    const u = (i / 89 - 0.5) * 242;
    sprayPositions[i * 3] = u;
    sprayPositions[i * 3 + 1] = 34 + ((i * 17) % 13) * 0.45;
    sprayPositions[i * 3 + 2] = ((i * 29) % 11) - 5;
  }
  const sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute("position", new THREE.BufferAttribute(sprayPositions, 3));
  const spray = new THREE.Points(
    sprayGeometry,
    new THREE.PointsMaterial({
      color: "#efffff",
      size: 3.2,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }),
  );
  spray.name = "wave-spray";
  root.add(spray);
  return root;
}

function kaijuEffect(): THREE.Group {
  const root = new THREE.Group();
  root.name = "catastrophe-godzilla";
  const skin = new THREE.MeshLambertMaterial({ color: "#244f36", flatShading: true });
  const belly = new THREE.MeshLambertMaterial({ color: "#71865a", flatShading: true });
  const spine = new THREE.MeshLambertMaterial({
    color: "#8bd4be",
    emissive: "#245f58",
    emissiveIntensity: 0.75,
    flatShading: true,
  });
  const eye = new THREE.MeshBasicMaterial({ color: "#ffe15c" });
  const debris = new THREE.MeshLambertMaterial({ color: "#807365", flatShading: true });

  const part = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = material !== eye;
    root.add(mesh);
    return mesh;
  };

  const body = part("body", new THREE.SphereGeometry(8, 9, 7), skin, 0, 23, 0);
  body.scale.set(1, 1.7, 0.85);
  const bellyMesh = part("belly", new THREE.SphereGeometry(5.8, 8, 6), belly, 0, 22, 5.4);
  bellyMesh.scale.set(0.72, 1.6, 0.28);
  const head = part("head", new THREE.SphereGeometry(6.3, 8, 6), skin, 0, 38, 0);
  head.scale.set(0.9, 0.82, 1.05);
  const snout = part("snout", new THREE.BoxGeometry(8, 4.2, 7), skin, 0, 36.5, 5.6);
  snout.rotation.x = -0.08;
  for (const x of [-2.2, 2.2]) part("eye", new THREE.SphereGeometry(0.65, 6, 4), eye, x, 40, 5.1);

  for (const side of [-1, 1]) {
    const arm = part(
      side < 0 ? "arm-left" : "arm-right",
      new THREE.CylinderGeometry(1.7, 2.5, 14, 7),
      skin,
      side * 8,
      24,
      1.8,
    );
    arm.rotation.z = side * 0.34;
    const leg = part(
      side < 0 ? "leg-left" : "leg-right",
      new THREE.CylinderGeometry(3.2, 4.1, 15, 7),
      skin,
      side * 4.5,
      8,
      0,
    );
    leg.rotation.z = side * 0.08;
    const foot = part("foot", new THREE.BoxGeometry(8, 3.2, 11), skin, side * 4.5, 1.5, 3.2);
    foot.rotation.y = side * 0.05;
  }

  for (let i = 0; i < 7; i++) {
    const plate = part(
      "dorsal-plate",
      new THREE.ConeGeometry(2.8 - i * 0.12, 7 - i * 0.45, 4),
      spine,
      0,
      35 - i * 4.5,
      -7.2 - i * 0.35,
    );
    plate.rotation.x = -0.35;
    plate.rotation.y = Math.PI / 4;
  }
  let parent: THREE.Object3D = root;
  for (let i = 0; i < 6; i++) {
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(0.7, 3.7 - i * 0.55), 11, 7),
      skin,
    );
    tail.name = i === 0 ? "tail" : "tail-segment";
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, i ? 0 : 16, -8);
    tail.castShadow = true;
    parent.add(tail);
    parent = tail;
  }

  const rubble = new THREE.Group();
  rubble.name = "rubble";
  for (let i = 0; i < 12; i++) {
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), debris);
    chunk.position.set((i % 4 - 1.5) * 8, 1, (Math.floor(i / 4) - 1) * 10);
    chunk.rotation.set(i * 0.7, i * 1.1, i * 0.4);
    chunk.castShadow = true;
    rubble.add(chunk);
  }
  root.add(rubble);
  root.scale.setScalar(1.15);
  return root;
}

export class CatastropheEffects {
  private active?: ActiveCatastrophe;
  private root?: THREE.Group;
  private readonly target = new THREE.Vector3();

  constructor(private readonly stage: EffectStage) {}

  update(status: CatastropheStatus): void {
    const next = status.active;
    if (!next || this.stage.worldTime() >= next.endsAt) {
      this.stop();
      return;
    }
    if (this.active?.sequence === next.sequence && this.active.id === next.id) {
      this.active = next;
      return;
    }
    this.stop();
    this.active = next;
    if (next.id === "tsunami") this.mount(waveEffect());
    else if (next.id === "godzilla") this.mount(kaijuEffect());
  }

  tick(): void {
    const active = this.active;
    if (!active) return;
    const now = this.stage.worldTime();
    if (now >= active.endsAt) {
      this.stop();
      return;
    }
    const elapsed = Math.max(0, now - active.startedAt);
    const progress = catastropheEffectProgress(active, now);
    this.stage.controls.getTarget(this.target);

    if (active.id === "earthquake") {
      const duration = Math.min(13, Math.max(4, active.endsAt - active.startedAt));
      const envelope = smooth(1 - elapsed / duration);
      if (!this.stage.reducedMotion && envelope > 0) {
        const phase = elapsed * 24 + active.sequence * 2.17;
        this.stage.setCameraShake(
          Math.sin(phase * 1.13) * 2.5 * envelope,
          Math.sin(phase * 1.71) * 0.75 * envelope,
          Math.cos(phase * 0.91) * 1.8 * envelope,
          Math.sin(phase * 0.67) * 0.009 * envelope,
        );
      } else this.stage.setCameraShake(0, 0, 0, 0);
      return;
    }

    this.stage.setCameraShake(0, 0, 0, 0);
    if (!this.root) return;
    if (active.id === "tsunami") this.animateWave(progress, elapsed);
    else if (active.id === "godzilla") this.animateKaiju(progress, elapsed);
  }

  snapshot(): CatastropheEffectSnapshot {
    let objects = 0;
    this.root?.traverse(() => objects++);
    return { sequence: this.active?.sequence, id: this.active?.id, objects };
  }

  stop(): void {
    this.stage.setCameraShake(0, 0, 0, 0);
    if (this.root) {
      this.stage.scene.remove(this.root);
      disposeTree(this.root);
    }
    this.root = undefined;
    this.active = undefined;
  }

  private mount(root: THREE.Group): void {
    this.root = root;
    this.stage.scene.add(root);
  }

  private animateWave(progress: number, elapsed: number): void {
    const root = this.root!;
    const travel = smooth(Math.min(1, progress / 0.78));
    const retreat = progress > 0.78 ? smooth((progress - 0.78) / 0.22) : 0;
    root.position.set(this.target.x, -retreat * 8, this.target.z + 155 - travel * 310);
    root.rotation.z = Math.sin(elapsed * 1.7) * 0.025;
    root.scale.y = 0.75 + Math.sin(Math.min(1, progress / 0.15) * Math.PI * 0.5) * 0.35;
    const spray = root.getObjectByName("wave-spray") as THREE.Points | undefined;
    if (spray) spray.position.y = Math.sin(elapsed * 4) * 1.7;
  }

  private animateKaiju(progress: number, elapsed: number): void {
    const root = this.root!;
    const enter = smooth(progress / 0.16);
    const exit = progress > 0.82 ? smooth((progress - 0.82) / 0.18) : 0;
    const stride = Math.sin(elapsed * 3.2);
    root.position.set(
      this.target.x - 105 + smooth(progress) * 210,
      -34 + enter * 34 - exit * 38,
      this.target.z + Math.sin(progress * Math.PI * 2) * 24,
    );
    root.rotation.y = Math.PI / 2 + Math.sin(elapsed * 0.8) * 0.08;
    root.rotation.z = stride * 0.025;
    const leftArm = root.getObjectByName("arm-left");
    const rightArm = root.getObjectByName("arm-right");
    const leftLeg = root.getObjectByName("leg-left");
    const rightLeg = root.getObjectByName("leg-right");
    if (leftArm) leftArm.rotation.x = stride * 0.55;
    if (rightArm) rightArm.rotation.x = -stride * 0.55;
    if (leftLeg) leftLeg.rotation.x = -stride * 0.3;
    if (rightLeg) rightLeg.rotation.x = stride * 0.3;
    const rubble = root.getObjectByName("rubble");
    if (rubble) {
      rubble.children.forEach((chunk, index) => {
        const burst = Math.max(0, Math.sin(progress * Math.PI * 7 - index * 0.3));
        chunk.position.y = 1 + burst * (5 + (index % 3) * 2);
        chunk.rotation.x += 0.025;
        chunk.rotation.z += 0.018;
      });
    }
    if (!this.stage.reducedMotion && enter > 0.95 && exit < 0.2) {
      const stomp = Math.max(0, Math.sin(elapsed * 3.2));
      this.stage.setCameraShake(stomp * 0.32, stomp * 0.16, -stomp * 0.2, 0);
    }
  }
}

/** One permanent frame callback; each event only mounts a bounded transient tree. */
export function initCatastropheEffects(stage: EffectStage): CatastropheEffects {
  const effects = new CatastropheEffects(stage);
  stage.onFrame(() => effects.tick());
  return effects;
}
