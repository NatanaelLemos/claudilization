# Claudilization

Claudilization is a persistent island civilization watched in the browser and
played by Claude Code activity. Each completed Claude Code turn sends a signed
numeric pulse; the simulation converts that work into growth while a local
Markdown doctrine guides autonomous decisions. Prompt and transcript text stay
on the player's machine.

The public world is available at [claudilization.com](https://claudilization.com).

## Architecture

- `src/client` — Vite and three.js browser client.
- `src/server` — Node HTTP, WebSocket/SSE transport, simulation, and persistence.
- `src/mcp` — local Claude Code bridge, owner CLI, Stop hook, and signing keys.
- `src/shared` — terrain, ages, buildings, orders, and protocol types.

The server owns the world state and stores an append-only command log plus
periodic snapshots. It uses the local `data/` directory by default and switches
to Postgres when `DATABASE_URL` or `CLAUDILIZATION_DB` is present.

## Local development

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run build
env -u DATABASE_URL npm start
```

The app starts at `http://localhost:8787` unless `PORT` is set. For hot reload,
run the server and client separately:

```bash
npm run dev:server
npm run dev:client
```

The Vite client runs on port 5173 and proxies API and WebSocket traffic to the
server on port 8787.

Copy `.env.example` only when you need overrides. Never commit `.env` files,
database exports, runtime world data, player links, identities, private keys,
logs, browser traces, or test artifacts.

## Connect Claude Code

Clone and inspect the repository first, then install dependencies and join a
world with the owner CLI:

```bash
npm ci
npx tsx src/mcp/cli.ts join greek https://claudilization.com "Your Island"
npx tsx src/mcp/install.ts --write
```

The CLI creates `~/.claudilization/identity.json` and an Ed25519 private key at
`~/.claudilization/key.pem`. Both are local credentials. Keep the entire
`~/.claudilization` directory private and never paste its contents into issues,
logs, prompts, or chat.

The browser also offers a generated installer. Review the downloaded script
before running it. The installer downloads a source archive and verifies its
SHA-256 digest before extraction.

## Creations — invent anything

Players can ask their Claude to create whatever they imagine — ninjas, dragons,
golems, siege engines — and watch it live on their island. A creation is pure
data, never code: a name, a pixel-art sprite, clamped stats, and behaviors
picked from a closed verb list. Claude composes the design; the server
validates, prices, and simulates it; the client renders the pixel art on the
island and across the open sea.

- **Sprite**: 8–16 pixels per side, up to 8 `#rrggbb` colors, rows of `.`
  (transparent) or palette digits. No SVG, no HTML, no URLs — ever.
- **Stats**: `power`, `speed`, `resilience`, each 1–10, sum capped at 15.
- **Verbs** (up to 3): `guard` (defends double), `patrol` (defends, walks
  rounds), `perform` (radiates joy), `gather` (harvests a resource tirelessly),
  `raid` (may be dispatched to attack).
- **Cost**: each unit costs food 4×(power+speed+resilience) and wood 2× the
  same — power is earned by the economy, never by prompt engineering.
- **Caps** (server law): 8 designs and 24 living units per island, 6 units per
  order, 5 creates per island day.
- **Orders**: `create` brings a design to life; `dispatch` sends its units
  across the sea — a rival colony is a raid (strictly more total power than
  the defense conquers it; otherwise the band is lost), your own colony a
  garrison; `disband` releases a design's home units.
- **The one law of the sea still holds**: home islands are sacred and can
  never be attacked — by boats, planes, or anything anyone ever invents.

Every string field passes a strict gate (length caps, plain-prose character
sets, no markup, links, or control characters), the schema is enforced on the
MCP client, the API boundary, and durable-log replay alike, and the renderer
re-validates sprites off the wire. Worlds saved before creations existed load
unchanged with zero creations.

## Privacy and trust model

- The Stop hook parses Claude Code's local transcript only to total token usage.
  It sends the count, not prompt or transcript text.
- Player links contain a bearer secret. They can reveal private island state,
  so treat them like passwords.
- State-changing owner requests are signed with the local Ed25519 key. The
  private key never needs to reach the server.
- The local doctrine lives at `~/.claudilization/skill.md`. The server only
  holds a transient draft while the browser editor is open.
- Public spectators receive world and subscribed-island simulation state. Do
  not put real personal information into island names, chat, or doctrine text.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting guidance.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to `8787`. |
| `CLAUDILIZATION_HOST` | Bind host; overrides `HOSTNAME`. |
| `CLAUDILIZATION_PUBLIC_URL` | Canonical public origin for generated links. |
| `CLAUDILIZATION_BASE_PATH` | Optional URL mount prefix. |
| `CLAWDIA_APP_BASE_PATH` | Clawdia-provided mount prefix fallback. |
| `CLAUDILIZATION_DATA` | Local world-data directory; defaults to `data/world`. |
| `CLAUDILIZATION_DB` / `DATABASE_URL` | Postgres connection string. |
| `CLAUDILIZATION_SEED` | Seed for a new world. |
| `CLAUDILIZATION_SERVER` | Default server used by the local MCP bridge. |

`CLAUDILIZATION_TEST`, `CLAUDILIZATION_BALANCE`, and the release/test database
variables are test-only. Do not point automated tests at a production database.

## Deployment

The included Dockerfile builds the client and runs the TypeScript server from a
production dependency install. `fly.toml` documents the current single-machine
Fly shape. One process must own a world at a time: scaling the current in-memory
simulation horizontally would create divergent writers.

Set `DATABASE_URL` with the deployment platform's secret manager. Do not place a
connection string in `fly.toml`, Docker build arguments, repository variables
that are exposed to forks, or committed environment files.

The same source can run under a path prefix. Vite bakes the prefix into asset
URLs, the server strips it once at the routing boundary, and the client derives
HTTP, SSE, and WebSocket URLs from `import.meta.env.BASE_URL`.

## Verification

Two lanes. The fast lane is the push gate; the slow lane is on demand.

**Push gate — run before every push (~10 seconds total):**

```bash
npm run verify   # = npm test (vitest units, ~6 s) + npm run typecheck (~4 s)
```

**Release verification — only for releases or changes that touch the world
loop, transports, persistence, or the client bundle (~8 minutes):**

```bash
npm run verify:release   # = verify + npm run build + npm run test:scenario
npm audit --omit=dev
```

The scenario suite (`npm run test:scenario`) drives a real browser against a
dedicated server with an accelerated world clock; its runtime is dominated by
deliberate real-time waits (dormancy, starvation, day boundaries) and it runs
serially against one shared world. Do not fold it into the push gate.

The agent-run QA walkthroughs in `evals/` take hours and are for major
behavior changes only — never part of any automated gate.

The scenario suite uses only `.test-data/` and `test-results/`, both ignored by
Git. Postgres contract tests are skipped unless an isolated
`CLAUDILIZATION_PG_TEST_URL` is supplied.

## Build log

- 2026-08-11 — Living towns + atmosphere shipped: deterministic plazas/streets/districts, street-facing grounded buildings, night life, swell-riding craft, and an establishing camera; live at https://claudilization.com.
- 2026-08-11 — One-empty-island spawn law shipped in Fly v35: a new wild island rises only when zero empty islands wait on the map (maxWildPerHome retired); live at https://claudilization.com.
- 2026-08-11 — Scroll World beauty pass shipped (terrain relief, groves, per-island palette, footpaths, working yards, tilt-shift post, contact blobs) in Fly v33; 28/28 scenarios, knip/audit clean; live at https://claudilization.com.
- 2026-08-10 — Structure-aware building spacing, demand-gated construction, and procedural animated clay water shipped; live at https://claudilization.com.
- 2026-08-10 — Miniature clay-diorama art direction shipped across terrain, structures, settlers, vegetation, craft, catastrophes, lighting, and responsive HUD in Fly v31; live at https://claudilization.com.
- 2026-08-07 — Live civilization population pill shipped in the top-left HUD; Fly v30 at https://claudilization.com.
- 2026-08-07 — Hourly catastrophes with synchronized earthquake shake, sweeping tsunami, and procedural kaiju rampage shipped in Fly v29; live at https://claudilization.com.
- 2026-08-06 — Global catastrophes and the full crowded-island renderer pass shipped: 600 repeated townhouses now batch from 6,600 to 11 main submissions and 4,200 to 7 shadow submissions; live at https://claudilization.com.
- 2026-08-06 — Global 30-minute catastrophes implemented and verified locally: earthquake, volcano, tsunami, and Godzilla; authoritative persistence/countdown plus 433 unit and 26 browser scenarios passing; not deployed.
- 2026-08-06 — Rendering performance pass shipped: static mesh compaction, batched/instanced resources, distant-terrain LOD, adaptive DPR/shadows, throttled hover picking, and a repeatable benchmark harness; live at https://claudilization.com.
- 2026-08-05 — World-wide attack alerts shipped: every voyage or creation raid rings one deduplicated `<island> is being attacked by <attacker>` card for all viewers, with a “See it” camera-focus action; live at https://claudilization.com (feature commit 051af5a, Fly v25).
- 2026-08-05 — Production proof + identity law: stale-client create rejection root-caused (local Zod error, server never saw a create — world_log evidence); full flow proven on claudilization.com via a real stale install → `curl -fsS https://claudilization.com/install.sh | sh` → ninja create accepted, units in the WS render feed; identity-preservation now a failing-test law (identityPreservation.test.ts); Clawdia rejoined as Portus Solis after the Aug-4 world reseed.
- 2026-08-05 — Test gate split: `npm run verify` (~10 s) is the push gate; scenario suite and evals moved behind explicit slow-lane commands; scenario 07 port collision fixed (commit 6127039).
- 2026-08-05 — Public-release privacy, security, dependency, and repository hardening published at https://github.com/NatanaelLemos/claudilization.
- 2026-08-05 — Creations shipped: players' Claudes invent arbitrary units (pixel-art + clamped stats + closed verbs) that render, gather, garrison, and raid under existing conquest law; live at https://claudilization.com (commit 21ea1a9).
- 2026-08-05 — Update channel shipped: /api/state now leads with an update notice for stale installed apps (they dump it verbatim into sync replies), /api/version probe, per-order screening, forward-compatible client parse, and the /claudilization command teaches 'Create anything' + safe app refresh; live at https://claudilization.com (commit 99d22cb).
- 2026-08-05 — Self-updating app replaces the prose update channel: state carries inert facts (`protocol`, `bundle`) + the rulebook as data; the installed app swaps `~/.claudilization/app` atomically by itself (updater.ts/selfUpdate.ts); rejections name their judge and attach the rules; live at https://claudilization.com.
- 2026-08-05 — Conquest law + camera + load: immutable island `origin` (homes never capturable, neutral-origin land contestable forever), conquered islands take the conqueror's civilization name, arrow-key camera pan, and on-demand terrain streaming (TTI ~1.9s → ~0.7s, startup main-thread blocking ~3.6× lower, three.js split into a long-cached chunk); live at https://claudilization.com and the Apps tab (commit 53e266f).
- 2026-08-05 — Civ colors: every founded civilization is dealt a unique banner color (widest-gap hue placement, backfilled on load for existing saves) worn by rooftops, clothes, flags, sails, and the HUD title; colonies fly their ruler's color; live at https://claudilization.com (commit 014785e).
- 2026-08-05: install.sh fix — U+2026 glued to $APP broke `set -u` shells; braced + pure-ASCII, deployed to Fly, verified `curl | sh` end-to-end (79fa0b6)
- 2026-08-11 — Miniature sea pass (clay-water-waves-v2): bathymetry field + lagoon banks, coast foam, lapping rings, crest bands, desktop sun sheen; still one draw call; Fly v34 live at https://claudilization.com (merge e4f4521).
