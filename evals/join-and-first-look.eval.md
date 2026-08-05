# Task: Join the world and see my brand-new Stone Age island

As a brand-new visitor, use the Play button flow in the browser to see how one
would get started, then join Claudilization from inside Claude Code by picking
a civilization, open my personal link, and check that my island looks the way a
brand-new island is promised to look — and that joining wrote my civilization's
starter rulebook onto my machine.

## Step-by-step:

1. Before joining anything, open http://localhost:8787 in a fresh browser (no
   key in the URL). Look for a **Play** button.
2. Click Play. It should open the civilization's rulebook in an in-browser
   editor. Pick a civilization (Norse) and watch the editor pre-fill with that
   civ's default doctrine. Skim the text — does it read like a strategy I could
   tweak?
3. Press **Install**. Read the single copy-paste prompt the game hands over.
   Judge it as a user: does it look like one complete prompt that downloads the
   client, installs the hook and tools, saves my edited rulebook, joins my
   chosen civilization, and promises back my island name and personal link?
   (Do NOT actually run it — my Claude Code console is already set up.)
4. In the Claude Code player console, type: "Please join claudilization as the
   norse civilization" and wait for the reply.
5. Read the reply. Note the island's name and the personal link it gives me.
6. Check my machine: a starter rulebook should now exist at
   `~/.claudilization/skill.md`, written in a general-strategy style flavored
   to the Norse.
7. Open the personal link in a browser.
8. Look at what's on screen: where is the camera pointing, what is the island
   named, what age is shown. Confirm the Play button and install flow are NOT
   shown to me here.
9. Count the settlers on my island and check their names.
10. Look for buildings (there should be none) and for untouched nature: trees,
    rocks, wild food.

## Expected result:

- A logged-out visitor sees a Play button; it opens a rulebook editor with a
  civilization picker and per-civ default doctrine; Install produces one
  complete, trustworthy copy-paste prompt for Claude Code.
- The reply to a single "join" prompt contains my island's name (Norse-flavored)
  and a personal link. No signup form, no password.
- Joining wrote `~/.claudilization/skill.md` — a Norse-flavored starter
  strategy I own and can edit.
- Opening the link lands the camera centered on my own island, with no Play
  button or install flow shown.
- The island is in the Stone Age, with exactly 10 settlers, each with a unique
  Norse-styled name, all visible.
- No buildings anywhere; the island has trees, rock deposits, and wild food
  sources.
