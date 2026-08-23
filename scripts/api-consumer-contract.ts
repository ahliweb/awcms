/**
 * api-consumer-contract.ts — `bun run api:consumer-contract:generate|:check`.
 *
 * Freezes the slice of this repo's public API that `ahliweb/awcms-astro`
 * actually calls, so a change to it fails HERE instead of in that repo's build.
 *
 * ## Why the existing frozen snapshot does not cover this
 *
 * `tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml` is the
 * **pre-#182-migration** monolith. Its job is to prove the fragmentation never
 * mutated a contract that existed *before* the split, and it does that job well.
 *
 * But every surface `awcms-astro` depends on landed **after** it — `/auth/session`
 * and `/access/machine-credentials` (ADR-0049), `/media/objects` (#318),
 * `/media/public-origin` (#370), the `/blog/posts` cursor traversal (#317).
 * Searching the snapshot for those paths returns zero. So today a response-shape
 * change to any of them is green in this repo's CI and breaks the other repo's
 * build — a failure that surfaces where the person who caused it is not looking.
 *
 * A SECOND snapshot rather than widening the first: they answer different
 * questions, and the pre-migration one must stay frozen at its own moment to
 * keep answering its.
 *
 * ## The transitive closure is the point
 *
 * Snapshotting the six path objects alone would be close to useless.
 * `GET /api/v1/blog/posts` is a few lines that `$ref` a `BlogPost` schema, and
 * **the interesting breakages happen in the schema** — a field renamed, a type
 * narrowed, a nullable dropped. So this walks every `$ref` reachable from those
 * paths and freezes the components too.
 *
 * ## Additive-superset, not equality
 *
 * Adding an optional field breaks no consumer; removing or retyping one does.
 * The check therefore requires the frozen contract to remain a strict SUBSET of
 * the current bundle — the same rule and the same helper shape the pre-migration
 * test uses.
 *
 * Regenerating is a deliberate act: it means "I accept that the consumer must
 * change too". The fixture's own header says so, and the ADR requires the
 * `awcms-astro` side to be updated in the same breath.
 */
import { readFile, writeFile } from "node:fs/promises";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const BUNDLE_PATH = "openapi/awcms-public-api.openapi.yaml";
const FIXTURE_PATH =
  "tests/fixtures/awcms-astro-consumer-contract.openapi.yaml";

/**
 * Surfaces `ahliweb/awcms-astro` CALLS today.
 *
 * The neighbour repo is the authority for this list, and it has a gate for it:
 * `tests/kontrak-awcms.test.mjs` there asserts an exact set of surfaces,
 * derived from `src/` **with comments stripped first**, and bound two-ways to a
 * marker block in its own skill. That count is written as a literal there, so a
 * new surface reddens it even when the author remembered the skill.
 *
 * ## The order this list is edited in is load-bearing
 *
 * That repo's Definition of Done says a new call "reddens it until `awcms`
 * freezes its response shape" — so an entry lands HERE first, and the neighbour
 * starts calling it second. Reversing the two would put a build in that repo on
 * a shape this repo has not agreed to keep, which is precisely the failure this
 * fixture exists to move back to where it can be fixed.
 *
 * ## Why this list used to hold six, and why that was wrong
 *
 * The first version was derived by grepping the neighbour for `/api/v1/` —
 * WITHOUT stripping comments. Three of the six hits were prose, not calls:
 *
 *   - `/api/v1/blog/posts/{id}` appears in a type docblock. That repo's
 *     ADR-0018 REMOVED the per-id fetch; posts are rendered from the
 *     `view=full` traversal. The reason recorded here even said "single-post
 *     rendering", describing a call that does not happen.
 *   - `/api/v1/auth/session` appears in a comment explaining why the build
 *     deliberately does NOT call it (ADR-0049 refuses machine credentials
 *     there with the same 401 an unknown token gets — anti-oracle).
 *   - `/api/v1/access/machine-credentials` appears in an ERROR MESSAGE telling
 *     a human how to mint a token. Issuing one is a human act, not a build call.
 *
 * That is the same defect class this repo keeps re-learning: reading a file at
 * the wrong granularity and concluding something confident and false. It cost
 * nothing here only because freezing extra paths is conservative — but it made
 * "the contract is guarded" read as more complete than it was, and it bound
 * this repo's evolution to shapes nobody consumes.
 */
