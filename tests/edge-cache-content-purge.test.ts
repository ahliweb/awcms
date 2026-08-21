/**
 * ADR-0042 — content-change purge emission.
 *
 * The assertion that matters most here is the negative one: with the edge cache
 * off, a publish must not append queue rows. Every deployment that has not opted
 * in still runs these write paths, and an unguarded enqueue would grow a table
 * no worker drains.
 */
import { describe, expect, test } from "bun:test";

import {
  enqueueModuleContentPurge,
  resolveDerivedSurfaceModuleKeys
} from "../src/lib/edge-cache/content-purge";
import type { SqlExecutor } from "../src/lib/edge-cache/purge-queue";
import { PUBLIC_CACHE_SURFACES } from "../src/lib/edge-cache/surface-registry";
import { listModules } from "../src/modules";
import { stripComments } from "../scripts/access-chokepoint-check";
import {
  collectClaims,
  resolveOwner,
  routeOf
} from "../scripts/validate-module-routes";

/** Records the parameter arrays passed to the tagged-template executor. */
function recordingTx(): { tx: SqlExecutor; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const tx = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);

    return Promise.resolve([]);
  }) as SqlExecutor;

  return { tx, calls };
}

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("enqueueModuleContentPurge", () => {
  test("is a no-op when the edge cache is disabled", async () => {
    const { tx, calls } = recordingTx();
    const previous = process.env.EDGE_CACHE_MODE;

    delete process.env.EDGE_CACHE_MODE;

    try {
      const enqueued = await enqueueModuleContentPurge(
        tx,
        TENANT,
        "blog_content",
        "blog.post.published"
      );

      expect(enqueued).toBe(0);
      expect(calls).toHaveLength(0);
    } finally {
      if (previous === undefined) {
        delete process.env.EDGE_CACHE_MODE;
      } else {
        process.env.EDGE_CACHE_MODE = previous;
      }
    }
  });

  test("enqueues the owning module's key plus its derived consumers", async () => {
    const { tx, calls } = recordingTx();
    const previous = process.env.EDGE_CACHE_MODE;

    process.env.EDGE_CACHE_MODE = "auto";

    try {
      const enqueued = await enqueueModuleContentPurge(
        tx,
        TENANT,
        "blog_content",
        "blog.post.published"
      );

      expect(enqueued).toBe(2);
      // Still ONE statement: the two keys go in a single enqueue, so the purge
      // commits atomically with the content change rather than half-committing.
      expect(calls).toHaveLength(1);

      // Module scope, NOT a resource key: cached responses are tagged with
      // tenant/surface/module only, so a resource-scoped ban would match no
      // object and the page would stay stale until its TTL expired.
      //
      // `seo_distribution` rides along (ADR-0061 §B) because it declares
      // `consumes: seo_facts providedBy blog_content` AND owns surfaces whose
      // bodies aggregate that content. Without it, publishing a post would purge
      // `/blog/{code}/feed.xml` and leave `/feed.xml` — the same content, the
      // host-resolved spelling — stale until TTL.
      expect(calls[0]).toEqual([
        TENANT,
        [`t:${TENANT}:m:blog_content`, `t:${TENANT}:m:seo_distribution`],
        "blog.post.published"
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.EDGE_CACHE_MODE;
      } else {
        process.env.EDGE_CACHE_MODE = previous;
      }
    }
  });
});

describe("derived-surface fan-out (ADR-0061 §B)", () => {
  const SURFACES = [{ moduleKey: "owner" }, { moduleKey: "consumer" }];

  test("a consumer that owns a surface is covered", () => {
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          { key: "owner" },
          {
            key: "consumer",
            capabilities: { consumes: [{ providedBy: "owner" }] }
          }
        ],
        SURFACES
      )
    ).toEqual(["consumer"]);
  });

  test("a consumer that owns NO surface is excluded", () => {
    // The condition this repo already applies to `media_library`: a ban on a
    // module key that tags no cached object matches nothing while the queue
    // reports success. Adding it would be ceremony that reads as coverage.
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          { key: "owner" },
          {
            key: "surfaceless",
            capabilities: { consumes: [{ providedBy: "owner" }] }
          }
        ],
        [{ moduleKey: "owner" }]
      )
    ).toEqual([]);
  });

  test("a surface owner that consumes nothing from the changing module is excluded", () => {
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          { key: "owner" },
          {
            key: "consumer",
            capabilities: { consumes: [{ providedBy: "somebody_else" }] }
          }
        ],
        SURFACES
      )
    ).toEqual([]);
  });

  test("the changing module never fans out to itself", () => {
    // It is already scope #1. A duplicate key would enqueue the same ban twice.
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          {
            key: "owner",
            capabilities: { consumes: [{ providedBy: "owner" }] }
          }
        ],
        SURFACES
      )
    ).toEqual([]);
  });

  test("against the LIVE registry, blog_content reaches seo_distribution and theming does not", () => {
    // The literals above prove the rule; this proves the rule is wired to the
    // real declarations. `theming` feeds no aggregator, so it must stay a
    // single-key purge — otherwise the fan-out is over-broad rather than exact.
    expect(resolveDerivedSurfaceModuleKeys("blog_content")).toEqual([
      "seo_distribution"
    ]);
    expect(resolveDerivedSurfaceModuleKeys("theming")).toEqual([]);
  });
});

