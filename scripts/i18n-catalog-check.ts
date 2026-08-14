#!/usr/bin/env bun
/**
 * `bun run i18n:catalog:check` — ADR-0095 §"Keputusan 4".
 *
 * Four questions, all mechanical, all pure (source text only — no database, no
 * network):
 *
 * 1. **Are the generated catalogs FRESH?** Recompile every `.po` and compare
 *    bytes. This is the check that turns `*.generated.ts` from a claim into a
 *    fact — a `.generated` file whose generator CI never runs is a lie this repo
 *    has already been told once.
 * 2. **Does every msgid the CODE uses exist in the catalogs?** Harvested from
 *    literal `t()` / `tn()` / `tx()` calls. A string nobody added to `locales/`
 *    can never be translated, and nothing else would ever say so.
 * 3. **Does each catalog's `nplurals` match the code's plural table?** The
 *    `.po` header is read to be VERIFIED, never evaluated.
 * 4. **How much of `id` is still untranslated?** Reported against a ledger that
 *    may only SHRINK.
 *
 * ## What this gate deliberately does NOT check
 *
 * Whether a literal English string somewhere FORGOT to be wrapped in `t()`.
 * That is a coverage question, not a consistency one, and fusing the two would
 * produce a gate that is green while every answer it gives is wrong — the
 * failure mode already recorded in this project's memory. The untranslated
 * ledger in check 4 is where incomplete coverage is made visible instead.
 *
 * It also cannot know whether a translation is CORRECT. Nothing mechanical can.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import {
  compileLocale,
  outputPathFor,
  poPathFor,
  CatalogCompileError
} from "./i18n-compile";
import { catalogKey } from "../src/lib/i18n/po";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale
} from "../src/lib/i18n/locales";

const REPO_ROOT = join(import.meta.dir, "..");
const SOURCE_ROOTS = ["src"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".astro"];

/**
 * Maximum `id` entries that may be declared-but-untranslated.
 *
 * A LEDGER, in the ADR-0094 §139→0 sense: it may only ever be lowered. Raising
 * it is how a translation debt becomes permanent, so raising it must be a
 * reviewed edit with a reason rather than the reflex fix for a red gate.
 *
 * **718, raised from 0 — and this is the raise the previous note predicted**:
 * "the check exists for the next wave, when 40 screens' worth of msgids land and
 * some arrive ahead of their translations". Forty admin screens were migrated to
 * `t()` in one pass, declaring 1,074 new msgids; 540 are translated and 718 are
 * not.
 *
 * The alternative was worse in both directions. Holding the migration back until
 * every string had Indonesian would have parked forty screens' worth of
 * mechanical change in a branch nobody could review, and shipping the wrapping
 * WITHOUT declaring the msgids would have left the strings invisible to
 * translators — untranslatable rather than untranslated, and reported by nothing.
 *
 * What makes the raise safe is that an untranslated entry is not a broken
 * screen: `createTranslator` falls back to the msgid, which IS the English
 * source text (ADR-0095 §"Keputusan 2"), so an Indonesian reader sees correct
 * English on the parts not yet done rather than a leaked key or an empty
 * element. That property is the whole reason the catalog can land incrementally.
 *
 * This number may only go DOWN from here. It is the count the next translation
 * pass is measured against.
 */
const MAX_UNTRANSLATED_ID_ENTRIES = 718;

/**
 * There is deliberately NO exemption list here.
 *
 * An earlier draft exempted `AdminLayout.astro`, on the grounds that it
 * translates sidebar labels arriving as VARIABLES (`t(entry.label)` over
 * `SIDEBAR_LABELS`). That reasoning was wrong in a way worth recording: the
 * harvester below matches string LITERALS only, so a variable call is skipped
 * by construction and needs no exemption — while the exemption additionally
 * hid that file's ten literal msgids, which are exactly the shell strings most
 * worth checking. An exemption that silences more than it was written for is
 * the failure mode this repo's gates keep re-learning.
 *
 * The variable calls are covered instead by
 * `tests/i18n-sidebar-labels.test.ts`, which asserts every value in
 * `SIDEBAR_LABELS` and every module display name is a catalog key. That reads
 * the actual tables rather than call syntax, so it is strictly stronger than
 * harvesting could be.
 */

