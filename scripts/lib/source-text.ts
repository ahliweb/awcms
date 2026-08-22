/**
 * Reading a source file as TEXT, with the prose taken out — finding D2 of the
 * 17 August 2026 audit round.
 *
 * ## Why this is a shared module now
 *
 * Eight files carried their own `stripComments`, and the version most of them
 * carried was this one:
 *
 * ```ts
 * source
 *   .replace(/\/\*[\s\S]*?\*\//g, "")
 *   .split("\n")
 *   .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
 *   .join("\n");
 * ```
 *
 * The block-comment regex runs over the WHOLE file before anything knows about
 * strings, so a `/*` inside a string literal opens a comment that is closed by
 * the next `*\/` anywhere in the file — and everything between them is deleted.
 * A route glob is enough to trigger it:
 *
 * ```ts
 * const PARTNER_GLOB = "/api/v1/partner/**";
 *
 * await tx`INSERT INTO awcms_tenant_users (tenant_id) VALUES (${t})`;
 *
 * /** A docblock whose closing marker ends the accidental comment. *\/
 * ```
 *
 * Run through the naive stripper, that `INSERT INTO` **is gone**. Every gate
 * built on it — `modules:table-writes:check`, `access:chokepoint:check`,
 * `config:env:coverage:check`, `identity:principal-access:check`,
 * `access:grant-readers:check` — was scanning less than it claimed, silently,
 * on any file shaped like that.
 *
 * No gate signal differed on the day this was found. That is the point: it is a
 * fail-open that grows with every new docblock and every new glob constant, and
 * it reports nothing when it grows.
 *
 * ## What replaced it
 *
 * The scanner below, previously local to `i18n-catalog-check.ts`, which tracks
 * string state and therefore cannot be opened by a `/*` that is inside quotes.
 * It also blanks trailing `// …` comments, which the naive version deliberately
 * left alone — the naive one could not tell a trailing comment from the `//` in
 * `"https://…"`, so leaving them was the safer of two wrong answers. This one
 * can tell, so it does not have to choose.
 *
 * `tests/source-text-stripping.test.ts` holds both properties against a naive
 * oracle, including the case above.
 */

export function stripComments(source: string): string {
  const out = source.split("");
  let index = 0;

  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i += 1) {
      // Keep newlines: line numbers and the `[^"\\\n]` guards in LITERAL both
      // depend on line structure surviving.
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    // String literals — skipped whole, so their contents are never treated as
    // comment starts and never blanked.
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;

      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }

      continue;
    }

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }

    index += 1;
  }

  return out.join("");
}
