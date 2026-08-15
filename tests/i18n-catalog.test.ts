/**
 * ADR-0095 — the i18n foundation.
 *
 * Pure: no database, no network, no filesystem beyond reading `locales/`.
 */
import { describe, expect, test } from "bun:test";

import {
  createTranslator,
  type CompiledCatalog
} from "../src/lib/i18n/catalog";
import {
  DEFAULT_LOCALE,
  PLURAL_FORM_COUNT,
  PLURAL_SELECTOR,
  SUPPORTED_LOCALES,
  isSupportedLocale
} from "../src/lib/i18n/locales";
import {
  coerceLocale,
  negotiateAcceptLanguage,
  resolveLocale
} from "../src/lib/i18n/negotiate";
import { resolveRequestLocale } from "../src/lib/i18n/request-locale";
import { catalogKey, parsePo, PoParseError } from "../src/lib/i18n/po";
import { formatCurrency, formatNumber } from "../src/lib/i18n/format";
import { getTranslator } from "../src/lib/i18n";
import {
  decodeSourceLiteral,
  placeholderMismatches,
  stripComments
} from "../scripts/i18n-catalog-check";

describe("locale vocabulary", () => {
  test("every supported locale declares a plural selector consistent with its form count", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const forms = PLURAL_FORM_COUNT[locale];
      const select = PLURAL_SELECTOR[locale];

      expect(forms).toBeGreaterThanOrEqual(1);

      // The selector must never index past the declared form count, for any
      // plausible count — otherwise a catalog that is complete by the gate's
      // reckoning still renders `undefined` at runtime.
      for (let n = 0; n <= 120; n += 1) {
        const index = select(n);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(forms);
      }
    }
  });

  test("Indonesian has exactly one plural form and English has two", () => {
    expect(PLURAL_FORM_COUNT.id).toBe(1);
    expect(PLURAL_FORM_COUNT.en).toBe(2);
    expect(PLURAL_SELECTOR.en(1)).toBe(0);
    expect(PLURAL_SELECTOR.en(0)).toBe(1);
    expect(PLURAL_SELECTOR.en(2)).toBe(1);
  });

  test("isSupportedLocale rejects non-locales without throwing", () => {
    expect(isSupportedLocale("id")).toBe(true);
    expect(isSupportedLocale("de")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
    expect(isSupportedLocale("ID")).toBe(false);
  });
});

describe("PO parser", () => {
  test("parses headers, plain entries, contexts and plurals", () => {
    const parsed = parsePo(`
msgid ""
msgstr ""
"Language: id\\n"
"Plural-Forms: nplurals=1; plural=0;\\n"

msgid "Log out"
msgstr "Keluar"

msgctxt "theme"
msgid "System"
msgstr "Sistem"

msgid "{count} file"
msgid_plural "{count} files"
msgstr[0] "{count} berkas"
`);

    expect(parsed.headers["language"]).toBe("id");
    expect(parsed.headers["plural-forms"]).toBe("nplurals=1; plural=0;");
    expect(parsed.entries).toHaveLength(3);

    expect(parsed.entries[0]?.msgid).toBe("Log out");
    expect(parsed.entries[0]?.msgstr[0]).toBe("Keluar");
    expect(parsed.entries[0]?.context).toBeNull();

    expect(parsed.entries[1]?.context).toBe("theme");
    expect(parsed.entries[2]?.msgidPlural).toBe("{count} files");
  });

  test("joins multi-line strings and decodes escapes", () => {
    const parsed = parsePo(`
msgid ""
"one "
"two"
msgstr "satu\\ndua\\t\\"kutip\\""
`);

    // `msgid ""` followed by continuations is a REAL entry, not the header:
    // the header is the entry whose msgid is empty AFTER all continuations.
    expect(parsed.entries[0]?.msgid).toBe("one two");
    expect(parsed.entries[0]?.msgstr[0]).toBe('satu\ndua\t"kutip"');
  });

  test("a fuzzy flag is carried so the compiler can treat it as untranslated", () => {
    const parsed = parsePo(`
#, fuzzy
msgid "Log out"
msgstr "Keluar"
`);

    expect(parsed.entries[0]?.fuzzy).toBe(true);
  });

  test("rejects an unsupported escape rather than passing a stray backslash through", () => {
    expect(() => parsePo('msgid "a\\qb"\nmsgstr ""')).toThrow(PoParseError);
  });

  test("rejects msgstr before msgid", () => {
    expect(() => parsePo('msgstr "orphan"')).toThrow(PoParseError);
  });

  test("catalogKey joins context with the gettext EOT separator", () => {
    expect(catalogKey("System")).toBe("System");
    expect(catalogKey("System", "theme")).toBe("theme\u0004System");
  });
});

