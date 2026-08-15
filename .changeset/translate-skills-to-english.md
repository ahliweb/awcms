---
"awcms": minor
---

docs(i18n): all 56 skills are English, with Indonesian mirrors — the ledger falls 253 → 197

The first batch of the ADR-0097 migration, and deliberately the first: skills are
read by coding agents, and a skill that is misread produces wrong work rather
than confusion. This repo has already recorded skills whose stale claims sent an
agent the wrong way. 13,000 lines of operational instruction now say what they
mean in the language every reader and every agent actually gets.

Each skill is English at `SKILL.md` with a verbatim Indonesian mirror at
`SKILL.id.md`, banner-linked both ways and held together by the
`i18n-source-hash` marker.

**Three defects had to be fixed before a single file could be translated, and two
of them were introduced by the language inversion itself.**

1. **The stamping tool would have silently broken every skill.** It writes the
   bilingual banner as line 1 — correct for the 198 plain documents, wrong for
   the 55 files that open with YAML frontmatter. A banner above `---` does not
   fail loudly; the frontmatter simply stops being frontmatter, and every skill
   loses the `name`/`description` that decide when it is selected. A repo full of
   skills nobody selects looks exactly like a repo whose skills were never
   needed. `tests/skill-frontmatter.test.ts` now asserts the invariant on the
   artefact and fails when the banner is put back on top.

2. **`module-absence-claims` fired on a correction note.** Its exoneration
   markers (`SUDAH`, `kini`, `Versi sebelumnya`, …) were Indonesian-only, so
   translating a document REMOVED its exoneration while leaving the absence
   phrasing intact — and the gate then failed on a paragraph whose whole purpose
   is to say the claim is obsolete.

3. **`doc-inventory-counts` stopped covering translated files entirely, without
   failing.** Its module-total pattern expects the Indonesian word order
   (`**22 modul terdaftar**`); English puts the qualifier first
   (`**22 registered modules**`), so it matched nothing. Not a failure — a
   silent loss of coverage, which as the corpus becomes English would have grown
   to the whole corpus one document at a time. Same shape as the `dot: true`
   blind spot this gate's own header records.

Both 2 and 3 are the same class: **a gate that matches on prose is a gate with a
language.** They were found by translating, and they are the reason to translate
in batches with the full chain green at each step rather than in one sweep.

The ADR index gate also now reads the ENGLISH `docs/adr/README.md` as
authoritative rather than the Indonesian mirror — under ADR-0097 asking the mirror
to lead is asking the copy to lead. The mirror stays covered by its hash.

`docs:i18n:stamp` no longer advises running `format` afterwards. That is
backwards and it cost a debugging round: formatting an English source after
stamping changes its bytes, so every mirror hash goes stale and the gate reports
17 files as mistranslated when nothing was. Format first, then stamp.

197 documents remain on the shrink-only ledger.
