/**
 * Where each advertisement slot actually appears, and what an unsold one draws
 * (Issue #594, PRD LenteraKalteng FR-ADS-007).
 *
 * ## The map is the point of this file
 *
 * `AD_PLACEMENT_KEYS` has twelve entries and the database CHECK accepts all
 * twelve, so an operator can book any of them. Only the ones a template
 * actually renders will ever be seen — and a slot that is bookable but
 * unrendered is the exact "declared, validated, never read" defect this repo has
 * shipped before: the booking succeeds, the audit row is written, the invoice
 * goes out, and nothing appears.
 *
 * So the mapping is DATA, checked in both directions by
 * `tests/blog-content-ad-rendering.test.ts` against the real route files: a slot
 * listed here must appear in the routes named, and a slot listed with no
 * surfaces must appear in none of them. `/admin/blog-ads` reads the same
 * constant to mark the unrendered slots on screen, so the person booking one
 * finds out before the advertiser does.
 *
 * Pure: no database, no config, no I/O.
 */
import { escapeHtml } from "../../../lib/html/escape";
import type { AdPlacementKey } from "./ad-placement-policy";

/**
 * Slot → the public routes of THIS repo that render it.
 *
 * Paths are the route files, not URLs, because that is what the gate can check.
 *
 * Three slots map to nothing, and the reason is the same for all three: the
 * `/blog/{tenantCode}` templates have no sidebar. They are kept bookable rather
 * than removed because removing a key means a migration against the CHECK
 * constraint, and because `ahliweb/awcms-astro` — which owns the reader-facing
 * portal and does have a sidebar — reads this inventory through the public API.
 * A slot unrendered HERE is not necessarily unrendered everywhere; what would be
 * wrong is not saying so.
 *
 * `category_archive_top` covers the TAG archive as well as the category one. The
 * key names the shape of the page, not the taxonomy, and minting a thirteenth
 * key for a slot nobody has sold would cost a migration against the CHECK.
 */
export const AD_PLACEMENT_RENDER_SURFACES: Readonly<
  Record<AdPlacementKey, readonly string[]>
> = Object.freeze({
  header_banner: [
    "src/pages/blog/[tenantCode]/index.ts",
    "src/pages/blog/[tenantCode]/[slug].ts"
  ],
  below_headline: ["src/pages/blog/[tenantCode]/index.ts"],
  homepage_middle: ["src/pages/blog/[tenantCode]/index.ts"],
  homepage_bottom: ["src/pages/blog/[tenantCode]/index.ts"],
  article_top: ["src/pages/blog/[tenantCode]/[slug].ts"],
  article_middle: ["src/pages/blog/[tenantCode]/[slug].ts"],
  article_bottom: ["src/pages/blog/[tenantCode]/[slug].ts"],
  sidebar_top: [],
  sidebar_middle: [],
  sidebar_bottom: [],
  category_archive_top: [
    "src/pages/blog/[tenantCode]/category/[slug].ts",
    "src/pages/blog/[tenantCode]/tag/[slug].ts"
  ],
  search_result_top: ["src/pages/blog/[tenantCode]/search.ts"]
});

/** True when this repo's own public templates draw the slot at all. */
export function isAdSlotRenderedHere(placementKey: AdPlacementKey): boolean {
  return AD_PLACEMENT_RENDER_SURFACES[placementKey].length > 0;
}

/**
 * One slot's markup.
 *
 * `adsHtml` entries come from `renderAdPlacementHtml`, which is a whitelist
 * renderer over a server-generated media URL and a write-time-validated link —
 * they are ALREADY safe HTML and are interpolated as such. Everything this
 * function adds of its own is either a literal or escaped.
 *
 * `placeholderLabel` is `null` for the case that must not draw anything: a
 * tenant that sells no advertising at all. Painting "ad space available" across
 * four slots of a newsroom that has never sold a banner would be defacing the
 * site to advertise a service it does not offer — so the caller decides, and the
 * decision is one query rather than a guess.
 */
export function renderAdSlotHtml(
  placementKey: AdPlacementKey,
  adsHtml: readonly string[],
  placeholderLabel: string | null
): string {
  const slot = escapeHtml(placementKey);

  if (adsHtml.length > 0) {
    return `<aside class="ad-slot" data-ad-slot="${slot}">${adsHtml.join("")}</aside>`;
  }

  if (placeholderLabel === null) {
    return "";
  }

  // FR-ADS-007 — an unsold slot is a sales pitch, not a hole in the layout.
  return `<aside class="ad-slot ad-slot--available" data-ad-slot="${slot}"><p>${escapeHtml(placeholderLabel)}</p></aside>`;
}

/**
 * Puts `article_middle` in the middle of an article instead of at the end of it.
 *
 * The slot is NAMED middle, and rendering it after the last paragraph would make
 * the name a lie an advertiser paid for. `renderContentJsonToHtml` and
 * `renderPortableTextToHtml` both join their block elements with `\n`, so
 * splitting on that gives block boundaries and the slot lands between two of
 * them rather than inside one.
 *
 * The assumption is stated because it is an assumption: a block whose own markup
 * spans a newline would shift the insertion point by a line. That is cosmetic —
 * the slot still lands between two top-level elements, because every line in
 * that output begins one — and it is the reason this splits rather than counting
 * tags, which would need a parser to be any more correct than this is.
 *
 * Fewer than two blocks means there is no middle: a one-paragraph article gets
 * the slot after its paragraph, which is where "middle" degenerates to.
 */
export function insertMidArticleSlotHtml(
  contentHtml: string,
  slotHtml: string
): string {
  if (!slotHtml) {
    return contentHtml;
  }

  const blocks = contentHtml.split("\n");

  if (blocks.length < 2) {
    return `${contentHtml}\n${slotHtml}`;
  }

  const midpoint = Math.floor(blocks.length / 2);

  return [
    ...blocks.slice(0, midpoint),
    slotHtml,
    ...blocks.slice(midpoint)
  ].join("\n");
}
