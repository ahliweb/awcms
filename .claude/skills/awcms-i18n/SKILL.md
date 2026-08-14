---
name: awcms-i18n
description: Add/change AWCMS UI strings or multi-language content correctly. Use when adding new UI text, adding a locale, formatting numbers/currency/dates, or adding a content field that needs to be multi-language. Enforces the gettext .po catalogue (default en, min en+id), locale resolution via middleware, and the multi-language content conventions of doc 04 per Issue #433.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — i18n (UI Strings & Multi-language Content)

Source of truth: **`docs/awcms/14_ui_ux_design_system.md`** §Internationalization and **`docs/awcms/04_erd_data_dictionary.md`** §Multi-language content. Reference implementation: `src/lib/i18n/`, `i18n/{messages.pot,en.po,id.po}` (Issue #433).

## Two layers — do not mix them

1. **Static UI strings** (labels, buttons, error messages, navigation) → gettext `.po`/`.pot` catalogue, **not** the database. Keys are `namespace.key` (e.g. `admin.settings.save_button`, `error.access_denied`).
2. **Multi-language data content** (user input — product names, descriptions, etc.) → stored in the database **per active locale** (per-locale JSONB or a translation table `(entity_id, locale, field, value)`), **not** in `.po`. There is already a real example to copy, not just an abstract pattern: `awcms_email_templates.subject_template`/`text_body_template`/`html_body_template` (`sql/014`) — per-locale JSONB `{"en": "...", "id": "..."}`, at least one locale filled, with the same fallback chain (`locale → en → raw key`) as the `.po` catalogue above. New domain modules (e.g. `blog_content`, epic #536) that need multi-language content fields (post title/body, etc.) follow this pattern exactly; do not invent a different translation schema without a strong reason.

## Adding a new UI string

1. Use it on the server: `const t = await createTranslator(locale)` (`src/lib/i18n/translate.ts`), then `t("namespace.key", params?)`. Fallback chain: `locale → en → raw key` — it never crashes on a missing key.
2. Run `bun run i18n:extract` (`scripts/i18n-extract.ts`, Issue #694) — it scans every `t("...")` in `src/` and rewrites `i18n/messages.pot` **deterministically** (alphabetically sorted, `#: file:line` per key). Your new key lands in that template automatically; **do not** hand-edit `messages.pot` any more.
3. Fill in `msgstr` for that new key in `i18n/en.po` **and** `i18n/id.po` — this is still a manual step (extraction only manages the key inventory, it does not translate).
4. Commit all three files (`messages.pot`, `en.po`, `id.po`) together. `bun run i18n:pot:check` (part of `bun run check`) fails if the committed `messages.pot` is not identical to a regeneration from source — a sign you forgot step 2.
5. Using it in a client script (inline `<script>` in an `.astro` page): you **cannot** call `createTranslator` (the catalogue is server-side only) — inject the strings you need via `<script type="application/json" set:html={JSON.stringify(clientStrings)} />` in the frontmatter and read them in the client script (the `login.astro`, `admin/access-users.astro` pattern).
6. Error banner messages: map error codes (doc 05) to localized keys via `translateErrorCode`/`buildClientErrorMessages` (`src/lib/i18n/error-messages.ts`) — do not hardcode a message per error code on every page.

## Dynamic key (t(\`ns.${var}\`), t(entry.labelKey), t(key) from a map)

A literal-string scan cannot find keys that are used dynamically. Three real patterns in this codebase are handled explicitly by `scripts/i18n-extract.ts` so that keys which really are used are not wrongly flagged "obsolete":

- `t(\`admin.blog.status.${post.status}\`)`(template-literal interpolation) — resolved through the`DYNAMIC_KEY_FAMILIES`table in`scripts/i18n-extract.ts`, mapping the prefix to the concrete suffixes from the original domain enum (same pattern as `CONFIG_EXEMPTIONS`, Issue #689). **Adding a new such pattern in source MUST be followed by a new entry in that table** — otherwise `bun run i18n:extract`/`i18n:pot:check` fails (rather than silently under-extracting).
- `t(entry.labelKey)` (nav menu) — resolved from the literal definition `labelKey: "admin.layout.nav_x"` in each `src/modules/*/module.ts`, not from the call site.
- `t(key)` from `ERROR_CODE_KEYS` (`src/lib/i18n/error-messages.ts`) — resolved from that map's values themselves.

## Placeholder parity, obsolete keys, plural forms (Issue #694)

- **Placeholders**: `{name}`-style is the only placeholder format this catalogue uses (there is no `%s`/`%d`). `bun run i18n:parity:check` fails if `en.po` and `id.po` have a different placeholder set for the same key — a translator who forgets to copy `{name}` is caught in CI instead of silently rendering the raw text `{name}`.
- **Obsolete keys**: `bun run i18n:extract` reports (does not delete) keys present in `en.po` but not found in any source. Before deleting one, make sure it is not a dynamic key (see the section above); if it really is unused, mark it `#~ ` (the gettext obsolete marker) in all three files instead of deleting it outright.
- **Plural forms**: this catalogue does **not** use `msgid_plural`/`msgstr[n]` at all (a current design decision, not an oversight — `po-parser.ts` does not implement plural parsing either). `bun run i18n:parity:check` includes a tripwire that fails if `msgid_plural` ever appears.

## Locale resolution — MUST be in middleware, not in the layout

**Real gotcha (Issue #433)**: an Astro page's frontmatter runs **before** the frontmatter of the layout that wraps it. Resolving the locale (cookie → tenant `default_locale` → `en`) inside the layout (`AdminLayout.astro`) makes the shell render correctly while the page content stays in the default language — a real bug that happened and has been fixed.

- Locale resolution **MUST** happen in `src/middleware.ts` (`resolveRequestLocale`/`resolveLocale`, `src/lib/i18n/locale.ts`), be stored in `Astro.locals.locale`, and every page/layout reads `Astro.locals.locale` directly — **do not** re-resolve the locale yourself in any layout or page.
- Precedence: cookie `awcms_locale` → `SsrContext.tenantDefaultLocale` (carried from a query that already exists in `resolveSsrContext`, with no new DB round-trip) → fallback `en`.

## Language switcher

`src/components/LanguageSwitcher.astro` — sets the cookie and then does a **full reload** (`window.location.reload()`), **not** an instant swap like the theme toggle. Reason: the locale changes SSR-rendered text, not just CSS — an instant swap cannot re-read the server-side catalogue. Show a flag icon + the language's native name (`LOCALE_FLAGS`/`LOCALE_LABELS`, `src/lib/i18n/locale.ts`), not the raw locale code (`en`/`id`).

## Locale-aware formatters

`src/lib/i18n/format.ts` — `formatNumber`/`formatCurrencyIDR`/`formatDate`/`formatDateTime` (`Intl.NumberFormat`/`DateTimeFormat`, tags `en-US`/`id-ID`, timezone fixed to `Asia/Jakarta`). **Gotcha**: `Intl.NumberFormat` currency style inserts U+00A0 (no-break space) between the symbol and the number, not an ordinary space — test assertions must use that exact character, not `" "`.

## Adding a new locale (`ms`/`ar`, etc.)

1. Add it to `SUPPORTED_LOCALES` (`src/lib/i18n/locale.ts`) + `LOCALE_LABELS`/`LOCALE_FLAGS` + the `INTL_LOCALE_TAG` tag (`format.ts`).
2. Add `i18n/<locale>.po` with a keyset identical to `en.po`.
3. The DB column `default_locale` may already accept that value (doc 04 §ERD) for backward compatibility — but the UI (`LanguageSwitcher`, the Settings dropdown) may only offer locales that **actually have a catalogue** (`SUPPORTED_LOCALES`); do not offer a locale with no real translation.

## Verification

- Switch the locale (switcher/cookie/tenant `default_locale`) → the whole UI changes language with no hardcoded string left behind, **including page content**, not just the layout shell.
- No flash of the wrong language during SSR.
- `bun run check` green (including `i18n:pot:check` and `i18n:parity:check`); `.po` keyset + placeholders identical across all three files.
- IDR/date formatters follow the correct locale/timezone.

## Related skills

`awcms-ui-screen` (uses `t()`/formatters when building screens), `awcms-ux-review` (audits hardcoded strings that slipped past extraction).
