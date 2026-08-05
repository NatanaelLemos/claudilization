// Behavior 7: inspect the actual outbound payload — numbers and structured
// orders only, never a word of prompt text.
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { TEST_WORK } from "./helpers/driver";

const SECRET_TEXT = "SUPER_SECRET_PROPRIETARY_PROMPT_CONTENT_ab12";

function fixtureTranscript(): string {
  return [
    JSON.stringify({ type: "user", message: { role: "user", content: SECRET_TEXT } }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", usage: { input_tokens: 1500, output_tokens: 400 } },
    }),
  ].join("\n");
}

test("the Stop hook sends only numbers — the prompt text never leaves the machine", async () => {
  const home = mkdtempSync(join(TEST_WORK, "hook-home-"));
  const captured: string[] = [];

  const capture = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      captured.push(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  // ephemeral port: a fixed number collides with whatever else lives on the
  // host running the suite
  await new Promise<void>((resolve) => capture.listen(0, resolve));
  const address = capture.address();
  if (address === null || typeof address === "string") {
    throw new Error("capture server has no port");
  }
  const capturePort = address.port;

  try {
    mkdirSync(join(home, ".claudilization"), { recursive: true });
    writeFileSync(
      join(home, ".claudilization", "identity.json"),
      JSON.stringify({ secret: "s-test", serverUrl: `http://localhost:${capturePort}` }),
    );
    const transcriptPath = join(home, "transcript.jsonl");
    writeFileSync(transcriptPath, fixtureTranscript());

    const run = (payload: unknown) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn("npx", ["tsx", "src/mcp/hook.ts"], {
          env: { ...process.env, HOME: home },
        });
        let out = "";
        child.stdout.on("data", (c: Buffer) => (out += c.toString()));
        child.on("close", () => resolve(out));
        child.on("error", reject);
        child.stdin.end(JSON.stringify(payload));
      });

    const decision = await run({
      transcript_path: transcriptPath,
      stop_hook_active: false,
    });

    expect(captured.length).toBe(1);
    const body = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["secret", "tokens"]);
    expect(typeof body.tokens).toBe("number");
    expect(body.tokens).toBe(1900);
    expect(captured[0]).not.toContain(SECRET_TEXT);

    // the decision step lives in the detached brain now, so the hook ends the
    // player's turn clean — it never blocks, on the first stop or any later one
    expect(JSON.parse(decision)).toEqual({});
    const second = await run({
      transcript_path: transcriptPath,
      stop_hook_active: true,
    });
    expect(JSON.parse(second)).toEqual({});
  } finally {
    capture.close();
  }
});
