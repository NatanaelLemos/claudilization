/**
 * The client/server contract version. Bump it whenever the order vocabulary
 * or the sync payload grows, and describe what changed in the server's
 * update notice (api.ts). Installed apps send their version with every state
 * fetch; the server tells older clients — in the state payload itself, which
 * even pre-versioning clients dump verbatim into the sync reply — that new
 * powers exist and how to refresh the app without touching their identity.
 *
 *   1 — launch vocabulary (gather/build/boat/plane/voyage/advance_age)
 *   2 — creations (create/dispatch/disband) and this update channel
 */
export const PROTOCOL_VERSION = 2;
