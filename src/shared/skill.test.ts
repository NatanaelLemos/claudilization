import { describe, expect, it } from "vitest";
import { defaultSkill, validateSkill } from "./skill";

describe("the default skill file", () => {
  const CIVS = [
    "roman", "greek", "egyptian", "norse", "japanese", "aztec", "mauryan", "mongol",
  ] as const;

  it("gives every civilization its own doctrine — different beyond the name", () => {
    const texts = CIVS.map((c) => defaultSkill(c));
    // distinct even with every civ name stripped out: the strategies differ
    const stripped = texts.map((t) =>
      t.toLowerCase().replace(/roman|greek|egyptian|norse|japanese|aztec|mauryan|mongol/g, ""),
    );
    expect(new Set(stripped).size).toBe(CIVS.length);
    for (const [i, text] of texts.entries()) {
      expect(text.toLowerCase()).toContain(CIVS[i]!);
      // the essentials survive in every civ's version
      expect(text.toLowerCase()).toContain("food");
      expect(text.toLowerCase()).toContain("wood");
    }
  });
});

describe("skill file validation", () => {
  it("accepts a reasonable doctrine", () => {
    expect(validateSkill("Send two settlers to wood before anything else.").ok).toBe(true);
  });

  it("rejects an empty file", () => {
    const v = validateSkill("   \n");
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it("rejects a file over 4000 characters", () => {
    const v = validateSkill("x".repeat(4001));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("4000");
  });

  it("rejects binary content", () => {
    expect(validateSkill("plans\u0000\u0000").ok).toBe(false);
  });
});

describe("the default skill file — creations", () => {
  it("teaches every civilization that it may invent", () => {
    const civs = [
      "roman", "greek", "egyptian", "norse", "japanese", "aztec", "mauryan", "mongol",
    ] as const;
    for (const civ of civs) {
      const text = defaultSkill(civ);
      expect(text).toContain("create order");
      expect(text.toLowerCase()).toContain("dispatch");
      expect(validateSkill(text).ok).toBe(true);
    }
  });
});
