/**
 * ADR-0098 amendment (see `docs/adr/0098-*.md` §Amendment): the locale-prefixed
 * public URLs are served by REAL routes, not by a middleware rewrite.
 *
 * ## Why this file exists at all
 *
 * ADR-0098 decision 3 put the locale in the PATH and served the prefixed URL by
 * rewriting it back to the bare route (`next("/blog/acme")`), explicitly to
 * avoid "a duplicated `[locale]` tree". That mechanism does not work in this
 * build: a rewrite whose TARGET is a parameterised route resolves the route and
 * computes its params correctly and then never executes it — the request is
 * answered by the catch-all instead. Measured against the production image, on
 * the same route:
 *
 * | rewrite target                  | reached directly | reached by rewrite |
 * | ------------------------------- | ---------------- | ------------------ |
 * | `/login`, `/search`, `/robots.txt` (static) | 200  | 200                |
 * | `/blog/{tenant}/search` (parameterised)     | 200  | **404**            |
 *
 * So every locale-prefixed blog URL answered 404 while the bare URL redirected
 * into it — the whole public blog, index and articles alike. `context.rewrite()`
 * re-runs middleware and loops; passing a `URL` or a `Request` to `next()`
 * changes nothing. There is no one-line spelling of the ADR's mechanism that
 * works, which is why the mechanism changed and the ADR was amended.
 *
 * ## Why a wrapper rather than a copy of each handler
 *
 * The `[locale]` tree duplicates ROUTE REGISTRATION, never logic: each file
 * re-exports the bare route's handler through this wrapper. That is the part of
 * ADR-0098's objection that still holds — a second copy of the blog index would
 * be a real cost — and it is the part this shape does not pay.
 *
 * ## What the wrapper is FOR
 *
 * `[locale]` is a dynamic segment, so `/blog` in `src/pages/[locale]/blog/…`
 * is the only literal in the pattern: `/anything/blog/acme` matches it too.
 * Without this check a bogus prefix would SERVE the tenant's content under a
 * URL that is not one of its canonical spellings — a duplicate-content surface
 * with an unbounded number of addresses, and a cache key per address.
 * `splitPublicLocalePath` cannot catch it, because a segment that is not a
 * supported locale is not a locale segment to it at all: `/foo/blog/acme`
 * splits to `{ locale: null, pathname: "/foo/blog/acme" }`, needs no prefix,
 * and would reach the route unexamined.
 *
 * The 404 is the same generic `notFoundHtmlResponse()` the blog routes give an
 * unknown tenant, deliberately: "that locale does not exist" and "that tenant
 * does not exist" must not be distinguishable by response.
 */
import type { APIRoute } from "astro";

import { notFoundHtmlResponse } from "../html/error-responses";
import { isSupportedLocale } from "./locales";

/**
 * Wraps a bare public route handler so it only answers under a SUPPORTED
 * locale segment.
 *
 * The wrapped handler is the same function object the bare route exports — no
 * behaviour is re-implemented here, and a change to the bare route is a change
 * to the prefixed one by construction.
 */
export function localisedPublicRoute(handler: APIRoute): APIRoute {
  return (context) => {
    if (!isSupportedLocale(context.params.locale)) {
      return notFoundHtmlResponse();
    }

    return handler(context);
  };
}