interface Failure {
  readonly kind: string;
  readonly detail: string;
}

function listSourceFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);

      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === "catalogs") continue;
        walk(full);
        continue;
      }

      if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        found.push(full);
      }
    }
  };

  for (const root of SOURCE_ROOTS) {
    const full = join(REPO_ROOT, root);
    if (existsSync(full)) walk(full);
  }

  return found;
}

/**
 * A single-quoted/double-quoted/backticked string literal, with no escape and no
 * interpolation. Anything more complex is left UNHARVESTED rather than parsed
 * approximately: a harvester that guesses produces phantom msgids, and a gate
 * that reports a msgid nobody wrote trains its readers to widen the ignore list
 * until it asks nothing (the lesson `permission-enforcement-check.ts` paid for
 * four times).
 */
const LITERAL = String.raw`(?:"([^"\\\n]*)"|'([^'\\\n]*)'|\x60([^\x60\\\n$]*)\x60)`;

const T_CALL = new RegExp(String.raw`\bt\(\s*${LITERAL}`, "g");
const TN_CALL = new RegExp(
  String.raw`\btn\(\s*${LITERAL}\s*,\s*${LITERAL}`,
  "g"
);
const TX_CALL = new RegExp(
  String.raw`\btx\(\s*${LITERAL}\s*,\s*${LITERAL}`,
  "g"
);

function literalOf(
  match: RegExpMatchArray,
  offset: number
): string | undefined {
  return (
    match[offset + 1] ?? match[offset + 2] ?? match[offset + 3] ?? undefined
  );
}

/**
 * Blanks out comments, preserving offsets and every non-comment character.
 *
 * WHY THIS IS NOT OPTIONAL
 *
 * The harvester matches source TEXT, and prose about the code is source text
 * too. `account.astro` documents its own bug fix with the words `t("Light")`
 * inside a block comment, and the first version of this gate dutifully reported
 * `"Light"` as an undeclared msgid — a failure with no defect behind it.
 *
 * The tempting fix is to reword the comment. That is backwards: it makes the
 * gate's false positive into a permanent tax on writing comments, and this repo
 * has already recorded the lesson that assertions over source must strip
 * comments FIRST.
 *
 * The scanner tracks string state so a `//` inside a quoted string (`"https://…"`)
 * does not start a comment — without that, everything after such a URL on the
 * same line would be blanked, which would silently HIDE real `t()` calls. A
 * false negative in a coverage gate is worse than the false positive it fixes.
 *
 * Characters are replaced with spaces rather than removed so that regex offsets
 * and line structure stay intact, and so a comment can never splice two tokens
 * together into something that matches.
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

interface UsedMsgid {
  readonly key: string;
  readonly display: string;
  readonly file: string;
}

/** Harvests every literal msgid the code asks for. */
function harvestUsedMsgids(): UsedMsgid[] {
  const used: UsedMsgid[] = [];

  for (const file of listSourceFiles()) {
    const relativePath = relative(REPO_ROOT, file);
    // Comments are prose ABOUT the code, not calls in it — see `stripComments`.
    const source = stripComments(readFileSync(file, "utf8"));

    // `tx` and `tn` are matched FIRST and their spans removed, so the `t(`
    // pattern cannot also match inside them (`\bt\(` does not match `tx(`, but
    // being explicit here keeps that true if the names ever change).
    let remaining = source;

    for (const match of source.matchAll(TX_CALL)) {
      const context = literalOf(match, 0);
      const msgid = literalOf(match, 3);

      if (context === undefined || msgid === undefined) continue;

      used.push({
        key: catalogKey(msgid, context),
        display: `${msgid} (context "${context}")`,
        file: relativePath
      });
      remaining = remaining.replace(match[0], "");
    }

    for (const match of remaining.matchAll(TN_CALL)) {
      const singular = literalOf(match, 0);

      if (singular === undefined) continue;

      used.push({
        key: catalogKey(singular),
        display: singular,
        file: relativePath
      });
      remaining = remaining.replace(match[0], "");
    }

    for (const match of remaining.matchAll(T_CALL)) {
      const msgid = literalOf(match, 0);

      // `t("")` is not a message; skip rather than report a phantom.
      if (msgid === undefined || msgid === "") continue;

      used.push({
        key: catalogKey(msgid),
        display: msgid,
        file: relativePath
      });
    }
  }

  return used;
}