export const CONSUMED_PATHS: Readonly<Record<string, string>> = {
  "/api/v1/blog/posts":
    "feed + sitemap build: `view=full` traversal with a stable `created_at` cursor and `?locale=` (#317). `src/lib/content.ts`.",
  "/api/v1/media/objects":
    "batch image resolution for a built page (#318). `src/lib/awcms/media.ts`, `src/lib/article-images.ts`.",
  "/api/v1/media/public-origin":
    "the media origin the build must name in `img-src` BEFORE pulling a single object (#370). `scripts/asal-media.mjs`.",
  "/api/v1/site-profile/composed":
    "who the site IS — masthead, favicon, footer, editorial address, contact details, social links, and the `Organization` node, plus the `seo_distribution` half this endpoint merges in (#596, ADR-0102). `src/lib/awcms/profil.ts` there. Promised as COMMITTED in #645 and moved here when `ahliweb/awcms-astro#61` made the call real.",
  "/api/v1/blog/terms":
    "the tenant's vocabulary, read at build time so a category or tag archive can exist at all (#597 item 1, ADR-0104). `src/lib/awcms/taksonomi.ts` there. The consumer uses the `?order=created_at` TRAVERSAL and never the default alphabetical list — that list returns some of the terms and says nothing about the rest (#647), and a site built from it would generate a hundred archive pages out of thousands. Promised as COMMITTED in #650 and moved here when `ahliweb/awcms-astro#66` made the call real.",
  "/api/v1/blog/menus":
    "the tenant's navigation menus, rendered as a SECONDARY footer region — the localised tab bar is NOT replaced, because a menu item carries one label and no per-locale variant (#597 item 6, ADR-0105). `src/lib/awcms/navigasi.ts` there. Only freezable after #652 gave the response a real schema; promised as COMMITTED in #653 and moved here when `ahliweb/awcms-astro#67` made the call real.",
  "/api/v1/blog/widgets":
    "the tenant's widgets, rendered in their declared positions (#597 item 6, ADR-0105). `bodyText` is plain text and the consumer ESCAPES it, because the write path refuses markup rather than sanitizing it. Inactive widgets are returned on purpose and filtered there. Same #652/#653/#67 sequence as the menus above."
};

/**
 * Surfaces this repo has COMMITTED to a consumer that does not call them yet.
 *
 * Kept frozen on purpose, and kept SEPARATE from `CONSUMED_PATHS` on purpose.
 * A promise and a dependency both deserve stability, but they fail differently:
 * breaking a consumed path breaks a build that exists today; breaking a
 * committed one breaks a design that has been agreed and not yet built. Merging
 * the two lists loses that distinction, and the lost distinction is exactly
 * what let three non-calls sit here labelled as calls.
 *
 * Each entry must name the ADR that makes the promise. No ADR, no entry —
 * otherwise this list becomes the place where "might be needed someday" goes to
 * acquire the authority of a contract.
 */
export const COMMITTED_PATHS: Readonly<Record<string, string>> = {
  "/api/v1/auth/session":
    "ADR-0049 — session introspection for the BFF of ADR-0050. The static build must NOT call it (it refuses machine credentials by design); the BFF that will is not built yet.",
  "/api/v1/access/machine-credentials":
    "ADR-0049 — how a human mints the read-only build credential. Never a build call, but the build cannot exist if this shape changes.",
  "/api/v1/site-search/query":
    "ADR-0107 — the reader's search results, called from the READER's browser at runtime rather than from the build (#597 item 3, #607). Unlike every other entry here it is anonymous: the tenant comes from the request's `Origin`, matched against `awcms_tenant_domains`. What is frozen is the result shape AND the facet payload the filter chips render from; the CORS grant itself is a header, not a schema, and is documented on the path.",
  "/api/v1/site-search/suggest":
    "ADR-0107 — the typeahead behind the same search box, same origin rule, same anonymity. Frozen alongside `/query` because a search box that lists suggestions and a search box that cannot are different products, and a consumer that has one will call both."
};

/** Every path frozen by the fixture: consumed today plus promised by ADR. */
export const CONSUMER_PATHS: Readonly<Record<string, string>> = {
  ...CONSUMED_PATHS,
  ...COMMITTED_PATHS
};

type AnyRecord = Record<string, unknown>;

/** Collect every `$ref` target reachable from a value, transitively. */
export function collectRefs(
  value: unknown,
  components: AnyRecord,
  seen: Set<string> = new Set()
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, components, seen);
    }

    return seen;
  }

  if (!value || typeof value !== "object") {
    return seen;
  }

  for (const [key, child] of Object.entries(value as AnyRecord)) {
    if (key === "$ref" && typeof child === "string") {
      const match = /^#\/components\/([^/]+)\/(.+)$/.exec(child);

      if (match && !seen.has(child)) {
        seen.add(child);

        const group = components[match[1]!] as AnyRecord | undefined;
        // Recurse into the target: a schema that refs another schema must pull
        // that one in too, or the closure is a half-frozen contract.
        collectRefs(group?.[match[2]!], components, seen);
      }

      continue;
    }

    collectRefs(child, components, seen);
  }

  return seen;
}

