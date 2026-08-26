---
"awcms": patch
---

fix(blog): the legacy importer dropped the lead photograph of all 25,029 articles, and its image work list was collected after the gate that skips it

Four defects in `bun run blog:legacy:import`, found while closing Issue #599 /
Issue #711. Each was proved by applying the mutation and running it, not by
reading the code.

**The lead photograph was never carried.** `featured_media_id` has existed since
`sql/035:46` and `public-content-port-adapter.ts` has been serving it to
`awcms-astro` all along, but `LegacyPostImportInput` had twelve fields and none
of them was media, and the INSERT named sixteen columns without it. Every one of
the 25,029 SeputarBorneo rows has a `foto_berita`, so a real run would have
landed the whole archive without the picture each page led with — reporting
success, because `--images` scanned body HTML only and would never have
mentioned them. The record now carries `featuredImageSrc`, it resolves through
the SAME `--media-map` handoff a body `<img>` uses and the SAME
`isMediaReferenceSafe` sweep (one map, one chokepoint, no second and weaker
check), a mapped one is written to `featured_media_id`, and an unmapped one is
refused with a report line rather than imported without the photograph.

**`--images` was wrong by the whole archive in the other direction too.** Body
scanning found 2 images in that archive; the honest upload set is ~25,031 files
/ 4.1 GB. The summary now prints the two parts separately — lead photographs and
body images — because a single total is what let "2" read as "almost nothing to
do".

**The image collection sat below the category gate.** A row naming a category
the run cannot map is refused with `continue`, and the scan was after that
`continue`, so a FIRST run — which by definition has no `--term-map`, because
`--terms` is how you get one — reported zero images. The identical ordering bug
had already been found and fixed one gate earlier for `categoriesPerArticle`.
It is now collected above both gates, and `--terms`/`--images` open no database
client at all, so the flag an operator runs first no longer dies on
`DATABASE_URL … is required`.

**Two rows of one file could claim one slug.** There was a `seenLegacyIds` set
and no `seenSlugs`; `findTakenSlugs` asks the database, which cannot see a
collision inside the file it has not written yet. The real archive has 84
collision groups across 171 rows, so the first real run raised 23505 in the
middle of a committing batch, after earlier batches had landed. The second
occurrence is now refused as a report line naming the line it collides with, and
the run finishes.

Also corrected: `legacy-media-map.ts` still claimed that essentially every row
of a real CKEditor archive was residue. Measured, it is 4 of 25,029 (0.02%), and
only 2 bodies contain an `<img>` at all.
