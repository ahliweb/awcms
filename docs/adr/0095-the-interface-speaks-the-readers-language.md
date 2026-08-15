🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0095-the-interface-speaks-the-readers-language.id.md)

# ADR-0095 — The interface speaks its READER's language, and its catalogue ships inside `dist/`

- **Status:** Accepted (2026-08-14).
- **Context:** Product requirement — the admin must be readable in Indonesian
  and English. This repo targets the Indonesian market (see
  [ADR-0046](0046-idn-admin-regions-module-admission.md), which vendors the
  Kemendagri region hierarchy), yet **all 40 admin screens ship English
  literals** and `src/components/LocaleBadge.astro` is a DEAD badge whose own
  comment states the reason: "awcms has NO i18n module … so a switcher would be
  a control with nothing behind it".
- **Admission:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
  §3 — new capabilities are BUILT in this repo with their own ADR, not ported
  from the archives. `awcms-micro` has a `LanguageSwitcher` + gettext
  catalogue; it is read as a specification, not copied.
- **Builds on:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (a principal is
  GLOBAL — one human, one credential),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) (HUMAN properties move to the
  principal; global table, four controls replacing RLS),
  [ADR-0088](0088-tenant-selection-and-switching.md) (there are screens rendered
  BEFORE a tenant is picked), and
  [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (an edge cache in front
  of a multi-tenant application).

## Why an ADR, and why not "just add `t()`"

The three things below cannot be inferred from the code, and all three are
wrong if guessed:

1. **Where the language preference LIVES.** The obvious answer
   (`awcms_identities`, tenant-scoped) produces one human who picks their
   language over and over in every tenant — and cannot localise the tenant
   selection screen at all.
2. **How the catalogue GETS to production.** This repo just paid for that
   lesson with 29 jobs that died silently.
3. **What happens to the edge cache** when one URL has two response bodies.

## Decision 1 — The language preference belongs to the PRINCIPAL, not to a per-tenant identity

New table `awcms_principal_preferences` (sql/128): GLOBAL, no `tenant_id`, no
RLS, keyed by `principal_id`. Its shape copies
`awcms_principal_mfa_factors` ([ADR-0087](0087-mfa-moves-to-the-principal.md))
exactly, including the explicit privilege registration in
`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`.

The reasoning is the same as the reasoning for moving MFA, one layer
shallower: **the language a person reads is a property of that person, not a
property of their tenant membership.** A human who reads Indonesian reads it in
three tenants at once; storing it per-identity means they set it three times
and lose the setting every time they are invited to a fourth tenant.

But the argument that DECIDES it is not that convenience — it is
[ADR-0088](0088-tenant-selection-and-switching.md). The tenant selection screen
is rendered **when there is no tenant yet**. A preference carrying a
`tenant_id` structurally cannot be read there, so the first screen an
Indonesian user sees after login would be in English forever. That is not a
shortcoming you can patch later; it is the consequence of picking the wrong
key.

### Why this is NOT the forbidden cross-tenant read

[ADR-0094](0094-a-data-subject-is-answered-per-tenant.md) warns, correctly,
that "ADR-0087 and ADR-0088 both planned a cross-tenant read that FORCE RLS
forbids, and both were only caught at implementation time". That warning was
read and **does not apply here**, and the difference must be written down so it
is not re-read as the wrong precedent:

- What FORCE RLS forbids is reading a **table carrying `tenant_id`** for
  another tenant. That is what makes a cross-tenant subject export impossible.
- This table has **no `tenant_id`**, exactly like `awcms_principals` and
  `awcms_principal_mfa_factors`. No RLS policy is bypassed, because no RLS
  policy applies — the same as `awcms_permissions`.

What replaces RLS are the ADR-0085 controls, reused without being loosened:
narrowed privileges (`DELETE` withheld permanently — a preference is RESET by
writing the default value, never deleted), writes confined to a single store
module, and **an authorization boundary that does not move: holding a
preference row grants no rights whatsoever.** This row is a string `"id"`; it
is neither a credential nor a target list, so it is NOT added to
`identity:principal-access:check` — that gate guards password hashes and the
list of who-has-a-second-factor, and widening it for a language choice would
blur what it actually guards.

## Decision 2 — The `msgid` IS the English source text

The catalogue uses the gettext form (`locales/en.po`, `locales/id.po`) with the
`msgid` being the **English string already present in the code**, not an
invented key (`admin.nav.posts`).

This is not taste. Sidebar labels are rendered from
`ModuleDescriptor.navigation[].label` across 24 modules; an invented-key scheme
demands that every descriptor grow a new key field, which means touching the
module registry and every gate that validates its shape. With `msgid` = source
text, `t(entry.label)` translates the existing label **without a single
descriptor changing**, and an untranslated string falls back to correct English
instead of to an `admin.nav.posts` leaking onto the screen.

A consciously accepted consequence: changing an English sentence breaks its
translation. That is exactly the gettext behaviour we want — a sentence whose
meaning changed MUST be retranslated, and the gate in Decision 4 is what makes
that breakage visible.

### The `Plural-Forms` expression is NOT evaluated

The `.po` header carries `Plural-Forms: … plural=(n != 1)`. That is a C
expression inside a **data file**, and this repo does not execute expressions
that come from data. The plural form selector is a
`Record<Locale, (n) => number>` table inside the code (`en` → 2 forms, `id` → 1
form — Indonesian does not inflect for plural), and `i18n:catalog:check`
rejects a catalogue whose `nplurals` does not match that table. The header is
read to be VERIFIED, not to be run.

## Decision 3 — The catalogue is COMPILED into TS modules that get bundled

`bun run i18n:compile` turns `locales/*.po` into
`src/lib/i18n/catalogs/*.generated.ts`. The runtime **never** reads `locales/`
from disk.

The reason is written in `docs/PROJECT_STATE.md` §4 in blood: the `runtime`
stage of `Dockerfile.production` copies only `dist/`, `node_modules/`, and
`package.json`. No `scripts/`, no `src/` — and **all 29 neatly registered jobs
exited with `Script not found` inside the production container**, silently, for
weeks. A catalogue read from `locales/` at request time is the EXACT SAME
defect, one subsystem over: green in dev, green in CI, and in production every
screen suddenly in English with not a single error.

A generated file is only legitimate when its generator exists and CI runs it —
the lesson of `.generated` without a generator is "a false claim". Hence
Decision 4.

## Decision 4 — One gate: `bun run i18n:catalog:check`

It joins the `bun run check` chain. PURE (no DB, no network). It rejects:

1. **A stale generated catalogue** — recompile the `.po` and compare bytes.
   This is what makes the `.generated` file a fact instead of a claim.
2. **A `msgid` used by the code but missing from the catalogue** — harvested
   from `t()`/`tn()` calls with literals.
3. **A mismatched `nplurals`** against the plural form table in the code.
4. **Empty or `fuzzy` `id` entries** — reported as unfinished coverage, with a
   threshold that may only SHRINK (the ADR-0094 §139→0 ledger pattern). An
   untranslated screen is visible debt, not hidden debt.

This gate deliberately does NOT claim to find English literals that were
forgotten by `t()`. That is a different question (coverage, not consistency),
its threshold lives in §4 point 4, and merging the two would produce a gate
that is green while all of its answers are wrong — a defect class already
recorded in the project memory.

## Decision 5 — Locale resolution order, and what is NOT cached

The middleware sets `Astro.locals.locale` for **every** request:

1. The `awcms_locale` cookie override (written by the language switcher; it
   applies before login, on the tenant selection screen, and for anonymous
   readers).
2. The stored principal preference (only when the session has resolved).
3. `awcms_tenants.default_locale` — a column that has **already existed** since
   sql/001 and is read by `seo_distribution` for hreflang; this is its second
   reader.
4. `Accept-Language` negotiation.
5. `en`.

**The edge cache hazard, stated up front.** One public URL whose body varies by
cookie is a cross-serving machine: Varnish will serve the Indonesian page to an
English reader. Therefore this ADR localises **no** public surface at all. It
sets `locale` (which nothing on the public path reads yet) and localises
`/admin`, which is `private, no-store` by ADR-0042 construction. Localising a
public surface demands that the cache key carry the locale too, and that is its
own decision in a later ADR — recorded as a prerequisite, not as an
implementation detail.

## Consequences

- Every new admin screen ships its strings through `t()`; the ones forgotten
  will show up in the coverage threshold instead of disappearing.
- `LocaleBadge` is DELETED and replaced by a `LanguageSwitcher` that actually
  changes the language. The badge was honest when it was written; it became
  dishonest the minute its capability landed.
- `awcms_tenants.default_theme` — a column that EXISTS but was never read by
  anyone — gets its first reader through the `data-tenant-default-theme` seam
  already documented by `theme-init-script.ts`. The comment in that file
  claiming the column "does not exist" is wrong and is corrected.
- Public locale, correct hreflang (`seo_distribution` currently passes
  `locale: null`), and multi-language content are NOT included here. All of
  them demand the cache-key decision above first.
