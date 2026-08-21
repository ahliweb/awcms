import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  listActiveAdPlacementsForRendering,
  type ActiveAdPlacementForRendering
} from "../../../../../modules/blog-content/application/ad-placement-directory";
import {
  AD_PLACEMENT_KEYS,
  AD_PLACEMENT_PRESETS,
  isAdTargetType,
  type AdPlacementKey,
  type AdTarget
} from "../../../../../modules/blog-content/domain/ad-placement-policy";
import { selectAdsForRotation } from "../../../../../modules/blog-content/domain/ad-placement-rotation";
import type { AdRotationCandidate } from "../../../../../modules/blog-content/domain/ad-placement-rotation";

/**
 * `GET /api/v1/news-portal/ad-placements/active` (Issue #594) — every slot's
 * currently-runnable creatives, already rotated and capped, for a build client
 * that renders its own markup.
 *
 * ## Why all twelve slots in one answer
 *
 * The alternative is a call per slot, and a consumer rendering a page has four
 * to seven of them. More importantly, THREE of the twelve are ones this repo's
 * own templates do not draw at all (`sidebar_*`, see
 * `domain/ad-slot-rendering.ts`) — the sidebar exists in
 * `ahliweb/awcms-astro`, not here. An endpoint shaped around what this repo
 * renders would silently withhold the inventory a consumer exists to show.
 *
 * ## Rotation happens HERE, and that is the point
 *
 * A consumer receives the SELECTION, not the pool: `selectAdsForRotation`
 * applies each slot's `rotationMode` and the preset's `maxItems` before the
 * response is built. Leaving that to the caller would mean four rotation modes
 * re-implemented in another repository, and the one that drifted would
 * over-serve a slot an advertiser paid a fixed number of impressions for.
 *
 * `random_safe`/`weighted` make this response deliberately NOT byte-stable
 * between calls. It is therefore not cacheable at the edge and does not try to
 * be — `Cache-Control` is left to the standard headers, and a build client
 * calls it once per build.
 *
 * ## `target` is a query parameter, and an invalid one is refused
 *
 * `?targetType=post&targetId=<uuid>` scopes the answer to one page: the
 * placements booked against it UNIONED with every global placement for the same
 * slot. Omitting both returns the global inventory, which is what a listing page
 * carries. A `targetType` outside the four is a 400 rather than a silent
 * fallback to `global`, because silently widening the scope of an ad query is
 * how a placement books against one article and appears on all of them.
 *
 * Guarded on `blog_content.ad_placements.read` — same "the builder
 * authenticates" decision as `GET /api/v1/site-profile/composed` (ADR-0102).
 * Media URLs here are the registry's own server-generated ones, never client
 * input; there is no free-URL column on this table at all.
 */
type PublicAdPlacement = {
  id: string;
  name: string;
  linkUrl: string | null;
  mediaPublicUrl: string;
  mediaAltText: string | null;
};

function toPublic(ad: ActiveAdPlacementForRendering): PublicAdPlacement {
  return {
    id: ad.id,
    name: ad.name,
    linkUrl: ad.linkUrl,
    mediaPublicUrl: ad.mediaPublicUrl,
    mediaAltText: ad.mediaAltText
  };
}

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "blog_content",
    activityCode: "ad_placements",
    action: "read"
  },
  handler: async ({ tx, tenantId, url, now }) => {
    const rawTargetType = url.searchParams.get("targetType");
    const rawTargetId = url.searchParams.get("targetId");

    let target: AdTarget | null = null;

    if (rawTargetType !== null) {
      if (!isAdTargetType(rawTargetType)) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "targetType must be one of global, widget, post, page."
        );
      }

      if (rawTargetType === "global") {
        if (rawTargetId) {
          return fail(
            400,
            "VALIDATION_ERROR",
            "targetId must be omitted when targetType is global."
          );
        }
      } else {
        if (!rawTargetId) {
          return fail(
            400,
            "VALIDATION_ERROR",
            "targetId is required when targetType is not global."
          );
        }

        target = { targetType: rawTargetType, targetId: rawTargetId };
      }
    } else if (rawTargetId) {
      // A targetId with no targetType is a caller who thinks they scoped the
      // query and did not. Answering the global inventory would look like it
      // worked.
      return fail(400, "VALIDATION_ERROR", "targetId requires targetType.");
    }

    const slots: Record<string, PublicAdPlacement[]> = {};

    // Sequential, never concurrent: parallel queries on one transaction
    // connection leak it. Twelve bounded queries, fixed by the key list rather
    // than by anything the request controls.
    for (const placementKey of AD_PLACEMENT_KEYS as readonly AdPlacementKey[]) {
      const eligible = await listActiveAdPlacementsForRendering(
        tx,
        tenantId,
        placementKey,
        target,
        now
      );

      if (eligible.length === 0) {
        slots[placementKey] = [];
        continue;
      }

      const selected = selectAdsForRotation<
        ActiveAdPlacementForRendering & AdRotationCandidate
      >(
        eligible,
        eligible[0]!.rotationMode,
        AD_PLACEMENT_PRESETS[placementKey].maxItems
      );

      slots[placementKey] = selected.map(toPublic);
    }

    return ok({ slots });
  }
});
