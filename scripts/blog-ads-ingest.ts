/**
 * blog-ads-ingest.ts — `bun run blog:ads:ingest`.
 *
 * ADR-0044 §4 Fase 2, step two. Moves the free-URL advertisement system
 * (`awcms_blog_ads` + `awcms_blog_ad_placements`, migration 037) onto the
 * media-backed one (`awcms_news_portal_ad_placements`, migrations 045/078/079),
 * and reports every row it cannot move.
 *
 * ## Preview is the default, not a flag
 *
 * `comments-retention.ts` and the other scheduled jobs take `--dry-run` as an
 * opt-in, because they run unattended on a timer and their normal mode is to
 * do the work. This one inverts that: it does nothing until told `--apply`.
 *
 * The reason is that this job is run once, by hand, against a live site's
 * advertising, by an operator who is about to drop the source tables. The
 * expensive mistake is not "forgot to preview" — it is "previewed, then never
 * read the residue". Making the report the default means the operator has the
 * list in front of them before anything is written, and reaching `--apply` is
 * a deliberate second act.
 *
 * ## What moves, and what is residue
 *
 * The classification lives in `blog-content/domain/legacy-ad-ingest.ts`, which
 * is pure and exhaustively tested; this script contains no judgement of its
 * own. In short: an ad whose `image_url` is already the public URL of one of
 * this tenant's REGISTERED media objects can be re-pointed at that object. Any
 * other image — remote, malformed, another tenant's key, or bytes in the
 * bucket that no registry row claims — is residue.
 *
 * That is deliberately conservative, and `legacy-ad-ingest.ts` explains why:
 * automating the rest would mean either fetching admin-supplied URLs from the
 * server (an SSRF primitive, inside a migration script) or minting `verified`
 * registry rows for bytes nothing has checked. Residue is reported with its
 * URL so a human can re-upload through the media library and re-run.
 *
 * ## `--placement-key`
 *
 * The legacy system has no slot concept; the surviving one requires one of
 * twelve. Nothing in the old data says which. So the job REFUSES to guess:
 * `--apply` without `--placement-key=<key>` is an error. Whatever is chosen is
 * printed on every ingested line, so the choice is in the run log rather than
 * inferred later from the rows.
 *
 * ## Idempotency
 *
 * Every row written carries `source_legacy_ad_id` (migration 079) under a
 * partial unique index, so a second run inserts nothing it already inserted.
 * This matters more than usual: the expected workflow is preview -> apply ->
 * fix residue -> apply again.
 *
 * This job does NOT go through `runJob` (`src/lib/jobs/job-runner.ts`) — it is
 * an operator-run one-shot, not a scheduled worker, so it has no advisory
 * lock and no `JobResult` telemetry. Run it once at a time.
 *
 * Runs as the least-privilege `awcms_worker` role (`sql/079` grants it SELECT
 * on both legacy tables and SELECT+INSERT on the successor — never UPDATE or
 * DELETE on anything). RLS is FORCE'd for that role too, so every pass is
 * wrapped in `withTenantOrThrow`.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  AD_PLACEMENT_KEYS,
  isAdPlacementKey,
  type AdPlacementKey
} from "../src/modules/blog-content/domain/ad-placement-policy";
import {
  UNPLACED_LEGACY_AD_DETAIL,
  classifyLegacyAdImage,
  mapLegacyPlacementToTarget,
  type LegacyAdResidueReason
} from "../src/modules/blog-content/domain/legacy-ad-ingest";
import {
  insertIngestedAdPlacement,
  listLegacyAdPlacements,
  listLegacyAdsForIngest
} from "../src/modules/blog-content/application/legacy-ad-ingest-directory";
import {
  fetchNewsMediaObjectByObjectKey,
  isNewsMediaObjectSafeForPublicReference
} from "../src/modules/media-library/application/media-object-directory";
import { resolveNewsMediaR2Config } from "../src/modules/media-library/domain/media-r2-config";

type TenantRow = { id: string };

type Residue = {
  tenantId: string;
  adId: string;
  adName: string;
  reason: LegacyAdResidueReason | "unplaced_ad";
  detail: string;
};

function resolvePlacementKey(): AdPlacementKey | null {
  const flag = process.argv.find((arg) => arg.startsWith("--placement-key="));
  if (!flag) return null;

  const value = flag.split("=")[1] ?? "";
  return isAdPlacementKey(value) ? value : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const placementKey = resolvePlacementKey();
  // Through `media_library`'s own resolver, never a raw `process.env` read:
  // the base URL is that module's config, and reading it directly here would
  // create a second place that has to be kept in step with it.
  const publicBaseUrl = resolveNewsMediaR2Config().publicBaseUrl;

  if (apply && !placementKey) {
    console.error(
      "blog:ads:ingest — `--apply` requires `--placement-key=<key>`.\n\n" +
        "The legacy advertisement system has no slot concept and the surviving one\n" +
        "requires exactly one of the twelve below. Nothing in the old data says which,\n" +
        "so this job will not choose on your behalf:\n\n  " +
        AD_PLACEMENT_KEYS.join("\n  ") +
        "\n"
    );
    process.exitCode = 1;
    return;
  }

  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  const residue: Residue[] = [];
  let ingestable = 0;
  let inserted = 0;
  let alreadyPresent = 0;

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    for (const tenant of tenants) {
      await withTenantOrThrow(
        sql,
        tenant.id,
        async (tx) => {
          const ads = await listLegacyAdsForIngest(tx, tenant.id);

          for (const ad of ads) {
            const classification = classifyLegacyAdImage({
              tenantId: tenant.id,
              imageUrl: ad.imageUrl,
              publicBaseUrl
            });

            if (classification.kind === "residue") {
              residue.push({
                tenantId: tenant.id,
                adId: ad.id,
                adName: ad.name,
                reason: classification.reason,
                detail: classification.detail
              });
              continue;
            }

            const media = await fetchNewsMediaObjectByObjectKey(
              tx,
              tenant.id,
              classification.objectKey
            );

            // A registry row that is not safe to reference publicly (still
            // pending, failed verification, orphaned) is treated exactly like a
            // missing one. Carrying an ad onto it would produce a placement the
            // render query filters out anyway — silently, which is the outcome
            // this whole job exists to avoid.
            if (
              !media ||
              !isNewsMediaObjectSafeForPublicReference(media.status)
            ) {
              residue.push({
                tenantId: tenant.id,
                adId: ad.id,
                adName: ad.name,
                reason: "unregistered_media_object",
                detail: media
                  ? `${classification.objectKey} (status ${media.status})`
                  : classification.objectKey
              });
              continue;
            }

            const placements = await listLegacyAdPlacements(
              tx,
              tenant.id,
              ad.id
            );

            if (placements.length === 0) {
              residue.push({
                tenantId: tenant.id,
                adId: ad.id,
                adName: ad.name,
                reason: "unplaced_ad",
                detail: UNPLACED_LEGACY_AD_DETAIL
              });
              continue;
            }

            for (const placement of placements) {
              const mapping = mapLegacyPlacementToTarget(placement);

              if (mapping.kind === "residue") {
                residue.push({
                  tenantId: tenant.id,
                  adId: ad.id,
                  adName: ad.name,
                  reason: mapping.reason,
                  detail: mapping.detail
                });
                continue;
              }

              ingestable += 1;

              if (!apply || !placementKey) {
                continue;
              }

              const written = await insertIngestedAdPlacement(tx, tenant.id, {
                placementKey,
                name: ad.name,
                mediaObjectId: media.id,
                linkUrl: ad.linkUrl,
                isActive: ad.isActive,
                startsAt: ad.startsAt,
                endsAt: ad.endsAt,
                targetType: mapping.target.targetType,
                targetId: mapping.target.targetId,
                sourceLegacyAdId: ad.id
              });

              if (written) {
                inserted += 1;
                console.log(
                  `blog:ads:ingest INGESTED — tenant=${tenant.id} legacyAd=${ad.id} ` +
                    `placementKey=${placementKey} target=${mapping.target.targetType}` +
                    `${mapping.target.targetId ? `:${mapping.target.targetId}` : ""} ` +
                    `mediaObject=${media.id}`
                );
              } else {
                alreadyPresent += 1;
              }
            }
          }
        },
        { workClass: "maintenance" }
      );
    }

    for (const row of residue) {
      console.log(
        `blog:ads:ingest RESIDUE — tenant=${row.tenantId} legacyAd=${row.adId} ` +
          `reason=${row.reason} name=${JSON.stringify(row.adName)} ` +
          `detail=${JSON.stringify(row.detail)}`
      );
    }

    const mode = apply ? "APPLIED" : "PREVIEW (nothing was written)";

    console.log(
      `blog:ads:ingest ${mode} — correlationId=${correlationId} ` +
        `tenants=${tenants.length} placementKey=${placementKey ?? "n/a"} ` +
        `ingestable=${ingestable} inserted=${inserted} ` +
        `alreadyPresent=${alreadyPresent} residue=${residue.length}`
    );

    if (residue.length > 0) {
      console.log(
        "blog:ads:ingest — residue rows were NOT migrated and their source rows " +
          "are untouched. Do not drop awcms_blog_ads until every line above has " +
          "been resolved or accepted."
      );
    }
  } catch (error) {
    logScriptFailure("blog:ads:ingest FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
