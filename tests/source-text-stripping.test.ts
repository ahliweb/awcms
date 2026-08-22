/**
 * One comment stripper, and it does not eat code — finding D2 of the
 * 17 August 2026 audit round.
 *
 * ## The defect, in five lines
 *
 * Eight files carried their own `stripComments`, and the version most of them
 * carried started by running a block-comment regex over the WHOLE file:
 *
 * ```ts
 * source.replace(/\/\*[\s\S]*?\*\//g, "")
 * ```
 *
 * Nothing there knows about strings. A `/*` inside a string literal opens a
 * comment that is closed by the next `*` + `/` anywhere in the file, and
 * everything between them is deleted. A route glob is enough to trigger it, and
 * route globs are ordinary.
 *
 * ## What it actually cost, on a real file
 *
 * `src/modules/blog-content/module.ts` loses **7,260 characters** and 57 lines
 * to the naive stripper — including its entire `jobs:` and `capabilities:`
 * declarations. Every gate built on that stripper was reading a module
 * descriptor with the module's jobs missing, and reporting OK.
 *
 * Across `src/`, 29 files lose more than 200 characters.
 *
 * **No gate signal differed on the day this was found.** That is the point. It
 * is a fail-open that grows with every new docblock and every new glob
 * constant, and it reports nothing as it grows.
 *
 * ## Why the naive version is kept HERE
 *
 * As an oracle. A test that only exercised the good stripper would assert that
 * it works, which is easy and uninformative; comparing the two on the same input
 * is what shows the difference is real and what would notice if somebody
 * reintroduced the shortcut.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/lib/source-text";

/** The implementation this replaced, kept as the oracle and nowhere else. */
function naiveStripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
    .join("\n");
}

describe("the swallowing case, minimised", () => {
  const sample = [
    'const PARTNER_GLOB = "/api/v1/partner/**";',
    "",
    "await tx`INSERT INTO awcms_tenant_users (tenant_id) VALUES (${t})`;",
    "",
    "/** A docblock whose closing marker ends the accidental comment. */",
    "export const AFTER = 1;"
  ].join("\n");

  test("the naive stripper deletes a real INSERT", () => {
    // Asserted, not described: this is the behaviour five gates were built on.
    expect(naiveStripComments(sample)).not.toContain("INSERT INTO");
  });

  test("the shared stripper keeps it", () => {
    expect(stripComments(sample)).toContain("INSERT INTO awcms_tenant_users");
  });

  test("and still removes the docblock", () => {
    // NON-VACUOUS: a stripper that returned its input unchanged would pass the
    // assertion above and be useless.
    expect(stripComments(sample)).not.toContain("accidental comment");
  });
});

describe("string state is what makes the difference", () => {
  test("a `//` inside a string does not start a comment", () => {
    // The failure this guards is a FALSE NEGATIVE in a coverage gate: blanking
    // from `https://` to end of line hides whatever followed on that line.
    const source = 'const url = "https://example.test/a"; const key = "kept";';

    expect(stripComments(source)).toContain('"kept"');
  });

  test("a trailing comment after code IS removed", () => {
    // The naive version left these alone deliberately — it could not tell a
    // trailing comment from the `//` in a URL, so leaving them was the safer of
    // two wrong answers. This one can tell, so it does not have to choose.
    const source = 'const key = "kept"; // t("NotADeclaration")';
    const stripped = stripComments(source);

    expect(stripped).toContain('"kept"');
    expect(stripped).not.toContain("NotADeclaration");
  });

  test("offsets and line structure survive", () => {
    // Blanking rather than deleting is what lets a caller match with a regex and
    // still report a line number, and what stops a removed comment splicing two
    // tokens into a third that matches.
    const source = [
      "const a = 1; /* gone */ const b = 2;",
      "const c = 3;"
    ].join("\n");
    const stripped = stripComments(source);

    expect(stripped).toHaveLength(source.length);
    expect(stripped.split("\n")).toHaveLength(2);
    expect(stripped).toContain("const a = 1;");
    expect(stripped).toContain("const b = 2;");
    expect(stripped).not.toContain("gone");
  });

  test("an unterminated block comment blanks to the end, not past it", () => {
    const source = "const a = 1;\n/* never closed\nconst b = 2;";
    const stripped = stripComments(source);

    expect(stripped).toContain("const a = 1;");
    expect(stripped).not.toContain("const b = 2;");
    expect(stripped).toHaveLength(source.length);
  });
});

describe("the cost on a real file in this repository", () => {
  test("a module descriptor loses its jobs and capabilities to the naive stripper", async () => {
    // The single most useful fact in this file: a gate scanning module
    // descriptors through the naive stripper could not see this module's jobs.
    const source = await Bun.file("src/modules/blog-content/module.ts").text();

    const aware = stripComments(source);
    const naive = naiveStripComments(source);

    expect(aware).toContain("jobs:");
    expect(aware).toContain("capabilities:");
    expect(naive).not.toContain("jobs:");
    expect(naive).not.toContain("capabilities:");
  });

  test("it is not one unlucky file", async () => {
    const affected: string[] = [];

    for await (const file of walk("src")) {
      const source = await Bun.file(file).text();
      const lost =
        stripComments(source).replace(/\s+/g, " ").trim().length -
        naiveStripComments(source).replace(/\s+/g, " ").trim().length;

      if (lost > 200) affected.push(file);
    }

    // Measured at 29 when this landed. Asserted as a floor rather than an exact
    // number: pinning the count would make an unrelated comment edit fail this
    // test, which is how a ledger becomes an off-switch.
    expect(affected.length).toBeGreaterThan(20);
  });
});

describe("there is exactly one implementation", () => {
  test("no file defines its own stripComments", async () => {
    const offenders: string[] = [];

    for (const root of ["scripts", "src", "tests"]) {
      for await (const file of walk(root)) {
        if (file.endsWith(path.join("scripts", "lib", "source-text.ts"))) {
          continue;
        }
        // This file's oracle is deliberately local and deliberately named
        // something else, so it cannot be mistaken for a fourth copy.
        if (file.endsWith("source-text-stripping.test.ts")) continue;

        const source = await Bun.file(file).text();

        if (/function stripComments\s*\(/.test(source)) offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".astro")) {
      yield full;
    }
  }
}
