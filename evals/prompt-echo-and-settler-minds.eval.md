# Task: Every prompt echoes, and my words don't command the settlers

Send an ordinary work prompt (nothing to do with the game) and check my island
visibly reacts within 10 seconds. Then try to boss the settlers around by
prompt ("build me a dock") and confirm it changes nothing — the settlers decide
for themselves. Watch a construction pass through its three stages. Then use
the one lever I DO own — the rulebook file at `~/.claudilization/skill.md` —
and confirm editing it changes what the settlers prioritize, while a broken
file is set aside with a notice instead of being obeyed.

## Step-by-step:

1. With my island open in a browser, note the current story feed and what the
   settlers are doing.
2. In the Claude Code player console, send an unrelated prompt: "Write me a
   haiku about autumn."
3. The moment the prompt finishes, start counting. Watch the browser for a
   visible event on my island (feed entry, settler order, anything new).
4. Confirm at least one visible event happened within 10 seconds of the prompt
   finishing.
5. Send a second prompt: "Please build me a dock on my island right now."
6. Watch what the settlers do. A Stone Age island shouldn't suddenly produce a
   dock just because I asked; the settlers' next orders should look like normal
   island-driven decisions (gathering, building what the island needs).
7. Over the following minutes, if any construction starts, watch it: it should
   visibly pass through site-marked, under-construction, and complete stages.
8. Edit `~/.claudilization/skill.md` on my machine: add a clear priority such
   as "Send two settlers to gather wood before anything else." Send another
   ordinary prompt and watch the next orders: do they now lean toward wood
   gathering?
9. Now sabotage the rulebook: replace it with garbage (or something absurdly
   long). Send another prompt. The island should keep running on sensible
   defaults, and I should see a notice that my rulebook was set aside — it
   must never be silently obeyed or crash anything.
10. Restore a sane rulebook afterwards.

## Expected result:

- The haiku prompt — totally unrelated to the game — causes at least one
  visible event on my island within 10 seconds of finishing.
- Asking for a dock does not conjure a dock; settler orders reflect the
  island's needs, not my words. My prompt text has no influence.
- Any building that goes up visibly shows three stages: site marked, under
  construction, complete.
- Editing my rulebook visibly shifts settler priorities (e.g. wood gathering
  first) — my file is a real lever.
- A malformed or oversized rulebook is set aside with a notice; the island
  keeps living on defaults, and world laws (rates, costs, timers) never bend.