describe("content write paths emit a purge", () => {
  test.each([
    ["src/pages/api/v1/blog/posts/[id].ts", 2],
    ["src/pages/api/v1/blog/posts/index.ts", 1],
    // Issue #623 — these five predate the page work below and were missed by
    // it, because a list of files cannot report the file it does not contain.
    // `publish` is the button `/admin/blog` calls: with the edge cache on, the
    // whole newsroom publish path emitted no purge at all. `archive` is the
    // direction that matters more — a withdrawn article still served from the
    // edge is the withdrawal not having happened. `revisions/{id}/restore`
    // rewrites the body of a post that may be published right now.
    //
    // `posts/[id]/schedule.ts` is deliberately ABSENT: only `draft` and
    // `review` may become `scheduled`, so it changes nothing a reader can see,
    // and the sweep that does publish it purges. See its own header.
    ["src/pages/api/v1/blog/posts/[id]/publish.ts", 1],
    ["src/pages/api/v1/blog/posts/[id]/archive.ts", 1],
    ["src/pages/api/v1/blog/posts/[id]/restore.ts", 1],
    ["src/pages/api/v1/blog/posts/[id]/purge.ts", 1],
    ["src/pages/api/v1/blog/posts/[id]/revisions/[revisionId]/restore.ts", 1],
    // Issue #594 gave `blog_content` the `blog-page` surface, so every handler
    // that changes a page now has the obligation posts already had. The four
    // lifecycle routes matter more than the two CRUD ones: `publish` is how a
    // page becomes reachable at all and `archive` is how it stops being, and
    // neither goes through the PATCH path that would otherwise have covered it.
    ["src/pages/api/v1/blog/pages/[id].ts", 2],
    ["src/pages/api/v1/blog/pages/index.ts", 1],
    ["src/pages/api/v1/blog/pages/[id]/publish.ts", 1],
    ["src/pages/api/v1/blog/pages/[id]/archive.ts", 1],
    ["src/pages/api/v1/blog/pages/[id]/restore.ts", 1],
    ["src/pages/api/v1/blog/pages/[id]/purge.ts", 1],
    // 2 since Issue #591: the publish sweep and the unpublish sweep each emit
    // one. The second matters MORE than the first — a withdrawn article still
    // sitting in the edge cache is the withdrawal not having happened, which is
    // the failure an embargo exists to prevent.
    ["src/modules/blog-content/application/blog-scheduled-publish.ts", 2],
    // `theming` owns the `theming-tokens` surface, so these three change what a
    // cached object contains. `news_portal` and `media_library` are absent on
    // purpose: they own no declared surface, so a ban keyed to them would match
    // nothing while the queue reported success. `edge-cache:surfaces:check`
    // enforces the obligation by ownership and will demand them the day they
    // declare one.
    ["src/pages/api/v1/theming/publish.ts", 1],
    ["src/pages/api/v1/theming/rollback.ts", 1],
    ["src/pages/api/v1/theming/retire.ts", 1],
    // `seo_distribution` owns the three `seo-*` discovery surfaces as of
    // ADR-0061 §B, so its own config write must purge them: the tenant-wide
    // `noindex` switch alone rewrites `/robots.txt`, and serving a stale crawl
    // policy to crawlers is the one staleness here with a lasting consequence.
    ["src/pages/api/v1/seo/config.ts", 1],
    // Issue #628 — the eleven the derived population found once the obligation
    // stopped being a list somebody maintained. Each renders onto a surface
    // Issue #594's work created or extended: ads on five public routes, the
    // composed homepage on `/blog/{code}`, the archives on terms, and
    // `feed.xml`/`sitemap-blog.xml` on the two settings flags that decide
    // whether they answer at all.
    ["src/pages/api/v1/blog/terms/index.ts", 1],
    ["src/pages/api/v1/blog/terms/[id].ts", 2],
    ["src/pages/api/v1/blog/settings/index.ts", 1],
    ["src/pages/api/v1/blog/internal-tag-links/settings.ts", 1],
    ["src/pages/api/v1/news-portal/homepage-sections/index.ts", 1],
    ["src/pages/api/v1/news-portal/homepage-sections/[id].ts", 2],
    ["src/pages/api/v1/news-portal/ad-placements/index.ts", 1],
    ["src/pages/api/v1/news-portal/ad-placements/[id].ts", 2]
  ])(
    "%s calls enqueueModuleContentPurge %i time(s)",
    async (path, expected) => {
      // A source-level assertion on purpose. These are the paths that make
      // content change; if someone adds a fourth mutating handler without an
      // enqueue, the edge cache silently serves stale content — a failure that
      // no unit test of the handler itself would surface.
      const source = await Bun.file(path).text();
      const occurrences =
        source.split("await enqueueModuleContentPurge(").length - 1;

      expect(occurrences).toBe(expected);
    }
  );
});

