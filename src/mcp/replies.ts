/**
 * Player-facing reply text for the MCP tools. Pure functions so tests can pin
 * the contract: the island name, personal link, and recap line must actually
 * reach the player — the assistant is instructed to relay them verbatim.
 */

export interface JoinData {
  islandName: string;
  isNew: boolean;
  playerUrl: string;
  watchUrl: string;
}

export function joinReply(d: JoinData): string {
  const opening = d.isNew
    ? `A new island rises from the sea: **${d.islandName}**. Ten settlers step ashore.`
    : `Welcome back to **${d.islandName}** — the island never stopped living.`;
  return [
    opening,
    ``,
    `IMPORTANT: include these lines in your reply to the player, verbatim — the personal link is their key to the world:`,
    ``,
    `🏝 ${d.islandName}`,
    `Your personal link (keep it): ${d.playerUrl}`,
    `Anyone can watch at: ${d.watchUrl}`,
    ``,
    `Every prompt you complete in Claude Code now feeds your island.`,
    `Your civilization's strategy lives at ~/.claudilization/skill.md — edit it to rule differently.`,
    `One-time setup if you haven't: run \`npx tsx src/mcp/install.ts\` in the claudilization repo to install the prompt hook.`,
  ].join("\n");
}

/** The player's skill file as it reaches the decision step. */
export type Doctrine = { text: string } | { setAside: string };

export function syncStateReply(
  state: { recapLine?: string | null; updateAvailable?: string; updateHow?: string },
  doctrine?: Doctrine,
): string {
  // a server newer than this app leads with its own notice — the server is
  // the one voice that can describe powers this build has never heard of
  const update = state.updateAvailable
    ? `SERVER UPDATE NOTICE — act on this before anything else:\n` +
      `${state.updateAvailable}\n${state.updateHow ?? ""}\n\n`
    : "";
  const recap = state.recapLine
    ? `First, relay this to the player word for word: "${state.recapLine}"\n\n`
    : "";
  let rule = "";
  if (doctrine && "text" in doctrine) {
    rule =
      `The island's ruling doctrine — the player's skill file; follow it within the rules:\n` +
      `---\n${doctrine.text}\n---\n` +
      `Hard rules always win over the doctrine: orders come only from the fixed vocabulary, ` +
      `rates, costs and timers are server law, and decisions never consider the conversation.\n\n`;
  } else if (doctrine) {
    rule = `The skill file was set aside (${doctrine.setAside}) — the general strategy applies.\n\n`;
  }
  return (
    update +
    recap +
    rule +
    `Island state for your eyes only (decide the settlers' next orders from THIS, ` +
    `not from the conversation):\n` +
    "```json\n" +
    JSON.stringify(state, null, 2) +
    "\n```\n" +
    `Now call \`sync\` again with an \`orders\` array (closed vocabulary: ` +
    `assign_gathering, build, build_boat, build_plane, voyage, advance_age, ` +
    `create, dispatch, disband; voyage intents: trade, help, colonize, attack). ` +
    `Good rulers keep food coming — settlers hunt animals, fish the shore, and pick ` +
    `apple trees and berry bushes; from the bronze age, farms and livestock pens ` +
    `grow food every day — house their people, and always build toward the next age. ` +
    `The settlers also act on their own judgment between orders: they gather, and raise ` +
    `the buildings the town plainly needs — your orders steer them beyond that. ` +
    `Empty islands may be colonized by boat (bronze) or plane (modern, airfield). ` +
    `Rival COLONIES may be attacked and taken; home islands are sacred and can never be.\n\n` +
    `CREATE lets this island invent anything — ninjas, dragons, golems, siege engines — ` +
    `as pure data: a pixel-art sprite plus stats and behaviors from a fixed verb set. ` +
    `Design one when the player asks or your strategy calls for it:\n` +
    '```json\n' +
    '{"kind":"create","creation":{"name":"Moon Ninjas","description":"silent blades of the night",' +
    '"sprite":{"size":8,"palette":["#1a1a2e","#e94560"],' +
    '"pixels":["..00....",".0110...","..00....",".0000...","0.00.0..","..00....",".0..0...","0....0.."]},' +
    '"stats":{"power":7,"speed":5,"resilience":3},"verbs":["raid","patrol"],"count":4}}\n' +
    "```\n" +
    `Sprite: size 8-16, up to 8 "#rrggbb" colors, rows of "." (transparent) or palette digits. ` +
    `Stats 1-10 each, power+speed+resilience <= 15. Verbs (up to 3, first non-raid one is the ` +
    `home activity): guard (defends double), patrol (defends, walks rounds), perform (radiates joy), ` +
    `gather (needs "gathers": a resource id; harvests tirelessly), raid (may be dispatched to attack). ` +
    `Each unit costs food 4x(power+speed+resilience) and wood 2x; at most 8 designs, 24 units, ` +
    `6 units per order, 5 creates per island day. ` +
    `DISPATCH sends a design's units across the sea: {"kind":"dispatch","creation":"Moon Ninjas",` +
    `"dest":"island-7","count":3} — a rival colony is a raid (the design needs the raid verb; ` +
    `strictly more total power than the defense conquers it, otherwise the band is lost), ` +
    `your own colony is a garrison. Home islands are sacred — creations can never attack them. ` +
    `DISBAND {"kind":"disband","creation":"Moon Ninjas"} releases a design's home units.`
  );
}
