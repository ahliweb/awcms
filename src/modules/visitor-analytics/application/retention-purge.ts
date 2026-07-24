/**
 * Visitor analytics retention purge (ported from awcms-micro epic
 * #617-#624), triggered by `POST /api/v1/analytics/retention/purge`
 * (on-demand) and `bun run analytics:purge` (scheduled worker, via
 * `purgeVisitorAnalyticsForAllTenants`).
 *
 * PORT NOTE: awcms-micro guarded step 1's DELETE behind a `LegalHoldGuardPort`
 * from its `data_lifecycle` module. That module is NOT ported to this base
 * (`ls src/modules` has no `data-lifecycle`, and `_shared/ports/
 * legal-hold-guard-port.ts` does not exist here), so the legal-hold gate is
 * DROPPED and step 1 is an unconditional DELETE. If/when `data_lifecycle` is
 * ported, re-introduce the guard here exactly as awcms-micro does.
 *
 * Four independent cutoffs, each from the module's config
 * (`VisitorAnalyticsConfig`):
 *   1. `awcms_visit_events` older than `eventRetentionDays` — hard deleted.
 *   2. `awcms_visitor_sessions.ip_address`/`login_identifier_snapshot` (the
 *      two genuinely "raw detail" columns) older than `rawDetailRetentionDays`
 *      — cleared in place, row kept (device/browser aggregate fields remain
 *      useful long after raw detail should be gone).
 *   3. `awcms_visitor_sessions` rows older than `eventRetentionDays` — hard
 *      deleted, but only ones with no remaining `visit_events` row
 *      (`NOT EXISTS`): the collector's own write-throttle (30s) can leave
 *      `last_seen_at` trailing a session's newest event, so a purge landing
 *      inside that straddle window could otherwise hit the
 *      `visit_events.visitor_session_id` FK and abort the transaction. The
 *      `NOT EXISTS` guard makes the delete self-defending.
 *   4. `awcms_visitor_daily_rollups` older than `rollupRetentionDays` — hard
 *      deleted.
 */
import type { VisitorAnalyticsConfig } from "../domain/visitor-analytics-config";

export type RetentionPurgeResult = {
  eventsDeleted: number;
  sessionsRawDetailCleared: number;
  sessionsDeleted: number;
  rollupsDeleted: number;
};

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function purgeVisitorAnalyticsData(
  tx: Bun.SQL,
  tenantId: string,
  config: VisitorAnalyticsConfig,
  now: Date
): Promise<RetentionPurgeResult> {
  const eventCutoff = daysAgo(now, config.eventRetentionDays);
  const rawDetailCutoff = daysAgo(now, config.rawDetailRetentionDays);
  const rollupCutoff = daysAgo(now, config.rollupRetentionDays)
    .toISOString()
    .slice(0, 10);

  const deletedEvents = await tx`
    DELETE FROM awcms_visit_events
    WHERE tenant_id = ${tenantId} AND occurred_at < ${eventCutoff}
    RETURNING id
  `;

  const clearedSessions = await tx`
    UPDATE awcms_visitor_sessions
    SET ip_address = NULL, login_identifier_snapshot = NULL, updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND last_seen_at < ${rawDetailCutoff}
      AND (ip_address IS NOT NULL OR login_identifier_snapshot IS NOT NULL)
    RETURNING id
  `;

  const deletedSessions = await tx`
    DELETE FROM awcms_visitor_sessions s
    WHERE s.tenant_id = ${tenantId} AND s.last_seen_at < ${eventCutoff}
      AND NOT EXISTS (
        SELECT 1 FROM awcms_visit_events e
        WHERE e.visitor_session_id = s.id
      )
    RETURNING id
  `;

  const deletedRollups = await tx`
    DELETE FROM awcms_visitor_daily_rollups
    WHERE tenant_id = ${tenantId} AND date < ${rollupCutoff}
    RETURNING tenant_id
  `;

  return {
    eventsDeleted: deletedEvents.length,
    sessionsRawDetailCleared: clearedSessions.length,
    sessionsDeleted: deletedSessions.length,
    rollupsDeleted: deletedRollups.length
  };
}
