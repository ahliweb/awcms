/**
 * `extractTemplateText` — the scanner behind `i18n:screens:check`.
 *
 * This scanner answers a COVERAGE question ("which screens still render
 * English literals?"), and a coverage scanner fails in the one direction that
 * is hardest to notice: when it goes blind it reports FEWER findings, which
 * reads as progress. Three separate defects in it were shipped and corrected
 * during ADR-0095's rollout, each of that same shape. These tests pin the
 * behaviours whose absence would be silent.
 */
import { describe, expect, test } from "bun:test";

import { extractTemplateText } from "../scripts/i18n-screen-coverage-check";

const frontmatter = `---\nconst t = (value: string) => value;\n---\n`;

describe("extractTemplateText — regions that must be stripped", () => {
  test("a script block is not prose", () => {
    const texts = extractTemplateText(
      `${frontmatter}<p>Visible label</p><script>const hidden = "Not a label";</script>`
    );

    expect(texts).toContain("Visible label");
    expect(texts.join(" ")).not.toContain("Not a label");
  });

  /**
   * CodeQL `js/bad-tag-filter`, high severity, twice on PR #564 — once for the
   * whitespace form, then again for the attribute form.
   *
   * What closes a `<script>` is wider than `</script>`: the HTML tokeniser ends
   * the element at `</script` followed by whitespace or `/`, discarding
   * whatever precedes the `>`. Attributes on an end tag are ignored, not
   * rejected. So every form below really does close the script.
   *
   * Missing one is not a near-miss. The quantifier is lazy, so an unrecognised
   * close does not fail locally — it runs on to the NEXT close in the file and
   * swallows every line between. The literals in that span are then not
   * reported at all, and the gate's number goes DOWN.
   */
  test.each([
    ["plain", "</script>"],
    ["trailing space", "</script >"],
    ["tab and newline", "</script\t\n >"],
    ["ignored attribute", '</script\t\n bar="baz">'],
    ["stray solidus", "</script/>"]
  ])("a script closed by a %s end tag is stripped", (_name, close) => {
    const texts = extractTemplateText(
      `${frontmatter}<script>const a = "Swallowed";${close}\n` +
        `<p>Label after the close</p>\n` +
        `<script>const b = "Also swallowed";</script>`
    );

    expect(texts).toContain("Label after the close");
    expect(texts.join(" ")).not.toContain("Swallowed");
    expect(texts.join(" ")).not.toContain("Also swallowed");
  });

  test.each([
    ["plain", "</style>"],
    ["trailing space", "</style >"],
    ["ignored attribute", '</style media="all">']
  ])("a style closed by a %s end tag is stripped", (_name, close) => {
    const texts = extractTemplateText(
      `${frontmatter}<style>.a { content: "Styled"; }${close}\n<p>Label after style</p>`
    );

    expect(texts).toContain("Label after style");
    expect(texts.join(" ")).not.toContain("Styled");
  });

  test("JSX comments are prose ABOUT the template, not template text", () => {
    const texts = extractTemplateText(
      `${frontmatter}{/* Explains the escaping, in a full sentence. */}<p>Real label</p>`
    );

    expect(texts).toContain("Real label");
    expect(texts.join(" ")).not.toContain("Explains the escaping");
  });

  test("HTML comments are stripped", () => {
    const texts = extractTemplateText(
      `${frontmatter}<!-- A note to the next reader -->\n<p>Real label</p>`
    );

    expect(texts).toContain("Real label");
    expect(texts.join(" ")).not.toContain("A note to the next reader");
  });
});

describe("extractTemplateText — text the scanner must still see", () => {
  /**
   * The first version of this scanner skipped every `{...}` by counting brace
   * depth. It reported SEVEN literals on a dashboard holding more than thirty,
   * because the majority of admin-screen text lives inside a JSX conditional.
   */
  test("text inside a JSX conditional is not skipped", () => {
    const texts = extractTemplateText(
      `${frontmatter}{items.length === 0 ? <p>Nothing here yet</p> : <p>Some rows</p>}`
    );

    expect(texts).toContain("Nothing here yet");
    expect(texts).toContain("Some rows");
  });

  test("frontmatter is not template text", () => {
    const texts = extractTemplateText(
      `---\nconst heading = "A frontmatter string";\n---\n<h1>A rendered heading</h1>`
    );

    expect(texts).toContain("A rendered heading");
    expect(texts.join(" ")).not.toContain("A frontmatter string");
  });
});
