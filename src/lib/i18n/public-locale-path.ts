/**
 * ADR-0098 made executable: the cache key carries the locale, and it carries it
 * in the PATH.
 *
 * This file is the whole mechanism. There is no `Vary` header anywhere in it,
 * no cookie read, and nothing that inspects a request — a path goes in and a
 * decision comes out. That is deliberate: ADR-0098's security argument is that
 * NO request header enters the cache key, and the cheapest way to keep that
 * true is for the function that decides the locale to be unable to see one.
 *
 * ## Which public paths carry a prefix, and why it is not "all of them"
 *
 * The rule is `CACHEABLE ⇒ prefixed`, and its converse is the reason ADR-0098
 * decision 6 leaves `/admin` alone: a response that is `private, no-store`
 * never reaches a shared cache, so it can localise from a cookie with no
 * possibility of misdelivery. `/admin` is the ADR's stated example; `/login`,
 * `/register`, `/reset-password` and `/blog/{tenant}/search` are the same case
 * for the same reason, and prefixing them would cost a redirect and buy
 * nothing.
 *
 * Among the CACHEABLE surfaces (`src/lib/edge-cache/surface-registry.ts`) only
 * the ones that render chrome a human reads are prefixed. The others are
 * machine surfaces whose bodies do not contain interface language at all:
 *
 * - `/robots.txt` is at a protocol-fixed location. A crawler will not follow a
 *   redirect to find it, so prefixing it would break the surface outright.
 * - `/sitemap*.xml` and `/blog/{tenant}/sitemap-blog.xml` are URL inventories.
 *   They must LIST the prefixed URLs (they are the canonical ones), but the
 *   inventory itself is one document per tenant, not one per language.
 * - `/feed.xml`, `/atom.xml`, `/feed.json` already carry their locale as a
 *   query parameter, which the surface registry allow-lists (`allowedQueryParams:
 *   ["locale"]`). A query parameter IS part of the URL and therefore part of
 *   the cache key, so those surfaces already satisfy ADR-0098 — by the same
 *   principle, through a different spelling. Moving them to a path prefix would
 *   break every existing subscription to buy nothing.
 * - `/theming/{tenant}/tokens.css` is CSS.
 *
 * The list below is therefore NOT free-form: `edge-cache:surfaces:check` probes
 * every declared surface through both files and fails when they disagree, and
 * `tests/public-locale-path.test.ts` pins the consequence at run time. Adding a
 * cacheable HTML surface without deciding its locale fails the gate, which is
 * the point — the failure mode this ADR exists to prevent is silent, and a
 * silent failure needs a loud gate.
 */
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "./locales";

/**
 * The path patterns that must carry a locale prefix, matched against the
 * UNPREFIXED pathname.
 *
 * Anchored, and `[^/]+` rather than `.*`, for the reason the surface registry
 * gives: a path must not be able to smuggle itself into a more permissive
 * pattern. These mirror `blog-index`, `blog-post`, `blog-taxonomy` and
 * `blog-page`.
 *
 * `blog-post` deliberately does NOT match `/blog/{tenant}/search`, `feed.xml`
 * or `sitemap-blog.xml`; those are excluded explicitly below rather than left
 * to pattern precedence, because relying on ordering here would mean a future
 * two-segment surface silently changing which paths get prefixed.
 */
const LOCALE_PREFIXED_PATH_PATTERNS: readonly RegExp[] = [
  /^\/blog\/[^/]+\/?$/,
  /^\/blog\/[^/]+\/(category|tag)\/[^/]+$/,
  // Issue #594 — a static page is interface prose a human reads (Redaksi, the
  // Pedoman Media Siber), so its canonical URL carries a locale for the same
  // reason a post's does. It needs its own entry because the `blog-post`
  // pattern below is two segments and this one is three.
  /^\/blog\/[^/]+\/pages\/[^/]+$/,
  /^\/blog\/[^/]+\/[^/]+$/
];

/**
 * Paths that match a pattern above but are NOT interface documents. Checked
 * first, so the broad `blog-post` shape cannot capture them.
 */
const NEVER_PREFIXED_PATHS: readonly RegExp[] = [
  /^\/blog\/[^/]+\/(feed\.xml|sitemap-blog\.xml|search)$/
];

