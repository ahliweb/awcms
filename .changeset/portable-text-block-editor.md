---
"awcms": minor
---

feat(admin-ui): the article editor can open a post with a gallery in it

`/admin/blog` was a plain-paragraph `<textarea>`, and it **refused to open** any
post whose body held a gallery or a video embed. That refusal was correct — it
could only write paragraphs, so saving would have destroyed those blocks — and
it meant that once an article had a gallery, its title and slug stayed editable
while **its body could never be touched from the CMS again**.

There is now a block editor, on top of the Portable Text ADR-0100 landed.

### Written here rather than pulled in, and the number is the argument

The editor costs **5,271 B** of client budget — 3,942 B of script, 1,329 B of
CSS. Measured on clean builds, `main` 181,418 B -> 186,689 B.

The alternative was TipTap + ProseMirror: roughly 150-250 kB across ~20
transitive packages, which would have broken the 27,000 B per-file cap about
tenfold and roughly doubled the client total, in a repo that ships exactly TWO
runtime dependencies and writes all 44 of its admin screens in vanilla
TypeScript.

It is that small because the vocabulary is CLOSED: three decorators, one
annotation, eight block styles, two list kinds. A general editing framework is
large because it must handle a vocabulary nobody has enumerated. This one does
not, so it does not need one.

### Three decisions that make it small

**One editable element per block, not one per document.** Portable Text is an
array of blocks and Sanity's own editor is block-based for the same reason: a
document-wide `contenteditable` has to solve cross-block selection, block
splitting and undo across the whole array. One element per block maps 1:1 onto
the data and keeps every hard case local.

**Paste is inserted as plain text.** This removes the editor's hardest security
question entirely — the editable region only ever contains tags this page
created, so the parser never has to reason about what a browser produced from
somebody's Word document. It is also the better editorial outcome.

**A gallery or video is an opaque card**, parsed from `data-opaque` and pushed
back byte-identical. That is what lets such a post be edited at all.

### Also

An `href` never reaches the editable DOM — it stays in `markDefs` and the span
carries only `data-mark`, so a stray click inside the editor cannot navigate and
the editor never trusts an href read back out of its own markup. Orphaned
annotations are pruned with their marks, because the validator refuses a mark
naming no declared annotation and the two must move together or a save fails on
content the editor itself produced.
