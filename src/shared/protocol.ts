/**
 * The client/server contract version. Bump it whenever the order vocabulary
 * or the sync payload grows.
 *
 * The update path is CODE, never prose: the installed app compares the
 * server's bundle digest (`/api/version`, echoed as the inert `bundle` fact
 * in `/api/state`) against its own `bundle.json` stamp and, on mismatch,
 * replaces ~/.claudilization/app atomically by itself (src/mcp/selfUpdate.ts).
 * State payloads carry machine facts only — no instructions, no URLs to run,
 * nothing phrased at the player's agent.
 *
 *   1 — launch vocabulary (gather/build/boat/plane/voyage/advance_age)
 *   2 — creations (create/dispatch/disband), rules-as-data, self-updating app
 */
export const PROTOCOL_VERSION = 2;

/** The oldest client protocol this server still answers. */
export const MIN_CLIENT_PROTOCOL = 1;