/** `/en`, `/id` — one segment per supported locale, derived from the one list. */
const LOCALE_SEGMENT_PATTERN = new RegExp(
  `^/(${SUPPORTED_LOCALES.join("|")})(?=/|$)`
);

export interface SplitLocalePath {
  /** The locale the path names, or `null` when it names none. */
  readonly locale: Locale | null;
  /** The path with any locale segment removed. Always starts with `/`. */
  readonly pathname: string;
}

/**
 * Splits a leading locale segment off a pathname.
 *
 * `/id/blog/acme` → `{ locale: "id", pathname: "/blog/acme" }`
 * `/blog/acme`    → `{ locale: null, pathname: "/blog/acme" }`
 * `/id`           → `{ locale: "id", pathname: "/" }`
 *
 * Only a segment that is exactly a supported locale is stripped, so a tenant
 * code of `indonesia` or a slug of `entrepreneurship` is untouched — the
 * lookahead requires the segment to END at a `/` or at the end of the path.
 */
export function splitPublicLocalePath(pathname: string): SplitLocalePath {
  const match = LOCALE_SEGMENT_PATTERN.exec(pathname);

  if (!match) {
    return { locale: null, pathname };
  }

  const rest = pathname.slice(match[0].length);

  return {
    locale: match[1] as Locale,
    pathname: rest.length > 0 ? rest : "/"
  };
}

/** `splitPublicLocalePath(...).pathname`, for callers that want only the path. */
export function stripPublicLocalePrefix(pathname: string): string {
  return splitPublicLocalePath(pathname).pathname;
}

/**
 * Builds the prefixed form of a path. `/blog/acme` + `id` → `/id/blog/acme`.
 *
 * Idempotent by construction: the path is stripped before it is prefixed, so
 * calling this on an already-prefixed path REPLACES the locale rather than
 * nesting one inside another. A `/id/en/blog/...` URL would be a second
 * canonical form for the same resource, which is precisely what ADR-0098
 * decision 4 forbids.
 */
export function withPublicLocalePrefix(
  pathname: string,
  locale: Locale
): string {
  const bare = stripPublicLocalePrefix(pathname);

  return bare === "/" ? `/${locale}` : `/${locale}${bare}`;
}

/**
 * True when this UNPREFIXED path is one whose canonical URL carries a locale.
 * Pass a prefixed path and you get the answer for the resource it names, since
 * the prefix is stripped first.
 */
export function requiresPublicLocalePrefix(pathname: string): boolean {
  const bare = stripPublicLocalePrefix(pathname);

  if (NEVER_PREFIXED_PATHS.some((pattern) => pattern.test(bare))) {
    return false;
  }

  return LOCALE_PREFIXED_PATH_PATTERNS.some((pattern) => pattern.test(bare));
}

export type PublicLocaleRoute =
  | {
      /** Path names a locale-prefixed resource and carries its prefix: serve it. */
      readonly action: "serve";
      /** Authoritative locale — it came from the cache key itself. */
      readonly locale: Locale;
      /** Path the request should be rewritten to, prefix removed. */
      readonly servePathname: string;
    }
  | {
      /** Path names a locale-prefixed resource WITHOUT a prefix: redirect. */
      readonly action: "redirect";
      /** Builds the target once the caller has resolved a locale. */
      readonly target: (locale: Locale) => string;
    }
  | {
      /** Nothing to do — not a locale-prefixed surface. */
      readonly action: "ignore";
    };

/**
 * The routing decision for one public pathname.
 *
 * Deliberately total and deliberately pure: every path gets an answer, and the
 * answer never depends on a header, a cookie, a session or a clock. The caller
 * (`src/middleware.ts`) supplies the locale only for the `redirect` case, which
 * is the only case ADR-0098 allows a cookie to influence — and that response is
 * `private, no-store`, so the cookie never reaches the cache.
 *
 * `/id/blog/acme/search` resolves to `ignore`, not `serve`: search is not a
 * prefixed surface, so a prefixed spelling of it is simply not a URL this site
 * has. It falls through to normal routing and 404s, rather than being quietly
 * accepted as a second name for `/blog/acme/search`.
 */
