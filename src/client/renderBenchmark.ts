import * as THREE from "three";

interface RenderBenchmarkOptions {
  scene: THREE.Scene;
  terrainReady: () => boolean;
  snapshot?: () => unknown;
  warmupMs?: number;
  sampleMs?: number;
}

interface FrameSample {
  frameMs: number;
  calls: number;
  triangles: number;
}

/**
 * Opt-in, visible benchmark for the shared Clawdia browser. It is activated
 * only by `?renderBenchmark=1`, waits for identical fully-streamed terrain,
 * warms the renderer, then writes machine-readable JSON into the page. This
 * keeps local measurement on the pooled browser instead of private browser
 * automation and makes before/after runs extractable with ordinary DOM tools.
 */
export function startRenderBenchmark({
  scene,
  terrainReady,
  snapshot,
  warmupMs = 2_000,
  sampleMs = 10_000,
}: RenderBenchmarkOptions): void {
  if (new URLSearchParams(location.search).get("renderBenchmark") !== "1") return;

  const output = document.createElement("pre");
  output.id = "render-benchmark-output";
  output.style.cssText =
    "position:fixed;inset:8px;z-index:99999;overflow:auto;padding:12px;background:#fff;color:#000;" +
    "font:12px/1.4 monospace;white-space:pre-wrap";
  output.textContent = JSON.stringify({ status: "waiting-for-terrain" });
  document.body.append(output);

  let calls = 0;
  let triangles = 0;
  const trianglesFor = (mode: number, count: number): number => {
    if (mode === 4) return Math.floor(count / 3);
    if (mode === 5 || mode === 6) return Math.max(0, count - 2);
    return 0;
  };
  const patch = (
    prototype: Record<string, unknown> | undefined,
    method: string,
    countAt: number,
    instancesAt?: number,
  ) => {
    const original = prototype?.[method];
    if (typeof original !== "function") return;
    prototype![method] = function (this: unknown, ...args: unknown[]) {
      const instances = instancesAt === undefined ? 1 : Number(args[instancesAt] ?? 1);
      calls += 1;
      triangles += trianglesFor(Number(args[0]), Number(args[countAt])) * instances;
      return Reflect.apply(original, this, args);
    };
  };
  for (const prototype of [
    window.WebGLRenderingContext?.prototype,
    window.WebGL2RenderingContext?.prototype,
  ] as unknown as (Record<string, unknown> | undefined)[]) {
    patch(prototype, "drawArrays", 2);
    patch(prototype, "drawElements", 1);
    patch(prototype, "drawArraysInstanced", 2, 3);
    patch(prototype, "drawElementsInstanced", 1, 4);
  }

  const frames: FrameSample[] = [];
  let previous: number | undefined;
  let sampling = false;
  const frame = (now: number) => {
    if (sampling && previous !== undefined) {
      frames.push({ frameMs: now - previous, calls, triangles });
    }
    previous = now;
    calls = 0;
    triangles = 0;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const waitForTerrain = window.setInterval(() => {
    if (!terrainReady()) return;
    window.clearInterval(waitForTerrain);
    output.textContent = JSON.stringify({ status: "warming-up" });
    window.setTimeout(() => {
      frames.length = 0;
      previous = undefined;
      sampling = true;
      output.textContent = JSON.stringify({ status: "sampling", sampleMs });
      const startedAt = performance.now();
      window.setTimeout(() => {
        sampling = false;
        const elapsedMs = performance.now() - startedAt;
        const values = (key: keyof FrameSample) => frames.map((sample) => sample[key]);
        const mean = (numbers: number[]) =>
          numbers.reduce((sum, value) => sum + value, 0) / Math.max(1, numbers.length);
        const percentile = (numbers: number[], p: number) => {
          const ordered = [...numbers].sort((a, b) => a - b);
          return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))] ?? 0;
        };
        let objects = 0;
        let meshes = 0;
        let instancedMeshes = 0;
        let batchedMeshes = 0;
        const geometries = new Set<string>();
        scene.traverse((object) => {
          objects += 1;
          if ((object as THREE.Mesh).isMesh) meshes += 1;
          if ((object as THREE.InstancedMesh).isInstancedMesh) instancedMeshes += 1;
          if ((object as THREE.BatchedMesh).isBatchedMesh) batchedMeshes += 1;
          const geometry = (object as THREE.Mesh).geometry;
          if (geometry?.uuid) geometries.add(geometry.uuid);
        });
        output.textContent = JSON.stringify({
          status: "complete",
          url: location.href,
          userAgent: navigator.userAgent,
          viewport: {
            width: innerWidth,
            height: innerHeight,
            devicePixelRatio,
          },
          warmupMs,
          sampleMs,
          elapsedMs,
          frames: frames.length,
          fps: (frames.length * 1_000) / elapsedMs,
          frameMs: {
            mean: mean(values("frameMs")),
            p50: percentile(values("frameMs"), 0.5),
            p95: percentile(values("frameMs"), 0.95),
            max: Math.max(0, ...values("frameMs")),
          },
          webgl: {
            callsMean: mean(values("calls")),
            callsP95: percentile(values("calls"), 0.95),
            trianglesMean: mean(values("triangles")),
            trianglesP95: percentile(values("triangles"), 0.95),
          },
          scene: {
            objects,
            meshes,
            instancedMeshes,
            batchedMeshes,
            geometries: geometries.size,
          },
          renderer: snapshot?.(),
        }, null, 2);
      }, sampleMs);
    }, warmupMs);
  }, 100);
}

