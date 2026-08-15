---
"awcms": minor
---

feat(i18n): the locale moves into the PATH — ADR-0098 implemented, and the public URL shape changes

ADR-0095 gave every request a `locals.locale` and then localised **no** public
surface, because `vcl_hash` hashes `(host, url)` and nothing else: one public URL
whose body varied by cookie would serve the Indonesian page to an English reader,
minutes later, from a cache neither could re-render. ADR-0098 decided the fix and
this builds it.

## What changed for a reader

`/blog/{tenant}` and everything under it now answers **`307`** to `/en/…` or
`/id/…`, chosen from ADR-0095's chain (cookie → tenant default → `Accept-Language`
→ `en`). The prefixed URL is the canonical one; the bare path is a permanent
alias that renders nothing.

The redirect is `private, no-store` — it reads a cookie and must never be cached.
Only its destination is cacheable, which is the property `Vary` cannot have.

## The inversion that is the whole safety property

On a prefixed URL the **PATH sets `locals.locale`, outranking the cookie.** If the
cookie won there, two readers of `/en/blog/acme` would get different bodies under
one cache key and whichever missed first would decide what the other saw — the
exact misdelivery this ADR exists to make impossible. The URL is the key, so the
URL chooses the body.

`src/lib/i18n/public-locale-path.ts` is the decision made executable, and it is
deliberately unable to read a header: a path goes in, a routing decision comes
out.

## The prefix is scoped to CACHEABLE HTML, and that is not a shortcut

`CACHEABLE ⇒ prefixed`, and the converse is ADR-0098 decision 6's own reasoning:
a `private, no-store` response never reaches a shared cache, so it can localise
from a cookie with no possibility of misdelivery. `/admin` is the ADR's stated
example; `/login`, `/register` and `/blog/{t}/search` are the same case for the
same reason. Among cacheable surfaces only the HTML ones are prefixed —
`robots.txt` sits at a protocol-fixed location a crawler will not follow a
redirect to reach, and the feeds already carry `?locale=`, which is the same
cache key in a different spelling.

## Three things that would have been silent

- **`matchPublicCacheSurface` needed a second matching attempt.** Without it
  every `/en/…` and `/id/…` request would have missed the registry and been
  stamped `private, no-store` — the ADR would have moved the locale into the key
  while turning the entire public surface uncacheable, a regression that reads as
  a caching bug rather than a routing one.
- **The sitemap had to move with the canonical.** A `<loc>` naming the bare path
  while the page's own `<link rel="canonical">` names the prefixed one is a
  disagreement search engines resolve by trusting neither. `<loc>` now names the
  tenant default's spelling, with `xhtml:link` alternates per locale.
- **Every in-page link is built from the prefixed base path.** Building them bare
  would drop each reader back onto the alias on their very next click.

## Decision 2 is enforced twice, and both were proven by planting the defect

`decideCacheability` REFUSES a response that varies on `Cookie` or
`Accept-Language`. Refusing rather than stripping is the point: stripping would
cache a body that its own author said varies, which is the misdelivery in its
purest form. `edge-cache:surfaces:check` then fails the build on the same two
names anywhere under `src/`, so the mistake is loud rather than merely safe.

Mutation-proven, not assumed green: three spellings of a forbidden `Vary`
(`{ Vary: "Cookie" }`, `headers.set("Vary", "Accept-Language")`, and
`"Accept-Encoding, Cookie"` hidden in a list), a machine surface handed a
prefixed alias, and a `localePrefixed` flag flipped out of agreement with the
path patterns — each caught, each with the failure naming the consequence.

## What is still open behind it

Multi-language content fields for `blog_content`. The reader's interface language
and the POST's own language are different axes, and `<html lang>` still comes
from `post.locale`; the public chrome is not translated yet, so `/en/…` and
`/id/…` differ today only in their `hreflang` and canonical. The mechanism is
what had to land first — translating the chrome into a cache that could not tell
the two apart was the failure ADR-0095 refused to ship.