describe("translator", () => {
  const catalog: CompiledCatalog = {
    "Log out": ["Keluar"],
    "theme\u0004System": ["Sistem"],
    "{count} file": ["{count} berkas"],
    "Hello, {name}": ["Halo, {name}"]
  };

  const { t, tn, tx } = createTranslator("id", catalog);

  test("translates a known msgid and falls back to the msgid otherwise", () => {
    expect(t("Log out")).toBe("Keluar");
    // The fallback IS correct English, which is the property that lets the
    // catalog land incrementally.
    expect(t("Not in the catalog")).toBe("Not in the catalog");
  });

  test("context keeps two identical English words apart", () => {
    expect(tx("theme", "System")).toBe("Sistem");
    // No context -> different key -> untranslated, not a silent wrong hit.
    expect(t("System")).toBe("System");
  });

  test("interpolates named placeholders", () => {
    expect(t("Hello, {name}", { name: "Rina" })).toBe("Halo, Rina");
  });

  test("leaves an unmatched placeholder verbatim rather than emptying it", () => {
    // A vanished number reads as a fine sentence stating something false; a
    // visible `{name}` is a bug someone fixes.
    expect(t("Hello, {name}")).toBe("Halo, {name}");
  });

  test("Indonesian plurals use the single form for every count", () => {
    expect(tn("{count} file", "{count} files", 1)).toBe("1 berkas");
    expect(tn("{count} file", "{count} files", 7)).toBe("7 berkas");
  });

  test("an untranslated plural falls back to ENGLISH grammar, not the target locale's", () => {
    const { tn: tnMissing } = createTranslator("id", {});

    // Indonesian's selector always returns form 0. If the fallback used it, a
    // count of 7 would render the English SINGULAR — "7 item". Falling back must
    // change the language, not the grammar being applied to English text.
    expect(tnMissing("{count} item", "{count} items", 1)).toBe("1 item");
    expect(tnMissing("{count} item", "{count} items", 7)).toBe("7 items");
  });

  test("an empty translation is treated as absent", () => {
    const { t: tEmpty } = createTranslator("id", { "Log out": [""] });

    expect(tEmpty("Log out")).toBe("Log out");
  });
});

