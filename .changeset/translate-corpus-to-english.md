---
"awcms": minor
---

docs(i18n): the whole corpus is English with Indonesian mirrors — the ledger reaches zero

The rest of the ADR-0097 migration: 97 ADRs, 75 `docs/awcms` documents, 21 module
READMEs, `ARCHITECTURE.md`, `PROJECT_STATE.md`, `scripts/README.md` and
`src/lib/README.md`. Every document is now English at its bare path with an
Indonesian mirror at `<name>.id.md`, banner-linked both ways and held together by
the `i18n-source-hash` marker. **`DOCS_AWAITING_MIRROR` is empty.**

**The seeding assumption was wrong for 21 documents, and nothing could see it.**

Mirrors are seeded by copying the source, on the assumption the source is
Indonesian awaiting translation. Twenty-one documents were *already written in
English* — four ADRs and seventeen module READMEs and runbooks, which makes sense
because those are developer-facing and were written in English from the start. So
seeding produced an English file named `.id.md`.

The rails structurally cannot detect this. The recorded hash matches (it is a
copy of the source), the banner is correct, and `check:docs:translation` is green
— while an Indonesian reader following the link gets English. It surfaced only
because a translator volunteered "already English — left unchanged" in its report,
which prompted checking the other direction.

That is the same shape as the two gates this migration already exposed as
half-blind: **a check inherits the assumptions of whoever wrote it.** The
verification built for this migration asked whether the English side still
contained Indonesian; it never asked whether the Indonesian side was Indonesian,
because the migration was only ever imagined as running one way. All 21 are now
real Indonesian, verified by stopword density on both sides.

**The inventory generators had to be translated too, and that was not cosmetic.**
`repo-inventory.ts`, `project-state-inventory.ts` and `scripts-inventory.ts`
write markdown *into* three of the documents being translated. Left in
Indonesian, the next `:generate` would have silently reverted those translations
— and no gate would have objected, because the gates check that the artefact
matches the generator, and it would have. 66 strings across four generators,
table headers and cell values included.

The OpenAPI `description` fields and the generated `api-reference.md` were
checked and are **already entirely English** — that half of the scope did not
exist.
