import { describe, expect, test } from "bun:test";

import { listWindow } from "../src/modules/seo-distribution/application/seo-discovery-service";
import {
  SEO_FACTS_PROVIDER_PAGE_SIZE,
  SITEMAP_PROVIDER_REQUESTS_PER_PAGE,
  SITEMAP_URLS_PER_PAGE
} from "../src/modules/seo-distribution/domain/discovery-limits";
import { sitemapPageCount } from "../src/modules/seo-distribution/domain/sitemap-serialization";
import { BLOG_CONTENT_SEO_MAX_LIST_PAGE_SIZE } from "../src/modules/blog-content/application/seo-facts-port-adapter";
import type {
  ListPublicResourceFactsOptions,
  SeoFactsSource,
  SeoResourceFacts,
  SeoResourceFactsPage,
  SeoResourceFactsSummary
} from "../src/modules/_shared/ports/seo-facts-port";
import type { SeoDiscoveryContext } from "../src/modules/seo-distribution/application/seo-discovery-service";

/**
 * The sitemap child-page window must serve the WHOLE corpus a tenant has, not
 * the first response a provider happens to hand back.
 *
 * The defect these tests lock out: `ListPublicResourceFactsOptions.pageSize` is
 * a REQUEST, and every provider clamps it (`blog_content` clamps at 200 —
 * `BLOG_CONTENT_SEO_MAX_LIST_PAGE_SIZE`). The window used to ask for a whole
 * child page in ONE call and take the answer at face value, so a tenant with
 * more than 200 eligible resources lost the remainder of every child sitemap —
 * silently: the index still advertised `ceil(count / perPage)` children, every
 * child returned 200 `<url>` entries, no error was raised anywhere, and the only
 * observable symptom was pages missing from search engines weeks later.
 *
 * Everything here is pure: `listWindow` touches only `tx`/`tenantId`/`providers`,
 * and the providers below are in-memory, so no database is involved.
 */

const FAKE_TX = { fake: "tx" } as unknown as Bun.SQL;
const TENANT = "11111111-1111-4111-8111-111111111111";

function makeFacts(id: string, path: string): SeoResourceFacts {
  return {
    resourceType: "blog_post",
    resourceId: id,
    visibility: {
      state: "published",
      noindex: false,
      scheduledPublishAt: null
    },
    canonicalPath: path,
    localeAlternates: [{ locale: "en", path }],
    metadata: { title: id, description: null, robots: "index,follow" },
    openGraph: {
      title: id,
      description: null,
      imageMediaId: null,
      type: "article"
    },
    jsonLd: [],
    sitemap: { lastmod: "2026-08-11T00:00:00.000Z", changefreq: "weekly" },
    feed: { publishedAt: "2026-08-11T00:00:00.000Z", updatedAt: null }
  };
}

/** A corpus of `count` entries in the provider's stable `id_asc` order. */
function corpus(prefix: string, count: number): SeoResourceFacts[] {
  return Array.from({ length: count }, (_, index) =>
    makeFacts(
      `${prefix}-${String(index).padStart(5, "0")}`,
      `/blog/${prefix}-${String(index).padStart(5, "0")}`
    )
  );
}

type FakeProvider = SeoFactsSource & {
  /** Every `options` object the service handed this provider, in order. */
  readonly calls: ListPublicResourceFactsOptions[];
  /** Every cursor value this provider ISSUED, in order. */
  readonly issuedCursors: string[];
};

type FakeProviderOptions = {
  /** Hard per-response ceiling, exactly like a real provider's clamp. */
  clamp?: number;
  /**
   * Cursor encoding. The default mimics `blog_content` (the row id). The
   * `microsecond` form mimics a keyset cursor carrying a FULL-PRECISION
   * `timestamptz` — six fractional digits, which a JS `Date` (milliseconds)
   * cannot represent.
   */
  cursorStyle?: "id" | "microsecond";
};

