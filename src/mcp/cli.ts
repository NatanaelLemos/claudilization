/**
 * Tiny owner CLI — the /claudilization slash command shells out to this for
 * actions that need the owner signature (plain curl can't sign).
 *
 *   npx tsx src/mcp/cli.ts join <civ> <serverUrl>
 *   npx tsx src/mcp/cli.ts rename "New Island Name"
 *   npx tsx src/mcp/cli.ts update
 */
import { CIV_IDS, type CivId } from "../shared/types";
import { loadIdentity, saveIdentity } from "./identity";
import { ensurePaired, loadOrCreateKeys, signedHeaders } from "./keys";
import { ensureDefaultSkill, loadSkill } from "./skillfile";

/**
 * Found the island — but one machine rules one civilization, so this refuses
 * outright when an identity already exists, and the server returns the same
 * island for a key it has seen before. A second civilization cannot happen.
 */
async function joinWorld(civ: string, serverUrl: string, name?: string): Promise<void> {
  const existing = loadIdentity();
  if (existing) {
    console.error(
      `This machine already rules ${existing.islandName ?? "an island"} — one machine, one civilization.`,
    );
    console.error(
      "Nothing was changed. To reshape how it behaves, use /claudilization update.",
    );
    process.exit(2);
  }
  if (!(CIV_IDS as readonly string[]).includes(civ)) {
    console.error(`Unknown civilization "${civ}" — pick one of: ${CIV_IDS.join(", ")}`);
    process.exit(1);
  }
  const res = await fetch(`${serverUrl}/api/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      civ,
      name,
      // the handshake: this machine's public key becomes the island's owner
      publicKey: loadOrCreateKeys().publicKeyPem,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    secret?: string;
    islandName?: string;
    isNew?: boolean;
    playerUrl?: string;
    error?: string;
  };
  if (!res.ok || !data.secret) {
    console.error(`Join failed: ${data.error ?? res.statusText}`);
    process.exit(1);
  }
  saveIdentity({
    secret: data.secret,
    serverUrl,
    islandName: data.islandName,
    playerUrl: data.playerUrl,
    // remembered so a world that is wiped and reborn can be re-entered as the
    // same people, without asking the player to choose again
    civ: civ as CivId,
    paired: true,
  });
  ensureDefaultSkill(civ as CivId);
  console.log(
    data.isNew
      ? `A new island rises: ${data.islandName}. It is yours.`
      : `This machine's key already owns ${data.islandName} — identity restored, no new island founded.`,
  );
  console.log(`Personal link: ${data.playerUrl}`);
}

async function rename(name: string): Promise<void> {
  const identity = loadIdentity();
  if (!identity) {
    console.error("Not in the game yet — join first.");
    process.exit(1);
  }
  await ensurePaired(identity);
  const payload = JSON.stringify({ secret: identity.secret, name });
  const res = await fetch(`${identity.serverUrl}/api/rename`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...signedHeaders("/api/rename", payload),
    },
    body: payload,
  });
  const data = (await res.json()) as { ok?: boolean; name?: string; error?: string };
  if (!res.ok || !data.ok) {
    console.error(`Rename failed: ${data.error ?? res.statusText}`);
    process.exit(1);
  }
  saveIdentity({ ...loadIdentity()!, islandName: data.name });
  console.log(`The island is now known as ${data.name}.`);
}

/** Stage the local doctrine on the server and hand back the visual editor link. */
async function update(): Promise<void> {
  const identity = loadIdentity();
  if (!identity) {
    console.error("Not in the game yet — join first.");
    process.exit(1);
  }
  const doctrine = loadSkill();
  if (doctrine === null) {
    console.error("No doctrine found at ~/.claudilization/skill.md.");
    process.exit(1);
  }
  await ensurePaired(identity);
  const payload = JSON.stringify({ secret: identity.secret, doctrine });
  const res = await fetch(`${identity.serverUrl}/api/update-draft`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...signedHeaders("/api/update-draft", payload),
    },
    body: payload,
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    console.error(`Staging failed: ${data.error ?? res.statusText}`);
    process.exit(1);
  }
  const base = identity.playerUrl ?? `${identity.serverUrl}/?key=${identity.secret}`;
  console.log("Your doctrine and island name are staged for editing. Open:");
  console.log(`${base}${base.includes("?") ? "&" : "?"}edit=1`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "join" && rest.length >= 2) {
  void joinWorld(rest[0]!, rest[1]!, rest[2]);
} else if (command === "rename" && rest.length > 0) {
  void rename(rest.join(" "));
} else if (command === "update") {
  void update();
} else {
  console.error(
    'Usage: cli.ts join <civ> <serverUrl> ["Island Name"] | cli.ts rename "New Island Name" | cli.ts update',
  );
  process.exit(1);
}