function main(): void {
  const failures: Failure[] = [];
  const declaredKeysByLocale = new Map<Locale, Set<string>>();

  for (const locale of SUPPORTED_LOCALES) {
    let compiled;

    try {
      compiled = compileLocale(locale);
    } catch (error) {
      failures.push({
        kind: "catalog invalid",
        detail:
          error instanceof CatalogCompileError
            ? error.message
            : `locales/${locale}.po: ${error instanceof Error ? error.message : String(error)}`
      });
      continue;
    }

    declaredKeysByLocale.set(locale, new Set(compiled.declaredKeys));

    // 1. Freshness — the check that makes `.generated` a fact.
    const outputPath = outputPathFor(locale);

    if (!existsSync(outputPath)) {
      failures.push({
        kind: "generated catalog missing",
        detail: `${relative(REPO_ROOT, outputPath)} does not exist. Run \`bun run i18n:compile\`.`
      });
    } else {
      const onDisk = readFileSync(outputPath, "utf8");

      if (onDisk !== compiled.source) {
        failures.push({
          kind: "generated catalog stale",
          detail: `${relative(REPO_ROOT, outputPath)} does not match a fresh compile of ${relative(REPO_ROOT, poPathFor(locale))}. Run \`bun run i18n:compile\` and commit the result (never hand-edit the generated file).`
        });
      }
    }

    // 4. Untranslated ledger — only for the non-source locales. `en` is
    //    legitimately all-empty (msgid IS the English), so counting it would
    //    make the source language look 0% translated forever.
    if (locale !== DEFAULT_LOCALE) {
      if (compiled.untranslatedCount > MAX_UNTRANSLATED_ID_ENTRIES) {
        failures.push({
          kind: "untranslated entries above ledger",
          detail: `locales/${locale}.po has ${compiled.untranslatedCount} untranslated or fuzzy entr${compiled.untranslatedCount === 1 ? "y" : "ies"}, ledger allows ${MAX_UNTRANSLATED_ID_ENTRIES}. Translate them, or lower-then-raise the ledger in scripts/i18n-catalog-check.ts WITH a reason (it is meant to shrink).`
        });
      } else if (compiled.untranslatedCount < MAX_UNTRANSLATED_ID_ENTRIES) {
        failures.push({
          kind: "ledger should shrink",
          detail: `locales/${locale}.po now has only ${compiled.untranslatedCount} untranslated entr${compiled.untranslatedCount === 1 ? "y" : "ies"} but the ledger still allows ${MAX_UNTRANSLATED_ID_ENTRIES}. Lower MAX_UNTRANSLATED_ID_ENTRIES to ${compiled.untranslatedCount} so the gain cannot be silently given back.`
        });
      }
    }
  }

  // 2. Every msgid the code uses is declared by EVERY catalog. Checking all
  //    catalogs rather than just `id` is what stops `en.po` — the inventory of
  //    translatable strings — from quietly falling behind the code.
  const used = harvestUsedMsgids();
  const reported = new Set<string>();

  for (const entry of used) {
    for (const locale of SUPPORTED_LOCALES) {
      const declared = declaredKeysByLocale.get(locale);

      if (!declared || declared.has(entry.key)) continue;

      const reportKey = `${locale}|${entry.key}`;
      if (reported.has(reportKey)) continue;
      reported.add(reportKey);

      failures.push({
        kind: "msgid used but not declared",
        detail: `${entry.file} translates "${entry.display}" but locales/${locale}.po has no such entry. Add it (msgid = the English source text), then run \`bun run i18n:compile\`.`
      });
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `i18n:catalog:check FAILED — ${failures.length} problem(s):\n\n`
    );

    for (const failure of failures) {
      process.stderr.write(`  [${failure.kind}] ${failure.detail}\n`);
    }

    process.stderr.write("\n");
    process.exit(1);
  }

  process.stdout.write(
    `i18n:catalog:check OK — ${SUPPORTED_LOCALES.length} catalog(s) fresh, ${used.length} literal msgid use(s) declared.\n`
  );
}

if (import.meta.main) {
  main();
}
