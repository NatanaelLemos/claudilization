import { describe, expect, it } from "vitest";
import {
  basePathFromEnv,
  normalizeBasePath,
  publicRoot,
  stripBasePath,
  withBasePath,
} from "./basePath";

describe("mounting under a host prefix", () => {
  it("treats no prefix, empty and bare slash as standalone", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("  ")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
  });

  it("normalizes a prefix to leading slash, no trailing slash", () => {
    expect(normalizeBasePath("/apps/projects/claudilization")).toBe(
      "/apps/projects/claudilization",
    );
    expect(normalizeBasePath("apps/projects/claudilization/")).toBe(
      "/apps/projects/claudilization",
    );
    expect(normalizeBasePath("/world//")).toBe("/world");
  });

  it("reads the host's env, preferring the app's own override", () => {
    expect(basePathFromEnv({ CLAWDIA_APP_BASE_PATH: "/apps/projects/claudilization" })).toBe(
      "/apps/projects/claudilization",
    );
    expect(
      basePathFromEnv({
        CLAWDIA_APP_BASE_PATH: "/apps/projects/claudilization",
        CLAUDILIZATION_BASE_PATH: "/world",
      }),
    ).toBe("/world");
    expect(basePathFromEnv({})).toBe("");
  });

  it("strips the prefix so routing only sees app-absolute paths", () => {
    const base = "/apps/projects/claudilization";
    expect(stripBasePath(`${base}/api/state`, base)).toEqual({
      path: "/api/state",
      matched: true,
    });
    expect(stripBasePath(`${base}/assets/index-abc.js`, base).path).toBe(
      "/assets/index-abc.js",
    );
    // the bare mount point is the client's index — no redirect dance
    expect(stripBasePath(base, base)).toEqual({ path: "/", matched: true });
    expect(stripBasePath(`${base}/`, base)).toEqual({ path: "/", matched: true });
  });

  it("still serves requests that arrive without the prefix", () => {
    // direct hit on the port, the Vite dev proxy, the host's readiness probe
    const base = "/apps/projects/claudilization";
    expect(stripBasePath("/api/world", base)).toEqual({ path: "/api/world", matched: false });
    expect(stripBasePath("/api/world", "")).toEqual({ path: "/api/world", matched: true });
    expect(stripBasePath("/", "")).toEqual({ path: "/", matched: true });
  });

  it("does not strip a prefix that only shares a name fragment", () => {
    const base = "/apps/projects/claudilization";
    expect(stripBasePath("/apps/projects/claudilization-two/api/state", base).matched).toBe(
      false,
    );
  });

  it("puts the prefix back on when handing out public URLs", () => {
    expect(withBasePath("/apps/projects/claudilization", "/ws")).toBe(
      "/apps/projects/claudilization/ws",
    );
    expect(withBasePath("/apps/projects/claudilization", "/")).toBe(
      "/apps/projects/claudilization/",
    );
    expect(withBasePath("", "/ws")).toBe("/ws");
  });

  it("hands out the forwarded host, not the loopback socket, behind a proxy", () => {
    expect(
      publicRoot(
        {
          host: "127.0.0.1:4108",
          "x-forwarded-host": "clawdia.example.com",
          "x-forwarded-proto": "https",
        },
        "127.0.0.1:4108",
        "/apps/projects/claudilization",
      ),
    ).toBe("https://clawdia.example.com/apps/projects/claudilization");
    expect(publicRoot({ host: "localhost:8787" }, "localhost:8787", "")).toBe(
      "http://localhost:8787",
    );
  });

  it("uses a configured canonical origin and rejects hostile forwarded hosts", () => {
    expect(
      publicRoot(
        { host: "localhost:8787", "x-forwarded-host": "attacker.example/path" },
        "localhost:8787",
        "/world",
        "https://claudilization.example",
      ),
    ).toBe("https://claudilization.example/world");
    expect(
      publicRoot(
        { host: "localhost:8787", "x-forwarded-host": "user@attacker.example" },
        "localhost:8787",
        "",
      ),
    ).toBe("http://localhost:8787");
  });
});