/**
 * The obligation, DERIVED rather than remembered (Issue #623).
 *
 * The list above pins how many times each enumerated file purges. Its weakness
 * is structural and its own comment admitted it: a file that is not in the list
 * is not checked, so a new mutating handler that forgets the enqueue turns
 * nothing red. That is precisely how the five post lifecycle routes went a year
 * without one while a gate named `edge-cache:surfaces:check` reported green —
 * that gate asks whether the MODULE purges anywhere, and `blog_content` did.
 *
 * So the population is computed here instead: every mutating API route owned by
 * a module that owns a cacheable surface. Each one either purges, or is named
 * below with a reason it cannot change what a reader sees.
 */
const SURFACE_OWNING_MODULES = new Set(
  PUBLIC_CACHE_SURFACES.map((surface) => surface.moduleKey).filter(
    (key): key is string => Boolean(key)
  )
);

/** `export const POST|PATCH|PUT|DELETE` — the handlers that can change content. */
const MUTATING_HANDLER = /export const (?:POST|PATCH|PUT|DELETE)\b/;

/**
 * Verified exempt: the handler cannot change any cached public surface.
 *
 * A reason here must be checkable, not plausible. "Probably not public" is how
 * an exemption list becomes the place obligations go to be forgotten.
 */
const PURGE_NOT_REQUIRED: Readonly<Record<string, string>> = {
  "src/pages/api/v1/blog/posts/[id]/schedule.ts":
    "Only `draft` and `review` may become `scheduled` (ALLOWED_STATUS_TRANSITIONS); a published post cannot. Nothing it commits is ever on a public surface, and the sweep that does publish it purges.",
  "src/pages/api/v1/blog/posts/[id]/submit-review.ts":
    "`review` is reachable from `draft` only — `published` transitions to `archived` or `draft`, never to `review`. So this never withdraws a live article.",
  "src/pages/api/v1/theming/draft.ts":
    "Writes a theme DRAFT. The live tokens change at `theming/publish.ts`, which purges.",
  "src/pages/api/v1/theming/preview.ts":
    "Creates a preview session, which is served to its holder rather than cached publicly.",
  "src/pages/api/v1/theming/validate.ts":
    "Validation only — no INSERT/UPDATE/DELETE anywhere in the file.",
  "src/pages/api/v1/seo/redirects/validate.ts":
    "Validation only — no INSERT/UPDATE/DELETE anywhere in the file.",

  // ── Issue #628, group 1: nothing in the public route closure reads them ──
  //
  // Checked rather than asserted: `NO_PUBLIC_READER_MODULES` below names the
  // directory each of these writes through, and a test walks the transitive
  // import closure of every file under `src/pages/blog/` to prove none is
  // reachable. The day a public surface starts rendering menus — or
  // institutions, which #614 stored and no reader shows — that test goes red
  // and this exemption has to be revisited. An exemption whose reason can go
  // stale in silence is the shape this whole gate exists to avoid.
  "src/pages/api/v1/blog/menus/index.ts":
    "No public surface renders a menu — `menu-directory` is unreachable from the public route closure.",
  "src/pages/api/v1/blog/menus/[id].ts":
    "As `menus/index.ts` — nothing public renders a menu.",
  "src/pages/api/v1/blog/widgets/index.ts":
    "No public surface renders a widget — `widget-directory` is unreachable from the public route closure.",
  "src/pages/api/v1/blog/widgets/[id].ts":
    "As `widgets/index.ts` — nothing public renders a widget.",
  "src/pages/api/v1/blog/templates/index.ts":
    "No public surface renders a template — `template-directory` is unreachable from the public route closure. `renderPublicPageShell` is a code-level shell, not a stored template.",
  "src/pages/api/v1/blog/templates/[id].ts":
    "As `templates/index.ts` — nothing public renders a template.",
  "src/pages/api/v1/blog/theme/index.ts":
    "`blog_content`'s own theme row is not the `theming-tokens` surface (that is `theming`'s, and its publish route purges). `theme-settings-directory` is unreachable from the public route closure.",
  "src/pages/api/v1/blog/institutions/index.ts":
    "Issue #614 stores an article's institution and no public surface renders it yet — `institution-directory` is unreachable from the public route closure.",
  "src/pages/api/v1/blog/institutions/[id].ts": "As `institutions/index.ts`.",
  "src/pages/api/v1/blog/institutions/[id]/restore.ts":
    "As `institutions/index.ts`.",
  "src/pages/api/v1/blog/institutions/[id]/purge.ts":
    "As `institutions/index.ts`.",
  "src/pages/api/v1/blog/ads/index.ts":
    "The LEGACY ad tables (ADR-0044 §4 Fase 2, pending drop). `composeAdSlots` reads `awcms_news_portal_ad_placements` only, so `ads-directory` is unreachable from the public route closure — the successor routes are the ones that purge.",
  "src/pages/api/v1/blog/ads/[id].ts": "As `ads/index.ts` — the legacy tables.",

  // ── Issue #628, group 2: seo_distribution's cached bodies do not read them ──
  //
  // `buildRobotsPayload`, `buildSitemapPagePayload` and `buildFeedPayload` are
  // the only producers of the three `seo-*` surfaces, and none of them reads a
  // redirect or a not-found record at all. So none of these handlers changes a
  // cached body belonging to this module.
  //
  // KNOWN RESIDUAL RISK, stated rather than hidden: a redirect whose SOURCE
  // path is itself a cacheable surface — a `blog-post` URL, say — is inert
  // until that object's TTL expires, because Varnish answers a cached hit
  // without ever reaching the middleware that would redirect. A purge here
  // cannot fix that: `enqueueModuleContentPurge` bans a MODULE scope, the
  // stale object is tagged `m:blog_content`, and a `m:seo_distribution` ban
  // matches nothing. Expressing it needs a path-scoped ban, which is a
  // different mechanism and a different change. The common case is already
  // covered from the other side — a slug change purges through the post's own
  // PATCH before `capture-url-change` records the redirect.
  "src/pages/api/v1/seo/redirects/index.ts":
    "No `seo-*` payload builder reads a redirect. See the residual-risk note above.",
  "src/pages/api/v1/seo/redirects/[id].ts": "As `redirects/index.ts`.",
  "src/pages/api/v1/seo/redirects/[id]/lifecycle.ts":
    "As `redirects/index.ts`.",
  "src/pages/api/v1/seo/redirects/capture-url-change.ts":
    "As `redirects/index.ts` — and the content change that triggers it purges through its own handler.",
  "src/pages/api/v1/seo/redirects/import.ts": "As `redirects/index.ts`.",
  "src/pages/api/v1/seo/redirects/settings.ts":
    "Redirect POLICY. No `seo-*` payload builder reads it either.",
  "src/pages/api/v1/seo/not-found/[id].ts":
    "A 404 observation record, read by the admin report only — no public surface renders it."
};

