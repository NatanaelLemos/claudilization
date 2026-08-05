const list = document.getElementById("chat-list")!;
const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("chat-input") as HTMLInputElement;
const MAX = 60;

/** Players get the input; spectators simply have no way to write. */
export function initChat(canWrite: boolean, send: (text: string) => void): void {
  form.hidden = !canWrite;
  if (!canWrite) return;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send(text);
    input.value = "";
  });
}

export function addChatMessage(from: string, text: string): void {
  const li = document.createElement("li");
  const who = document.createElement("b");
  who.textContent = from;
  li.append(who, document.createTextNode(` ${text}`));
  list.append(li);
  while (list.children.length > MAX) list.firstElementChild?.remove();
  list.scrollTop = list.scrollHeight;
}
