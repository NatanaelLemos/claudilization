/**
 * The owner's visual editor. `/claudilization update` stages the local
 * doctrine on the server (owner-signed), then the playerUrl with `&edit=1`
 * opens this modal prefilled with the island's current name and doctrine.
 * Update produces ONE prompt for Claude Code that replaces what was
 * installed before — it never re-joins, so the civilization and everything
 * it has built stay exactly as they are.
 */
import { SKILL_MAX_CHARS, validateSkill } from "../../shared/skill";
import { apiUrl } from "../base";
import { wirePreview } from "./markdown";

export function updatePrompt(
  currentName: string,
  newName: string,
  skill: string,
): string {
  const renamed = newName !== currentName;
  return [
    `Update my Claudilization civilization — apply my edited settings, all in this one turn.`,
    `IMPORTANT: my island already exists. Never POST /api/join and never create a new`,
    `civilization — only the doctrine${renamed ? " and name" : ""} below change; the island keeps its people,`,
    `buildings, stocks, and colonies untouched.`,
    ``,
    `1. Replace my doctrine — overwrite ~/.claudilization/skill.md with everything between the SKILL markers, exactly as-is:`,
    `   ---SKILL---`,
    skill,
    `   ---SKILL---`,
    ``,
    ...(renamed
      ? [
          `2. Rename my island to "${newName}" with the owner CLI (it signs the request; app lives at ~/.claudilization/app, or the repo during development):`,
          `   npx tsx ~/.claudilization/app/src/mcp/cli.ts rename "${newName}"`,
          ``,
          `3. Touch nothing else — no other file, no other endpoint.`,
          ``,
          `4. Confirm: the new doctrine rules from the next decision step, the island now sails as "${newName}", and everything it had is still there.`,
        ]
      : [
          `2. Touch nothing else — no other file, no other endpoint.`,
          ``,
          `3. Confirm: the new doctrine rules from the next decision step, and everything the island had is still there.`,
        ]),
  ].join("\n");
}

export async function initUpdateFlow(key: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/update-draft?secret=${encodeURIComponent(key)}`));
  if (!res.ok) return; // not the owner — the editor stays closed
  const current = (await res.json()) as { name: string; doctrine: string | null };

  const modal = document.getElementById("join-modal")!;
  const title = document.getElementById("doctrine-title")!;
  const intro = document.getElementById("doctrine-intro")!;
  const nameRow = document.getElementById("edit-name-row")!;
  const nameInput = document.getElementById("edit-name") as HTMLInputElement;
  const editor = document.getElementById("skill-editor") as HTMLTextAreaElement;
  const preview = document.getElementById("skill-preview")!;
  const status = document.getElementById("skill-status")!;
  const updateBtn = document.getElementById("install-btn")!;
  const closeBtn = document.getElementById("modal-close")!;
  const backBtn = document.getElementById("wiz-back-people")!;
  const out = document.getElementById("install-out")!;
  const outIntro = out.querySelector("p")!;
  const promptEl = document.getElementById("install-prompt")!;
  const copyBtn = document.getElementById("copy-prompt")!;

  // the owner walks straight into the doctrine page — no wizard, no rejoin
  document.getElementById("wiz-logo")!.hidden = true;
  document.getElementById("wiz-howto")!.hidden = true;
  document.getElementById("wiz-people")!.hidden = true;
  document.getElementById("wiz-doctrine")!.hidden = false;
  backBtn.hidden = true;

  title.textContent = "Update your civilization";
  intro.textContent =
    "Edit your island's name and doctrine. Nothing you built is touched — " +
    "this only changes how your settlers decide from now on.";
  nameRow.hidden = false;
  nameInput.value = current.name;
  editor.value =
    current.doctrine ??
    "# Run /claudilization update in Claude Code first to load your current doctrine here.";
  updateBtn.textContent = "Update";
  outIntro.textContent =
    "Paste this one prompt into Claude Code — it replaces your installed " +
    "doctrine (and name, if you changed it) and leaves your island exactly as it is:";

  const refreshPreview = wirePreview(editor, preview);

  function refreshStatus(): void {
    const v = validateSkill(editor.value);
    status.textContent = v.ok
      ? `${editor.value.length} / ${SKILL_MAX_CHARS} characters`
      : `Not usable yet — ${v.reason}.`;
  }
  refreshPreview();
  refreshStatus();
  editor.addEventListener("input", () => {
    out.hidden = true;
    refreshStatus();
  });
  nameInput.addEventListener("input", () => {
    out.hidden = true;
  });

  updateBtn.addEventListener("click", () => {
    const v = validateSkill(editor.value);
    if (!v.ok) {
      refreshStatus();
      return;
    }
    const newName = nameInput.value.trim() || current.name;
    promptEl.textContent = updatePrompt(current.name, newName, editor.value);
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

  closeBtn.addEventListener("click", () => {
    modal.hidden = true;
  });
  modal.hidden = false;
}