/**
 * The application directories whose writes reach no reader.
 *
 * Each backs one or more exemptions above, and the assertion is transitive: the
 * import closure of every file under `src/pages/blog/` is walked, and none of
 * these may appear in it. That turns "nothing public reads it" from a claim
 * someone checked once into one the suite re-checks every run.
 */
const NO_PUBLIC_READER_MODULES: readonly string[] = [
  "menu-directory",
  "widget-directory",
  "template-directory",
  "theme-settings-directory",
  "institution-directory",
  "ads-directory"
];

/**
 * The ledger, now EMPTY (Issue #628).
 *
 * It held twenty-eight entries when Issue #623 derived this population and
 * declined to decide them inside a five-route bug fix. Eleven of them were real
 * staleness and now purge; the other twenty moved up into `PURGE_NOT_REQUIRED`
 * with a reason a reader can check.
 *
 * An empty list is worth more than a short one: the next entry is the only
 * entry, so it cannot be added quietly. Keep it that way — a handler belongs in
 * `PURGE_NOT_REQUIRED` with a reason, or it purges.
 */
const PURGE_OBLIGATION_UNREVIEWED: readonly string[] = [];

type PurgeObligation = { file: string; owner: string; purges: boolean };

async function collectPurgeObligations(): Promise<PurgeObligation[]> {
  const { claims } = collectClaims(listModules());
  const obligations: PurgeObligation[] = [];

  for await (const file of new Bun.Glob("src/pages/api/**/*.ts").scan({
    cwd: process.cwd()
  })) {
    const source = await Bun.file(file).text();

    if (!MUTATING_HANDLER.test(source)) {
      continue;
    }

    const owner = resolveOwner(routeOf(file), claims);

    // An UNCLAIMED route resolves to no owner and is skipped here. That is not
    // a hole: `modules:routes:check` already refuses a route no module declares,
    // so a handler cannot reach main without an owner for this to read.
    if (!owner || !SURFACE_OWNING_MODULES.has(owner)) {
      continue;
    }

    obligations.push({
      file,
      owner,
      purges: source.includes("enqueueModuleContentPurge(")
    });
  }

  return obligations.sort((a, b) => a.file.localeCompare(b.file));
}

