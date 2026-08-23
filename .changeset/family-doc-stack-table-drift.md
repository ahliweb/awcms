---
"awcms": patch
---

docs(family): the stack table said Astro `^7.0.7` while the repo ran `^7.2.2`, and nothing was looking

`docs/awcms/family-compatibility.md` is where a human goes to find out which
Astro this repo is pinned to. It said `^7.0.7` and `@astrojs/node` `^11.0.2`.
`package.json` and the manifest both said `^7.2.2` and `^11.1.2`, and
`family:conformance:check` was green the whole time — it proves the manifest's
`declared` values against their real `source`, and never reads the prose.

### The drift has a direction, which is why it needed a gate and not a fix

The Bun, TypeScript and PostgreSQL rows were correct. The two stale rows were
exactly the two that **dependabot moves**: a bump edits `package.json`, the
conformance gate forces the manifest to follow, and there the chain stops.

So this table does not rot randomly. It ages in the direction dependency bumps
push it, at the rate they land, and silently — which makes it worse than no
table at all. An absent table sends the reader to `package.json`; a confident
wrong one does not.

Correcting the two rows without closing that would have bought a few weeks.

### `tests/family-compatibility-doc-parity.test.ts`

Every row of the stack table in **both** the English source and the `.id.md`
mirror is now compared against the manifest, cell by cell. Em-dash cells are
asserted as absent values, so a real number cannot be quietly added where the
matrix says the repo declares none.

Both files are read rather than just the source. The translation gates compare
the mirror's `i18n-source-hash` against the English file, which catches "the
source moved and the mirror did not" — it cannot catch "both were written
wrong on the same day", which is what had happened here.

Proved by mutation in five directions, each naming the offending file and row:
the original defect restored; the mirror drifting alone; a row deleted; an
em-dash cell gaining a value; and the real future case — the manifest bumped
to `^7.2.4` with the docs untouched, which reddens both files by name.
