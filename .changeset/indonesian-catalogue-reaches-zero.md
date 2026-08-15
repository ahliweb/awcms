---
"awcms": patch
---

fix(i18n): the Indonesian catalogue reaches ZERO — and one screen was shipping Indonesian as its English source

`MAX_UNTRANSLATED_ID_ENTRIES` goes **718 → 0**. All 1,258 msgids now carry an
Indonesian translation, which is PROJECT_STATE §4's next step 1 closed rather
than deferred again.

## The defect the count was hiding

Translating the backlog meant reading every untranslated msgid, and eighteen of
them were **already Indonesian** — the msgid ITSELF, in `en.po`, the file this
repo calls its English source since ADR-0097.

`/admin/blog-settings` was the whole of it. Its bulk `t()` migration wrapped the
screen's existing Indonesian literals instead of translating them first, so:

- `en.po` uses the gettext identity fallback (`msgstr ""` → the msgid IS the
  output), which means an **English reader got an Indonesian screen** —
  `Simpan`, `Judul blog`, `RSS aktif`, `Anda tidak punya permission`;
- `id.po` left those eighteen untranslated, so an Indonesian reader got the same
  page by ACCIDENT — falling back to a msgid that happened to be their language.

Both locales rendered something plausible, which is exactly why no gate and no
screenshot review would ever have caught it. The one artefact that disagreed was
the untranslated counter, and only once somebody read the strings it was
counting.

Two more Indonesian strings were outside the catalogue entirely — the client
script's `Gagal menyimpan pengaturan…` and `Tersimpan.` were hard-coded, so they
were Indonesian in *every* locale with nothing declaring them. They now travel
through the `#blog-settings-i18n` data-attribute seam `/admin/account` already
uses.

The screen is fully English-sourced and comes **off** the
`i18n:screens:check` ledger (18 → 17). Its five-fragment trailing note is merged
into one msgid with `{setting}`/`{table}` placeholders — the merge PROJECT_STATE
§4 step 2 prescribes, because a translator handed `BUKAN di sini — ia setting
modul, disimpan di` cannot reorder a sentence they only see in pieces.

`t("Identity")` was deliberately NOT reused for the blog's identity fieldset:
that msgid already exists carrying the `menu-section` context, where it names the
identity_access module group. Two unrelated senses on one key is the ambiguity
`msgctxt` exists to prevent, so the legend is `Blog identity`.

## A fifth check, because the ledger at 0 is not the same as correct

`i18n:catalog:check` now asserts **placeholder parity**: every `{name}` in a
msgid survives into its translation, and none is invented.

This is the one translation defect a machine can see, and it is silent in both
directions. A dropped `{days}` renders a sentence that reads perfectly and has
lost its number. An invented `{dyas}` is left VERBATIM by `interpolate()` (a
deliberate choice there — an unmatched placeholder is printed rather than
blanked), so the reader gets a literal brace mid-sentence. Neither is visible in
a review of the English.

Proven against both shapes rather than merely green: dropping `{days}` from
`Allow ({days} days)` and renaming `{linked}` to `{tautan}` in `Connected
{linked}` are each reported, with the line number and both placeholder sets.
Plural entries compare against the UNION of `msgid` and `msgid_plural`, since
Indonesian's single form has to serve both; comparing sets rather than sequences
keeps reordering legal, which it must be, because Indonesian does not put a
two-placeholder sentence in the English order.

The ledger stays at 0 rather than being deleted. At 0 it rejects the next msgid
that lands without Indonesian on the day it lands — the alternative is counting
again in a year.
