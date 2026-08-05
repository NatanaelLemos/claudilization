/**
 * The spectator's way in — a three-screen wizard in the old style:
 * the title screen, then a people and an island name (each people suggests
 * one from its own tongue), then the doctrine in a live Markdown editor.
 * Install hands over ONE prompt for Claude Code that sets everything up —
 * client install, doctrine saved, joined under the chosen name, link
 * returned. The doctrine travels inside the prompt; the server never
 * stores it.
 */
import { CIVS } from "../../shared/civs";
import { defaultSkill, SKILL_MAX_CHARS, validateSkill } from "../../shared/skill";
import { CIV_IDS, type CivId } from "../../shared/types";
import { publicRoot } from "../base";
import { wirePreview } from "./markdown";

/** Quote an arbitrary value as one POSIX-shell argument. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function setupPrompt(
  origin: string,
  civ: CivId,
  islandName: string,
  skill: string,
): string {
  const name = islandName.trim().slice(0, 40);
  const installUrl = shellQuote(`${origin}/install.sh`);
  const serverUrl = shellQuote(origin);
  const quotedName = shellQuote(name);
  return [
    `Set up the Claudilization game for me, all in this one turn:`,
    ``,
    `1. THE GUARD, before anything else: if the file ~/.claudilization/identity.json exists, I ALREADY have a civilization. In that case STOP here — install nothing, overwrite nothing — and tell me my island's name (islandName in that file) and that I can reshape my existing civilization with /claudilization update instead.`,
    ``,
    `2. Install the client:`,
    `   install_script="$(mktemp)"`,
    `   curl -fsS ${installUrl} -o "$install_script"`,
    `   Review the downloaded script, then run: sh "$install_script" && rm -f "$install_script"`,
    ``,
    `3. Join the world (this command itself refuses if a civilization already exists on this machine):`,
    `   npx tsx ~/.claudilization/app/src/mcp/cli.ts join ${civ} ${serverUrl} ${quotedName}`,
    `   If it refuses, STOP — skip every remaining step, change no files, and tell me what it said.`,
    ``,
    `4. Save my civilization's doctrine — write everything between the SKILL markers, exactly as-is, to ~/.claudilization/skill.md:`,
    `   ---SKILL---`,
    skill,
    `   ---SKILL---`,
    ``,
    `5. Then tell me my island's name and my personal link (the join command prints both), and that from now on every prompt I complete feeds my island.`,
  ].join("\n");
}

/** One name from the people's own bank — `roll` in [0,1) picks which. */
export function suggestName(civ: CivId, roll: number): string {
  const bank = CIVS[civ].islandNames;
  return bank[Math.floor(roll * bank.length) % bank.length]!;
}

export function initJoinFlow(): void {
  const playBtn = document.getElementById("play-button")!;
  const modal = document.getElementById("join-modal")!;
  const steps = {
    logo: document.getElementById("wiz-logo")!,
    howto: document.getElementById("wiz-howto")!,
    people: document.getElementById("wiz-people")!,
    doctrine: document.getElementById("wiz-doctrine")!,
  };
  const chips = document.getElementById("civ-chips")!;
  const nameInput = document.getElementById("island-name") as HTMLInputElement;
  const editor = document.getElementById("skill-editor") as HTMLTextAreaElement;
  const preview = document.getElementById("skill-preview")!;
  const status = document.getElementById("skill-status")!;
  const installBtn = document.getElementById("install-btn")!;
  const out = document.getElementById("install-out")!;
  const promptEl = document.getElementById("install-prompt")!;
  const copyBtn = document.getElementById("copy-prompt")!;

  let civ: CivId = "roman";
  let skillEdited = false;
  let nameEdited = false;

  function show(step: keyof typeof steps): void {
    for (const [key, el] of Object.entries(steps)) el.hidden = key !== step;
  }

  for (const id of CIV_IDS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = CIVS[id].label;
    chip.dataset.civ = id;
    if (id === civ) chip.dataset.active = "true";
    chip.addEventListener("click", () => {
      civ = id;
      for (const c of chips.children) delete (c as HTMLElement).dataset.active;
      chip.dataset.active = "true";
      // every people offers a name of its own — rerolled on every pick,
      // but a name the player typed themselves is never overwritten
      if (!nameEdited) nameInput.value = suggestName(civ, Math.random());
      if (!skillEdited) {
        editor.value = defaultSkill(civ);
        refreshPreview();
      }
      refreshStatus();
    });
    chips.append(chip);
  }

  const refreshPreview = wirePreview(editor, preview);

  function refreshStatus(): void {
    const v = validateSkill(editor.value);
    status.textContent = v.ok
      ? `${editor.value.length} / ${SKILL_MAX_CHARS} characters`
      : `Not usable yet — ${v.reason}.`;
  }

  nameInput.value = suggestName(civ, Math.random());
  editor.value = defaultSkill(civ);
  refreshPreview();
  refreshStatus();

  nameInput.addEventListener("input", () => {
    nameEdited = nameInput.value.trim().length > 0;
    out.hidden = true;
  });
  editor.addEventListener("input", () => {
    skillEdited = true;
    out.hidden = true;
    refreshStatus();
  });

  playBtn.hidden = false;
  playBtn.addEventListener("click", () => {
    show("logo");
    modal.hidden = false;
  });
  for (const id of ["logo-close", "modal-close"]) {
    document.getElementById(id)!.addEventListener("click", () => {
      modal.hidden = true;
    });
  }
  document.getElementById("wiz-begin")!.addEventListener("click", () => show("howto"));
  document.getElementById("wiz-howto-next")!.addEventListener("click", () => show("people"));
  document.getElementById("wiz-howto-back")!.addEventListener("click", () => show("logo"));
  document.getElementById("wiz-back-howto")!.addEventListener("click", () => show("howto"));
  document
    .getElementById("wiz-to-doctrine")!
    .addEventListener("click", () => show("doctrine"));
  document
    .getElementById("wiz-back-people")!
    .addEventListener("click", () => show("people"));

  installBtn.addEventListener("click", () => {
    const v = validateSkill(editor.value);
    if (!v.ok) {
      refreshStatus();
      return;
    }
    const name = nameInput.value.trim() || suggestName(civ, Math.random());
    // the world's public address includes any host prefix we are mounted under
    promptEl.textContent = setupPrompt(publicRoot(), civ, name, editor.value);
    out.hidden = false;
    out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  copyBtn.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(promptEl.textContent ?? "")
      .then(() => (copyBtn.textContent = "Copied!"))
      .catch(() => {
        const range = document.createRange();
        range.selectNodeContents(promptEl);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      });
  });
}
