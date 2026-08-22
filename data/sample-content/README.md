# Sample content archive

Nine finished articles in Bahasa Indonesia, on the subjects an AhliWeb-style web
studio actually writes about — choosing a CMS, perceived page speed, URL
structure that never has to change, the three services, Core Web Vitals for
non-technical owners, static versus dynamic, and a pre-launch checklist.

They exist so that a fresh deployment, a demo tenant, or a local
`awcms-astro` build has something real to render. A CMS with no content answers
none of the questions you set it up to answer: every list is empty, every
pagination boundary is untested, and every layout looks correct because nothing
is in it.

## Loading it

The archive is NDJSON in the shape `bun run blog:legacy:import` already reads,
so there is no second importer to keep in step with the first:

```bash
bun run blog:legacy:import \
  --file=data/sample-content/ahliweb-articles.ndjson \
  --tenant=<tenant-uuid> \
  --author=<tenant-user-uuid> \
  --system=sample-ahliweb
```

Preview is the default and prints what would land. Add `--commit` to write.
Re-running is safe: `(tenant_id, legacy_source_system, legacy_source_id)` is
unique and the insert is `ON CONFLICT DO NOTHING`, so a second run reports
`already present` rather than duplicating anything.

## `--system=sample-ahliweb` is load-bearing

`legacy_source_system` is how the redirect importer decides which rows to build a
301 map from, and it takes the system name as an explicit `--system` flag. Using
a distinct name here is what keeps a real migration run
(`--system=seputarborneo`) from deriving redirects for URLs that never existed on
anybody's site.

Do not load this archive under the same system name as a real import.

## What it does NOT set

- **No images.** Every article is text, headings, lists and quotes. The importer
  refuses an `<img>` whose `src` is not already a verified media object, and the
  right way to add pictures is `/admin/media` plus `--media-map`, not a fetcher
  reaching for third-party bytes. See `scripts/blog-legacy-import.ts`.
- **No taxonomy terms.** The rows carry no `category`/`channel`/`topic`, so they
  will not appear under a section on an `awcms-astro` build until an editor files
  them — that template resolves a section from the post's own stored `kategori`.
  Assign them in `/admin/blog` after loading, or treat the set as a body of
  content to page through rather than a finished front page.
- **No claim to be real.** These are written specimens, not published work by
  anybody. They are safe to delete, edit past recognition, or replace wholesale.

## Adding to it

Keep every body inside the converter's grammar — `p`, `h1`–`h6`, `blockquote`,
`ul`/`ol`/`li`, `strong`/`em`/`code`, and `a[href]` on an `http`/`https` URL.
Anything else is refused with a per-row report rather than silently sanitised,
which is the behaviour to rely on: run the import without `--commit` and read
what it says before adding a line here.
