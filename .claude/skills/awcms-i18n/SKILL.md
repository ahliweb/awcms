---
name: awcms-i18n
description: Add/change AWCMS UI strings or multi-language content correctly. Use when adding new UI text, adding a locale, formatting numbers/currency/dates, or adding a content field that needs to be multi-language. Enforces the gettext .po catalogues in locales/ (default en, min en+id), locale resolution via middleware, and the multi-language content conventions of doc 04 per ADR-0095.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — i18n (UI Strings & Multi-language Content)

Source of truth: **[ADR-0095](../../../docs/adr/0095-the-interface-speaks-the-readers-language.md)**, `docs/awcms/14_ui_ux_design_system.md` §Internationalization, and `docs/awcms/04_erd_data_dictionary.md` §Multi-language content. Implementation: `src/lib/i18n/`, catalogues in `locales/{en,id}.po`.

> **This skill was rewritten on 2 September 2026 because it described a system that was never built.** It named an `i18n/` directory, a `messages.pot` template, `bun run i18n:extract`, `i18n:pot:check`, `i18n:parity:check`, `scripts/i18n-extract.ts`, `src/lib/i18n/translate.ts`, `src/lib/i18n/locale.ts` and `src/lib/i18n/error-messages.ts` — **none of which exist**. What ADR-0095 actually shipped is smaller and different in kind: hand-maintained catalogues, compiled, with two verifying gates and no extraction step. If anything below disagrees with `package.json` or `grep -n "^export" src/lib/i18n/index.ts`, believe the code.

## Two layers — do not mix them

1. **Static UI strings** (labels, buttons, error messages, navigation) → gettext `.po` catalogues in `locales/`, **not** the database.
2. **Multi-language data content** (user input — product names, descriptions) → stored in the database **per active locale** (per-locale JSONB or a translation table `(entity_id, locale, field, value)`), **not** in `.po`. There is a real example to copy: `awcms_email_templates.subject_template`/`text_body_template`/`html_body_template` (`sql/014`) — per-locale JSONB `{"en": "…", "id": "…"}`, at least one locale filled, same fallback chain. New domain modules follow this exactly; do not invent a second translation schema.

## The msgid IS the English sentence

There are **no `namespace.key` identifiers**. `t("Skip to main content")`, not `t("admin.layout.skip_link")`. Two consequences worth internalising:

- An untranslated locale degrades to readable English, not to a key.
- A reviewer reads the actual sentence in the diff, so bad copy is catchable.
- Changing the English **changes the msgid**, which orphans the translation. That is intentional — a reworded sentence usually needs re-translating anyway — but it means a copy tweak is a catalogue edit too.

Use `tx("context", "Order")` when the same English word needs two different translations (the noun vs the verb). Without it, one of them is always wrong.

## Adding a new UI string

1. **Server side:** `const { t, tn, tx } = getTranslator(locale)` (`src/lib/i18n`), then `t("Your English sentence", { name })`. Placeholders are `{name}` only — there is no `%s`/`%d`. A placeholder with no matching value is left verbatim rather than blanked.
2. **Add the pair by hand** to `locales/en.po` **and** `locales/id.po`. There is nothing to extract; the gate is what tells you if you forgot.
3. **`bun run i18n:compile`** and commit the regenerated `src/lib/i18n/catalogs/*.generated.ts` alongside the `.po` files. `i18n:catalog:check` recompiles and compares bytes, so a stale generated file is a red gate, not a silent divergence.
4. **Client scripts cannot translate.** The catalogue is a server module, and shipping it would send both languages to every browser. Pass the translated string down as a `data-*` attribute — the pattern `AdminLayout.astro` uses for its logout button's busy label, and `ThemeToggle` for its three mode labels.
5. **Error-code messages** are currently mapped **per screen, inline** (`blog-ads.astro`, `blog-homepage.astro`). There is no `translateErrorCode`/`buildClientErrorMessages` and no `src/lib/i18n/error-messages.ts`, whatever older docs say. A central map is worth building; until then, follow the local pattern and keep the wording consistent by hand.

## Two gates, deliberately separate

