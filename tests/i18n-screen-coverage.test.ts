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
   * CodeQL `js/bad-tag-filter`, high severity, caught on PR #564.
   *
   * HTML permits whitespace before the `>` of a closing tag, so `</script >`
   * really does close a script. A pattern demanding `</script>` exactly does
   * not merely fail to strip that one block — being lazy, it runs on to the
   * NEXT closing tag in the file and swallows every line in between. The
   * literals inside that swallowed span are then never counted, and the gate
   * reports a smaller number with no indication that it stopped looking.
   */
  test("a closing tag with whitespace before `>` still closes the block", () => {
    const texts = extractTemplateText(
      `${frontmatter}<script>const a = "Swallowed";</script >\n` +
        `<p>Label after a spaced close</p>\n` +
        `<script>const b = "Also swallowed";</script>`
    );

    expect(texts).toContain("Label after a spaced close");
    expect(texts.join(" ")).not.toContain("Swallowed");
    expect(texts.join(" ")).not.toContain("Also swallowed");
  });

  test("the same tolerance applies to `</style >`", () => {
    const texts = extractTemplateText(
      `${frontmatter}<style>.a { content: "Styled"; }</style >\n<p>Label after style</p>`
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
