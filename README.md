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

```bash
npm test
npm run typecheck
npm run build
npm run test:scenario
npm audit --omit=dev
```

The scenario suite uses only `.test-data/` and `test-results/`, both ignored by
Git. Postgres contract tests are skipped unless an isolated
`CLAUDILIZATION_PG_TEST_URL` is supplied.

## Build log

- 2026-08-05 — Public-release privacy, security, dependency, and repository hardening published at https://github.com/NatanaelLemos/claudilization.
