import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown — the doctrine preview", () => {
  it("renders headings, paragraphs, and emphasis", () => {
    const html = renderMarkdown("# The Way\n\nWalk **boldly** and *softly* with `care`.");
    expect(html).toContain("<h1>The Way</h1>");
    expect(html).toContain("<strong>boldly</strong>");
    expect(html).toContain("<em>softly</em>");
    expect(html).toContain("<code>care</code>");
  });

  it("groups list lines into one list and closes it on a blank line", () => {
    const html = renderMarkdown("- feed the people\n- house the people\n\nThen rest.");
    expect(html).toContain("<ul>\n<li>feed the people</li>\n<li>house the people</li>\n</ul>");
    expect(html).toContain("<p>Then rest.</p>");
  });

  it("numbers ordered lists and draws rules", () => {
    const html = renderMarkdown("1. first\n2. second\n---");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("<hr>");
  });

  it("keeps pasted HTML inert — everything is escaped first", () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> and **<b>bold</b>**');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>&lt;b&gt;bold&lt;/b&gt;</strong>");
  });
});
