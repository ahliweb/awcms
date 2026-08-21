/**
 * Fills the advertisement slots on one public page (Issue #594).
 *
 * `selectAndRenderActiveAdsForPlacement` has existed since ADR-0044 §4 with test
 * callers only — its own docblock says "not wired to any public page route in
 * this issue ... a later issue's homepage/article template work calls it
 * directly". This is that issue.
 *
 * ## Why the first query is "does this tenant sell advertising at all"
 *
 * FR-ADS-007 asks an unsold slot to show an availability notice rather than
 * leave a hole. Applied unconditionally that would paint "ad space available"
 * across four slots of every newsroom in the family, including the ones that
 * have never sold a banner and do not want to look like they are trying to — the
 * feature would deface the site to advertise a service the tenant does not
 * offer.
 *
 * So the placeholder is shown only to a tenant that HAS inventory: at least one
 * ad placement row, active or not, scheduled or not. That is a deliberate
 * reading of "available" as "this slot is for sale and currently unsold", and it
 * costs exactly one `EXISTS` — for a tenant with no advertising at all, it is
 * also the ONLY query this file runs.
 *
 * ## Query count
 *
 * One `EXISTS`, then one per slot the page asks for. The pages ask for four at
 * most, and the slot list is a compile-time constant per route rather than
 * anything a request can influence.
 */
import type { AdPlacementKey } from "../domain/ad-placement-policy";
import type { AdTarget } from "../domain/ad-placement-policy";
import { renderAdSlotHtml } from "../domain/ad-slot-rendering";
import { selectAndRenderActiveAdsForPlacement } from "./ad-placement-directory";

/** Rendered markup per slot; a slot the caller did not ask for is absent, and one it did ask for is always present (possibly as an empty string). */
export type RenderedAdSlots = ReadonlyMap<AdPlacementKey, string>;

/**
 * True when this tenant has any ad placement at all — the signal that it is in
 * the advertising business, and therefore that an empty slot means "unsold"
 * rather than "not applicable".
 *
 * Deliberately ignores `is_active`, the schedule window and the media object's
 * status: a tenant whose only campaign ended last week still sells advertising,
 * and its slots are still available. Soft-deleted rows are excluded, because a
 * tenant that removed its last placement has removed its inventory.
 */
export async function tenantSellsAdvertising(
  tx: Bun.SQL,
  tenantId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present
    FROM awcms_news_portal_ad_placements
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    LIMIT 1
  `) as { present: number }[];

  return rows.length > 0;
}

export async function composeAdSlots(
  tx: Bun.SQL,
  tenantId: string,
  placementKeys: readonly AdPlacementKey[],
  options: {
    /** The page being rendered, for scoped placements. `null` returns global ads only. */
    target?: AdTarget | null;
    /** Shown in an unsold slot. The caller supplies it already localised, the same way `renderPostSummaryListHtmlAtBasePath` takes its empty message. */
    placeholderLabel: string;
    now?: Date;
  }
): Promise<RenderedAdSlots> {
  const slots = new Map<AdPlacementKey, string>();

  if (placementKeys.length === 0) {
    return slots;
  }

  const sellsAdvertising = await tenantSellsAdvertising(tx, tenantId);

  if (!sellsAdvertising) {
    // Every requested slot answers the empty string, so a caller can
    // interpolate `slots.get(key) ?? ""` without branching and the page comes
    // out byte-identical to what it was before this feature existed.
    for (const key of placementKeys) {
      slots.set(key, "");
    }

    return slots;
  }

  const placeholder = options.placeholderLabel;
  const target = options.target ?? null;
  const now = options.now ?? new Date();

  // Sequential on purpose: these run inside one transaction, and concurrent
  // queries on a single transaction connection leak it.
  for (const key of placementKeys) {
    const adsHtml = await selectAndRenderActiveAdsForPlacement(
      tx,
      tenantId,
      key,
      target,
      now
    );

    slots.set(key, renderAdSlotHtml(key, adsHtml, placeholder));
  }

  return slots;
}