export function resolvePublicLocaleRoute(pathname: string): PublicLocaleRoute {
  const { locale, pathname: bare } = splitPublicLocalePath(pathname);

  if (!requiresPublicLocalePrefix(bare)) {
    return { action: "ignore" };
  }

  if (locale) {
    return { action: "serve", locale, servePathname: bare };
  }

  return {
    action: "redirect",
    target: (chosen: Locale) => withPublicLocalePrefix(bare, chosen)
  };
}

/**
 * Carries a reader's locale through a `seo_distribution` redirect.
 *
 * Redirect RULES are authored against bare paths, because a slug change is not
 * a language change and an editor should not have to write the same rule twice.
 * That means matching happens on the stripped path — and it means the target
 * comes back stripped too. Handing that target straight to a reader who arrived
 * on `/id/…` would silently drop them into the default language, one hop after
 * they chose otherwise.
 *
 * Only same-origin paths are touched. A rule pointing at another host is a
 * deliberate exit from this site and its URL is not ours to rewrite; a target
 * that is not itself a locale-prefixed surface (`/robots.txt`, an uploaded
 * file) has no prefixed spelling to send anyone to.
 */
export function carryLocaleThroughRedirect(
  location: string,
  locale: Locale | null
): string {
  if (!locale || !location.startsWith("/") || location.startsWith("//")) {
    return location;
  }

  const [pathname, ...rest] = location.split(/(?=[?#])/);

  if (!pathname || !requiresPublicLocalePrefix(pathname)) {
    return location;
  }

  return withPublicLocalePrefix(pathname, locale) + rest.join("");
}

/**
 * The `hreflang` set for one resource — ADR-0098 decision 5.
 *
 * `x-default` points at the TENANT DEFAULT's prefixed URL, never at the bare
 * alias. A crawler following `x-default` must land on the cacheable canonical
 * document; landing it on the redirect would make the crawler's own
 * `Accept-Language` decide which document it indexes as the default, which is
 * option B's failure re-introduced through the back door.
 */
export function buildHreflangAlternates(
  pathname: string,
  tenantDefaultLocale: Locale = DEFAULT_LOCALE
): readonly { readonly hreflang: string; readonly pathname: string }[] {
  const bare = stripPublicLocalePrefix(pathname);

  if (!requiresPublicLocalePrefix(bare)) {
    return [];
  }

  return [
    ...SUPPORTED_LOCALES.map((locale) => ({
      hreflang: locale,
      pathname: withPublicLocalePrefix(bare, locale)
    })),
    {
      hreflang: "x-default",
      pathname: withPublicLocalePrefix(bare, tenantDefaultLocale)
    }
  ];
}

export interface LocalisedPublicUrls {
  /** Absolute canonical URL for THIS locale's spelling of the resource. */
  readonly canonicalUrl: string;
  /** Absolute `hreflang` set, ready for the page shell. */
  readonly hreflangAlternates: readonly {
    readonly hreflang: string;
    readonly href: string;
  }[];
  /** Prefixed listing root, for building in-page links that keep the locale. */
  readonly basePath: string;
}

/**
 * Everything a public HTML route needs to name itself and its siblings.
 *
 * `barePathname` is what the route sees after the middleware rewrite
 * (`Astro.url.pathname`), and it is deliberately the input rather than the
 * prefixed URL: a route should not have to know whether it was reached through
 * a prefix, only which locale it is rendering.
 *
 * The canonical URL is the PREFIXED one. That is the half of decision 4 that is
 * easy to get wrong — leaving canonical pointing at the bare path would tell
 * every crawler that the real document is the URL that answers `307`, and the
 * two prefixed documents would be indexed as duplicates of a redirect.
 */
export function buildLocalisedPublicUrls(
  origin: string,
  barePathname: string,
  locale: Locale,
  tenantDefaultLocale: Locale = DEFAULT_LOCALE
): LocalisedPublicUrls {
  const bare = stripPublicLocalePrefix(barePathname);

  return {
    canonicalUrl: `${origin}${withPublicLocalePrefix(bare, locale)}`,
    hreflangAlternates: buildHreflangAlternates(bare, tenantDefaultLocale).map(
      (alternate) => ({
        hreflang: alternate.hreflang,
        href: `${origin}${alternate.pathname}`
      })
    ),
    basePath: withPublicLocalePrefix(bare, locale)
  };
}