/**
 * An in-memory `SeoFactsSource` that behaves like a real one in the two ways
 * that matter: it CLAMPS `pageSize` to its own ceiling, and it reports "there is
 * more" only through `nextCursor`.
 *
 * Its cursors are looked up by EXACT string match, so any consumer that parses,
 * re-encodes, or round-trips one through a `Date` fails loudly here instead of
 * silently skipping the rows inside a truncated microsecond.
 */
function fakeProvider(
  items: readonly SeoResourceFacts[],
  options: FakeProviderOptions = {}
): FakeProvider {
  const clamp = options.clamp ?? BLOG_CONTENT_SEO_MAX_LIST_PAGE_SIZE;
  const cursorStyle = options.cursorStyle ?? "id";
  const calls: ListPublicResourceFactsOptions[] = [];
  const issuedCursors: string[] = [];

  // Cursor → index of the row it points AT (the walk resumes strictly after it).
  const cursorIndex = new Map<string, number>();
  const cursorFor = (index: number): string => {
    if (cursorStyle === "id") return items[index]!.resourceId;
    // `2026-08-11T04:05:06.123456+00:00` — microsecond precision, the digits a
    // `Date` round-trip would drop.
    const micros = String(index).padStart(6, "0");
    return `2026-08-11T04:05:06.${micros}+00:00|${items[index]!.resourceId}`;
  };
  items.forEach((_, index) => cursorIndex.set(cursorFor(index), index));

  return {
    calls,
    issuedCursors,

    async listPublicResourceFacts(
      tx: Bun.SQL,
      tenantId: string,
      opts?: ListPublicResourceFactsOptions
    ): Promise<SeoResourceFactsPage> {
      expect(tx).toBe(FAKE_TX);
      expect(tenantId).toBe(TENANT);
      expect(opts?.order).toBe("id_asc");
      calls.push({ ...opts });

      const cursor = opts?.cursor ?? null;
      // A window slice must position itself with exactly one of the two; sending
      // both would double-skip on a provider that honors each independently.
      if (cursor !== null && opts?.offset !== undefined) {
        throw new Error(
          `provider received BOTH cursor and offset (${cursor} / ${opts.offset}) — a slice must be positioned by one or the other`
        );
      }

      let start: number;
      if (cursor === null) {
        start = Math.max(0, Math.trunc(opts?.offset ?? 0));
      } else {
        const at = cursorIndex.get(cursor);
        if (at === undefined) {
          throw new Error(
            `provider received an unrecognized cursor ${JSON.stringify(
              cursor
            )} — cursors are opaque and must be handed back byte-for-byte (never parsed or re-encoded)`
          );
        }
        start = at + 1;
      }

      const size = Math.min(
        Math.max(1, opts?.pageSize ?? 50),
        clamp // the clamp a caller cannot see except through `nextCursor`
      );
      const page = items.slice(start, start + size);
      const hasMore = start + page.length < items.length;
      const nextCursor = hasMore ? cursorFor(start + page.length - 1) : null;
      if (nextCursor !== null) issuedCursors.push(nextCursor);

      return { items: page, nextCursor };
    },

    async resolveResourceFacts(): Promise<SeoResourceFacts | null> {
      return null;
    },

    async summarizePublicResourceFacts(): Promise<SeoResourceFactsSummary> {
      return {
        count: items.length,
        latestLastmod: "2026-08-11T00:00:00.000Z",
        latestPublishedAt: "2026-08-11T00:00:00.000Z"
      };
    }
  };
}

function contextOf(providers: readonly SeoFactsSource[]): SeoDiscoveryContext {
  return {
    tx: FAKE_TX,
    tenantId: TENANT,
    tenantDisplayName: "Paging Tenant",
    defaultLocale: "en",
    providers,
    mediaLibrary: null
  };
}

