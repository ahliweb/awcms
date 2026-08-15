#!/usr/bin/env bun
/**
 * `bun run i18n:screens:check` — ADR-0095, the coverage half.
 *
 * `i18n:catalog:check` answers "is every msgid the code ASKS FOR declared?" —
 * consistency. It says nothing about the English sentence sitting in a template
 * that nobody ever wrapped in `t()`, and its own header records that fusing the
 * two would produce a gate that is green while every answer it gives is wrong.
 *
 * This is the other question: **which admin screens still render untranslated
 * literal text?** It is deliberately a SEPARATE gate with a SEPARATE ledger.
 *
 * ## Why a ledger rather than a pass/fail
 *
 * Forty-three screens carry roughly 1,300 literal strings between them. A gate
 * that demanded all of them at once would have exactly two outcomes: the whole
 * i18n capability waits months behind one enormous unreviewable change, or the
 * gate is switched off. The ledger takes the third option — every screen not yet
 * translated is NAMED, the count may only SHRINK, and a newly added screen has
 * to be translated because it cannot join a list that never grows.
 *
 * That is the same instrument ADR-0094 used to take the subject-data ledger from
 * 139 to 0, and the same one `data-lifecycle:table-coverage:check` uses for its
 * 108 predating tables.
 *
 * ## What counts as an untranslated literal
 *
 * A TEXT NODE in the template with at least three consecutive letters, outside
 * `<style>`, `<script>`, comments, and expression braces. That is narrow on
 * purpose:
 *
 *   - attributes are NOT scanned. `aria-label="…"` genuinely needs translating,
 *     but so does `class="admin-card"` look identical to this scanner, and a
 *     gate that reports class names trains its readers to ignore it.
 *   - anything inside `{...}` is skipped, so `{t("Saved")}` and `{count}` both
 *     read as already-handled. A screen can therefore be finished by wrapping
 *     its text, which is exactly the migration this measures.
 *
 * The consequence, stated rather than hidden: a screen that passes may still
 * have an untranslated `aria-label` or `placeholder`. This gate measures the
 * bulk migration, not perfection, and claiming otherwise would be the "green
 * while every answer is wrong" failure it was written to avoid.
 *
 * ## A THIRD blind spot, and it matters more now the ledger is empty
 *
 * Text that follows an EXPRESSION rather than a tag is not scanned. `afterTag`
 * below is cleared on `{` and `}`, so in
 *
 *   <caption>{roles.length} role(s)</caption>
 *
 * the words ` role(s)` are invisible. Nineteen such strings were found BY HAND
 * when this ledger reached zero — table captions, `{n} per page`, a
 * `{label} media id` — and every one of them was rendering English to an
 * Indonesian reader while this gate reported the screen finished. They are
 * fixed; the scanner still cannot see the class, so a NEW one would be silent.
 *
 * Extending `afterTag` to survive a closing `}` is the obvious fix and is NOT
 * free: template literals and chained ternaries would start being captured as
 * prose (`` ` : "other" `` after a `${…}`), which is the false-positive failure
 * `CODE_SHAPED` already exists to hold back. That widening deserves its own
 * change, with its own mutation test, rather than riding along with a ledger
 * that was being emptied. Until then: an empty ledger means "no untranslated
 * text after a TAG", which is less than "nothing untranslated".
 *
 * Pure: reads source text. No database, no network.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SCREENS_ROOT = join(REPO_ROOT, "src", "pages", "admin");

/**
 * Admin screens NOT yet migrated to `t()`, and therefore still rendering English
 * to every reader.
 *
 * **This list may only SHRINK.** A screen that gains translations must be
 * removed from it in the same change, and the gate reports an entry that no
 * longer belongs — a stale ledger reads as debt that does not exist, which is
 * how a counter stops being believed.
 *
 * A NEW screen may not be added here. That is the point: the migration is
 * finite, and the way it stays finite is that nothing new joins it.
 *
 * **IT IS NOW EMPTY, AND THAT IS THE END STATE.** All 43 screens render their
 * template text through `t()`. The list stays rather than being deleted because
 * emptiness is what makes the gate absolute: with no entries, the FIRST
 * untranslated literal on any screen fails the build, and there is no existing
 * row for it to hide behind.
 *
 * What the last 23 literals had in common is worth keeping: every one was a
 * sentence split by an interpolated value or a `<code>`/`<strong>` — the shape
 * the bulk migration could not mechanise. They are merged into whole msgids
 * with placeholders. Where the value is OPTIONAL (a tenant code that may not
 * resolve) that means TWO msgids, one per branch, because a single `{code}`
 * entry renders "platform tenant ()" when it is absent.
 */
export const SCREENS_AWAITING_TRANSLATION: readonly string[] = [];

interface Finding {
  readonly screen: string;
  readonly samples: readonly string[];
  readonly count: number;
}