describe("Accept-Language negotiation", () => {
  test("picks the highest-quality supported language", () => {
    expect(negotiateAcceptLanguage("id-ID,id;q=0.9,en;q=0.8")).toBe("id");
    expect(negotiateAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
  });

  test("q ordering beats header order", () => {
    expect(negotiateAcceptLanguage("en;q=0.2,id;q=0.9")).toBe("id");
  });

  test("region subtags resolve to the language catalog", () => {
    expect(negotiateAcceptLanguage("id-ID")).toBe("id");
  });

  test("q=0 means explicitly not that language", () => {
    expect(negotiateAcceptLanguage("id;q=0,en;q=0.5")).toBe("en");
  });

  test("`*` is not a preference for any particular locale", () => {
    expect(negotiateAcceptLanguage("*")).toBeNull();
  });

  test("returns null when nothing is supported, so the caller keeps falling back", () => {
    expect(negotiateAcceptLanguage("de,fr;q=0.8")).toBeNull();
    expect(negotiateAcceptLanguage("")).toBeNull();
    expect(negotiateAcceptLanguage(null)).toBeNull();
  });

  test("a hostile header is bounded rather than parsed in full", () => {
    const hostile = `${"de-DE,".repeat(50_000)}id`;

    const started = performance.now();
    const result = negotiateAcceptLanguage(hostile);
    const elapsed = performance.now() - started;

    // Truncation means the trailing `id` is never reached — the point is that
    // the work is bounded, not that the answer is clever.
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(50);
  });
});

describe("locale resolution chain", () => {
  test("coerceLocale discards anything unrenderable", () => {
    expect(coerceLocale("id")).toBe("id");
    expect(coerceLocale("klingon")).toBeNull();
    expect(coerceLocale(undefined)).toBeNull();
  });

  test("resolveLocale takes the first stated source and ends at the default", () => {
    expect(resolveLocale([null, "id", "en"])).toBe("id");
    expect(resolveLocale([null, undefined])).toBe(DEFAULT_LOCALE);
  });

  test("the cookie outranks the stored preference so a switch applies immediately", () => {
    expect(
      resolveRequestLocale({
        cookieValue: "en",
        storedPreference: "id",
        tenantDefault: "id",
        acceptLanguage: "id"
      })
    ).toBe("en");
  });

  test("the stored preference outranks the tenant default", () => {
    expect(
      resolveRequestLocale({
        cookieValue: null,
        storedPreference: "en",
        tenantDefault: "id"
      })
    ).toBe("en");
  });

  test("the tenant default outranks Accept-Language", () => {
    expect(
      resolveRequestLocale({
        tenantDefault: "id",
        acceptLanguage: "en-GB,en;q=0.9"
      })
    ).toBe("id");
  });

  test("Accept-Language is used when nothing else has an opinion", () => {
    expect(resolveRequestLocale({ acceptLanguage: "id-ID" })).toBe("id");
  });

  test("a tampered cookie cannot wedge a render — it simply has no opinion", () => {
    expect(
      resolveRequestLocale({
        cookieValue: "../../etc/passwd",
        storedPreference: "id"
      })
    ).toBe("id");
  });

  test("with no sources at all the answer is the source language", () => {
    expect(resolveRequestLocale({})).toBe(DEFAULT_LOCALE);
  });
});

describe("formatting", () => {
  test("Indonesian and English disagree about separators, which is the point", () => {
    // A number formatted with the wrong locale is not a missing translation —
    // it is a different number to the reader.
    expect(formatNumber("id", 1234.56)).toBe("1.234,56");
    expect(formatNumber("en", 1234.56)).toBe("1,234.56");
  });

  test("currency requires an explicit code and survives a numeric string", () => {
    expect(formatCurrency("id", "1500000", "IDR")).toContain("1.500.000");
  });

  test("a non-numeric amount renders a dash rather than NaN", () => {
    expect(formatCurrency("id", "not-a-number", "IDR")).toBe("—");
  });
});

describe("compiled catalogs", () => {
  test("every supported locale has a translator backed by a real catalog", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getTranslator(locale).locale).toBe(locale);
    }
  });

  test("the Indonesian catalog actually translates the shell", () => {
    // Guards against the catalog compiling to an empty object and every screen
    // silently reverting to English — the exact failure ADR-0095 §"Keputusan 3"
    // is about.
    expect(getTranslator("id").t("Log out")).toBe("Keluar");
    expect(getTranslator("id").t("Dashboard")).toBe("Dasbor");
  });

  test("English resolves to the source text", () => {
    expect(getTranslator("en").t("Log out")).toBe("Log out");
  });
});

describe("the catalog gate's comment stripper", () => {
  test("blanks comments so prose about the code is not harvested as a msgid", () => {
    // The bug this fixes was real: `account.astro` documents its own fix with
    // the words `t("Light")` inside a block comment, and the gate reported an
    // undeclared msgid with no defect behind it.
    expect(stripComments('// t("InComment")\nt("Real")')).not.toContain(
      "InComment"
    );
    expect(stripComments('/* t("InBlock") */ t("Real")')).not.toContain(
      "InBlock"
    );
  });

  test("keeps the real call on the same line as a stripped comment", () => {
    expect(stripComments('t("Real") // t("InComment")')).toContain('t("Real")');
  });

  test("a `//` inside a string does NOT start a comment", () => {
    // This is the direction that matters most. Treating it as a comment would
    // blank the rest of the line and silently HIDE real `t()` calls — a false
    // negative in a coverage gate, which is worse than the false positive the
    // stripper was written to fix.
    for (const source of [
      'const u = "https://x/y"; t("Real")',
      "const s = '// not a comment'; t(\"Real\")",
      'const s = `a//b`; t("Real")'
    ]) {
      expect(stripComments(source)).toContain('t("Real")');
    }
  });

  test("preserves length and newlines, so offsets and line structure survive", () => {
    const source = '// abc\nt("Real")';
    const stripped = stripComments(source);

    expect(stripped.length).toBe(source.length);
    expect(stripped.split("\n").length).toBe(source.split("\n").length);
  });
});

