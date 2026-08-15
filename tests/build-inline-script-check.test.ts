/**
 * The parser behind `build:inline-scripts:check`.
 *
 * The gate itself was proven against the real thing: run on the build that
 * shipped, it named `src/components/ThemeToggle.astro` as inlined, which was the
 * live defect. What that proof does NOT cover is the parser's edge cases, and
 * the parser is the fragile half — it walks a minified script body character by
 * character looking for the end of a JSON array, and script bodies are full of
 * brackets, quotes and escapes. A regex here would be the `js/bad-tag-filter`
 * mistake wearing a different hat, so the walker is tested directly against the
 * shapes that would break a naive one.
 */
import { describe, expect, test } from "bun:test";
import { extractInlinedScripts } from "../scripts/build-inline-script-check";

/** Wrap entries the way Astro serialises them inside `entry.mjs`. */
function manifest(entries: [string, string][]): string {
  return `const x = JSON.parse('{"routes":[],"inlinedScripts":${JSON.stringify(entries)},"compressHTML":true}');`;
}

describe("extractInlinedScripts", () => {
  test("an empty map yields nothing", () => {
    expect(extractInlinedScripts(manifest([]))).toEqual([]);
  });

  test("a manifest without the key yields nothing", () => {
    expect(extractInlinedScripts("const x = 1;")).toEqual([]);
  });

  test("finds a single inlined script and reports its id", () => {
    const found = extractInlinedScripts(
      manifest([
        ["/app/src/components/ThemeToggle.astro?astro&type=script", "var e=1;"]
      ])
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(
      "/app/src/components/ThemeToggle.astro?astro&type=script"
    );
    expect(found[0]?.bytes).toBe("var e=1;".length);
  });

  test("finds every entry when several are inlined", () => {
    const found = extractInlinedScripts(
      manifest([
        ["/app/a.astro?astro", "var a=1;"],
        ["/app/b.astro?astro", "var b=2;"],
        ["/app/c.astro?astro", "var c=3;"]
      ])
    );
    expect(found.map((s) => s.id)).toEqual([
      "/app/a.astro?astro",
      "/app/b.astro?astro",
      "/app/c.astro?astro"
    ]);
  });

  test("an empty body is NOT an inlined script", () => {
    // Astro writes a present-but-empty value to mean "resolve this externally".
    // Treating it as inlined would fail every build for a script that is
    // already doing the right thing.
    expect(
      extractInlinedScripts(manifest([["/app/a.astro?astro", ""]]))
    ).toEqual([]);
  });

  test("mixes empty and non-empty bodies correctly", () => {
    const found = extractInlinedScripts(
      manifest([
        ["/app/external.astro?astro", ""],
        ["/app/inlined.astro?astro", "var x=1;"]
      ])
    );
    expect(found.map((s) => s.id)).toEqual(["/app/inlined.astro?astro"]);
  });

  describe("bodies that would break a naive scan", () => {
    test.each([
      ["array literals", "var a=[1,[2,[3]]];"],
      ["object literals", "var o={a:{b:{c:1}}};"],
      ["a bracket inside a string", 'var s="]}]";'],
      ["an escaped quote", 'var s="he said \\"no\\"";'],
      ["a trailing backslash before the closing quote", 'var s="c:\\\\";'],
      ["a closing script tag", 'var s="<\\/script>";'],
      ["template literals", "var t=`awcms_theme`;"],
      ["a regex containing a bracket", "var r=/[\\]]/g;"]
    ])("survives %s", (_name, body) => {
      const found = extractInlinedScripts(
        manifest([["/app/a.astro?astro", body]])
      );
      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe("/app/a.astro?astro");
    });
  });

  test("stops at the end of the array and ignores later manifest keys", () => {
    const source = `${manifest([["/app/a.astro?astro", "var a=1;"]])} const later = {"inlinedScripts":"decoy"};`;
    expect(extractInlinedScripts(source)).toHaveLength(1);
  });

  test("the real defect shape is detected", () => {
    // Verbatim shape of what shipped: a minified body using template literals
    // for its string constants, which is what the folded `THEME_STORAGE_KEY`
    // import became.
    const body =
      "var e=`awcms_theme`,t=[`system`,`light`,`dark`],n={system:`🖥️`,light:`☀️`,dark:`🌙`};function r(e){return e===`light`}";
    const found = extractInlinedScripts(
      manifest([
        [
          "/home/data/dev_bun/awcms/src/components/ThemeToggle.astro?astro&type=script&index=0&lang.ts",
          body
        ]
      ])
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.bytes).toBe(body.length);
  });
});
