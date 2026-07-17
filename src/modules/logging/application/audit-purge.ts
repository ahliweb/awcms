import { withTenant } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "./audit-log";

/**
 * Retention/purge for `awcms_audit_events` (Issue #146). Ported from
 * awcms-mini's own `logging/application/audit-purge.ts`.
 *
 * ## The gap this closes
 *
 * `AUDIT_LOG_RETENTION_DAYS` was already documented (`.env.example:4`, doc
 * 18) and already validated as an integer >= 1
 * (`scripts/validate-env.ts`) — but NOTHING read it. An operator who set it
 * got a silently no-op retention policy while `awcms_audit_events` grew
 * without bound. A validated env var that does nothing is worse than an
 * absent one: it buys false confidence. This module is the missing
 * implementation.
 *
 * 730 days (2 years) is the default: doc 04 §Retention awal names the policy
 * only in prose ("Security/audit log: 1-5 tahun sesuai kebutuhan"), and 730
 * is the midpoint of that range — long enough for a full annual audit/tax
 * cycle, short enough that an append-only table doesn't grow forever on a
 * long-lived tenant. Overridable per run via `AUDIT_LOG_RETENTION_DAYS`
 * (doc 18) or `--retention-days=<n>`.
 *
 * ## Differences from mini's version (deliberate, not oversights)
 *
 * - **No `legalHoldGuard` parameter.** Mini takes a `LegalHoldGuardPort` and
 *   skips a batch when `logging.audit_events` is under an active legal hold.
 *   That port only exists there because mini HAS a `data_lifecycle` module
 *   with a legal-hold registry; this base has neither (no `data-lifecycle`
 *   under `src/modules/`, no `_shared/ports/legal-hold-guard-port.ts`).
 *   Porting the parameter here would mean inventing a guard with nothing
 *   behind it — a fake gate that always answers "not held", which is more
 *   dangerous than an honest absence. When a legal-hold registry lands in
 *   this base, this function is the enforcement point that must consult it,
 *   and the parameter should be REQUIRED (not optional) so no call site can
 *   silently skip the check — the shape mini already uses.
 * - **No `LOGGING_AUDIT_EVENTS_LIFECYCLE_KEY`.** Same reason: that constant
 *   is a `data_lifecycle` descriptor key.
 *
 * ## Scope: this purges `awcms_audit_events` ONLY
 *
 * `awcms_abac_decision_logs` (one row per authorized request — ~8.6M
 * rows/day at 100 req/s) is NOT touched here. It is the larger volume
 * problem, but it is a different problem: mini does not purge it either
 * (there it is a projection cursor source), and deleting from it needs a
 * retention decision this issue never made. Deliberately left to its own
 * issue rather than quietly bundled in — see the report on #146.
 */
export const AUDIT_EVENT_DEFAULT_RETENTION_DAYS = 730;

/**
 * Rows deleted per DELETE statement. Doc 04 §Aturan implementasi: purge must
 * never be a single unbounded statement that locks the table for an
 * unpredictable amount of time. Same bounded-batch shape as the rest of this
 * base's background work (`src/lib/jobs/batching.ts`), applied to a DELETE.
 */
export const AUDIT_EVENT_PURGE_BATCH_LIMIT = 5000;

export type PurgeAuditEventsOptions = {
  /** Defaults to `AUDIT_EVENT_DEFAULT_RETENTION_DAYS`. */
  retentionDays?: number;
  /** Defaults to `AUDIT_EVENT_PURGE_BATCH_LIMIT`. */
  batchLimit?: number;
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  now?: Date;
  correlationId?: string;
};

export type PurgeAuditEventsResult = {
  purgedCount: number;
  cutoff: Date;
};

type PurgedRow = { id: string };

