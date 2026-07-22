import { escapeHtml } from "../../../lib/html/escape";
import type { AdPlacementInput, AdPlacementType } from "../domain/ad-policy";
import type { CreateAdInput, UpdateAdInput } from "../domain/ad-policy";

/** Read/write query module for `awcms_blog_ads`/`_ad_placements` (Issue #542) — same "one directory, reads and writes" convention as `blog-taxonomy-directory.ts`. */
export type BlogAdView = {
  id: string;
  tenantId: string;
  name: string;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type BlogAdRow = {
  id: string;
  tenant_id: string;
  name: string;
  image_url: string;
  link_url: string | null;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toAdView(row: BlogAdRow): BlogAdView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    isActive: row.is_active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

export type BlogAdPlacementView = {
  id: string;
  tenantId: string;
  adId: string;
  placementType: AdPlacementType;
  targetId: string | null;
};

type BlogAdPlacementRow = {
  id: string;
  tenant_id: string;
  ad_id: string;
  placement_type: AdPlacementType;
  target_id: string | null;
};

function toPlacementView(row: BlogAdPlacementRow): BlogAdPlacementView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    adId: row.ad_id,
    placementType: row.placement_type,
    targetId: row.target_id
  };
}

export async function createAd(
  tx: Bun.SQL,
  tenantId: string,
  input: CreateAdInput
): Promise<BlogAdView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_ads
      (tenant_id, name, image_url, link_url, is_active, starts_at, ends_at)
    VALUES (
      ${tenantId}, ${input.name}, ${input.imageUrl}, ${input.linkUrl},
      ${input.isActive}, ${input.startsAt}, ${input.endsAt}
    )
    RETURNING id, tenant_id, name, image_url, link_url, is_active, starts_at, ends_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogAdRow[];

  return toAdView(rows[0]!);
}

export async function fetchAdById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<BlogAdView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, name, image_url, link_url, is_active, starts_at, ends_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_ads
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as BlogAdRow[];

  const row = rows[0];
  return row ? toAdView(row) : null;
}

export async function listAds(
  tx: Bun.SQL,
  tenantId: string
): Promise<BlogAdView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, name, image_url, link_url, is_active, starts_at, ends_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_ads
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 100
  `) as BlogAdRow[];

  return rows.map(toAdView);
}

export async function updateAd(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateAdInput
): Promise<BlogAdView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_ads
    SET name = COALESCE(${input.name ?? null}, name),
        image_url = COALESCE(${input.imageUrl ?? null}, image_url),
        link_url = CASE WHEN ${input.linkUrl === undefined} THEN link_url ELSE ${input.linkUrl ?? null} END,
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        starts_at = CASE WHEN ${input.startsAt === undefined} THEN starts_at ELSE ${input.startsAt ?? null} END,
        ends_at = CASE WHEN ${input.endsAt === undefined} THEN ends_at ELSE ${input.endsAt ?? null} END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, name, image_url, link_url, is_active, starts_at, ends_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogAdRow[];

  return rows[0] ? toAdView(rows[0]) : null;
}

export async function softDeleteAd(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_ads
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/** Full replace semantics — same "PATCH replaces the whole sub-resource" convention `syncPostTermAssignments`/`syncMenuItems` use. Unlike menu items, placements have no hierarchy, so plain `DELETE` + `INSERT` (DB-generated ids) is sufficient — no client-supplied-id complication. */
export async function syncAdPlacements(
  tx: Bun.SQL,
  tenantId: string,
  adId: string,
  placements: readonly AdPlacementInput[]
): Promise<BlogAdPlacementView[]> {
  await tx`
    DELETE FROM awcms_blog_ad_placements
    WHERE tenant_id = ${tenantId} AND ad_id = ${adId}
  `;

  const inserted: BlogAdPlacementRow[] = [];

  for (const placement of placements) {
    const rows = (await tx`
      INSERT INTO awcms_blog_ad_placements (tenant_id, ad_id, placement_type, target_id)
      VALUES (${tenantId}, ${adId}, ${placement.placementType}, ${placement.targetId})
      RETURNING id, tenant_id, ad_id, placement_type, target_id
    `) as BlogAdPlacementRow[];

    inserted.push(rows[0]!);
  }

  return inserted.map(toPlacementView);
}

export async function fetchAdPlacements(
  tx: Bun.SQL,
  tenantId: string,
  adId: string
): Promise<BlogAdPlacementView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, ad_id, placement_type, target_id
    FROM awcms_blog_ad_placements
    WHERE tenant_id = ${tenantId} AND ad_id = ${adId}
  `) as BlogAdPlacementRow[];

  return rows.map(toPlacementView);
}

export type ActiveAdForPlacement = {
  id: string;
  name: string;
  imageUrl: string;
  linkUrl: string | null;
};

type ActiveAdRow = {
  id: string;
  name: string;
  image_url: string;
  link_url: string | null;
};

/**
 * Public-safe query (Issue #542 §Advertisement Management: "Rendering must
 * respect tenant isolation... schedule and active status"). Tenant scoped
 * via the explicit `tenant_id = $1` predicate (RLS FORCE'd defense in
 * depth, same convention as `public-blog-directory.ts`), `is_active =
 * true`, and the schedule window (`starts_at`/`ends_at` NULL-permissive —
 * an unset bound means "no restriction on that side"). Not wired to any
 * route in this issue (same "tested public-safe helper, wiring is a later
 * issue's job" precedent `searchPublicBlogContent` set in #539) — a
 * derived app or #543's admin/public UI work calls this directly.
 */
export async function listActiveAdsForPlacement(
  tx: Bun.SQL,
  tenantId: string,
  placementType: AdPlacementType,
  targetId: string | null,
  now: Date = new Date()
): Promise<ActiveAdForPlacement[]> {
  const rows = (await tx`
    SELECT a.id, a.name, a.image_url, a.link_url
    FROM awcms_blog_ads a
    JOIN awcms_blog_ad_placements p
      ON p.ad_id = a.id AND p.tenant_id = a.tenant_id
    WHERE a.tenant_id = ${tenantId} AND a.deleted_at IS NULL AND a.is_active = true
      AND p.placement_type = ${placementType}
      AND (p.target_id IS NOT DISTINCT FROM ${targetId})
      AND (a.starts_at IS NULL OR a.starts_at <= ${now})
      AND (a.ends_at IS NULL OR a.ends_at >= ${now})
    ORDER BY a.created_at DESC
  `) as ActiveAdRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    linkUrl: row.link_url
  }));
}

/** Whitelist render — `<img>` wrapped in `<a>` only when `linkUrl` is set, both attributes escaped, no other markup possible (doc issue #542: "Advertisement rendering must not become an XSS channel"). URLs are already write-time validated absolute http(s) (`domain/ad-policy.ts`), escaped here purely for HTML-attribute safety, not URL-scheme re-validation. */
export function renderAdHtml(ad: ActiveAdForPlacement): string {
  const image = `<img src="${escapeHtml(ad.imageUrl)}" alt="${escapeHtml(ad.name)}">`;

  if (!ad.linkUrl) {
    return `<div class="ad">${image}</div>`;
  }

  return `<div class="ad"><a href="${escapeHtml(ad.linkUrl)}" rel="sponsored noopener noreferrer" target="_blank">${image}</a></div>`;
}
