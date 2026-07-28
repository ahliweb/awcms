/**
 * "May the legacy advertisement tables be dropped yet?" — ADR-0044 §4 Fase 2,
 * step three.
 *
 * The drop is irreversible and takes a live site's advertising with it, so the
 * question has to be answerable from the data rather than from someone's
 * recollection of having run the ingest. Migration 079's `source_legacy_ad_id`
 * is what makes that possible: every successor row names the legacy row it came
 * from, so "did everything move?" is a join.
 *
 * ## What counts as ready
 *
 * A legacy ad is ACCOUNTED FOR when either
 *
 *   - at least one `awcms_news_portal_ad_placements` row names it via
 *     `source_legacy_ad_id` (it migrated), or
 *   - it is soft-deleted (`deleted_at IS NOT NULL`) — an operator read the
 *     residue report and decided this ad does not come along.
 *
 * Anything else is OUTSTANDING, and outstanding means not ready. There is no
 * "close enough" threshold and no override flag: the whole point of the
 * `source_legacy_ad_id` column is that this check cannot be satisfied by
 * assertion.
 *
 * ## What this deliberately does NOT check
 *
 * Whether the successor rows are any good — right slot, right schedule, right
 * image. That is editorial judgement, and a readiness check that pretended to
 * validate it would be making a promise it cannot keep. This answers exactly
 * one question: is there a legacy row whose fate nobody has decided?
 *
 * Runs inside the caller's own tenant-scoped transaction.
 */

export type LegacyAdDropReadiness = {
  tenantId: string;
  /** Every non-deleted legacy ad, whether or not it migrated. */
  totalLegacyAds: number;
  /** Non-deleted legacy ads with at least one successor row. */
  migrated: number;
  /**
   * Non-deleted legacy ads with no successor. Each one either failed to
   * migrate (it is in the residue report) or was created after the ingest ran.
   */
  outstanding: number;
  /** Up to `MAX_REPORTED_OUTSTANDING` ids, so the report names rows rather than counting them. */
  outstandingAdIds: string[];
  /** Soft-deleted legacy ads — accounted for by an operator's decision, not by migration. */
  retired: number;
};

/**
 * A readiness report is read by a human, and a thousand ids is not a report.
 * The COUNT is always exact and always the thing the ready/not-ready decision
 * rests on; this only bounds how many are named. The script says explicitly
 * when the list was truncated, because a silently shortened list of blockers
 * reads as a complete one.
 */
export const MAX_REPORTED_OUTSTANDING = 50;

export async function assessLegacyAdDropReadiness(
  tx: Bun.SQL,
  tenantId: string
): Promise<LegacyAdDropReadiness> {
  const rows = (await tx`
    SELECT
      count(*) FILTER (WHERE a.deleted_at IS NULL)::int AS total_legacy_ads,
      count(*) FILTER (
        WHERE a.deleted_at IS NULL AND s.source_legacy_ad_id IS NOT NULL
      )::int AS migrated,
      count(*) FILTER (WHERE a.deleted_at IS NOT NULL)::int AS retired
    FROM awcms_blog_ads a
    LEFT JOIN LATERAL (
      SELECT p.source_legacy_ad_id
      FROM awcms_news_portal_ad_placements p
      WHERE p.tenant_id = a.tenant_id AND p.source_legacy_ad_id = a.id
      LIMIT 1
    ) s ON true
    WHERE a.tenant_id = ${tenantId}
  `) as {
    total_legacy_ads: number;
    migrated: number;
    retired: number;
  }[];

  const summary = rows[0] ?? { total_legacy_ads: 0, migrated: 0, retired: 0 };

  const outstandingRows = (await tx`
    SELECT a.id
    FROM awcms_blog_ads a
    WHERE a.tenant_id = ${tenantId}
      AND a.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM awcms_news_portal_ad_placements p
        WHERE p.tenant_id = a.tenant_id AND p.source_legacy_ad_id = a.id
      )
    ORDER BY a.created_at ASC
    LIMIT ${MAX_REPORTED_OUTSTANDING}
  `) as { id: string }[];

  return {
    tenantId,
    totalLegacyAds: summary.total_legacy_ads,
    migrated: summary.migrated,
    outstanding: summary.total_legacy_ads - summary.migrated,
    outstandingAdIds: outstandingRows.map((row) => row.id),
    retired: summary.retired
  };
}

export function isReadyToDrop(
  reports: readonly LegacyAdDropReadiness[]
): boolean {
  return reports.every((report) => report.outstanding === 0);
}
