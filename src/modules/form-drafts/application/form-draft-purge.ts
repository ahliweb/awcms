import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { FORM_DRAFTS_LIFECYCLE_KEY } from "../module";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";

/**
 * Retention for `awcms_form_drafts` (ported from awcms-micro Issue #484), same bounded-batch +
 * self-auditing shape as `logging/application/audit-purge.ts`. Two distinct
 * steps, run separately so a caller can schedule them independently:
 *
 * 1. `expireOverdueFormDrafts` — a `draft` whose caller-supplied
 *    `expires_at` has passed transitions to `status = 'expired'` (soft
 *    transition, not a delete — the row and its payload are still there for
 *    audit/debugging, just no longer resumable/editable).
 * 2. `purgeExpiredFormDrafts` — physically deletes rows that have been
 *    `expired`/`abandoned` for longer than `retentionDays`, the same
 *    age-based cutoff `purgeExpiredAuditEvents` uses (no `expires_at`-only
 *    cutoff here since `abandoned` drafts never had one).
 *
 * Neither drafts nor the columns they touch have FK children, so a physical
 * DELETE in step 2 can never break a foreign key (same reasoning as audit
 * events)..
 *
 * Legal hold enforcement (awcms-micro security-auditor finding, PR #773): step 2
 * (`purgeExpiredFormDrafts`) is this module's registered "delegated"
 * adopter for `form_drafts.form_drafts`
 * (`src/modules/form-drafts/module.ts`'s `dataLifecycle` descriptor,
 * `deletion.mode: "status_transition_then_purge"`) — the data_lifecycle
 * module's own engine never mutates this table, only reports a dry-run
 * snapshot, so `purgeExpiredFormDrafts` is the real enforcement point for
 * the actual, irreversible DELETE. Before deleting, it asks the
 * caller-supplied `legalHoldGuard` (a `LegalHoldGuardPort`, see
 * `_shared/ports/legal-hold-guard-port.ts`) and skips the whole batch if
 * `form_drafts.form_drafts` is held. `expireOverdueFormDrafts` (step 1,
 * the non-destructive `status -> 'expired'` transition) is NOT gated — it
 * never deletes data, so it carries none of the irreversible-loss risk a
 * legal hold exists to prevent. Not imported directly from
 * `data_lifecycle`'s `application`/`domain` code — that would create a
 * forbidden circular cross-module import (the cross-module import rule); the port
 * is the documented way around it.
 */
export const FORM_DRAFT_DEFAULT_RETENTION_DAYS = 30;
export const FORM_DRAFT_PURGE_BATCH_LIMIT = 5000;

export type ExpireFormDraftsOptions = {
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  now?: Date;
  /** Defaults to `FORM_DRAFT_PURGE_BATCH_LIMIT`. */
  batchLimit?: number;
  correlationId?: string;
};

export type ExpireFormDraftsResult = {
  expiredCount: number;
};

type IdRow = { id: string };

/** Transitions one batch of overdue `draft` rows to `status = 'expired'`. */
export async function expireOverdueFormDrafts(
  sql: Bun.SQL,
  tenantId: string,
  options: ExpireFormDraftsOptions = {}
): Promise<ExpireFormDraftsResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? FORM_DRAFT_PURGE_BATCH_LIMIT;

  const expiredCount = await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const expired = (await tx`
        UPDATE awcms_form_drafts
        SET status = 'expired', updated_at = ${now}
        WHERE id IN (
          SELECT id FROM awcms_form_drafts
          WHERE tenant_id = ${tenantId} AND status = 'draft'
            AND expires_at IS NOT NULL AND expires_at < ${now}
          ORDER BY expires_at ASC
          LIMIT ${batchLimit}
        )
        RETURNING id
      `) as IdRow[];

      if (expired.length > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "form_drafts",
          action: "expire",
          resourceType: "form_draft",
          severity: "info",
          message: `Expired ${expired.length} form draft(s) past their expires_at.`,
          attributes: { expiredCount: expired.length },
          correlationId: options.correlationId
        });
      }

      return expired.length;
    },
    { workClass: "maintenance" }
  );

  return { expiredCount };
}

export type PurgeFormDraftsOptions = {
  /** Defaults to `FORM_DRAFT_DEFAULT_RETENTION_DAYS`. */
  retentionDays?: number;
  /** Defaults to `FORM_DRAFT_PURGE_BATCH_LIMIT`. */
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgeFormDraftsResult = {
  purgedCount: number;
  cutoff: Date;
};

/** Physically deletes one batch of `expired`/`abandoned` drafts older than the retention cutoff (by `updated_at`, the moment they stopped being editable). */
export async function purgeExpiredFormDrafts(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeFormDraftsOptions = {}
): Promise<PurgeFormDraftsResult> {
  const retentionDays =
    options.retentionDays ?? FORM_DRAFT_DEFAULT_RETENTION_DAYS;
  const batchLimit = options.batchLimit ?? FORM_DRAFT_PURGE_BATCH_LIMIT;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const purgedCount = await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const held = await legalHoldGuard.isDescriptorHeld(
        tx,
        tenantId,
        FORM_DRAFTS_LIFECYCLE_KEY
      );
      if (held) {
        return 0;
      }

      const deleted = (await tx`
        DELETE FROM awcms_form_drafts
        WHERE id IN (
          SELECT id FROM awcms_form_drafts
          WHERE tenant_id = ${tenantId}
            AND status IN ('expired', 'abandoned')
            AND updated_at < ${cutoff}
          ORDER BY updated_at ASC
          LIMIT ${batchLimit}
        )
        RETURNING id
      `) as IdRow[];

      if (deleted.length > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "form_drafts",
          action: "purge",
          resourceType: "form_draft",
          severity: "warning",
          message: `Purged ${deleted.length} expired/abandoned form draft(s) older than the retention cutoff.`,
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
    { workClass: "maintenance" }
  );

  return { purgedCount, cutoff };
}
