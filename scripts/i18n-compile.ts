#!/usr/bin/env bun
/**
 * `bun run i18n:compile` — compiles `locales/*.po` into
 * `src/lib/i18n/catalogs/<locale>.generated.ts` (ADR-0095 §"Keputusan 3").
 *
 * ## Why compile at all, instead of reading `.po` at request time
 *
 * `Dockerfile.production`'s `runtime` stage copies `dist/`, `node_modules/`, and
 * `package.json`. It does NOT copy `locales/`, any more than it copies
 * `scripts/` — and that omission is exactly how 29 registered jobs came to exit
 * `Script not found` in production while every gate stayed green
 * (`docs/PROJECT_STATE.md` §4). A catalog read from disk at request time is the
 * same defect one subsystem over, with a quieter failure: no error, no log line,
 * just every screen silently reverting to English.
 *
 * Compiling to a TS module makes the catalog part of the bundle, so it either
 * ships with the app or fails the build. There is no third state.
 *
 * ## Why a `.generated` suffix, and why this script is in the `check` chain
 *
 * A `.generated` file whose generator is not run by CI is a claim, not a fact —
 * this repo has the scar. `bun run i18n:catalog:check` recompiles and compares
 * bytes, so a hand-edited catalog or a stale one fails `bun run check`.
 *
 * Pure: reads `locales/`, writes `src/lib/i18n/catalogs/`. No database, no
 * network.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { parsePo, catalogKey, type PoFile } from "../src/lib/i18n/po";
import {
  PLURAL_FORM_COUNT,
  SUPPORTED_LOCALES,
  type Locale
} from "../src/lib/i18n/locales";

const REPO_ROOT = join(import.meta.dir, "..");
const LOCALES_DIR = join(REPO_ROOT, "locales");
const OUTPUT_DIR = join(REPO_ROOT, "src", "lib", "i18n", "catalogs");

export interface CompiledLocale {
  readonly locale: Locale;
  /** The generated module source, exactly as it should exist on disk. */
  readonly source: string;
  /** Entries carrying at least one non-empty translation. */
  readonly translatedCount: number;
  /** Entries present but untranslated or fuzzy. */
  readonly untranslatedCount: number;
  /** Every key the catalog declares, translated or not. */
  readonly declaredKeys: readonly string[];
}

export class CatalogCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogCompileError";
  }
}

export function poPathFor(locale: Locale): string {
  return join(LOCALES_DIR, `${locale}.po`);
}

export function outputPathFor(locale: Locale): string {
  return join(OUTPUT_DIR, `${locale}.generated.ts`);
}

/**
 * Validates a parsed catalog and renders its generated module.
 *
 * Exported so `i18n-catalog-check.ts` can produce the expected bytes without
 * writing anything — the freshness check is a byte comparison against this
 * exact function's output.
 */
export function compileCatalog(locale: Locale, parsed: PoFile): CompiledLocale {
  const declaredLanguage = parsed.headers["language"];

  if (declaredLanguage !== locale) {
    throw new CatalogCompileError(
      `locales/${locale}.po declares "Language: ${declaredLanguage ?? "<missing>"}" but must declare "${locale}". A catalog whose header disagrees with its filename is one wrong import away from serving the wrong language.`
    );
  }

  const expectedForms = PLURAL_FORM_COUNT[locale];
  const pluralForms = parsed.headers["plural-forms"] ?? "";
  const npluralsMatch = /nplurals\s*=\s*(\d+)/.exec(pluralForms);
  const declaredNplurals = npluralsMatch ? Number(npluralsMatch[1]) : null;

  if (declaredNplurals !== expectedForms) {
    throw new CatalogCompileError(
      `locales/${locale}.po declares nplurals=${declaredNplurals ?? "<missing>"} but src/lib/i18n/locales.ts declares ${expectedForms} plural form(s) for "${locale}". The header is verified against the code, never evaluated (ADR-0095) — so the two must be made to agree by hand.`
    );
  }

  // A duplicate key means two translations of the same string, and whichever
  // lost the race is dead weight that a translator will keep maintaining. The
  // entry is identified by line so the second one is findable.
  const seen = new Map<string, number>();
  const catalog: Record<string, string[]> = {};
  const declaredKeys: string[] = [];
  let translatedCount = 0;
  let untranslatedCount = 0;

  for (const entry of parsed.entries) {
    const key = catalogKey(entry.msgid, entry.context);
    const previousLine = seen.get(key);

    if (previousLine !== undefined) {
      throw new CatalogCompileError(
        `locales/${locale}.po line ${entry.line}: duplicate entry for msgid "${entry.msgid}"${entry.context ? ` (context "${entry.context}")` : ""}, first defined on line ${previousLine}.`
      );
    }

    seen.set(key, entry.line);
    declaredKeys.push(key);

    if (entry.msgidPlural !== null && entry.msgstr.length !== expectedForms) {
      throw new CatalogCompileError(
        `locales/${locale}.po line ${entry.line}: plural entry "${entry.msgid}" has ${entry.msgstr.length} form(s), expected ${expectedForms}.`
      );
    }

    // Fuzzy is UNTRANSLATED, as gettext treats it: the string changed and the
    // old translation may now be wrong. Emitting it would ship a translation
    // nobody approved.
    const usable = entry.fuzzy
      ? []
      : entry.msgstr.filter((form) => form !== "");

    if (usable.length === 0) {
      untranslatedCount += 1;
      // Omitted from the emitted object entirely — `createTranslator` falls back
      // to the msgid, which is the correct English.
      continue;
    }

    translatedCount += 1;
    catalog[key] = [...entry.msgstr];
  }

  const body = Object.keys(catalog)
    .sort()
    .map((key) => {
      const forms = catalog[key] ?? [];

      return `  ${JSON.stringify(key)}: [${forms
        .map((form) => JSON.stringify(form))
        .join(", ")}]`;
    })
    .join(",\n");

  const source = `// GENERATED by \`bun run i18n:compile\` from locales/${locale}.po — DO NOT EDIT.
//
// Freshness is enforced by \`bun run i18n:catalog:check\`, which recompiles the
// .po and compares bytes. Edit locales/${locale}.po and recompile instead.
//
// Untranslated and fuzzy entries are deliberately ABSENT rather than present as
// empty strings: a lookup miss falls back to the msgid, which is the English
// source text (ADR-0095).
import type { CompiledCatalog } from "../catalog";

export const ${locale.toUpperCase()}_CATALOG: CompiledCatalog = {
${body}
};
`;

  return {
    locale,
    source,
    translatedCount,
    untranslatedCount,
    declaredKeys
  };
}

/** Reads and compiles one locale, throwing on a missing or invalid file. */
export function compileLocale(locale: Locale): CompiledLocale {
  const path = poPathFor(locale);

  if (!existsSync(path)) {
    throw new CatalogCompileError(
      `locales/${locale}.po does not exist, but "${locale}" is in SUPPORTED_LOCALES. Either add the catalog or remove the locale.`
    );
  }

  return compileCatalog(locale, parsePo(readFileSync(path, "utf8")));
}

export function compileAll(): readonly CompiledLocale[] {
  return SUPPORTED_LOCALES.map((locale) => compileLocale(locale));
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const compiled of compileAll()) {
    writeFileSync(outputPathFor(compiled.locale), compiled.source, "utf8");

    const total = compiled.translatedCount + compiled.untranslatedCount;
    process.stdout.write(
      `${compiled.locale}: ${compiled.translatedCount}/${total} translated -> src/lib/i18n/catalogs/${compiled.locale}.generated.ts\n`
    );
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}
