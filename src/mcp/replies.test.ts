import { describe, expect, it } from "vitest";
import { joinReply, syncStateReply } from "./replies";

const data = {
  islandName: "Barufjord",
  isNew: true,
  playerUrl: "http://localhost:8787/?key=s-1",
  watchUrl: "http://localhost:8787/",
};

describe("join reply", () => {
  it("hands the player their island name and both links, with a verbatim relay instruction", () => {
    const text = joinReply(data);
    expect(text).toContain("Barufjord");
    expect(text).toContain(data.playerUrl);
    expect(text).toContain(data.watchUrl);
    expect(text.toLowerCase()).toContain("verbatim");
  });

  it("welcomes a returning player back — links included again", () => {
    const text = joinReply({ ...data, isNew: false });
    expect(text).toContain("Welcome back");
    expect(text).toContain("Barufjord");
    expect(text).toContain(data.playerUrl);
  });
});

describe("sync state reply", () => {
  it("surfaces a recap line and tells the assistant to relay it", () => {
    const state = { recapLine: "While you were away: Olaf raised a hut." };
    const text = syncStateReply(state);
    expect(text).toContain(state.recapLine);
    expect(text.toLowerCase()).toContain("relay");
  });

  it("stays quiet about recaps when there is none", () => {
    const text = syncStateReply({ recapLine: null });
    expect(text.toLowerCase()).not.toContain("while you were away");
    expect(text).toContain("orders");
  });
});

describe("the ruling doctrine (skill file) in sync replies", () => {
  const state = { recapLine: null };

  it("quotes a valid doctrine and follows it with the hard-rules charter", () => {
    const text = syncStateReply(state, { text: "Send two settlers to wood before anything else." });
    expect(text).toContain("Send two settlers to wood");
    expect(text.toLowerCase()).toContain("doctrine");
    expect(text.toLowerCase()).toContain("server law");
  });

  it("sets aside an invalid doctrine with the reason, quoting nothing", () => {
    const text = syncStateReply(state, { setAside: "over 4000 characters" });
    expect(text.toLowerCase()).toContain("set aside");
    expect(text).toContain("over 4000 characters");
    expect(text.toLowerCase()).not.toContain("doctrine —");
  });

  it("says nothing about doctrines when there is no skill file", () => {
    const text = syncStateReply(state);
    expect(text.toLowerCase()).not.toContain("doctrine");
    expect(text.toLowerCase()).not.toContain("set aside");
  });
});

describe("join reply — the skill file", () => {
  it("tells the player where their civilization's strategy lives", () => {
    expect(joinReply(data)).toContain("skill.md");
  });
});