describe("every mutating handler of a surface-owning module is accounted for", () => {
  test("a handler either purges or carries a reason it need not", async () => {
    const obligations = await collectPurgeObligations();

    // Proves the population is real. An empty scan would make every assertion
    // below pass while checking nothing — the failure mode a derived gate has
    // and an enumerated list does not.
    expect(obligations.length).toBeGreaterThan(40);

    const unaccounted = obligations
      .filter((entry) => !entry.purges)
      .map((entry) => entry.file)
      .filter((file) => !(file in PURGE_NOT_REQUIRED));

    expect(unaccounted).toEqual([...PURGE_OBLIGATION_UNREVIEWED].sort());
  });

  test("no exemption or ledger entry names a route that no longer exists", async () => {
    const population = new Set(
      (await collectPurgeObligations()).map((entry) => entry.file)
    );

    // An entry pointing at a deleted or renamed file forgives nothing while
    // reading as a decision — the shape that lets a ledger look shorter than
    // the problem.
    for (const file of [
      ...Object.keys(PURGE_NOT_REQUIRED),
      ...PURGE_OBLIGATION_UNREVIEWED
    ]) {
      expect(population.has(file)).toBe(true);
    }
  });

  test("the five routes Issue #623 named are no longer among the unaccounted", async () => {
    const obligations = await collectPurgeObligations();
    const purging = new Set(
      obligations.filter((entry) => entry.purges).map((entry) => entry.file)
    );

    for (const file of [
      "src/pages/api/v1/blog/posts/[id]/publish.ts",
      "src/pages/api/v1/blog/posts/[id]/archive.ts",
      "src/pages/api/v1/blog/posts/[id]/restore.ts",
      "src/pages/api/v1/blog/posts/[id]/purge.ts",
      "src/pages/api/v1/blog/posts/[id]/revisions/[revisionId]/restore.ts"
    ]) {
      expect(purging.has(file)).toBe(true);
    }
  });

  test("the ledger is empty, and that is the point", () => {
    // A short ledger hides its next entry among the others. An empty one makes
    // the next entry the only entry.
    expect(PURGE_OBLIGATION_UNREVIEWED).toEqual([]);
  });
});

