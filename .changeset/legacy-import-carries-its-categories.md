---
"awcms": minor
---

feat(blog): the legacy importer files its articles, instead of landing 23,906 of them under nothing

`LegacyPostImportInput` carried no taxonomy and `importLegacyBlogPost` wrote no
join row, so a real import landed EVERY article with zero categories. The defect
is not visible where you would look for it: each article renders correctly and
reads correctly. The symptom appears somewhere else — `/{locale}/kategori/{slug}`,
the page each legacy rubrik URL is redirected to, loads and lists nothing.

A crawler reads that as a **soft 404**, which is worse than the hard 404 this
issue exists to prevent: nothing reports it, and no test that looks at an
article would ever see it.

**The same handoff as the images, deliberately** — it is the same operator doing
the same kind of work twice:

- `--terms=<path>` writes the category work list (every legacy category the
  archive files under, most-used first) and stops.
- `--term-map=<path>` takes it back as `{ "<legacy name>": "<term uuid>" }`.

Every id is checked against this tenant's **live** taxonomy before a single
article is written, and one that is not aborts the whole run — a map is one
artefact, so a wrong id in it is a wrong artefact, not a per-row problem.
Soft-deleted terms count as unknown: filing an archive under a category an
editor removed would resurrect it in every listing without anybody choosing to.

**Names are never turned into terms.** An importer that creates a term because a
row mentioned one converts a single typo in a 23,906-row export into a published
category nobody chose, with no review step where anyone would notice. A
newsroom's taxonomy is an editorial decision, not a side effect of an import. A
row naming a category the map does not cover is refused, exactly as a row with
an unmanaged `<img>` is, and for the same reason: an article that imported
cleanly and lost its filing looks like a success.

Two smaller decisions that are easy to get wrong and hard to see afterwards:

- A `categories` value that is a bare string is REFUSED rather than read as one
  name — an export that later grows a second category would otherwise file a
  day's articles under one called `Politik,Daerah`.
- Filing happens in the SAME transaction as the insert, and only for a row this
  run actually inserted. `ON CONFLICT DO NOTHING` leaves no post id for an
  article that was already present, and re-filing it would DELETE whatever an
  editor has since corrected by hand.

Also adds `findUnknownTermIds`, which names the missing ids rather than counting
them: "3 of 40 are unknown" sends an operator to diff two lists by eye.