- **`bun run i18n:catalog:check` — consistency.** Recompiles every `.po` and compares bytes; asserts every msgid the code asks for is declared; checks each catalogue's `nplurals` against `PLURAL_FORM_COUNT`; checks `{placeholder}` parity between msgid and msgstr; reports the untranslated `id` count against a **shrink-only ledger**.
- **`bun run i18n:screens:check` — coverage.** Finds admin screens still rendering literal English text nodes, against its own shrink-only ledger of named screens. A newly added screen must be translated because it cannot join a list that never grows.

Fusing them would produce a gate that is green while every answer it gives is wrong; both script headers say so at length. **Do not raise either ledger** — that is how translation debt becomes permanent.

What the coverage gate deliberately does **not** scan: attributes. `aria-label="Close"` needs translating just as much, but `class="admin-card"` looks identical to the scanner, and a gate that reports class names trains its readers to ignore it. So a passing screen may still have an untranslated `placeholder`, `aria-label` or `title` — check those by hand.

## Plural forms ARE implemented

`tn("1 file", "%d files", count)` — with `PLURAL_FORM_COUNT` and `PLURAL_SELECTOR` in `src/lib/i18n/locales.ts`. Indonesian declares `nplurals=1` because it does not inflect for number ("satu berkas" / "dua berkas"). The `plural=` expression in a `.po` header is **read to be verified, never evaluated** — `i18n:catalog:check` asserts it agrees with the code's table rather than running it.

## Locale resolution — MUST be in middleware, not in the layout

**Real gotcha:** an Astro page's frontmatter runs **before** the frontmatter of the layout that wraps it. Resolving the locale inside `AdminLayout.astro` makes the shell render correctly while the page content stays in the default language — a bug that actually happened.

- Resolution happens in `src/middleware.ts` via `resolveRequestLocale` (`src/lib/i18n/request-locale.ts`), is stored on `Astro.locals`, and every page/layout reads it from there. **Do not re-resolve the locale in a layout or page.**
- Precedence: cookie `awcms_locale` (`LOCALE_COOKIE_NAME`) → the tenant's `default_locale` carried on `SsrContext` (no new DB round-trip) → `DEFAULT_LOCALE` (`en`).

## Language switcher

`src/components/LanguageSwitcher.astro` sets the cookie and does a **full reload**, not an instant swap like the theme toggle — the locale changes SSR-rendered text, and only a cookie reaches the server before render. Show `LOCALE_FLAG` + `LOCALE_ENDONYM` (the language's own name), not the raw code.

## Locale-aware formatters

`src/lib/i18n/format.ts` — `formatNumber`/`formatCurrency`/`formatDate`/`formatDateTime`, built on `Intl` with `LOCALE_INTL_TAG` and the timezone fixed to `Asia/Jakarta`. **Gotcha**: `Intl.NumberFormat` currency style inserts U+00A0 (no-break space) between symbol and number, not an ordinary space — a test asserting `" "` fails for a reason you cannot see in the diff.

## Adding a new locale (`ms`/`ar`, etc.)

1. Add it to `SUPPORTED_LOCALES` + `LOCALE_ENDONYM`/`LOCALE_FLAG`/`LOCALE_INTL_TAG` + `PLURAL_FORM_COUNT`/`PLURAL_SELECTOR` (`src/lib/i18n/locales.ts`).
2. Add `locales/<locale>.po` with the same msgid set as `en.po`, then `bun run i18n:compile`.
3. **Check the fonts.** The self-hosted subsets in `public/fonts/` are latin/latin-ext only (ADR-0120); a locale in another script needs its subsets added, and `FONT_BUDGET_BYTES` in `scripts/client-asset-budget.ts` is where that cost becomes visible.
4. The DB column `default_locale` is free `text`, so no migration is needed — but the UI may only offer locales that actually have a catalogue.

## Verification

- Switch the locale (switcher/cookie/tenant `default_locale`) → the whole UI changes language, **including page content**, not just the shell.
- No flash of the wrong language during SSR.
- `bun run i18n:catalog:check` and `bun run i18n:screens:check` both green, with neither ledger raised.
- IDR/date formatters follow the correct locale and timezone.

## Related skills

`awcms-ui-screen` (uses `t()`/formatters when building screens), `awcms-ux-review` (audits hardcoded strings), `awcms-module-management` (`labelKey` → `SIDEBAR_LABELS` → translated by the layout).
