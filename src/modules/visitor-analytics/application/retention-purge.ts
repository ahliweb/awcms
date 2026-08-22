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
  /**
   * Finding C2 — at least one of the four statements filled its batch, so there
   * is more to purge. The caller decides what to do with that: the scheduled
   * job loops in a FRESH transaction per pass; the on-demand endpoint returns
   * it, because an interactive request must not hold a purge of unknown size
   * open.
   */
  hasMore: boolean;
};

/**
 * Finding C2 — this was the only unbounded retention purge in the repo. Four
 * statements with no limit, each using `RETURNING id` purely to take a JS-side
 * `.length`, so a tenant with a year of unpurged analytics deleted every row in
 * ONE transaction: one lock set held for the duration, one WAL burst, and a
 * `statement_timeout` that turns the whole pass into a rollback rather than
 * partial progress.
 *
 * 5000 is the number every sibling already uses
 * (`AUDIT_EVENT_PURGE_BATCH_LIMIT`), and matching it matters more than the
 * value: a purge cadence that differs per table for no stated reason is a
 * cadence nobody can reason about.
 */
export const VISITOR_ANALYTICS_PURGE_BATCH_LIMIT = 5000;

export type PurgeVisitorAnalyticsOptions = {
  batchLimit?: number;
};

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function purgeVisitorAnalyticsData(
  tx: Bun.SQL,
  tenantId: string,
  config: VisitorAnalyticsConfig,
  now: Date,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeVisitorAnalyticsOptions = {}
): Promise<RetentionPurgeResult> {
  const batchLimit = options.batchLimit ?? VISITOR_ANALYTICS_PURGE_BATCH_LIMIT;
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
      rollupsDeleted: 0,
      // A hold is not "more to purge": looping would spin forever against a
      // control whose whole purpose is to stop the purge.
      hasMore: false
    };
  }

  // Every statement is `WHERE <pk> IN (SELECT … ORDER BY … LIMIT n)` — the shape
  // `audit-purge.ts` already established.
  //
  // What the ORDER BY buys, stated precisely: termination does NOT depend on it
  // (a DELETE removes what it took, so any bounded slice shrinks the set and the
  // loop ends regardless). It buys OLDEST-FIRST, which is worth having for two
  // reasons — the ordering matches the index the predicate already uses, and a
  // purge interrupted half way has removed the data furthest past retention
  // rather than an arbitrary slice of it. On a retention control, "which half
  // got deleted" is not a detail.
  //
  // `tenant_id` stays in the inner predicate even though FORCE RLS already
  // scopes the table: it keeps the index usable.
  const deletedEvents = await tx`
    DELETE FROM awcms_visit_events
    WHERE id IN (
      SELECT id FROM awcms_visit_events
      WHERE tenant_id = ${tenantId} AND occurred_at < ${eventCutoff}
      ORDER BY occurred_at ASC
      LIMIT ${batchLimit}
    )
    RETURNING id
  `;

  const clearedSessions = await tx`
    UPDATE awcms_visitor_sessions
    SET ip_address = NULL, login_identifier_snapshot = NULL, updated_at = now()
    WHERE id IN (
      SELECT id FROM awcms_visitor_sessions
      WHERE tenant_id = ${tenantId}
        AND last_seen_at < ${rawDetailCutoff}
        AND (ip_address IS NOT NULL OR login_identifier_snapshot IS NOT NULL)
      ORDER BY last_seen_at ASC
      LIMIT ${batchLimit}
    )
    RETURNING id
  `;

  // The `NOT EXISTS` guard stays exactly where it was and is why this statement
  // is ordered by `last_seen_at` rather than deleted outright: a session whose
  // events have not been purged yet is skipped THIS pass and caught by a later
  // one, once step 1 has removed them.
  const deletedSessions = await tx`
    DELETE FROM awcms_visitor_sessions
    WHERE id IN (
      SELECT s.id FROM awcms_visitor_sessions s
      WHERE s.tenant_id = ${tenantId} AND s.last_seen_at < ${eventCutoff}
        AND NOT EXISTS (
          SELECT 1 FROM awcms_visit_events e
          WHERE e.visitor_session_id = s.id
        )
      ORDER BY s.last_seen_at ASC
      LIMIT ${batchLimit}
    )
    RETURNING id
  `;

  // `awcms_visitor_daily_rollups` is keyed on `(tenant_id, date, area)`, not a
  // surrogate id, so the bound is `ctid` — the one identifier every Postgres
  // row has. It is not stable across an UPDATE, which is exactly why it is
  // only ever used inside the single statement that selected it.
  const deletedRollups = await tx`
    DELETE FROM awcms_visitor_daily_rollups
    WHERE ctid IN (
      SELECT ctid FROM awcms_visitor_daily_rollups
      WHERE tenant_id = ${tenantId} AND date < ${rollupCutoff}
      ORDER BY date ASC
      LIMIT ${batchLimit}
    )
    RETURNING tenant_id
  `;

  return {
    eventsDeleted: deletedEvents.length,
    sessionsRawDetailCleared: clearedSessions.length,
    sessionsDeleted: deletedSessions.length,
    rollupsDeleted: deletedRollups.length,
    // Any statement that filled its batch means there is more behind it.
    hasMore:
      deletedEvents.length === batchLimit ||
      clearedSessions.length === batchLimit ||
      deletedSessions.length === batchLimit ||
      deletedRollups.length === batchLimit
  };
}
