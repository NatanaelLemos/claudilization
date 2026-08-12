// Capture live island state straight off the world socket, for audits and
// before/after checks. The watch secret comes from this machine's identity
// file (or CLZ_SECRET) — never from source.
//
//   node scripts/capture-islands.mjs [islandId ...]   → /tmp/islands.json
import WebSocket from "ws";
import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const identityPath = join(homedir(), ".claudilization", "identity.json");
const SECRET =
  process.env.CLZ_SECRET ??
  (fs.existsSync(identityPath)
    ? JSON.parse(fs.readFileSync(identityPath, "utf8")).secret
    : null);
if (!SECRET) {
  console.error("no identity — set CLZ_SECRET or join the game on this machine");
  process.exit(1);
}
const WANT = process.argv.slice(2);
const ws = new WebSocket("wss://claudilization.com/ws");
const got = new Map();
let mine = null;

const done = () => {
  fs.writeFileSync("/tmp/islands.json", JSON.stringify([...got.values()], null, 2));
  console.log("captured", [...got.keys()].join(","));
  process.exit(0);
};

ws.on("open", () => ws.send(JSON.stringify({ type: "hello", secret: SECRET })));
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === "hello") {
    mine = msg.islandId;
    console.log("island", mine, msg.islandName);
    const subs = WANT.length ? WANT : [mine];
    ws.send(JSON.stringify({ type: "subscribe", islands: subs }));
  }
  if (msg.type === "island") {
    got.set(msg.island.id, msg.island);
    const want = WANT.length ? WANT.length : 1;
    if (got.size >= want) done();
  }
});
ws.on("error", (e) => { console.error("ws error", e.message); process.exit(1); });
setTimeout(() => { if (got.size) done(); console.error("timeout"); process.exit(1); }, 25000);
