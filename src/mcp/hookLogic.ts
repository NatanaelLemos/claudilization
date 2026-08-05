/** Pure logic for the Claude Code Stop hook — testable without stdin/stdout. */

interface TranscriptEntry {
  type?: string;
  message?: {
    role?: string;
    usage?: Record<string, number | undefined>;
  };
}

const USAGE_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
];

/** Sum the token usage of the transcript's final turn (after the last user message). */
export function parseTurnTokens(transcriptJsonl: string): number {
  const entries: TranscriptEntry[] = [];
  for (const line of transcriptJsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      // not a JSON line — skip
    }
  }
  let lastUser = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.type === "user") lastUser = i;
  }
  let total = 0;
  for (const entry of entries.slice(lastUser + 1)) {
    if (entry.type !== "assistant") continue;
    const usage = entry.message?.usage;
    if (!usage) continue;
    for (const field of USAGE_FIELDS) total += usage[field] ?? 0;
  }
  return total;
}

export interface StopHookInput {
  stop_hook_active?: boolean;
}

export interface StopHookDecision {
  decision?: "block";
  reason?: string;
}

/**
 * The hook never blocks the session anymore — decision steps run in the
 * detached background brain, so the player's turns end clean and quiet.
 */
export function hookDecision(_input: StopHookInput): StopHookDecision {
  return {};
}
