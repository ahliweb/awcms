🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0104-the-build-reads-the-taxonomy-and-owns-its-own-archive-urls.id.md)

# ADR-0104 — The static build reads the taxonomy, and owns its own archive URLs

- **Status:** Accepted
- **Date:** 2026-08-22
- **Decision maker:** ahliweb
- **Related:** Issue #597 item 1; PRD LenteraKalteng §8.5, §12.4, FR-DSC-006; ADR-0102 (nothing anonymous; the refusal/failure split); ADR-0065 (the consumer contract); ADR-0009 (path-based public tenant routes); Issues #647, #649

## Context

`ahliweb/awcms-astro` has no category archive and no tag archive. An article belongs to one of the tabs configured in that repo's source, and there is no page anywhere that aggregates "everything filed under Politik". That is the first item Issue #597 lists, and until two changes landed this month it could not be built at all:

- **The build feed did not carry classifications.** `GET /api/v1/blog/posts?view=full` returned every column of a post except `termIds`, so the traversal a static site is generated from never said which category an article was in (fixed in Issue #649).
- **The vocabulary could not be read to the end.** `GET /api/v1/blog/terms` returned the alphabetically-first hundred entries with no cursor and no signal that more existed, which for a tag vocabulary grown over a 23,906-article archive means a site that builds a hundred archive pages out of thousands and looks healthy (fixed in Issue #647).

Both are now true, and a fourth surface therefore enters the frozen consumer contract of ADR-0065. What that surface should be, and what stays on which side of the boundary, is what this records.

## Decision

**The static build reads the tenant's taxonomy from the existing admin surface with its build credential, and computes its own archive URLs.**

### The surface is `GET /api/v1/blog/terms`, not a new anonymous one

ADR-0102 already settled the posture and the wording matters: "public read" in these issues means the BUILDER of the public site can read it. A site publishes its own taxonomy through its own template — that is the site's decision, not one this API makes on the site's behalf by serving the vocabulary to anyone who asks. `GET /api/v1/media/public-origin` and the post feed itself already work this way.

The consequence is real and is stated here rather than discovered in a build log: the build credential's role needs `blog_content.taxonomies.read`. A credential minted before this ADR holds it only if its role already granted it, which is the same permission-seed gap ADR-0102 hit with `site_profile.profile.read` and the reason the consumer warns with the permission's name in it.

### The consumer uses the TRAVERSAL, never the default list

`?order=created_at` with `nextCursor` is what the contract freezes for this consumer. Freezing the default alphabetical list instead would freeze its truncation — a contract whose guaranteed behaviour is "returns some of the terms" is worse than no contract, because it makes the wrong thing official.

### The archive URL shape belongs to the CONSUMER

`awcms` already renders category and tag archives for its own public route family at `/blog/{tenantCode}/category/{slug}` (ADR-0009), and `internal-tag-linking` composes `${basePath}/tag/${slug}` for the bodies it renders. A site built by `awcms-astro` has a different origin, a different base path, and may use different segment words entirely.

**`awcms` does not gain a setting for the consumer's archive URL.** A per-tenant "your archive lives at this template" field would put the decision in the repo that does not serve the page, and the first time the two disagreed the links would be broken by the side that cannot see them. The consumer holds the term's `slug` and its own routing; it composes the URL.

One consequence follows and is named rather than left to be found: automatic internal tag linking (Issue #641) rewrites bodies with `awcms`-shaped tag URLs. It does not reach `awcms-astro` today, because that repo renders bodies itself from `bodyPortableText` rather than consuming rendered HTML — so the transform simply does not run on that path. If a consumer ever does read rendered HTML, this is the seam where the URLs would be wrong, and the answer will be to give the linking transform the consumer's base rather than to give `awcms` a URL template.

### A refusal is not a failed build; a failure is

The same split ADR-0102 made, with one difference worth naming.

- **403 or 404** — the credential lacks `blog_content.taxonomies.read`, or the instance predates the traversal. The build warns with the permission named and produces no archive pages.
- **Anything else** — a 500, a timeout, an unreachable host — throws, because building through it publishes a site that quietly lost every archive it had yesterday.

The difference from site identity: an **empty vocabulary is a legitimate state**. A newsroom that files nothing under a category is not broken, and the fallback and the honest empty answer produce the same pages. That is exactly why the failure branch must stay separate — with a blanket `catch`, "your CMS is down" and "this newsroom uses no categories" would be the same event, and only one of them should ship.

### The freeze order stands

`/api/v1/blog/terms` is added to `COMMITTED_PATHS` here, moves to `CONSUMED_PATHS` when `awcms-astro` actually calls it, and the neighbour's own gate is what proves the call is real. The distinction between promised and consumed is only worth keeping if entries move; three non-calls once sat in `CONSUMED_PATHS` describing calls that never happened.

## Consequences

- **Positive:** a category and tag archive becomes possible in the consumer with no new endpoint, no new anonymous surface, and no new table.
- **Positive:** the vocabulary has exactly one home. A renamed category is renamed once and every consumer sees it on the next build.
- **Negative / trade-off:** the build now makes one more class of request, and needs one more permission. A deployment that upgrades `awcms-astro` without granting it gets a warning and no archives rather than an error — which is the right failure, and is still a failure somebody has to read.
- **Negative / trade-off:** two repos now compose archive URLs for the same terms, in two shapes. That is deliberate (they serve different sites) and it means a term's URL is not a single fact anybody can look up.
- **Neutral:** `institutionIds` rides the same feed but has no archive in this ADR. The institution landing page is PRD §12.2 work and its own decision.

## Alternatives considered

- **A new anonymous `GET /api/v1/blog/public-terms`.** Rejected on ADR-0102's posture, and on cost: a second endpoint returning the same rows is a second thing to keep in step with the first, and the first already exists.
- **Embedding each term's `name` and `slug` in every post's payload.** Rejected. It repeats a dozen category names across 23,906 posts, and worse, it makes the vocabulary a per-row copy — two posts in the same page could carry different spellings of the same category after a rename, and nothing would be wrong enough to fail.
- **A per-tenant archive URL template in `awcms`.** Rejected — see above. The side that renders the link is not the side that serves it.
- **Freezing the default alphabetical list rather than the traversal.** Rejected: it would make "returns some of the terms" the guaranteed behaviour.
