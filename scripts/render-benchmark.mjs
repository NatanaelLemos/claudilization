import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";
const sampleSeconds = Number(process.env.BENCHMARK_SECONDS ?? 8);
const viewport = { width: 1600, height: 900 };

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.addInitScript(() => {
  const counters = {
    calls: 0,
    triangles: 0,
    frames: [],
    longTasks: [],
  };
  window.__renderBenchmark = counters;

  const trianglesFor = (mode, count) => {
    if (mode === 4) return Math.floor(count / 3);
    if (mode === 5 || mode === 6) return Math.max(0, count - 2);
    return 0;
  };
  const patch = (prototype, method, countAt, instancesAt) => {
    if (!prototype || typeof prototype[method] !== "function") return;
    const original = prototype[method];
    prototype[method] = function (...args) {
      const instances = instancesAt === undefined ? 1 : Number(args[instancesAt] ?? 1);
      counters.calls += 1;
      counters.triangles += trianglesFor(Number(args[0]), Number(args[countAt])) * instances;
      return original.apply(this, args);
    };
  };
  for (const prototype of [
    window.WebGLRenderingContext?.prototype,
    window.WebGL2RenderingContext?.prototype,
  ]) {
    patch(prototype, "drawArrays", 2);
    patch(prototype, "drawElements", 1);
    patch(prototype, "drawArraysInstanced", 2, 3);
    patch(prototype, "drawElementsInstanced", 1, 4);
  }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) counters.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  } catch {}

  let previous;
  const sample = (now) => {
    if (previous !== undefined) {
      counters.frames.push({
        at: now,
        frameMs: now - previous,
        calls: counters.calls,
        triangles: counters.triangles,
      });
    }
    previous = now;
    counters.calls = 0;
    counters.triangles = 0;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});

await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForFunction(
  () => typeof window.__terrain === "function" && window.__terrain().pending === 0,
  undefined,
  { timeout: 120_000 },
);
await page.waitForTimeout(2_000);

await page.evaluate(() => {
  window.__renderBenchmark.frames.length = 0;
  window.__renderBenchmark.longTasks.length = 0;
});
const metricsBefore = await page.context().newCDPSession(page);
await metricsBefore.send("Performance.enable");
const before = await metricsBefore.send("Performance.getMetrics");
await page.waitForTimeout(sampleSeconds * 1_000);
const after = await metricsBefore.send("Performance.getMetrics");

const result = await page.evaluate(({ sampleSeconds, viewport }) => {
  const benchmark = window.__renderBenchmark;
  const frames = benchmark.frames;
  const sorted = (values) => [...values].sort((a, b) => a - b);
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const ordered = sorted(values);
    return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))];
  };
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    url: location.href,
    sampleSeconds,
    viewport: { ...viewport, deviceScaleFactor: devicePixelRatio },
    userAgent: navigator.userAgent,
    terrain: window.__terrain?.(),
    frameCount: frames.length,
    fps: frames.length / sampleSeconds,
    frameMs: {
      mean: mean(frames.map((frame) => frame.frameMs)),
      p50: percentile(frames.map((frame) => frame.frameMs), 0.5),
      p95: percentile(frames.map((frame) => frame.frameMs), 0.95),
      max: Math.max(...frames.map((frame) => frame.frameMs)),
    },
    webgl: {
      callsMean: mean(frames.map((frame) => frame.calls)),
      callsP95: percentile(frames.map((frame) => frame.calls), 0.95),
      trianglesMean: mean(frames.map((frame) => frame.triangles)),
      trianglesP95: percentile(frames.map((frame) => frame.triangles), 0.95),
    },
    longTasks: {
      count: benchmark.longTasks.length,
      totalMs: benchmark.longTasks.reduce((sum, value) => sum + value, 0),
      maxMs: Math.max(0, ...benchmark.longTasks),
    },
    scene: window.__perf?.(),
  };
}, { sampleSeconds, viewport });

const metricMap = (payload) => Object.fromEntries(payload.metrics.map((entry) => [entry.name, entry.value]));
const beforeMap = metricMap(before);
const afterMap = metricMap(after);
result.mainThread = {
  taskMs: ((afterMap.TaskDuration ?? 0) - (beforeMap.TaskDuration ?? 0)) * 1_000,
  scriptMs: ((afterMap.ScriptDuration ?? 0) - (beforeMap.ScriptDuration ?? 0)) * 1_000,
  layoutMs: ((afterMap.LayoutDuration ?? 0) - (beforeMap.LayoutDuration ?? 0)) * 1_000,
  heapUsedMb: (afterMap.JSHeapUsedSize ?? 0) / (1024 * 1024),
  domNodes: afterMap.Nodes ?? 0,
};

console.log(JSON.stringify(result, null, 2));
await browser.close();