export function resolveAuditRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Deletes ONE batch (up to `batchLimit`) of one tenant's
 * `awcms_audit_events` rows older than the retention cutoff and — unless the
 * batch was empty — records the purge itself as a new audit event in the
 * SAME transaction (doc 04 §Aturan implementasi: "Purge ... harus diaudit" —
 * never a silent purge). The recorded `attributes` carry only counts and the
 * cutoff, never which individual rows were deleted; there is nothing
 * sensitive to redact there, and `recordAuditEvent` redacts defensively
 * anyway.
 *
 * Self-auditing means a purge run is never a no-op even when it deletes
 * everything past the cutoff: the newest row it writes (its own purge event)
 * is by construction newer than the cutoff, so it survives the same run and
 * the next one. The table can therefore never be emptied to "no evidence a
 * purge happened".
 *
 * Callers loop this per tenant until it returns `purgedCount: 0` (see
 * `scripts/audit-log-purge.ts`, via `iterateTenantsInBatches`) — so one huge
 * backlog can neither hold a single DB transaction open indefinitely nor
 * make a scheduled run non-terminating.
 *
 * Age-only cutoff, no cascading delete: `awcms_audit_events` (migration 007)
 * has no dependent FK children, so a physical DELETE here cannot "memutus FK
 * penting" (doc 04).
 */
export async function purgeExpiredAuditEvents(
  sql: Bun.SQL,
  tenantId: string,
  options: PurgeAuditEventsOptions = {}
): Promise<PurgeAuditEventsResult> {
  const retentionDays =
    options.retentionDays ?? AUDIT_EVENT_DEFAULT_RETENTION_DAYS;
  const batchLimit = options.batchLimit ?? AUDIT_EVENT_PURGE_BATCH_LIMIT;
  const now = options.now ?? new Date();
  const cutoff = resolveAuditRetentionCutoff(now, retentionDays);

  const purgedCount = await withTenant(
    sql,
    tenantId,
    async (tx) => {
      // The inner SELECT is bounded and ordered oldest-first so repeated
      // passes make monotonic progress; `tenant_id` stays in the predicate
      // even though FORCE RLS (sql/017) already scopes the table — belt and
      // braces, and it keeps the index usable.
      const deleted = (await tx`
        DELETE FROM awcms_audit_events
        WHERE id IN (
          SELECT id FROM awcms_audit_events
          WHERE tenant_id = ${tenantId} AND created_at < ${cutoff}
          ORDER BY created_at ASC
          LIMIT ${batchLimit}
        )
        RETURNING id
      `) as PurgedRow[];

      if (deleted.length > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "logging",
          action: "purge",
          resourceType: "audit_event",
          severity: "warning",
          message: `Purged ${deleted.length} audit event(s) older than the retention cutoff.`,
          attributes: {
            retentionDays,
            cutoffIso: cutoff.toISOString(),
            purgedCount: deleted.length
          },
          correlationId: options.correlationId
        });
      }

      return deleted.length;
    },
    // "maintenance" (max 1 concurrent slot, doc 16 §Connection pooling) is
    // the correct work class for an administrative bulk delete — neither a
    // request-serving "interactive" query nor a "background_sync"
    // replication/dispatch operation. Matches this script's existing entry
    // in `src/lib/database/work-class-registry.ts`.
    { workClass: "maintenance" }
  );

  return { purgedCount, cutoff };
}

/**
 * Read-only preview for `--dry-run`: a `count(*)` against the exact same
 * cutoff a real run would use, with no DELETE and no purge audit event.
 * Shares `resolveAuditRetentionCutoff` with the real path so a dry run can
 * never drift from what a real run treats as "past retention".
 */
export async function countPurgeableAuditEvents(
  sql: Bun.SQL,
  tenantId: string,
  cutoff: Date
): Promise<number> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS count
        FROM awcms_audit_events
        WHERE tenant_id = ${tenantId} AND created_at < ${cutoff}
      `) as { count: number }[];

      return rows[0]?.count ?? 0;
    },
    { workClass: "maintenance" }
  );
}
