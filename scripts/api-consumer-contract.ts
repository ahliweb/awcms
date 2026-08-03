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
 * The paths `ahliweb/awcms-astro` calls, each with why it calls them.
 *
 * Derived by grepping that repo for `/api/v1/` — not from memory, and not from
 * what this repo assumes a static-site build "probably" needs.
 */
export const CONSUMER_PATHS: Readonly<Record<string, string>> = {
  "/api/v1/blog/posts":
    "feed + sitemap build: `view=full` traversal with a stable `created_at` cursor and `?locale=` (#317).",
  "/api/v1/blog/posts/{id}": "single-post rendering.",
  "/api/v1/media/objects": "batch image resolution for a built page (#318).",
  "/api/v1/media/public-origin":
    "the media origin the build must name in `img-src` BEFORE pulling a single object (#370).",
  "/api/v1/auth/session": "session introspection for the BFF (ADR-0049).",
  "/api/v1/access/machine-credentials":
    "the read-only build credential itself (ADR-0049)."
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
