import type { Recap } from "../../server/recap";

const panel = document.getElementById("recap")!;
const line = document.getElementById("recap-line")!;
const list = document.getElementById("recap-list")!;
const close = document.getElementById("recap-close")!;

close.addEventListener("click", () => {
  panel.hidden = true;
});

/** The full "while you were gone" story, told by name. */
export function showRecap(recap: Recap): void {
  line.textContent = recap.line;
  list.replaceChildren(
    ...recap.events.map((e) => {
      const li = document.createElement("li");
      li.textContent = e.text;
      return li;
    }),
  );
  panel.hidden = false;
}
