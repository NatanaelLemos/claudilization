/**
 * Mounting the world under a URL prefix.
 *
 * Standalone, Claudilization owns the whole origin (`/api/...`, `/ws`, `/`).
 * Inside a host like Clawdia's Apps tab it is proxied under a prefix
 * (`/apps/projects/claudilization`) and the proxy forwards the FULL pathname,
 * prefix included. Everything above this module keeps speaking absolute
 * server paths; this is the one place that translates.
 */

/** `undefined | "" | "/"` → `""`; anything else → `/leading/no-trailing`. */
export function normalizeBasePath(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, "");
}

/** The base path this process was mounted under, from the host's env. */
export function basePathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeBasePath(env.CLAUDILIZATION_BASE_PATH ?? env.CLAWDIA_APP_BASE_PATH);
}

/**
 * Strip the mount prefix so routing only ever sees app-absolute paths.
 * `matched` says whether the request actually carried the prefix — requests
 * that arrive without it (direct hit on the port, the Vite dev proxy, health
 * probes) are still served, so one build works in both worlds.
 */
export function stripBasePath(
  pathname: string,
  basePath: string,
): { path: string; matched: boolean } {
  if (!basePath) return { path: pathname || "/", matched: true };
  if (pathname === basePath) return { path: "/", matched: true };
  if (pathname.startsWith(`${basePath}/`)) {
    return { path: pathname.slice(basePath.length) || "/", matched: true };
  }
  return { path: pathname || "/", matched: false };
}

/** Prefix an app-absolute path back onto the public mount point. */
export function withBasePath(basePath: string, path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (!basePath) return suffix;
  return suffix === "/" ? `${basePath}/` : `${basePath}${suffix}`;
}

/**
 * The origin+prefix the outside world should use for this server — what the
 * install script, the join reply and the player link must hand out. Behind a
 * proxy that means the forwarded host, not the loopback socket we answered on.
 */
export function publicRoot(
  headers: Record<string, string | string[] | undefined>,
  fallbackHost: string,
  basePath: string,
  configuredOrigin?: string,
): string {
  const first = (v: string | string[] | undefined): string | undefined =>
    (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim() || undefined;

  if (configuredOrigin?.trim()) {
    try {
      const configured = new URL(configuredOrigin.trim());
      if (
        (configured.protocol === "https:" || configured.protocol === "http:") &&
        !configured.username &&
        !configured.password &&
        !configured.search &&
        !configured.hash &&
        (configured.pathname === "/" || configured.pathname === "")
      ) {
        return `${configured.origin}${basePath}`;
      }
    } catch {
      // Invalid operator input falls back to validated request headers.
    }
  }

  const safeHost = (raw: string | undefined): string | undefined => {
    if (!raw || raw.length > 255 || /[\\/\s]/.test(raw)) return undefined;
    try {
      const parsed = new URL(`http://${raw}`);
      if (parsed.username || parsed.password || parsed.pathname !== "/") return undefined;
      return parsed.host;
    } catch {
      return undefined;
    }
  };
  const host =
    safeHost(first(headers["x-forwarded-host"])) ??
    safeHost(first(headers.host)) ??
    safeHost(fallbackHost) ??
    "localhost";
  const proto = first(headers["x-forwarded-proto"])?.toLowerCase() === "https"
    ? "https"
    : "http";
  return `${proto}://${host}${basePath}`;
}
