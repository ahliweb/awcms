---
"awcms": minor
---

feat(blog-content): 23,906 legacy articles can be imported, and their URLs land in one hop (#599)

#634 added `legacy_source_system`/`legacy_source_id` (`sql/138`), the HTML→Portable
Text converter, and `listLegacyRedirectMappings`. What it did not add — and what
the issue's own design review caught — is **anything that writes those columns**.
The redirect map had a reader and no writer.

### `bun run blog:legacy:import`

NDJSON in, one article per line, preview by default. `--commit` is a second
deliberate act, the same inversion `blog:ads:ingest` uses and for a stronger
reason: this runs once, by hand, against a newsroom's entire archive, and the
expensive mistake is not "forgot to preview" but "previewed, then never read the
rejections".

The format is a file rather than a connection to the legacy MySQL, because a job
here that dialled out to it would add a second driver, a second set of secrets
and a second network dependency to a runtime with exactly two dependencies.

**Three independent refusal gates, all reported per row, none of which repairs
anything:**

- **The record.** No `legacyId` → refused, because without it the redirect map
  cannot be derived after the fact, which is the permanent loss this issue exists
  to prevent. `status: "published"` with no `publishedAt` → refused, rather than
  re-dated to the cutover afternoon. MySQL's `0000-00-00` zero date is caught
  here instead of by Postgres mid-batch.
- **The body.** A body with any rejection is **skipped entirely**, not stored
  sanitized. An article whose images silently vanished looks imported and is
  broken.
- **The slug.** Checked against the tenant in one query before anything is
  written, so a collision is a line in the report rather than a constraint error
  12,000 rows into a run.

A duplicate `legacyId` **inside one file** is reported too — the database would
answer it with a silent `DO NOTHING`, which reads as "already imported" and hides
the export script's bug.

`importLegacyBlogPost` is one INSERT rather than create-then-publish, for three
reasons and the first is the whole issue: `transitionBlogPostStatus` sets
`published_at` to `now()`. It is idempotent on `sql/138`'s partial unique index,
so preview → commit → fix rejects → commit again does not duplicate the archive.
It writes no revision or audit event: an import is the arrival of something that
existed elsewhere, and 23,906 "created by import" revisions bury the real history.

### `bun run blog:legacy:redirects:import`

The map is **derived, not supplied** — `legacy_source_id` IS the map, which is
why the column exists. So the rules cannot disagree with the content: an article
that was never imported has no rule, and one that gets unpublished stops
producing one. `--path-template` carries the legacy URL shape because that shape
belongs to the system being migrated *from*.

Two checks run in preview as well as commit, because the point is to find out
before cutover: the target must not itself be the source of an existing rule, and
it must already carry its locale prefix. An existing rule for a source path is
**reported, never overwritten** — a hand-authored exception must survive a bulk
run. One `now` for the whole run, so a rule expiring mid-run cannot be seen by
one check and not the next.

### The two-hop bug that was already merged

ADR-0098 made `/blog/{code}/{slug}` a locale-prefixed surface.
`listLegacyRedirectMappings` was emitting the bare path, so every legacy URL
would have been redirected to a path that immediately redirected again — the
chain longer than one hop that PRD §9.2 forbids and that this issue lists as its
own acceptance criterion. The target now carries the prefix, taken from the
**post's own** locale; a post in a locale this deployment does not support keeps
the bare path rather than being sent confidently into a language with no routes,
and the importer reports that case instead of writing it.

### Still open on this issue

Two things need artefacts that are not in this repo and are noted rather than
guessed at:

- **Enumerating every legacy URL shape from `.htaccess`.** Only
  `/news/{id}_{slug}.html` is covered here. The static-page and rubrik rewrites
  need the actual file; `--path-template` means covering them is a second run,
  not a code change.
- **The pre-cutover crawl against the live legacy sitemap.** The local half —
  every rule this repo would write resolves in one hop to a published post — is
  enforced by the importer above. Fetching the legacy site to confirm coverage
  needs the legacy site.
