/**
 * Two findings from the 17 August 2026 audit round that share a shape: a
 * control that was applied to the wrong copy, and a contract that no value
 * could satisfy.
 *
 * ## A6 — the feed and sitemap escaped as HTML, not as XML
 *
 * `escapeHtml` neutralises the five markup entities and passes C0 control
 * characters through. XML 1.0 forbids most of them ANYWHERE in a document,
 * including as a numeric reference (`&#x1;` is itself not well-formed). HTML
 * merely discourages them.
 *
 * `validateTitleField` checks a post title's LENGTH and nothing else, and there
 * is no write-side stripping, so one stray control character in one title made
 * the whole channel non-well-formed and every reader rejected it — not that
 * item, the feed.
 *
 * ADR-0038 named `escapeXmlText` for exactly this. It was applied to the
 * `seo_distribution` serializers, which answer **404** in production, and not to
 * `/blog/{tenantCode}/feed.xml` and `sitemap-blog.xml`, which answer **200**.
 * The route's own docblock asserted the equivalence ("XML and HTML share the
 * same five entity escapes") — true, and not the whole difference.
 *
 * ## D3 — no value of `LOG_LEVEL` both validated and worked
 *
 * `config:validate` accepted `warn`. The logger implements `warning`. So
 * `LOG_LEVEL=warn` passed the validated contract, matched no level, fell back
 * to `info`, and the firehose kept shipping while the operator believed it was
 * quiet — and `LOG_LEVEL=warning`, the value that would have worked, was
 * rejected.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { escapeHtml, escapeXmlText } from "../src/lib/html/escape";
import { resetLogLevelAliasWarningForTests } from "../src/lib/logging/logger";

const XML_ROUTES = [
  "src/pages/blog/[tenantCode]/feed.xml.ts",
  "src/pages/blog/[tenantCode]/sitemap-blog.xml.ts"
];

describe("A6 — the XML routes escape as XML", () => {
  test("a C0 control character survives escapeHtml and does not survive escapeXmlText", () => {
    // Written as an escape, not as a literal: a raw U+0001 in a source file is
    // invisible in review and does not survive every editor that touches it —
    // which is the same reason it reaches a post title in the first place.
    const title = `Banjir\u0001 Kobar`;

    expect(escapeHtml(title)).toContain("\u0001");
    expect(escapeXmlText(title)).not.toContain("\u0001");
    expect(escapeXmlText(title)).toBe("Banjir Kobar");
  });

  test("every XML-1.0-illegal C0 character is removed, not just the obvious one", () => {
    // U+0000-U+0008, U+000B, U+000C, U+000E-U+001F. Enumerated because "strip
    // control characters" is the kind of rule a regex gets 90% right.
    const illegal = [
      ...Array.from({ length: 9 }, (_, i) => String.fromCharCode(i)),
      "\u000B",
      "\u000C",
      ...Array.from({ length: 18 }, (_, i) => String.fromCharCode(0x0e + i))
    ];

    for (const char of illegal) {
      expect(escapeXmlText(`a${char}b`)).toBe("ab");
    }
  });

  test("the three XML-legal control characters are kept", () => {
    // TAB, LF and CR are legal XML 1.0 characters. Stripping them would corrupt
    // multi-line text for no reason, which is the failure mode of a blunt
    // "remove all control characters".
    expect(escapeXmlText("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  test("entity escaping still happens", () => {
    // NON-VACUOUS: a function that only stripped control characters would pass
    // the assertions above and leave the markup injection it exists to stop.
    expect(escapeXmlText('<a href="x">&</a>')).not.toContain("<a href");
    expect(escapeXmlText("&")).toBe("&amp;");
  });

  test("neither XML route calls escapeHtml any more", async () => {
    for (const route of XML_ROUTES) {
      const source = await Bun.file(route).text();
      const code = source
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return (
            !trimmed.startsWith("*") &&
            !trimmed.startsWith("//") &&
            !trimmed.startsWith("/*")
          );
        })
        .join("\n");

      expect(code).not.toContain("escapeHtml(");
      expect(code).toContain("escapeXmlText(");
    }
  });

  test("the docblock no longer claims the two are interchangeable", async () => {
    // The sentence was the reason the wrong function looked right. A false
    // comment beside correct code is the next author's instruction.
    const source = await Bun.file(XML_ROUTES[0]!).text();

    expect(source).not.toContain(
      "same `escapeHtml` used for HTML (XML and HTML share the same five"
    );
  });
});

describe("D3 — LOG_LEVEL has a value that both validates and works", () => {
  const previous = process.env.LOG_LEVEL;

  afterEach(() => {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
    resetLogLevelAliasWarningForTests();
  });

  test("the validator accepts the level the logger implements", async () => {
    const source = await Bun.file("scripts/validate-env.ts").text();
    const block = source.slice(
      source.indexOf('name: "LOG_LEVEL"'),
      source.indexOf('name: "AUDIT_LOG_RETENTION_DAYS"')
    );

    // Before D3 this list held `warn` and NOT `warning`.
    expect(block).toContain('"warning"');
  });

  test("`warn` is still accepted, so a running deployment does not start failing config:validate", async () => {
    const source = await Bun.file("scripts/validate-env.ts").text();
    const block = source.slice(
      source.indexOf('name: "LOG_LEVEL"'),
      source.indexOf('name: "AUDIT_LOG_RETENTION_DAYS"')
    );

    expect(block).toContain('"warn"');
  });

  test("`warn` now actually raises the threshold instead of falling back to info", async () => {
    // The defect itself: an `info` line under LOG_LEVEL=warn used to be printed.
    process.env.LOG_LEVEL = "warn";
    resetLogLevelAliasWarningForTests();

    const { log } = await import("../src/lib/logging/logger");
    const lines = captureStdout(() => log("info", "should.be.suppressed"));

    expect(lines.join("")).not.toContain("should.be.suppressed");
  });

  test("`warning` works too", async () => {
    process.env.LOG_LEVEL = "warning";

    const { log } = await import("../src/lib/logging/logger");
    const lines = captureStdout(() => log("info", "should.be.suppressed"));

    expect(lines.join("")).not.toContain("should.be.suppressed");
  });

  test("NON-VACUOUS: an info line IS printed at the default level", async () => {
    // Without this, a logger that printed nothing at all would satisfy both
    // assertions above.
    delete process.env.LOG_LEVEL;

    const { log } = await import("../src/lib/logging/logger");
    const lines = captureStdout(() => log("info", "should.be.printed"));

    expect(lines.join("")).toContain("should.be.printed");
  });

  test("an unrecognised value still falls back to info rather than silencing everything", async () => {
    // The safe direction: the alternative is a deployment that logs nothing
    // because somebody typed `infoo`.
    process.env.LOG_LEVEL = "infoo";

    const { log } = await import("../src/lib/logging/logger");
    const lines = captureStdout(() => log("info", "still.printed"));

    expect(lines.join("")).toContain("still.printed");
  });
});

function captureStdout(run: () => void): string[] {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  console.error = () => {};

  try {
    run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return lines;
}
