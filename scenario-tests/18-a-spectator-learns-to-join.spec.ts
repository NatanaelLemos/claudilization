// Behavior 18 (revised): a spectator gets a Play button; it opens the
// rulebook editor; Install yields ONE setup prompt carrying the edited
// doctrine; the server serves the installer and the client archive.
import { expect, test } from "@playwright/test";
import { joinGame } from "./helpers/driver";

const BASE = "http://localhost:8790";

test("Play walks the wizard: title screen, a people and a name, the doctrine, one prompt", async ({ page }) => {
  await page.goto("/");
  const play = page.getByTestId("play-button");
  await expect(play).toBeVisible();
  await play.click();

  // step 1 — the title screen
  await expect(page.getByTestId("wiz-logo")).toBeVisible();
  await expect(page.getByTestId("wiz-logo")).toContainText(/Sad Meh-ier's/i);
  await expect(page.getByTestId("wiz-logo")).toContainText(/Claudilization/i);
  await page.getByTestId("wiz-begin").click();

  // step 2 — how to play, before any customization
  await expect(page.getByTestId("wiz-howto")).toBeVisible();
  await expect(page.getByTestId("wiz-howto")).toContainText(/How to play/i);
  await expect(page.getByTestId("wiz-howto")).toContainText(/Play by prompting/i);
  await page.getByTestId("wiz-howto-next").click();

  // step 3 — pick a people; each suggests a name from its own bank
  const name = page.getByTestId("island-name");
  await expect(name).toBeVisible();
  await expect(name).not.toHaveValue("");
  await page.locator('#civ-chips button[data-civ="norse"]').click();
  await name.fill("Testholm");
  await page.getByTestId("wiz-next").click();

  // step 3 — the doctrine, with a live Markdown preview
  const editor = page.getByTestId("skill-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(/Norse/);
  await expect(page.getByTestId("skill-preview")).toContainText(/Norse/);

  const doctrine = "Send two settlers to wood before anything else.";
  await editor.fill(doctrine);
  await page.getByTestId("install-btn").click();

  const prompt = page.getByTestId("install-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("Review the downloaded script");
  await expect(prompt).not.toContainText("| sh");
  await expect(prompt).toContainText(doctrine);
  await expect(prompt).toContainText('cli.ts join norse');
  await expect(prompt).toContainText("'Testholm'");
  await expect(page.locator("#copy-prompt")).toBeVisible();

  // players on their personal link see none of this
  const player = await joinGame("japanese");
  await page.goto(`/?key=${player.secret}`);
  await expect(page.getByTestId("play-button")).toBeHidden();
});

test("the installer script and client archive are really served", async () => {
  const sh = await fetch(`${BASE}/install.sh`);
  expect(sh.ok).toBe(true);
  const script = await sh.text();
  expect(script).toContain("claudilization.tgz");
  expect(script).toContain("claude mcp add");
  expect(script).toContain("Archive checksum mismatch");
  expect(script).not.toContain("| tar");

  const tgz = await fetch(`${BASE}/claudilization.tgz`);
  expect(tgz.ok).toBe(true);
  const bytes = await tgz.arrayBuffer();
  expect(bytes.byteLength).toBeGreaterThan(10_000);
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  expect(script).toContain(digest);
});