/**
 * Every module file a public route can reach, following relative imports.
 *
 * Transitive on purpose: a route rarely imports a directory itself, it imports a
 * composer that does. Stopping at direct imports would let "no public reader"
 * stay true-looking while a reader sat one hop away.
 */
async function publicRouteImportClosure(): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue: string[] = [];

  for await (const file of new Bun.Glob("src/pages/blog/**/*.ts").scan({
    cwd: process.cwd()
  })) {
    queue.push(file);
  }

  // Proves the crawl found the public routes at all. An empty frontier would
  // make every assertion below pass while walking nothing.
  expect(queue.length).toBeGreaterThan(5);

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = stripComments(await Bun.file(file).text());

    for (const match of source.matchAll(/from "(\.[^"]+)"/g)) {
      const specifier = match[1]!;
      const base = `${file.slice(0, file.lastIndexOf("/"))}/${specifier}`;
      const resolved = new URL(base, "file:///").pathname.slice(1);

      for (const candidate of [`${resolved}.ts`, `${resolved}/index.ts`]) {
        if (await Bun.file(candidate).exists()) {
          queue.push(candidate);
          break;
        }
      }
    }
  }

  return seen;
}

describe('"no public reader" is checked, not asserted', () => {
  test("the public route closure reaches none of the exempted directories", async () => {
    const closure = await publicRouteImportClosure();

    // Sanity: the closure must contain something a public route obviously does
    // read, or the walker is broken and every exemption below is vacuous.
    expect(
      [...closure].some((file) => file.includes("public-blog-directory"))
    ).toBe(true);

    for (const moduleName of NO_PUBLIC_READER_MODULES) {
      const readers = [...closure].filter((file) =>
        file.includes(`/${moduleName}.ts`)
      );

      // If this fails, a public surface has started rendering something whose
      // write handler is exempted from purging on the grounds that nothing
      // renders it. The exemption is now false; give that handler a purge.
      expect(readers).toEqual([]);
    }
  });

  test("every exempted directory actually exists", async () => {
    // Otherwise a rename turns the assertion above into a check that a
    // non-existent file is not imported, which is true of everything.
    for (const moduleName of NO_PUBLIC_READER_MODULES) {
      expect(
        await Bun.file(
          `src/modules/blog-content/application/${moduleName}.ts`
        ).exists()
      ).toBe(true);
    }
  });
});