function listScreens(): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);

      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (entry.endsWith(".astro")) {
        found.push(relative(SCREENS_ROOT, full));
      }
    }
  };

  walk(SCREENS_ROOT);

  return found.sort();
}

/**
 * Strips everything that is not template text: frontmatter, `<style>`,
 * `<script>`, HTML/JS comments, tags, and expression braces.
 *
 * Brace handling counts DEPTH rather than matching the first `}`, because
 * `{items.map((i) => <li>{i.name}</li>)}` nests — a non-counting version ends
 * the expression at the inner brace and then reports the JSX after it as loose
 * template text.
 */
export function extractTemplateText(source: string): string[] {
  // Astro frontmatter: everything up to the second `---` at line start.
  let body = source;
  const fence = /^---\s*$/m;

  if (fence.test(body)) {
    const first = body.indexOf("---");
    const second = body.indexOf("\n---", first + 3);
    if (second !== -1) body = body.slice(second + 4);
  }

  body = body
    // What closes a `<script>` is wider than `</script>`. The HTML tokeniser
    // ends the element at `</script` followed by whitespace or `/`, and then
    // discards whatever precedes the `>` — so `</script >`, `</script\t\n bar>`
    // and `</script/>` all close it, attributes on an end tag being ignored
    // rather than rejected.
    //
    // Matching only the exact form is not a near-miss, because the quantifier
    // is lazy: an unrecognised close does not fail locally, it keeps consuming
    // until the NEXT close in the file and swallows every line between. On a
    // COVERAGE gate that failure is silent AND flattering — the literals inside
    // the swallowed span are not reported as errors, they are not reported at
    // all, and the number goes down. CodeQL `js/bad-tag-filter` caught both the
    // whitespace form and the attribute form here, one after the other.
    .replace(/<style[\s\S]*?<\/style(?:[\s/][^>]*)?>/gi, " ")
    .replace(/<script[\s\S]*?<\/script(?:[\s/][^>]*)?>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // JSX comments — `{/* … */}`. These are prose ABOUT the template and are
    // the single largest source of false positives here: several screens
    // explain their own `set:text` escaping in one, and every sentence of that
    // explanation was being reported as an untranslated string.
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ");

  const texts: string[] = [];
  let buffer = "";
  let inTag = false;
  /**
   * True only just after a REAL tag closed, which is the one position where
   * template TEXT can begin.
   *
   * An earlier version skipped everything inside `{...}` by counting brace
   * depth, and it was badly wrong in a way that looked right: on the dashboard
   * it reported 7 untranslated strings where there are more than thirty,
   * because most of an admin screen's text lives inside JSX conditionals
   * (`{allowed && (<p>Some text</p>)}`) and therefore inside braces. A coverage
   * gate that quietly ignores the majority of the thing it measures is the
   * "green while every answer is wrong" failure this repo keeps re-learning.
   *
   * So braces are not skipped. Instead, text counts only where text can
   * actually appear — between a closed tag and the next `<` or `{` — which
   * excludes the surrounding code (`allowed && (`) without excluding the JSX
   * inside it.
   */
  let afterTag = false;

  const flush = (): void => {
    if (buffer.trim() !== "") texts.push(buffer.trim());
    buffer = "";
  };

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const next = body[i + 1] ?? "";

    if (inTag) {
      // Attribute values may contain `>` (`aria-label="a > b"`), so quotes are
      // skipped whole rather than scanned.
      if (char === '"' || char === "'") {
        const quote = char;
        i += 1;
        while (i < body.length && body[i] !== quote) i += 1;
        continue;
      }

      // An attribute EXPRESSION is skipped to its matching brace, because it is
      // code and code contains `>`: `class={count > 0 ? "alert" : undefined}`
      // would otherwise close the tag at the comparison operator, and the
      // remainder — `0 ? "dd-alert" : undefined` — would be reported as
      // untranslated prose. A gate that reports code as a missing translation
      // is one its readers learn to ignore.
      if (char === "{") {
        let depth = 1;
        i += 1;

        while (i < body.length && depth > 0) {
          const inner = body[i];

          if (inner === '"' || inner === "'" || inner === "`") {
            const quote = inner;
            i += 1;
            while (i < body.length && body[i] !== quote) {
              if (body[i] === "\\") i += 1;
              i += 1;
            }
          } else if (inner === "{") {
            depth += 1;
          } else if (inner === "}") {
            depth -= 1;
          }

          i += 1;
        }

        i -= 1;
        continue;
      }

      if (char === ">") {
        inTag = false;
        afterTag = true;
      }

      continue;
    }

    // A `<` starts a tag only when followed by a name, `/`, or `>` — the last
    // being a JSX FRAGMENT (`<>`), which is a tag boundary even though it has no
    // name. Without it, the code between a fragment and the previous closed tag
    // (`) : ( users.map((user) => (`) accumulates as if it were prose.
    //
    // This is what keeps `a < b` and the `<` of a comparison from being read as
    // markup.
    if (char === "<" && /[A-Za-z/>]/.test(next)) {
      flush();
      inTag = true;
      afterTag = false;
      continue;
    }

    // An expression ends the text run: `{t("Saved")}` and `{count}` are already
    // handled, and the code inside them is not prose.
    if (char === "{" || char === "}") {
      flush();
      afterTag = false;
      continue;
    }

    if (afterTag) buffer += char;
  }

  flush();

  return texts;
}

