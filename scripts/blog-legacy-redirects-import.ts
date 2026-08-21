/**
 * blog-legacy-redirects-import.ts — `bun run blog:legacy:redirects:import`.
 *
 * Issue #599 part 2. `seo_distribution` has had exact-path redirects with
 * chain/loop prevention since `sql/060`; what it has never had is a way to load
 * **tens of thousands** of rules at once, or a way to check them before cutover.
 * PRD FR-DSC-007 makes the 301 map a precondition of the second tenant's
 * migration, not optional follow-up work.
 *
 * ## The map is derived, not supplied
 *
 * There is no mapping file to hand in. `legacy_source_id` on each imported post
 * IS the map — that is why `sql/138` added it and why `blog:legacy:import`
 * writes it. This job reads `listLegacyRedirectMappings` and turns each row into
 * a rule, which means the map cannot disagree with the content: a post that was
 * never imported has no rule, and a post that was unpublished stops producing
 * one.
 *
 * `--path-template` carries the legacy URL shape (`/news/{legacyId}_{slug}.html`
 * for SeputarBorneo) because that shape belongs to the system being migrated
 * FROM. Hard-coding it here would make the next migration a code change.
 *
 * ## Preview is the default
 *
 * Same as `blog:legacy:import` and `blog:ads:ingest`. This writes rules that
 * will redirect real search-engine traffic; the run that does it is typed on
 * purpose.
 *
 * ## The two checks that make the DoD's "no chain longer than one hop" real
 *
 * Both run in preview as well as commit, because the point is to find out
 * BEFORE cutover:
 *
 * 1. **The target must not itself be a redirect source.** If `/news/1_a.html`
 *    → `/id/blog/t/a` and some other rule already sends `/id/blog/t/a`
 *    somewhere, a crawler follows two hops, which PRD §9.2 forbids. Checked
 *    against the rules already in the table.
 * 2. **The target must carry its locale prefix.** ADR-0098 made
 *    `/blog/{code}/{slug}` locale-prefixed; a rule pointing at the bare path
 *    would be answered by a second redirect onto the prefixed canonical — the
 *    same two hops, arriving from a direction nobody would think to look. The
 *    prefix is applied by `listLegacyRedirectMappings` from the post's own
 *    locale, and asserted here so a regression in that function is caught by the
 *    job that depends on it rather than by a crawler.
 *
 * A source path that already has a rule is reported as `existing`, not
 * overwritten: an operator who has hand-authored an exception for one URL should
 * not have it silently replaced by a bulk run.
 *
 * ## Roles
 *
 * The APP role, like `blog:legacy:import` and for the same reason — authoring a
 * redirect is an authoring action, and `awcms_worker` should not gain INSERT on
 * `awcms_seo_redirects` for a job that runs once.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  LEGACY_REDIRECT_MAP_LIMIT,
  listLegacyRedirectMappings
} from "../src/modules/blog-content/application/blog-post-directory";
import type { LegacyRedirectMapping } from "../src/modules/blog-content/application/blog-post-directory";
import {
  createRedirect,
  findActiveRedirectByPath
} from "../src/modules/seo-distribution/application/redirect-directory";
import { normalizeRedirectPath } from "../src/modules/seo-distribution/domain/redirect-path";
import { isRedirectEligiblePath } from "../src/modules/seo-distribution/domain/redirect-eligibility";
import {
  requiresPublicLocalePrefix,
  splitPublicLocalePath
} from "../src/lib/i18n/public-locale-path";

type Problem = {
  legacyId: string;
  sourcePath: string;
  reason: string;
};

function flag(name: string): string | null {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") || null : null;
}

function usage(message: string): void {
  console.error(
    `blog:legacy:redirects:import — ${message}\n\n` +
      "  --tenant=<uuid>          the tenant whose posts carry the provenance (required)\n" +
      "  --tenant-code=<code>     its public tenant_code, used to build targets (required)\n" +
      "  --actor=<uuid>           awcms_tenant_users.id recorded as author of each rule (required)\n" +
      "  --system=<name>          legacy_source_system to map, e.g. seputarborneo (required)\n" +
      "  --path-template=<tpl>    legacy URL shape, e.g. '/news/{legacyId}_{slug}.html' (required)\n" +
      "  --commit                 write. Without it, nothing is written and you get the report.\n"
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const tenantId = flag("tenant");
  const tenantCode = flag("tenant-code");
  const actorId = flag("actor");
  const system = flag("system");
  const pathTemplate = flag("path-template");

  if (!tenantId) return usage("`--tenant=<uuid>` is required.");
  if (!tenantCode) return usage("`--tenant-code=<code>` is required.");
  if (!actorId) return usage("`--actor=<uuid>` is required.");
  if (!system) return usage("`--system=<name>` is required.");
  if (!pathTemplate) return usage("`--path-template=<tpl>` is required.");

  if (!pathTemplate.includes("{legacyId}")) {
    // Without the legacy id the template cannot produce one source path per
    // article, so every rule would collide on the same source.
    return usage("`--path-template` must contain `{legacyId}`.");
  }

  const sql = getDatabaseClient();

  const problems: Problem[] = [];
  let scanned = 0;
  let written = 0;
  let existing = 0;
  let writable = 0;

  // ONE instant for the whole run. `findActiveRedirectByPath` filters by an
  // effective window, and taking `now` per call would let a rule that expires
  // mid-run be seen by one check and not the next — a chain the report says is
  // absent.
  const now = new Date();

  try {
    let after: string | null = null;

    for (;;) {
      const page: LegacyRedirectMapping[] = await withTenantOrThrow(
        sql,
        tenantId,
        (tx) =>
          listLegacyRedirectMappings(tx, tenantId, {
            system,
            tenantCode,
            pathTemplate,
            afterLegacyId: after
          })
      );

      if (page.length === 0) break;

      scanned += page.length;

      await withTenantOrThrow(sql, tenantId, async (tx) => {
        for (const mapping of page) {
          const source = normalizeRedirectPath(mapping.sourcePath);

          if (!source.ok) {
            problems.push({
              legacyId: mapping.legacyId,
              sourcePath: mapping.sourcePath,
              reason: `source path is not usable: ${source.reason}`
            });
            continue;
          }

          if (!isRedirectEligiblePath(source.path)) {
            // The same eligibility gate the resolver applies, at write time: a
            // legacy URL shaped like an admin or API path must never become a
            // rule that could intercept one.
            problems.push({
              legacyId: mapping.legacyId,
              sourcePath: source.path,
              reason:
                "source path is not eligible for a redirect (admin/API/auth/static/system paths)"
            });
            continue;
          }

          // Check 2 — the target must already carry its locale prefix.
          //
          // BOTH halves are needed. `requiresPublicLocalePrefix` strips the
          // prefix before testing, so it answers "is this the KIND of path that
          // takes a locale" and says `true` for a correctly prefixed one too.
          // The missing-prefix condition is that, AND no locale segment
          // actually present.
          if (
            requiresPublicLocalePrefix(mapping.targetPath) &&
            splitPublicLocalePath(mapping.targetPath).locale === null
          ) {
            problems.push({
              legacyId: mapping.legacyId,
              sourcePath: source.path,
              reason:
                `target ${mapping.targetPath} is a locale-prefixed surface but carries no prefix — ` +
                "a reader would be redirected again onto the canonical, which is two hops (PRD §9.2)"
            });
            continue;
          }

          const alreadyThere = await findActiveRedirectByPath(
            tx,
            tenantId,
            source.path,
            { locale: null, host: null, now }
          );

          if (alreadyThere) {
            // Reported, never overwritten: a hand-authored exception must
            // survive a bulk run.
            existing += 1;
            continue;
          }

          // Check 1 — the target must not itself be a redirect source.
          const targetIsSource = await findActiveRedirectByPath(
            tx,
            tenantId,
            mapping.targetPath,
            { locale: null, host: null, now }
          );

          if (targetIsSource) {
            problems.push({
              legacyId: mapping.legacyId,
              sourcePath: source.path,
              reason:
                `target ${mapping.targetPath} is itself the source of an existing rule — ` +
                "a crawler would follow two hops (PRD §9.2)"
            });
            continue;
          }

          writable += 1;

          if (!commit) continue;

          await createRedirect(tx, tenantId, actorId, {
            sourcePath: source.path,
            normalizedSourcePath: source.path,
            localeScope: null,
            domainScopeHost: null,
            targetType: "relative_same_tenant",
            target: mapping.targetPath,
            statusCode: 301,
            state: "active",
            effectiveFrom: null,
            effectiveUntil: null,
            preserveQuery: false,
            reason: `legacy migration from ${system} (#599)`,
            origin: "import"
          });

          written += 1;
        }
      });

      after = page[page.length - 1]!.legacyId;

      if (page.length < LEGACY_REDIRECT_MAP_LIMIT) break;
    }

    console.log(
      `\nblog:legacy:redirects:import ${commit ? "COMMITTED" : "PREVIEW (nothing written — pass --commit to write)"}\n` +
        `  tenant           ${tenantId} (${tenantCode})\n` +
        `  system           ${system}\n` +
        `  template         ${pathTemplate}\n` +
        `  posts scanned    ${scanned}\n` +
        `  rules writable   ${writable}\n` +
        `  already ruled    ${existing}\n` +
        `  problems         ${problems.length}\n` +
        (commit ? `  rules written    ${written}\n` : "")
    );

    if (problems.length > 0) {
      console.log(
        "Problems — these legacy URLs would NOT resolve in one hop:\n"
      );
      for (const problem of problems) {
        console.log(`  [${problem.legacyId}] ${problem.sourcePath}`);
        console.log(`      - ${problem.reason}`);
      }
      console.log("");
    }

    if (scanned === 0) {
      console.log(
        "  No posts carry this legacy system. Run `bun run blog:legacy:import`\n" +
          "  first — the redirect map is DERIVED from `legacy_source_id`, so there is\n" +
          "  nothing to derive it from yet.\n"
      );
    }
  } catch (error) {
    logScriptFailure("blog:legacy:redirects:import", error);
    process.exitCode = 1;
  } finally {
    await sql.close({ timeout: 5 });
  }
}

await main();