describe("placeholder parity between a msgid and its translation", () => {
  const entry = (
    msgid: string,
    msgstr: string[],
    extra: { msgidPlural?: string; fuzzy?: boolean } = {}
  ) => ({
    msgid,
    msgidPlural: extra.msgidPlural ?? null,
    msgstr,
    fuzzy: extra.fuzzy ?? false
  });

  test("a faithful translation reports nothing", () => {
    expect(
      placeholderMismatches(
        entry("Allow ({days} days)", ["Izinkan ({days} hari)"])
      )
    ).toEqual([]);
  });

  test("reordering placeholders is allowed — word order is the whole point", () => {
    // Indonesian does not put these in the English order, and a check that
    // compared sequences rather than sets would reject every correct
    // translation of a two-placeholder sentence.
    expect(
      placeholderMismatches(
        entry("{setting} is stored in {table}.", [
          "Di {table} lah {setting} disimpan."
        ])
      )
    ).toEqual([]);
  });

  test("a DROPPED placeholder is caught — the silent half of the defect", () => {
    const [mismatch] = placeholderMismatches(
      entry("Allow ({days} days)", ["Izinkan (beberapa hari)"])
    );

    expect(mismatch).toBeDefined();
    expect(mismatch!.expected).toEqual(["days"]);
    expect(mismatch!.actual).toEqual([]);
  });

  test("an INVENTED placeholder is caught — it would print verbatim", () => {
    const [mismatch] = placeholderMismatches(
      entry("Connected {linked}", ["Terhubung {tautan}"])
    );

    expect(mismatch).toBeDefined();
    expect(mismatch!.actual).toEqual(["tautan"]);
  });

  test("an untranslated entry cannot disagree with itself", () => {
    expect(placeholderMismatches(entry("Allow ({days} days)", [""]))).toEqual(
      []
    );
    expect(
      placeholderMismatches(entry("Allow ({days} days)", ["   "]))
    ).toEqual([]);
  });

  test("a fuzzy entry is skipped, as the compiler already treats it untranslated", () => {
    expect(
      placeholderMismatches(
        entry("Allow ({days} days)", ["Izinkan (beberapa hari)"], {
          fuzzy: true
        })
      )
    ).toEqual([]);
  });

  test("a plural form may draw from either source string", () => {
    // `nplurals=1` for Indonesian means the single form has to serve both the
    // singular and the plural msgid. Comparing it against only `msgid` would
    // reject a form that legitimately uses the plural source's placeholder.
    expect(
      placeholderMismatches(
        entry("{count} row", ["{count} baris dari {total}"], {
          msgidPlural: "{count} rows of {total}"
        })
      )
    ).toEqual([]);
  });

  test("reports the offending form index on a plural entry", () => {
    const found = placeholderMismatches(
      entry("{count} row", ["{count} row", "rows"], {
        msgidPlural: "{count} rows"
      })
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.form).toBe(1);
  });
});

describe("the catalog gate's source-literal decoder", () => {
  test("decodes the escapes prettier actually writes", () => {
    // The `—` case is the one that mattered: prettier rewrites an em dash
    // inside a `t()` literal into that form, and this admin's prose is full of
    // them, so 86 msgids were invisible to the "used but not declared" check.
    expect(decodeSourceLiteral(String.raw`a — b`)).toBe("a — b");
    expect(decodeSourceLiteral(String.raw`line\nbreak`)).toBe("line\nbreak");
    expect(decodeSourceLiteral(String.raw`say \"hi\"`)).toBe('say "hi"');
    expect(decodeSourceLiteral(String.raw`back\\slash`)).toBe("back\\slash");
  });

  test("a literal with no escape is returned unchanged", () => {
    expect(decodeSourceLiteral("Log out")).toBe("Log out");
  });

  test("an UNKNOWN escape skips the literal rather than guessing", () => {
    // Same choice `decodeEscapes` in po.ts makes. Guessing would let the gate
    // demand a msgid whose text nobody wrote.
    expect(decodeSourceLiteral(String.raw`a \q b`)).toBeNull();
    expect(decodeSourceLiteral(String.raw`emoji \u{1F600}`)).toBeNull();
    expect(decodeSourceLiteral(String.raw`short \u12`)).toBeNull();
  });

  test("agrees with the PO parser on the TEXT, though not on the escapes", () => {
    // The two formats escape DIFFERENTLY, and that is fine — what has to match
    // is the decoded string, because the two sides are compared as keys. A
    // `.po` stores a real em dash and its parser rejects `\u` outright; a
    // TypeScript source stores the `—` form, because that is what prettier
    // writes. Asserting the escapes were identical would be asserting something
    // untrue about the formats.
    const fromSource = decodeSourceLiteral(String.raw`Deleted — not purged`);
    const fromCatalog = parsePo('msgid "Deleted — not purged"\nmsgstr ""');

    expect(fromSource).toBe("Deleted — not purged");
    expect(fromSource).toBe(fromCatalog.entries[0]!.msgid);
  });
});
