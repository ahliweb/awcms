/**
 * Query module for ADR-0044 §4 Fase 2's legacy advertisement ingest
 * (`scripts/blog-ads-ingest.ts`) — same "one directory, reads and writes"
 * convention as `ads-directory.ts`/`ad-placement-directory.ts`.
 *
 * The job script owns orchestration and reporting; every statement it runs
 * lives here, in the module that owns these four tables. That is the rule
 * `modules:table-writes:check` enforces, and it earns its keep in exactly this
 * situation: a one-shot migration script is the most tempting place to inline
 * "just one INSERT", and the most expensive place to have one that nobody can
 * find later when the table's invariants change.
 *
 * All three functions run inside the caller's own tenant-scoped transaction.
 */

export type LegacyAdForIngest = {
  id: string;
  name: string;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

type LegacyAdRow = {
  id: string;
  name: string;
  image_url: string;
  link_url: string | null;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
};

/**
 * Every non-deleted legacy ad, oldest first. Unbounded on purpose: this runs
 * once, per tenant, with an operator watching, and a `LIMIT` here would mean
 * the residue report silently omits whatever fell past it — the precise
 * failure ADR-0044 §4 forbids. `awcms_blog_ads` is admin-authored
 * configuration, not user-generated content, so the row count is small by
 * construction.
 */
export async function listLegacyAdsForIngest(
  tx: Bun.SQL,
  tenantId: string
): Promise<LegacyAdForIngest[]> {
  const rows = (await tx`
    SELECT id, name, image_url, link_url, is_active, starts_at, ends_at
    FROM awcms_blog_ads
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY created_at ASC
  `) as LegacyAdRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    isActive: row.is_active,
    startsAt: row.starts_at,
    endsAt: row.ends_at
  }));
}

export type LegacyAdPlacementForIngest = {
  placementType: string;
  targetId: string | null;
};

/**
 * `placementType` is deliberately typed as a plain `string`, not the narrowed
 * union. These rows predate the shared vocabulary and the legacy table's CHECK
 * is the only thing that ever constrained them; narrowing here would assert at
 * the type level what `mapLegacyPlacementToTarget` exists to VERIFY at runtime,
 * and an unrecognised value would be cast into validity instead of reported.
 */
export async function listLegacyAdPlacements(
  tx: Bun.SQL,
  tenantId: string,
  adId: string
): Promise<LegacyAdPlacementForIngest[]> {
  const rows = (await tx`
    SELECT placement_type, target_id
    FROM awcms_blog_ad_placements
    WHERE tenant_id = ${tenantId} AND ad_id = ${adId}
    ORDER BY created_at ASC
  `) as { placement_type: string; target_id: string | null }[];

  return rows.map((row) => ({
    placementType: row.placement_type,
    targetId: row.target_id
  }));
}

export type IngestedAdPlacementInput = {
  placementKey: string;
  name: string;
  mediaObjectId: string;
  linkUrl: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  targetType: string;
  targetId: string | null;
  sourceLegacyAdId: string;
};

/**
 * Inserts one successor placement, returning whether a row was actually
 * written. `ON CONFLICT DO NOTHING` against migration 079's partial unique
 * index is what makes the job re-runnable: the intended workflow is preview ->
 * apply -> resolve residue -> apply again, and every run after the first must
 * add only what is new.
 *
 * `rotationMode` and `priority` are left to their column defaults (`latest`,
 * `0`). The legacy system had neither concept, so any value chosen here would
 * be invented editorial policy attributed to the migration rather than to the
 * editor who can change it afterwards.
 *
 * No audit event. The other writers to this table record one because they act
 * for a signed-in user whose action needs attributing; this runs as the worker
 * role with no actor, and `source_legacy_ad_id` on the row itself is a better
 * provenance record than an audit line naming nobody.
 */
export async function insertIngestedAdPlacement(
  tx: Bun.SQL,
  tenantId: string,
  input: IngestedAdPlacementInput
): Promise<boolean> {
  const rows = await tx`
    INSERT INTO awcms_news_portal_ad_placements
      (tenant_id, placement_key, name, media_object_id, link_url,
       is_active, starts_at, ends_at, target_type, target_id,
       source_legacy_ad_id)
    VALUES (
      ${tenantId}, ${input.placementKey}, ${input.name}, ${input.mediaObjectId},
      ${input.linkUrl}, ${input.isActive}, ${input.startsAt}, ${input.endsAt},
      ${input.targetType}, ${input.targetId}, ${input.sourceLegacyAdId}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  return rows.length > 0;
}
