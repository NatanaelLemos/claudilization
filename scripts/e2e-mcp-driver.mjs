#!/usr/bin/env node
/**
 * Drives an installed Claudilization MCP server through a REAL MCP client —
 * the same stdio transport and tool-call path Claude Code uses. No shortcuts:
 * whatever this prints is exactly what an agent would receive.
 *
 * usage: node scripts/e2e-mcp-driver.mjs <appDir> <tool> [jsonArgs]
 * env:   HOME (identity sandbox), CLAUDILIZATION_SERVER (world address)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [appDir, tool, jsonArgs] = process.argv.slice(2);
if (!appDir || !tool) {
  console.error("usage: node scripts/e2e-mcp-driver.mjs <appDir> <tool> [jsonArgs]");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", `${appDir}/src/mcp/server.ts`],
  cwd: appDir,
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "e2e-driver", version: "0.0.1" });
await client.connect(transport);
const result = await client.callTool({
  name: tool,
  arguments: jsonArgs ? JSON.parse(jsonArgs) : {},
});
console.log(JSON.stringify(result, null, 2));
await client.close();
