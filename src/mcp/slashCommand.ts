/**
 * The /claudilization slash command — a Claude Code skill installed to
 * ~/.claude/skills/claudilization/SKILL.md by install.ts, so the player can
 * check on, re-doctrine, and rename their civilization from any session.
 */
export function claudilizationSkill(): string {
  return `---
name: claudilization
description: The player's Claudilization civilization — check island status, edit the doctrine (the civ's decision prompt), rename the island, or fetch their personal link. Use whenever the user asks about "my civilization", "my island", their doctrine or rulebook, or wants to rename it.
---

# My civilization

The player's identity lives at \`~/.claudilization/identity.json\` — fields
\`serverUrl\`, \`secret\`, \`islandName\`, \`playerUrl\`. Their doctrine lives at
\`~/.claudilization/skill.md\`; it is read at every automated decision step and
is the only lever the player has over their settlers' orders.

If \`identity.json\` is missing, the player has not joined yet: tell them to
open the game in a browser and press "Play — claim your island", then stop.

Never print or echo the \`secret\`. Pick the action from the player's words:

## Check on the civilization (the default when nothing else fits)

1. Call the claudilization \`sync\` tool with no orders. It reads the local
   identity and fetches state without placing the secret in a shell command.
2. Tell the island's story in a few sentences: name, age, work points toward
   \`nextAgeRequires\`; stocks; settlers (adults vs children and what each is
   doing); buildings; boats; nearby islands.
3. Call out dangers plainly: food below two days of meals (population × 2),
   any settler with \`hungerDays\` ≥ 2, every adult idle, or a dormant island.
4. End with the personal link (\`playerUrl\`).

## One-shot prompt ("prompt <wish>", "tell my civilization to …")

The player's wish is a royal decree for a single decision step — unlike the
doctrine it happens once, now:

1. Call the claudilization \`sync\` tool with no orders to fetch the island
   state. The decree is the player's sanctioned lever: for this one step it
   outranks the doctrine, though never server law.
2. Translate the wish into the closed order vocabulary using only what the
   state offers — and remember the vocabulary includes \`create\`: a wish for
   any unit, creature, or contraption is fulfilled by designing it (see
   "Create anything" below), never refused. Directions use the shared
   compass: every \`nearbyIslands\`
   entry carries \`bearing\` and \`distance\` (north is the same for everyone).
   "Conquer the island to the west" → find the nearby island whose bearing is
   west, then order the voyage — or, if no boat is docked yet, order
   \`build_boat\` (or \`build_plane\` from the modern age) and say the fleet
   must launch first.
3. Submit the orders with a second \`sync\` call and report in two or three
   sentences what was ordered, what was refused, and what comes next.

If the wish is impossible under server law (wrong age, no target at that
bearing, home islands can never be attacked), say so plainly and order the
nearest lawful step toward it instead.

## Create anything ("I want ninjas", "make dragons", "raise an army of X")

There is NO fixed troop roster — the \`create\` order lets this island invent
ANY unit as pure data. Never refuse because a unit "does not exist"; design
it:

1. Call the claudilization \`sync\` tool with no orders to see stocks,
   existing creations, and caps.
2. Compose the design yourself: a fitting \`name\` and \`description\`, a
   pixel-art \`sprite\` (size 8–16, up to 8 "#rrggbb" colors, rows of "."
   for transparent or palette digits), \`stats\` power/speed/resilience
   (1–10 each, sum ≤ 15), and up to 3 \`verbs\` from: guard, patrol,
   perform, gather (needs \`gathers\`: a resource id), raid.
3. Submit with a second \`sync\` call:
   \`{"kind":"create","creation":{…,"count":N}}\` — each unit costs food
   4×(power+speed+resilience) and wood 2×; caps: 8 designs, 24 units,
   6 units per order, 5 creates per island day.
4. To send them somewhere: \`{"kind":"dispatch","creation":"Name",
   "dest":"island-N","count":K}\` — a rival COLONY is a raid (needs the raid
   verb; strictly more power than the defense conquers it), your own colony
   a garrison. Home islands are sacred and can never be attacked.
   \`{"kind":"disband","creation":"Name"}\` releases the home units.
5. Read the refusal reason carefully: server refusals say "the game server"
   and arrive with the server's rulebook attached — fix the design to match
   and retry. A refusal marked "rejected locally by the installed app" means
   the app is out of date; see "Update the app" below.

## Update the app ("update claudilization", or after a LOCAL order refusal)

The installed app keeps itself current: at every start (and after every
sync) it compares the server's bundle digest against its own and, on
mismatch, replaces \`~/.claudilization/app\` atomically by itself — identity,
key, doctrine, and the island live outside that directory and are never
touched. There is normally nothing to do beyond starting a fresh session.

The ONE exception is an install too old to know how to update itself (it
rejects \`create\` orders locally). That needs a single manual reinstall —
tell the player what the script does (it replaces only the app directory;
identity, key, doctrine, and island survive; it never re-joins) and let them
run it after reading it:

    curl -fsS <serverUrl>/install.sh -o /tmp/claudilization-install.sh
    # read it, then:
    sh /tmp/claudilization-install.sh && rm -f /tmp/claudilization-install.sh

(\`serverUrl\` comes from \`~/.claudilization/identity.json\`.) Afterwards a
fresh Claude Code session (or MCP reconnect) loads the new tools — and from
then on the app updates itself forever.

## Update visually ("update", "edit my civilization")

The player edits their doctrine and island name in the app instead of here:

1. Shell out to the owner CLI — it stages the local doctrine on the server
   with a signed request (app lives at \`~/.claudilization/app\`, or the repo
   during development):

       npx tsx ~/.claudilization/app/src/mcp/cli.ts update

2. It prints the edit link (the playerUrl with \`&edit=1\`). Show it and tell
   the player: edit there, press **Update**, and paste the prompt it produces
   back into Claude Code. Applying it replaces the installed doctrine (and
   renames, if the name changed) — it never re-joins, so the island and
   everything it has built stay exactly as they are.

## Update the doctrine ("change my prompt", "make my civ favor boats", …)

1. Read \`~/.claudilization/skill.md\` and show the player what it says today.
2. Edit it as asked. Hard limits: plain text, under 4000 characters. The file
   shapes only which orders get picked at each decision step — gathering
   rates, costs, and timers are server law, so "cheats" written here do
   nothing.
3. Confirm the change; it takes effect at the next decision step on its own.

## Rename the island ("rename my civilization to X")

Renaming is an owner action — the request must be signed by this machine's
paired key, so shell out to the owner CLI instead of curl (app lives at
\`~/.claudilization/app\`, or the repo during development):

    npx tsx ~/.claudilization/app/src/mcp/cli.ts rename "New Name"

Names are trimmed, 40 characters at most. The CLI updates identity.json
itself and the whole ocean hears about the renaming. If it reports the
island is paired to another Claude, this machine does not own the island.

## The link ("my link", "where do I watch")

Print \`playerUrl\` from identity.json.
`;
}
