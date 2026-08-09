/**
 * Retention for the domain-event delivery ledger (Issue #468, ADR-0072). This
 * module's registered "delegated" adopter for the `dataLifecycle` descriptor in
 * `../module.ts`.
 *
 * The other three delegated purges in this repo (`email`, `push_delivery`,
 * `sync_storage`) each need ONE predicate beyond the cutoff: the terminal
 * status. This one needs three, and each is load-bearing on its own.
 *
 * ## 1. `dead_letter` is excluded, and it is the trap
 *
 * It LOOKS terminal — the dispatcher will never retry one by itself — and it is
 * precisely the row an operator opens `/admin/domain-events` to find and
 * replay. A window that swept it would delete the work AND the evidence of it,
 * and the deletion would be indistinguishable from the queue having drained
 * cleanly. Only `delivered` and `skipped` are settled.
 *
 * ## 2. A row a REPLAY references may not go
 *
 * `awcms_domain_event_replays` carries two NOT NULL foreign keys into this
 * table — `original_delivery_id` and `replay_delivery_id`. Deleting either side
 * fails on the constraint, and a purge that half-succeeds every night is worse
 * than one that never runs: the error is intermittent and the backlog still
 * grows. The replay row itself is the audit record of a manual operator action,
 * so the answer is to skip the delivery, not to widen the delete.
 *
 * ## 3. A row another DELIVERY references may not go either
 *
 * `replay_of_delivery_id` is a self-foreign-key: a replay attempt is a new row
 * pointing back at the original. Same constraint, same treatment.
 *
 * Predicates 2 and 3 are `NOT EXISTS` rather than a join, so a row that becomes
 * referenced between the SELECT and the DELETE is simply not deleted — the two
 * run in one statement, inside one transaction.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import { DOMAIN_EVENT_DELIVERIES_LIFECYCLE_KEY } from "../module";

/**
 * Longer than the email queue's 90: a delivery receipt is what answers "did
 * consumer X ever see event Y", and that question is asked when a downstream
 * projection is found to disagree with its source — months after the delivery.
 */
export const DELIVERY_DEFAULT_RETENTION_DAYS = 120;
export const DELIVERY_PURGE_BATCH_LIMIT = 5000;

/**
 * The statuses that are SETTLED — not merely "not pending".
 *
 * `dead_letter` is deliberately absent; see this file's header. The distinction
 * between "the dispatcher is done with it" and "nothing more will happen to it"
 * is the whole content of this constant.
 */
export const SETTLED_DELIVERY_STATUSES = ["delivered", "skipped"] as const;

const MODULE_KEY = "domain_event_runtime";

export function resolveDeliveryRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export type PurgeSettledDeliveriesOptions = {
  retentionDays?: number;
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgeSettledDeliveriesResult = { purgedRows: number };

type IdRow = { id: string };

export async function purgeSettledDeliveries(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeSettledDeliveriesOptions = {}
): Promise<PurgeSettledDeliveriesResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? DELIVERY_PURGE_BATCH_LIMIT;
  const cutoff = resolveDeliveryRetentionCutoff(
    now,
    options.retentionDays ?? DELIVERY_DEFAULT_RETENTION_DAYS
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      if (
        await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          DOMAIN_EVENT_DELIVERIES_LIFECYCLE_KEY
        )
      ) {
        return { purgedRows: 0 };
      }

      const deleted = (await tx`
        DELETE FROM awcms_domain_event_deliveries
        WHERE id IN (
          SELECT d.id FROM awcms_domain_event_deliveries d
          WHERE d.tenant_id = ${tenantId}
            AND d.status IN ('delivered', 'skipped')
            AND d.updated_at < ${cutoff}
            AND NOT EXISTS (
              SELECT 1 FROM awcms_domain_event_replays r
              WHERE r.original_delivery_id = d.id
                 OR r.replay_delivery_id = d.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM awcms_domain_event_deliveries child
              WHERE child.replay_of_delivery_id = d.id
            )
          ORDER BY d.updated_at ASC
          LIMIT ${batchLimit}
        )
        RETURNING id
      `) as IdRow[];

      if (deleted.length > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: MODULE_KEY,
          action: "purge",
          resourceType: "domain_event_delivery",
          severity: "info",
          message: `Domain-event delivery retention purge removed ${deleted.length} row(s).`,
          attributes: {
            purgedRows: deleted.length,
            cutoff: cutoff.toISOString(),
            ...(options.correlationId
              ? { correlationId: options.correlationId }
              : {})
          }
        });
      }

      return { purgedRows: deleted.length };
    },
    { workClass: "maintenance" }
  );
}