/** Build the frozen slice: the consumer paths plus every component they reach. */
export function buildConsumerContract(bundle: AnyRecord): AnyRecord {
  const bundlePaths = (bundle.paths ?? {}) as AnyRecord;
  const bundleComponents = (bundle.components ?? {}) as AnyRecord;

  const paths: AnyRecord = {};
  const refs = new Set<string>();

  for (const pathKey of Object.keys(CONSUMER_PATHS).sort()) {
    const pathItem = bundlePaths[pathKey];

    if (pathItem === undefined) {
      throw new Error(
        `Consumer path ${pathKey} is not in ${BUNDLE_PATH}. Either the endpoint was ` +
          "removed — which breaks awcms-astro — or CONSUMER_PATHS is stale."
      );
    }

    paths[pathKey] = pathItem;
    collectRefs(pathItem, bundleComponents, refs);
  }

  const components: AnyRecord = {};

  for (const ref of [...refs].sort()) {
    const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref)!;
    const group = (components[match[1]!] ??= {}) as AnyRecord;

    group[match[2]!] = (bundleComponents[match[1]!] as AnyRecord)[match[2]!];
  }

  return { paths, components };
}

/**
 * Is `frozen` fully contained in `current`? Additive changes pass; a removal or
 * a retype does not.
 */
export function isAdditiveSuperset(frozen: unknown, current: unknown): boolean {
  if (Array.isArray(frozen)) {
    // Arrays (enums, `required`) are compared as sets: an added enum value is
    // additive, a removed one is not.
    if (!Array.isArray(current)) {
      return false;
    }

    return frozen.every((item) =>
      current.some((candidate) => isAdditiveSuperset(item, candidate))
    );
  }

  if (frozen && typeof frozen === "object") {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return false;
    }

    return Object.entries(frozen as AnyRecord).every(([key, value]) =>
      isAdditiveSuperset(value, (current as AnyRecord)[key])
    );
  }

  return frozen === current;
}

/** Every frozen path/component that the current bundle no longer satisfies. */
export function findContractBreaks(
  frozen: AnyRecord,
  current: AnyRecord
): string[] {
  const breaks: string[] = [];

  for (const [pathKey, pathItem] of Object.entries(
    (frozen.paths ?? {}) as AnyRecord
  )) {
    const now = ((current.paths ?? {}) as AnyRecord)[pathKey];

    if (now === undefined) {
      breaks.push(`path ${pathKey} is gone from the bundle`);
      continue;
    }

    if (!isAdditiveSuperset(pathItem, now)) {
      breaks.push(`path ${pathKey} changed non-additively`);
    }
  }

  for (const [group, entries] of Object.entries(
    (frozen.components ?? {}) as AnyRecord
  )) {
    for (const [name, schema] of Object.entries(entries as AnyRecord)) {
      const now = (
        ((current.components ?? {}) as AnyRecord)[group] as
          AnyRecord | undefined
      )?.[name];

      if (now === undefined) {
        breaks.push(`components.${group}.${name} is gone from the bundle`);
        continue;
      }

      if (!isAdditiveSuperset(schema, now)) {
        breaks.push(`components.${group}.${name} changed non-additively`);
      }
    }
  }

  return breaks;
}

const HEADER = `# FROZEN — the slice of this API that \`ahliweb/awcms-astro\` calls (ADR-0065).
#
# Generated by \`bun run api:consumer-contract:generate\`. Do NOT hand-edit.
#
# Regenerating is a DELIBERATE act: it means "this contract changed and the
# consumer must change with it". If you regenerate, the \`awcms-astro\` side has to
# be updated in the same breath — that repo's build is the thing this file exists
# to stop breaking silently.
#
# Additive changes (a new optional field, a new enum value) do NOT require
# regeneration: the check is a subset assertion, so they already pass.
`;

async function main(): Promise<void> {
  const generate = process.argv.includes("--generate");
  const bundle = parseYaml(await readFile(BUNDLE_PATH, "utf8")) as AnyRecord;
  const contract = buildConsumerContract(bundle);

  if (generate) {
    await writeFile(
      FIXTURE_PATH,
      HEADER + stringifyYaml(contract, { lineWidth: 0 }),
      "utf8"
    );

    console.log(
      `api:consumer-contract:generate OK — ${Object.keys(contract.paths as AnyRecord).length} paths, ` +
        `${Object.values(contract.components as AnyRecord).reduce<number>(
          (total, group) => total + Object.keys(group as AnyRecord).length,
          0
        )} components frozen into ${FIXTURE_PATH}.`
    );
    return;
  }

  const frozen = parseYaml(await readFile(FIXTURE_PATH, "utf8")) as AnyRecord;
  const breaks = findContractBreaks(frozen, contract);

  if (breaks.length > 0) {
    console.error("api:consumer-contract:check FAILED");

    for (const entry of breaks) {
      console.error(`  - ${entry}`);
    }

    console.error(
      "\n  These surfaces are consumed by ahliweb/awcms-astro. A non-additive change " +
        "here breaks that repo's BUILD, and its CI is the only place that would " +
        "otherwise notice. If the change is intended, update awcms-astro and re-run " +
        "`bun run api:consumer-contract:generate`."
    );

    process.exitCode = 1;
    return;
  }

  console.log(
    `api:consumer-contract:check OK — ${Object.keys(frozen.paths as AnyRecord).length} consumer paths ` +
      "and every component they reach are still satisfied additively."
  );
}

if (import.meta.main) {
  await main();
}