/** Walk every child sitemap the index would advertise for `total` entries. */
async function walkAllPages(
  ctx: SeoDiscoveryContext,
  total: number
): Promise<SeoResourceFacts[][]> {
  const pageCount = sitemapPageCount(total);
  const pages: SeoResourceFacts[][] = [];
  for (let page = 1; page <= pageCount; page++) {
    pages.push(
      await listWindow(
        ctx,
        (page - 1) * SITEMAP_URLS_PER_PAGE,
        SITEMAP_URLS_PER_PAGE
      )
    );
  }
  return pages;
}

describe("sitemap window paging: a corpus past the provider clamp is served whole", () => {
  test("201 entries — every one appears exactly once across the child pages", async () => {
    const items = corpus("post", 201);
    // The fixture is deliberately one past the real provider's clamp: 201 is the
    // smallest corpus the old single-request window could not serve.
    expect(items.length).toBeGreaterThan(BLOG_CONTENT_SEO_MAX_LIST_PAGE_SIZE);

    const provider = fakeProvider(items);
    const pages = await walkAllPages(contextOf([provider]), items.length);
    const served = pages.flat().map((fact) => fact.resourceId);

    expect(served.length).toBe(201);
    expect(new Set(served).size).toBe(201);
    expect(served).toEqual(items.map((fact) => fact.resourceId));

    // …and it cost more than one provider request, which is the whole point:
    // one request can only ever return `clamp` rows.
    const listCalls = provider.calls.length;
    expect(listCalls).toBeGreaterThan(1);
    expect(listCalls).toBeLessThanOrEqual(SITEMAP_PROVIDER_REQUESTS_PER_PAGE);
  });

  test("a corpus spanning two child pages loses nothing and repeats nothing", async () => {
    const total = SITEMAP_URLS_PER_PAGE + 201;
    const items = corpus("post", total);
    const provider = fakeProvider(items);

    const pages = await walkAllPages(contextOf([provider]), total);
    expect(pages.length).toBe(2);
    expect(pages[0]!.length).toBe(SITEMAP_URLS_PER_PAGE);
    expect(pages[1]!.length).toBe(201);

    const served = pages.flat().map((fact) => fact.resourceId);
    expect(served).toEqual(items.map((fact) => fact.resourceId));
    expect(new Set(served).size).toBe(total);

    // No entry is served by two different child pages (a crawler would index the
    // same URL twice, and the index would over-count the corpus).
    const first = new Set(pages[0]!.map((fact) => fact.resourceId));
    expect(pages[1]!.some((fact) => first.has(fact.resourceId))).toBe(false);
  });

  test("the window is exact at the page boundary (offset positions the resume)", async () => {
    const total = SITEMAP_URLS_PER_PAGE + 201;
    const items = corpus("post", total);
    const provider = fakeProvider(items);
    const ctx = contextOf([provider]);

    const second = await listWindow(
      ctx,
      SITEMAP_URLS_PER_PAGE,
      SITEMAP_URLS_PER_PAGE
    );
    expect(second[0]!.resourceId).toBe(
      items[SITEMAP_URLS_PER_PAGE]!.resourceId
    );
    expect(second[second.length - 1]!.resourceId).toBe(
      items[total - 1]!.resourceId
    );

    // The first request of a slice carries the offset; every later one carries
    // only the cursor.
    expect(provider.calls[0]!.offset).toBe(SITEMAP_URLS_PER_PAGE);
    for (const call of provider.calls.slice(1)) {
      expect(call.offset).toBeUndefined();
      expect(typeof call.cursor).toBe("string");
    }
  });
});

