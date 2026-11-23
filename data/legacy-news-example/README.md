# Legacy news import — example rubrik redirect map

> **Status ([ADR-0116](../../docs/adr/0116-the-legacy-site-is-a-feature-reference-not-a-migration-source.md)):
> reference material, not a pending work order.** A legacy site is a reference
> for its features, not a wholesale migration source. This directory is a
> worked example for the legacy import path (`blog:legacy:*` scripts), kept so
> the redirect tooling has a realistic, committed input to be tested against.

## What is here

- `rubrik-redirects.json` — an example map of legacy rubrik/listing URLs
  (two-segment `.html` shapes such as `Section/Subsection.html`) to destination
  category paths (`/kategori/{slug}`). Each entry records the legacy link as
  written, the section it was matched under, and its destination, or `null` when
  the entry has no resolvable parent and therefore gets no rule. The counts
  stored per entry are a snapshot, not a contract.

Provenance of the original capture (working copies, databases, hosts) is
intentionally not recorded in this public repository.

## Using it

```
bun run blog:legacy:rubrik-redirects            # dry run — prints the payload
bun run blog:legacy:rubrik-redirects --emit     # write import payload chunks
```

The script only builds the payload. `--emit` writes its chunks
(`legacy-rubrik-redirects.N.json`) beside this file; they are gitignored.
Loading them is `POST /api/v1/seo/redirects/import` (`dryRun` by default).

Rules for the map ([ADR-0113](../../docs/adr/0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.md)):
a dead listing URL goes to its first segment's archive when that segment
resolves; an entry with no resolvable parent carries `targetPath: null` and gets
no rule. Redirect matching is by equality on the normalised source path and
preserves case, so each spelling that was linked needs its own rule.

Preconditions before any rule points anywhere: every destination category must
exist in the tenant, and the consuming public site must build a page for each
destination section. A rule into a missing category is a 301 into a 404.

Under [ADR-0114](../../docs/adr/0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.md)
the 301s for a migrated archive are executed at the edge, not by
`awcms_seo_redirects`; read the script's output as a validated map, not as a
load instruction.

## Generated, gitignored artefacts

`bun run blog:legacy:article-paths` (preview by default, `--emit` writes
`article-paths.json` and `article-paths.tsv` beside this file) generates an
id → post-path table from a live tenant. It is regenerated, never committed:
it is re-derivable from the tenant, and a committed copy would go stale and
carry editorial content into git history. Commit what cannot be regenerated;
regenerate what can.

`--default-locale` is required: the consuming site serves its default locale
unprefixed, so the wrong value redirects every article into a 404. A row with no
section gets no path, and the run refuses to emit while any remain; the fix is
upstream, a `--section-map` on `blog:legacy:import`.
