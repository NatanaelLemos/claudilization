import { defineConfig } from "vite";

/**
 * Standalone the client owns the origin; mounted inside a host (Clawdia's Apps
 * tab) every built asset must carry the prefix. `import.meta.env.BASE_URL`
 * follows this value, and the client derives every URL it fetches or streams
 * from it at runtime — so one build works in both worlds.
 */
const raw = (
  process.env.CLAUDILIZATION_BASE_PATH ??
  process.env.CLAWDIA_APP_BASE_PATH ??
  ""
).trim();
const base = raw && raw !== "/" ? `${raw.replace(/\/+$/, "")}/` : "/";

export default defineConfig({
  base,
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // the 3D engine dwarfs the app code and changes only when the
        // dependency is bumped — its own chunk downloads in parallel on a
        // cold visit and stays browser-cached across app deploys, so game
        // updates cost returning players only the small app chunk
        manualChunks: {
          three: ["three", "camera-controls"],
        },
      },
    },
  },
});