describe("sitemap window paging: cursors stay opaque", () => {
  test("a full-precision timestamp cursor is handed back byte-for-byte", async () => {
    const items = corpus("post", 201);
    const provider = fakeProvider(items, { cursorStyle: "microsecond" });

    // The provider throws on an unrecognized cursor, so a `new Date(cursor)`
    // round-trip anywhere in the walk (which truncates microseconds to
    // milliseconds) fails this test instead of silently skipping rows.
    const pages = await walkAllPages(contextOf([provider]), items.length);
    expect(pages.flat().length).toBe(201);

    const sent = provider.calls
      .map((call) => call.cursor)
      .filter((cursor): cursor is string => typeof cursor === "string");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent).toEqual(provider.issuedCursors.slice(0, sent.length));
    // Six fractional digits survived — a `Date` would have left three.
    for (const cursor of sent) {
      expect(cursor).toMatch(/\.\d{6}\+00:00\|/);
    }
  });
});

describe("sitemap window paging: multiple providers", () => {
  test("a window spanning two providers takes each one's full share", async () => {
    const first = corpus("alpha", 250);
    const second = corpus("beta", 300);
    const providerA = fakeProvider(first);
    const providerB = fakeProvider(second);

    const window = await listWindow(
      contextOf([providerA, providerB]),
      0,
      SITEMAP_URLS_PER_PAGE
    );

    expect(window.map((fact) => fact.resourceId)).toEqual([
      ...first.map((fact) => fact.resourceId),
      ...second.map((fact) => fact.resourceId)
    ]);
    expect(new Set(window.map((fact) => fact.resourceId)).size).toBe(550);
  });

  test("an offset landing inside the second provider skips the first entirely", async () => {
    const first = corpus("alpha", 250);
    const second = corpus("beta", 300);
    const providerA = fakeProvider(first);
    const providerB = fakeProvider(second);

    const window = await listWindow(
      contextOf([providerA, providerB]),
      260,
      SITEMAP_URLS_PER_PAGE
    );

    expect(window.map((fact) => fact.resourceId)).toEqual(
      second.slice(10).map((fact) => fact.resourceId)
    );
    // Provider A was rolled up, never listed: its 250 entries are entirely
    // behind the offset.
    expect(providerA.calls.length).toBe(0);
  });
});

describe("sitemap window paging: the walk stays bounded", () => {
  test("a provider that clamps to 1 costs a fixed number of requests, not one per row", async () => {
    const items = corpus("post", 5000);
    const provider = fakeProvider(items, { clamp: 1 });

    const window = await listWindow(
      contextOf([provider]),
      0,
      SITEMAP_URLS_PER_PAGE
    );

    expect(provider.calls.length).toBe(SITEMAP_PROVIDER_REQUESTS_PER_PAGE);
    expect(window.length).toBe(SITEMAP_PROVIDER_REQUESTS_PER_PAGE);
  });

  test("a provider that hands back a cursor with no rows terminates the walk", async () => {
    let calls = 0;
    const nonTerminating: SeoFactsSource = {
      async listPublicResourceFacts(): Promise<SeoResourceFactsPage> {
        calls++;
        return { items: [], nextCursor: "never-ends" };
      },
      async resolveResourceFacts(): Promise<SeoResourceFacts | null> {
        return null;
      },
      async summarizePublicResourceFacts(): Promise<SeoResourceFactsSummary> {
        return { count: 10, latestLastmod: null, latestPublishedAt: null };
      }
    };

    const window = await listWindow(
      contextOf([nonTerminating]),
      0,
      SITEMAP_URLS_PER_PAGE
    );
    expect(window).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe("sitemap window paging: the limits agree with the real provider", () => {
  test("the request budget can fill a whole child page from blog_content", () => {
    // The number the service asks for must be one the real provider honors…
    expect(SEO_FACTS_PROVIDER_PAGE_SIZE).toBeLessThanOrEqual(
      BLOG_CONTENT_SEO_MAX_LIST_PAGE_SIZE
    );
    // …and the per-page request ceiling must be generous enough to actually
    // fill a child page at that size, or the truncation comes straight back.
    expect(
      Math.ceil(SITEMAP_URLS_PER_PAGE / SEO_FACTS_PROVIDER_PAGE_SIZE)
    ).toBeLessThanOrEqual(SITEMAP_PROVIDER_REQUESTS_PER_PAGE);
  });
});
