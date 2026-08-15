🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.id.md)

# ADR-0071 — The public URL vocabulary is split: `/blog/**` here, `/news/**` in `awcms-astro`

- **Status:** Accepted
- **Date:** 2026-08-08
- **Decision makers:** @ahliweb
- **Supersedes:** [ADR-0059](0059-host-resolved-public-content-routes.md) — the host-resolved `/news/**` route family is not built in this repo. What is revoked is its **address**, not its capability; see §3 for what still holds from that ADR.
- **Refines:** [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) — that ADR states `awcms-astro` carries public pages as its primary function, but its §Consequences still names the `/news/**` family as this repo's public surface. This ADR settles that remainder.
- **Related:** [ADR-0009](0009-public-tenant-scoped-routes.md) (the `/blog/{tenantCode}` family), [ADR-0044](0044-merge-news-portal-into-blog-content.md) (`news_portal` merged into `blog_content`), [ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md) (edge cache surfaces), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) (frozen consumer contract), `awcms-astro` ADR-0033 (a tab may declare itself a news section) and ADR-0036 ([`docs/adr/0036-...`](https://github.com/ahliweb/awcms-astro/blob/main/docs/adr/))

## Context

[ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
moved the split axis from AUDIENCE to WHAT IS MANAGED, and states that
`awcms-astro` carries **public pages as its primary function**. But it left one
thing unanswered, and its §Consequences even wrote it down as the part left
untouched:

> `awcms`'s own public surface (`/blog/{tenantCode}/**`, the host-resolved
> `/news/**` family, `robots`/`sitemap`/`feed`, `/search`) is untouched —
> ADR-0059/ADR-0061 stand as they are.

So both repos may serve public news pages, at two different addresses, from one
and the same content source. That is not a division of roles; that is two answers
to one question. And the question will be asked every time a deployment is built:
**where is this site's news served from?**

### What leaves that question without an answer today

ADR-0059 landed `/news/**` here for reasons that were right at the time:
`blog_content` already described that family as a design deliberately not yet
built, `tenant_domain` finally provided its host resolver, and this repo was the
only place that had content to serve. On 4 August 2026 there was no other repo
that could carry it.

Three things have changed since, and all three changed on the other side:

1. `awcms-astro` ADR-0033 gives a tab the ability to **declare itself a news
   section** — ordering by date, two separate dates, and publish/modified
   semantics that are correct for news.
2. `awcms-astro` ADR-0035 gives every news section **its own Atom feed**.
3. `awcms-astro` ADR-0034 and this repo's ADR-0070 state that that repo carries
   public pages as its **primary function**, not as an add-on.

The neighbouring repo now has a more complete news engine than the four routes
ADR-0059 landed here — and it takes its content from this repo through
`GET /api/v1/blog/posts`, a contract already frozen by ADR-0065.

### The discrepancy that is invisible until the two stand side by side

[ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md) §A concludes
that today's edge cache position is "exactly the inverse of the direction
ADR-0059 set: edge cache speeds up the **legacy form** and does not touch the
**forward form** at all". That conclusion is correct — but it rests on the
premise that `/blog/{tenantCode}` is a legacy form being left behind.

The decision below revokes that premise. `/blog/{tenantCode}` is not legacy; it
is this repo's permanent vocabulary.

## Decision

**We decide to split the public URL vocabulary between the two family repos, one
route family per repo, and never both in one repo.**

| Vocabulary | Serving repo                                                    | Its form                                                                       |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/blog/**` | [`ahliweb/awcms`](https://github.com/ahliweb/awcms)             | `/blog/{tenantCode}/**` — path-scoped, ADR-0009, with an explicit `tenantCode` |
| `/news/**` | [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) | a tab named `news` that declares `urutanSeksi: "terbaru"` (ADR-0033)           |

### 1. One module, two vocabularies — not two content models

Both are served by the **same `blog_content` module** in this repo. `awcms-astro`
has no database and stores not one post; it reads `GET /api/v1/blog/posts`
through the contract frozen by
[ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) and builds its pages
statically.

This is what makes the split cheap, and it is also its condition: **what is split
is the URL, not content ownership.** A post has one source of truth, one set of
management screens (`/admin/blog*` here), and one contract. All that differs is
the address at which an anonymous reader finds it.

The mirror rule of [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
§4 is therefore satisfied with no extra work: no capability exists only over
there, because no capability **moved** over there — what moved is the rendering
of the pages.

### 2. `/news` stops being a reserved word in this repo

ADR-0059 §Consequences records that "`/news` becomes a reserved word on any
host". That is revoked. Once its routes are deleted (§4), `/news` in this repo is
an ordinary path like any other path that is not served.

Conversely, in `awcms-astro`, `news` **is still not** a reserved word: it is a
tab slug chosen by the site. A site with no news has no `/news`, and needs no
explanation why. That is a deliberate difference between this rule and the form
ADR-0059 used.

### 3. What STILL holds from ADR-0059, stated so it is not revoked along with it

Superseding an ADR revokes all of its decisions. Two of them must in fact
survive, so both are restated here instead of being let fall silently:

- **The invariant "never advertise a URL we do not serve"** (§C). The SEO base
  path table shrinks to two rows — `legacyTenantRouteEnabled` `true` →
  `/blog/{tenantCode}`, `false` → **zero providers** — but its last row, which is
  the core of the rule, does not change: a tenant that disables its public
  surface gets an empty sitemap, not a sitemap full of links that are certain to 404. That invariant is test-enforced, and its test stays.
- **The refusal to declare an edge cache surface without a per-host key** (§E).
  The reason was never about `/news`: declaring a host-resolved surface before
  the per-host key is verified in the VCL is the most direct way to install a
  cross-tenant leak in a shared cache. That remains true for the root discovery
  routes, which this ADR does not touch.

What does **not** survive: the route family itself (§A), the
`withHostResolvedBlogTenant` gate that only served it (§B), the `publicRouteMode`
switch, and the `"/news"` declaration on `blog_content.api.routes` (§D).

### 4. The `/news/**` routes in this repo are deleted

- **§4 implementation status:** ALREADY CARRIED OUT

When this ADR landed, four routes still existed in `src/pages/news/` and
`publicRouteMode` was still `domain_default` as the module default — meaning
`/news/**` was **on** for every tenant that did not turn it off. The rule above
applies from that day; the code followed in its own PR, and that ordering was
chosen: deleting a route family that is on by default is a URL migration, and a
URL migration merged with the decision that produced it yields one PR that cannot
be reviewed as either.

That window is now closed. What landed:

1. Four route files deleted. `src/pages/news/` no longer exists.
2. **301 from `/news/**` to `/blog/{tenantCode}/**`**, not 404 — URLs already
   advertised by this repo's sitemap and feeds do not die without a successor. It
   lives in `seo_distribution` as **strategy 1 inverted**: the file that used to
   map `/blog/{tenantCode}` → `/news` (`domain/legacy-blog-redirect.ts`) is
   replaced by `domain/retired-news-redirect.ts`, which maps the opposite
   direction. This redirect has **no** policy: its route family is gone for
   everyone, so nobody can opt to keep being served. It is also deliberately not
   gated on `seo_distribution` being active — gating it would mean the tenants
   that disable that module are exactly the ones whose published URLs die.
3. **One condition still applies, and it upholds the §3 invariant**: a tenant
   with `legacyTenantRouteEnabled: false` gets no redirect. It has already turned
   off its entire public content surface, so a 301 to `/blog/{tenantCode}` would
   hand over a certain 404. "Never advertise a URL we do not serve" applies to
   redirect targets, not just to sitemap entries.
4. **The legacy auto-redirect `/blog/{tenantCode}` → `/news` is turned off**
   along with its file. The `legacy_blog_redirect_enabled` column (`sql/060`) is
   **not** dropped — applied migrations are immutable, and its API surface is
   already published — but nothing reads it any more. It is now genuinely inert,
   and for a decided rather than an accidental reason.
5. The §C table shrinks to two rows; `publicRouteMode`,
   `withHostResolvedBlogTenant`, and `padUnresolvedHostRouteLatency` are revoked;
   `"/news"` leaves `blog_content.api.routes`.

The marker above is not a formality: `tests/url-vocabulary-split.test.ts` binds it
to the existence of `src/pages/news/` **in both directions**, and it did go red
between deleting the routes and flipping this marker. A rule without a checker is
a forgotten rule, and a rule that schedules work for "later" is the one most often
forgotten.

## Consequences

- **Positive:**
  - The question "where is this site's news served from" has one answer readable
    from the address itself. `/blog/` means `awcms`; `/news/` means
    `awcms-astro`. No deployment needs to decide it again.
  - The ADR-0061 §A premise falls in a favourable direction:
    `/blog/{tenantCode}` is no longer "the legacy form that is cached while the
    forward form is not", it is this repo's permanent vocabulary — and it is
    **path-scoped**, which means it is already edge-cacheable today. The per-host
    key deferral stops blocking this repo's content surface; it is now only about
    the discovery routes.
  - One class of duplication disappears entirely: two URLs for one post, which
    ADR-0059 §Consequences accepted as "controlled duplication" with canonical as
    the arbiter. There is nothing to arbitrate when there is only one.
  - The neighbouring repo gets the vocabulary that matches its engine.
    `urutanSeksi` (ADR-0033) and per-section feeds (ADR-0035) were written for
    news; the four routes here have neither.
- **Negative / accepted trade-offs:**
  - **A deployment that uses only `awcms` loses news URLs without a tenant
    code.** `/blog/{tenantCode}/**` always carries `tenantCode` in its path, and
    that does not change. A deployment that wants clean URLs puts `awcms-astro`
    in front of it — which is precisely the shape this family has been aiming at
    since ADR-0045.
  - **There is a window between this rule and its implementation** during which
    this repo still served the `/news/**` that its own rule forbids. That window
    is stated (§4) and gated, not left to be discovered only by an attentive
    reader.
  - **A URL migration is a real SEO cost**, and the 301 in item §4.2 is how it is
    paid, not how it is avoided.
- **Neutral:**
  - **Zero code changes in this PR.** The `blog_content` module, the ADR-0065
    contract, every admin screen, and every permission stay exactly as before.
  - `awcms-astro` is not obliged to install a `news` tab. This rule states
    **where** `/news/**` may exist, not that every site must have news.

## Alternatives considered

- **Let both serve `/news/**`, differentiated per deployment** — rejected. That
  moves the decision out of an ADR and into every deployment's configuration
  file, and its failure mode is two teams both being right while pointing at
  different documents. The URL vocabulary is this family's public interface; it
  deserves to be decided once.
- **Move `/blog/{tenantCode}` to `awcms-astro` too**, leaving this repo with no
  public content surface — rejected. This repo needs a public surface that can
  stand on its own: a single `awcms` deployment must still be able to publish,
  and `/blog/{tenantCode}` has done that since ADR-0009 with edge caching that
  already works.
- **Delete `/news/**` in the same PR as this ADR** — rejected, and the reason is
  written in §4: a decision and the URL migration it produces are reviewed with
  different questions. Merging them lets one of the two through unread.
- **Marking this ADR `Accepted (not yet implemented)`** — mechanically
  impossible, and that is informative. The `tests/adr-implementation-status.test.ts`
  gate binds that qualifier to the **existence** of the promised artefact:
  artefact exists → status must be plain `Accepted`. This ADR promises a
  **deletion**, so its direction is inverted, and rule (d) of that gate forbids
  using the qualifier outside its map. That is why §4 gets its own gate, which
  enforces the same thing for the opposite shape of promise.
- **Superseding ADR-0061 as well**, since its §A premise falls — rejected. Its
  analysis remains correct for the root discovery routes, which are the majority
  of its content; what falls is only the "legacy versus forward" framing for the
  content family. That is recorded as a banner there, not as a revocation.
