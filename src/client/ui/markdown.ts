/**
 * A doctrine-sized Markdown renderer for the rulebook editor's live preview.
 * Input is escaped before any formatting, so pasted HTML stays inert text.
 * Covers what doctrines use: #/##/### headings, paragraphs, - and 1. lists,
 * **bold**, *italic*, `code`, and --- rules. Nothing more on purpose.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of escapeHtml(src).split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList();
      out.push("<hr>");
    } else if (bullet) {
      if (list !== "ul") closeList();
      if (!list) out.push("<ul>");
      list = "ul";
      out.push(`<li>${inline(bullet[1]!)}</li>`);
    } else if (numbered) {
      if (list !== "ol") closeList();
      if (!list) out.push("<ol>");
      list = "ol";
      out.push(`<li>${inline(numbered[1]!)}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

/** Keep a preview element rendering the textarea live, scroll roughly synced. */
export function wirePreview(
  editor: HTMLTextAreaElement,
  preview: HTMLElement,
): () => void {
  const sync = () => {
    preview.innerHTML = renderMarkdown(editor.value);
  };
  editor.addEventListener("input", sync);
  editor.addEventListener("scroll", () => {
    const range = Math.max(1, editor.scrollHeight - editor.clientHeight);
    preview.scrollTop =
      (editor.scrollTop / range) * (preview.scrollHeight - preview.clientHeight);
  });
  sync();
  return sync;
}
