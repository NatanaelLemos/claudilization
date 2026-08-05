import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join as joinPath } from "node:path";

export const BASE = "http://localhost:8790";
export const TEST_WORK = ".test-data/scenario";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`);
  return data;
}

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export interface JoinReply {
  secret: string;
  islandId: string;
  islandName: string;
  isNew: boolean;
  playerUrl: string;
  watchUrl: string;
}

export const joinGame = (civ: string, secret?: string) =>
  api<JoinReply>("/api/join", post({ civ, secret }));

export const pulse = (secret: string, tokens: number) =>
  api<{ events: number }>("/api/pulse", post({ secret, tokens }));

export const getState = (secret: string) =>
  api<{
    island: {
      id: string;
      name: string;
      age: string;
      workPoints: number;
      stocks: Record<string, number>;
      settlers: { name: string; adult: boolean; task: { kind: string; resource?: string }; hungerDays: number }[];
      buildings: { type: string; stage: string }[];
      boats: { state: string; intent?: string }[];
      dormant: boolean;
      natureNodes: Record<string, number>;
      buildable: { type: string; age: string }[];
      resourcesUnlocked: string[];
    };
    nearbyIslands: unknown[];
    recapLine: string | null;
  }>(`/api/state?secret=${encodeURIComponent(secret)}`);

export const sendOrders = (secret: string, orders: unknown[]) =>
  api<{ outcomes: { ok: boolean; reason?: string }[] }>(
    "/api/orders",
    post({ secret, orders }),
  );

export const grant = (islandId: string, g: unknown) =>
  api<{ ok: boolean }>("/api/debug/grant", post({ islandId, grant: g }));

export const worldSummary = () =>
  api<{
    time: number;
    islands: {
      id: string;
      name: string;
      civ: string;
      age: string;
      ruins: boolean;
      dormant: boolean;
      population: number;
      stocks: Record<string, number>;
      boats: { state: string }[];
    }[];
  }>("/api/world");

/** Poll until fn() is truthy or timeout. */
export async function waitFor<T>(
  fn: () => Promise<T | undefined | false | null>,
  timeoutMs = 45_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
      last = value;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out; last=${String(last)}`);
}

export interface McpSession {
  client: Client;
  home: string;
  callText(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

/** Spawn the real MCP stdio server with an isolated HOME (identity file). */
export async function mcpSession(home?: string): Promise<McpSession> {
  mkdirSync(TEST_WORK, { recursive: true });
  const dir = home ?? mkdtempSync(joinPath(TEST_WORK, "mcp-home-"));
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/server.ts"],
    env: {
      ...process.env,
      HOME: dir,
      CLAUDILIZATION_SERVER: BASE,
    },
  });
  const client = new Client({ name: "scenario-driver", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    home: dir,
    async callText(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text?: string }[];
      return content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    },
    close: () => client.close(),
  };
}
