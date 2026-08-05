import { describe, expect, it } from "vitest";
import { hookDecision, parseTurnTokens } from "./hookLogic";

const line = (o: unknown) => JSON.stringify(o);

const transcript = [
  line({ type: "user", message: { role: "user", content: "first prompt" } }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      usage: { input_tokens: 9000, output_tokens: 100 },
    },
  }),
  line({ type: "user", message: { role: "user", content: "second prompt" } }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_creation_input_tokens: 40,
        cache_read_input_tokens: 60,
      },
    },
  }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      usage: { input_tokens: 500, output_tokens: 200 },
    },
  }),
].join("\n");

describe("parseTurnTokens", () => {
  it("sums the final turn only — every usage field, both assistant steps", () => {
    // last turn = everything after the last user message: 1200+300+40+60+500+200
    expect(parseTurnTokens(transcript)).toBe(2300);
  });

  it("returns 0 for an empty or unusable transcript", () => {
    expect(parseTurnTokens("")).toBe(0);
    expect(parseTurnTokens("not json at all")).toBe(0);
  });
});

describe("hookDecision — the session is never blocked", () => {
  it("lets every stop straight through; the brain decides in the background", () => {
    expect(hookDecision({})).toEqual({});
    expect(hookDecision({ stop_hook_active: true })).toEqual({});
  });
});
