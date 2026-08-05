/**
 * Where this client is served from. Standalone that's the origin root; inside
 * a host (Clawdia's Apps tab) it's a prefix like
 * `/apps/projects/claudilization/`. Vite bakes the value into
 * `import.meta.env.BASE_URL` at build time, so nothing in the client may hard
 * code a leading-slash path — every URL is derived here.
 */
export function baseUrl(): string {
  const raw = (import.meta.env?.BASE_URL ?? "/") || "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** True when a host has mounted us under a prefix. */
export function isMounted(): boolean {
  return baseUrl() !== "/";
}

/** `apiUrl("/api/state")` → `/apps/projects/claudilization/api/state`. */
export function apiUrl(path: string): string {
  return `${baseUrl()}${path.replace(/^\/+/, "")}`;
}

/** Absolute origin+prefix, no trailing slash — what the setup prompt hands to Claude Code. */
export function publicRoot(origin: string = location.origin): string {
  return `${origin}${baseUrl()}`.replace(/\/+$/, "");
}

/** WebSocket URL for the native transport, prefix included. */
export function socketUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${baseUrl()}ws`;
}
