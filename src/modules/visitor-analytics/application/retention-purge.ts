/**
 * Visitor analytics retention purge (ported from awcms-micro epic
 * #617-#624), triggered by `POST /api/v1/analytics/retention/purge`
 * (on-demand) and `bun run analytics:purge` (scheduled worker, via
 * `purgeVisitorAnalyticsForAllTenants`).
 *
 * Legal hold enforcement (ADR-0037): `awcms_visit_events` is this module's
 * registered "delegated" adopter for `visitor_analytics.visit_events`
 * (`src/modules/visitor-analytics/module.ts`'s `dataLifecycle` descriptor) — the
 * `data_lifecycle` module's own engine never mutates this table, only reports a
 * dry-run snapshot, so THIS function is the real enforcement point. Before any
 * DELETE, this asks the caller-supplied `legalHoldGuard` (a `LegalHoldGuardPort`,
 * see `_shared/ports/legal-hold-guard-port.ts`) and, if a hold covers
 * `visitor_analytics.visit_events` (a descriptor-scoped hold OR a tenant-wide
 * `descriptorKey: null` hold — `isDescriptorHeld` surfaces both), skips **every**
 * step and preserves all of this tenant's analytics data. This is deliberately
 * broader than awcms-micro (which gated only the events DELETE): steps 2-4
 * (session raw-detail clearing, session deletion, rollup deletion) also destroy
 * litigation-relevant data (IP / login snapshot, aggregates), and the session/
 * rollup tables are not separately registered descriptors, so gating them behind
 * the events hold is the safe, over-preserving default for a compliance control
 * — normal retention resumes once the hold is released. Not imported directly
 * from `data_lifecycle`'s `application`/`domain` code — that would create a
 * forbidden circular cross-module import (ADR-0011); the port is the documented
 * way around it, wired at the composition roots (the retention-purge route and
 * `scripts/visitor-analytics-purge.ts`).
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
import { VISITOR_ANALYTICS_VISIT_EVENTS_LIFECYCLE_KEY } from "../module";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";

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
  now: Date,
  legalHoldGuard: LegalHoldGuardPort
): Promise<RetentionPurgeResult> {
  const eventCutoff = daysAgo(now, config.eventRetentionDays);
  const rawDetailCutoff = daysAgo(now, config.rawDetailRetentionDays);
  const rollupCutoff = daysAgo(now, config.rollupRetentionDays)
    .toISOString()
    .slice(0, 10);

  const visitEventsHeld = await legalHoldGuard.isDescriptorHeld(
    tx,
    tenantId,
    VISITOR_ANALYTICS_VISIT_EVENTS_LIFECYCLE_KEY
  );

  // A hold covering this module's data preserves ALL of it (see header): skip
  // every step, not just the events DELETE, so session PII and rollups survive
  // the hold too.
  if (visitEventsHeld) {
    return {
      eventsDeleted: 0,
      sessionsRawDetailCleared: 0,
      sessionsDeleted: 0,
      rollupsDeleted: 0
    };
  }

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