/**
 * Fragments of JavaScript that can appear BETWEEN two JSX elements inside one
 * expression, where the scanner's "text follows a closed tag" rule cannot tell
 * them from prose:
 *
 *   {empty ? (<p>None yet</p>) : (rows.map((row) => (<tr>…
 *                                ^^^^^^^^^^^^^^^^^^^^^^ captured as "text"
 *
 * Rejecting on these tokens is a HEURISTIC, and the trade is stated rather than
 * hidden: a UI sentence that genuinely contained `=>` or `.map(` would be missed
 * by the coverage count. No such sentence exists in this admin, and the
 * alternative — a full JSX parser inside a coverage gate — buys precision the
 * gate does not need at a cost it cannot justify.
 *
 * The direction of the error matters and is the safe one: this can only cause
 * an UNDER-count of untranslated strings on a screen already on the ledger,
 * never a false accusation against a screen that is finished.
 *
 * `===`/`!==` were added when the ledger reached its last screen. A CHAINED
 * ternary between two elements —
 *
 *   ) : token.kind === "number" ? (
 *
 * — is not caught by `\)\s*:\s*\(`, because the comparison sits between the
 * colon and the paren. It was the only thing standing between `theming.astro`
 * and a finished ledger, and "a screen that cannot be finished" is where a
 * heuristic stops being conservative and starts being wrong: the under-count
 * argument above holds only while a screen is ON the ledger. Neither operator
 * can appear in a UI sentence.
 */
const CODE_SHAPED =
  /=>|&&|\|\||\.map\(|\?\.|\);|\)\s*:\s*\(|\.join\(|\bconst\b|\breturn\b|===|!==/;

/** Text that looks like a sentence a reader would see, not markup residue. */
export function isTranslatableText(text: string): boolean {
  // Three consecutive letters — enough to exclude `&amp;`, `·`, `v9.0.0`, and
  // stray punctuation, while catching any real word.
  if (!/[A-Za-z]{3}/.test(text)) return false;

  // An HTML entity on its own is markup, not prose.
  if (/^&[a-z]+;$/i.test(text.trim())) return false;

  if (CODE_SHAPED.test(text)) return false;

  return true;
}

function scan(screen: string): Finding | null {
  const source = readFileSync(join(SCREENS_ROOT, screen), "utf8");
  const offenders = extractTemplateText(source).filter(isTranslatableText);

  if (offenders.length === 0) return null;

  return {
    screen,
    count: offenders.length,
    samples: offenders.slice(0, 3)
  };
}

function main(): void {
  const screens = listScreens();

  // Guard the fixture: an empty scan would report "all translated" while
  // checking nothing — the failure mode PROJECT_STATE §4 records for gates that
  // stop matching.
  if (screens.length < 20) {
    process.stderr.write(
      `i18n:screens:check FAILED — found only ${screens.length} admin screens, which means the scan stopped working rather than that the screens went away.\n`
    );
    process.exit(1);
  }

  const ledger = new Set(SCREENS_AWAITING_TRANSLATION);
  const untranslated = screens
    .map((screen) => scan(screen))
    .filter((finding): finding is Finding => finding !== null);

  const problems: string[] = [];

  for (const finding of untranslated) {
    if (ledger.has(finding.screen)) continue;

    problems.push(
      `${finding.screen} renders ${finding.count} untranslated literal(s) and is not on the ledger — wrap them in t() (see /admin/account for the pattern). Examples: ${finding.samples.map((sample) => JSON.stringify(sample.slice(0, 60))).join(", ")}`
    );
  }

  const untranslatedNames = new Set(
    untranslated.map((finding) => finding.screen)
  );

  for (const entry of SCREENS_AWAITING_TRANSLATION) {
    if (!screens.includes(entry)) {
      problems.push(
        `${entry} is on the ledger but no longer exists — remove the entry.`
      );
      continue;
    }

    if (!untranslatedNames.has(entry)) {
      problems.push(
        `${entry} is on the ledger but renders no untranslated literals any more — remove the entry so the count keeps meaning something.`
      );
    }
  }

  if (problems.length > 0) {
    process.stderr.write(
      `i18n:screens:check FAILED — ${problems.length} problem(s):\n\n`
    );

    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);

    process.stderr.write("\n");
    process.exit(1);
  }

  const done = screens.length - untranslated.length;

  process.stdout.write(
    `i18n:screens:check OK — ${done}/${screens.length} admin screens translated; ${SCREENS_AWAITING_TRANSLATION.length} on the shrink-only ledger.\n`
  );
}

if (import.meta.main) {
  main();
}
