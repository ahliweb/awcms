🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0098-the-cache-key-carries-the-locale-in-the-path.id.md)

# ADR-0098 — The cache key carries the locale, and it carries it in the PATH

- **Status:** Accepted
- **Date:** 2026-08-15
- **Decision maker:** @ahliweb
- **Related:** [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (the URL is the cache key), [ADR-0095](0095-the-interface-speaks-the-readers-language.md) §"Decision 5" (registered this as a prerequisite), `infra/varnish/default.vcl`, `src/middleware.ts`

## Context

ADR-0095 gave every request a `locals.locale` and then localised **no public surface at all**. That was not caution for its own sake; it was one sentence of arithmetic:

> One public URL whose body varies by cookie is a cross-serving machine: Varnish will serve the Indonesian page to an English reader.

`vcl_hash` hashes `req.http.host`, and the builtin hashes `req.url`. Nothing else. So today two readers of `https://example.test/blog/acme` share one cache object, and the first one to miss decides what the second one sees. Localising that body without touching the key is not a bug that shows up in review — it is a bug that shows up as _the wrong language for a stranger_, minutes later, on a page neither of them can re-render.

The prerequisite was recorded rather than implemented, deliberately, and this ADR is the decision it was waiting for. The brief is explicit: **best performance and most secure.**

Three mechanisms can make a cached body locale-correct.

**A — `Vary: Cookie`.** Correct, and catastrophic. The cache object count multiplies by the number of _distinct cookie strings_, not the number of locales: session ids, analytics ids and CSRF tokens all live in `Cookie`, so nearly every reader gets a private copy of a public page. Hit rate collapses toward zero, which is worse than having no cache — the origin now pays for the cache's misses too. It also puts a credential-bearing header into the cache key, so a key-collision or a normalisation slip becomes a session-adjacent leak rather than a cosmetic one.

**B — `Vary: Accept-Language`, normalised in VCL.** Better: normalising `Accept-Language` down to `en`/`id` in `vcl_recv` bounds the fan-out at two. But it is wrong on the axis that matters most here — it cannot see the reader's _explicit choice_. A person who clicked the Indonesian switch on an English-configured browser gets English forever, and the switch appears broken while behaving exactly as specified. It also concentrates correctness in a VCL normalisation step: get it wrong and the failure is silent cross-serving, which is the same failure A has, arrived at more cleverly.

**C — the locale in the URL path.** `/en/blog/acme` and `/id/blog/acme` are different URLs, so they are already different cache objects under the key that exists today.

## Decision

1. **The locale lives in the URL path, and the cache key is not changed at all.** `vcl_hash` keeps hashing `(host, url)`. No `Vary` header is added to any public response. This is the whole of the mechanism: two locales are two URLs, and the cache cannot cross-serve them because it never had a reason to consider them the same object.

   The performance argument is not "fast enough" but _unchanged_: the hit rate of a locale-prefixed site is identical to the hit rate of the site today, and the object count grows linearly with the number of locales (2) rather than with the number of readers (A) or the number of header permutations (B).

   The security argument is that **no request header enters the cache key**. Cache-poisoning and cache-splitting attacks in this class all work by making the key disagree with the body; there is no disagreement available when the key is the path and the path is what selects the body.

2. **`Vary: Cookie` and `Vary: Accept-Language` are FORBIDDEN on any cacheable public response**, and this is enforced rather than documented. The forbidden-header check belongs with the existing `edge-cache:surfaces:check` probes: a surface that declares itself cacheable and emits either header fails the gate. Without that, decision 1 is a convention, and the next person to need a per-reader public variation will reach for the tool that is already in the toolbox.

3. **Locale selection happens by REDIRECT, never by variation.** A request to an un-prefixed public URL is answered `307` to the prefixed one, choosing the locale from the ADR-0095 order (cookie → principal preference → tenant default → `Accept-Language` → `en`).

   That redirect reads a cookie, so **the redirect itself is `private, no-store`** and never enters the cache. Only the prefixed destination is cacheable. This is the line that keeps the cookie out of the cache while still honouring the reader's explicit choice — the property option B cannot have.

4. **The tenant's default locale gets the bare path as a permanent alias, not a second cacheable body.** `/blog/acme` does not render; it redirects. One canonical URL per (resource, locale), which is also what makes `hreflang` expressible: `src/middleware.ts` currently passes `locale: null` into redirect resolution with a comment saying it is a deliberate refusal pending this ADR, and that refusal ends here.

5. **`x-default` points at the tenant default's prefixed URL**, not at the bare alias. A crawler that follows `x-default` must land on a cacheable, canonical document, not on a redirect that varies by the crawler's own `Accept-Language`.

6. **Admin stays exactly as it is.** `/admin` is `private, no-store` by ADR-0042 construction and localises from the cookie and the stored preference. Nothing above applies to it, and nothing above may be read as licence to cache it.

## Consequences

- **Positive:** the cache behaves identically to today, with no new headers, no VCL edit to `vcl_hash`, and no new failure mode in the layer that is hardest to observe. Adding a third locale adds URLs, not cache dimensions.

- **Positive:** every locale of every public resource has its own canonical URL, so `hreflang`, sitemaps and feeds become expressible without inventing a query-parameter convention that Varnish would then have to be taught about.

- **Trade-off, and it is the real one:** the public URL shape changes. Links to `/blog/acme` keep working through the redirect in decision 3, but they stop being canonical, and any external system that recorded a bare URL now records one that answers `307`. PROJECT_STATE §4 item 6 already names the public URL shape as an open decision — this settles that half of it.

- **Trade-off:** a redirect costs a round trip for readers arriving on a bare URL. It is paid once per reader per resource rather than per request, because the redirect target is cacheable and the browser follows it; and it buys the property that the cookie never reaches the cache.

- **Neutral:** `seo_distribution` already builds absolute URLs through `site-origin.ts` (ADR-0097 round, #573), so the prefix enters through the existing single origin builder rather than a second one.

- **Rejected: `Vary` on a normalised header.** It is the mechanism most sites use and it is the wrong one here, for a reason specific to this product: the language switcher is a control this repo already shipped, broke, and fixed twice (v9.1.1, v9.1.2). A design in which an explicit click cannot win over a browser header would make that control decorative on exactly the surface most readers see.

## Amendment (2026-08-27, v10.0.1) — the prefixed URL is served by a route, not by a rewrite

**What changed:** the serving mechanism inside decision 3, and nothing else.

Decision 3 said the prefixed URL is served by rewriting it back to the bare route (`next("/blog/acme")`), and this ADR's Consequences justified that with "no duplicated `[locale]` tree". **That mechanism does not work in this build.** A rewrite whose target is a PARAMETERISED route resolves the route and computes its params correctly and then never executes it — the catch-all answers instead.

Measured against the production image, in an isolated container, on the same route:

| rewrite target                              | reached directly | reached by rewrite |
| ------------------------------------------- | ---------------- | ------------------ |
| `/login`, `/search`, `/robots.txt` (static) | 200              | 200                |
| `/blog/{tenant}/search` (parameterised)     | 200              | **404**            |
| `/blog/{tenant}`, `/blog/{tenant}/{slug}`   | —                | **404**            |

Because every `/blog/{tenantCode}` surface is parameterised, v10.0.0 shipped a public blog in which the bare URL `307`d to a prefixed URL that answered 404 — index and every article. `context.rewrite()` re-runs middleware and loops; passing a `URL` or a `Request` to `next()` changes nothing. There is no one-line spelling of the original mechanism that works.

**The new mechanism:** the four reader-facing surfaces have real routes at `src/pages/[locale]/blog/[tenantCode]/…`. Each is **registration only** — it re-exports the bare route's handler through `localisedPublicRoute()`, which 404s a segment that is not a supported locale. The objection this ADR raised to a `[locale]` tree was duplicated LOGIC, and re-export does not duplicate logic: a change to the bare route is a change to the prefixed one by construction.

`src/middleware.ts` no longer rewrites. It still sets `locals.locale` from the path, still resolves `seo_distribution` rules against the bare path, and still `307`s a bare URL to its prefixed spelling.

**What did NOT change:** decisions 1, 2, 4, 5 and 6 stand unmodified, and so does the whole of decision 3 except its serving mechanism. The cache key is still `(host, url)`, no `Vary` is added, locale selection is still a `private, no-store` `307`, the bare path is still an alias that does not render, and `/admin` is still untouched. **The URL shape a reader sees is identical** — this amendment is invisible from outside the server.

**Why it reached production green.** Not one test at any level fetched a locale-prefixed public URL. The ADR made the prefixed spelling the canonical one for every reader-facing blog surface, and the suite went on exercising only the bare spellings, which redirect. `tests/localised-public-routes.test.ts` closes that: it derives the required prefixed routes from the filesystem, so a new prefixed surface cannot be added without one, and it is mutation-proven against both real defects — deleting a prefixed route and restoring the rewrite each turn it red.
