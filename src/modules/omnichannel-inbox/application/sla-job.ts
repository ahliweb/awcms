/**
 * `omnichannel-inbox:sla` (Issue #1164, ADR-0160 sections 3 and 4).
 *
 * For each active tenant whose `omnichannel_inbox` module is on, in ONE
 * transaction per tenant (a failure in one tenant is logged and counted, and
 * never stops the others):
 *
 * 0. Customer-state sweep: Telegram consent changes and website withdrawals of
 *    the last 48 hours that the projection has not applied yet (see
 *    `applyRecentCustomerStateChanges`).
 * 1. Assignee re-check: current assignees (bounded, least recently checked
 *    first) are re-run through
 *    `assigneeEligibility`. Somebody who is no longer eligible (deactivated,
 *    lost the permission, confinement no longer covers the conversation) is
 *    UNASSIGNED from those conversations, each with an `assignee_revoked`
 *    activity row naming the reason code, and is therefore not notified below.
 * 2. Breaches: conversations whose response is due and not yet stamped are
 *    stamped `sla_breached_at` once (`FOR UPDATE SKIP LOCKED`, bounded per
 *    run), with an `sla_breached` activity row. Each ASSIGNEE is told once per
 *    run, through the existing `workflow_notification` port (the e-mail outbox;
 *    a tenant without the template gets nothing, silently). Nobody outside the
 *    tenant's staff is ever told anything.
 *
 * Runs as `awcms_app` (see the script header): it reads role grants to decide
 * eligibility and enqueues e-mail, both of which only the runtime role may do.
 * It decrypts nothing.
 */
import { fetchActiveTenants } from "../../../lib/jobs/batching";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";
import type { WorkflowNotificationPort } from "../../_shared/ports/workflow-notification-port";
import { resolveModuleEnabled } from "../../identity-access/application/auth-context";
import { isOmnichannelInboxEnabled } from "../domain/inbox-config";
import {
  CUSTOMER_STATE_EVENT_TYPES,
  CUSTOMER_STATE_SWEEP_BATCH,
  CUSTOMER_STATE_SWEEP_WINDOW_HOURS,
  OMNICHANNEL_INBOX_MODULE_KEY,
  TELEGRAM_CONTACT_AGGREGATE_TYPE,
  WEBSITE_SUBMISSION_AGGREGATE_TYPE,
  SLA_BREACH_TEMPLATE_KEY,
  SLA_SWEEP_BATCH
} from "../domain/inbox-constants";
import { assigneeEligibility } from "./assignee-eligibility";
import { projectEvent } from "./conversation-projector";

export type SlaTenantResult = {
  customerStateApplied: number;
  revoked: number;
  breached: number;
  notified: number;
};

export type SlaJobSummary = {
  inert: boolean;
  tenantsChecked: number;
  tenantsSkipped: number;
  tenantsErrored: number;
  aborted: boolean;
  totals: SlaTenantResult;
};

export type SlaJobDeps = {
  hierarchy: BusinessScopeHierarchyPort;
  notifier: WorkflowNotificationPort;
};

/**
 * Applies the customer-state changes recorded in the last
 * `CUSTOMER_STATE_SWEEP_WINDOW_HOURS` that the projection has NOT applied yet:
 *
 * - Telegram consent, which no consumer subscribes to (its dispatcher role may
 *   not write delivery rows, sql/374), so this is how a later opt-out of an
 *   existing conversation arrives;
 * - website withdrawals, which the consumer does receive: this is the safety
 *   net for a delivery that dead-lettered or ran while the module was off
 *   (#1275 audit, H-1). A withdrawal must never be lost.
 *
 * Only events NEWER than the conversation's applied state are read (a join on
 * the conversation, not a scan of the window), newest first (L-4): once one is
 * applied, every older event of that conversation drops out of the next run's
 * answer, so the bound can never starve a pending change behind applied ones.
 */
export async function applyRecentCustomerStateChanges(
  tx: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<number> {
  const since = new Date(
    now.getTime() - CUSTOMER_STATE_SWEEP_WINDOW_HOURS * 3_600_000
  );
  const events = (await tx`
    SELECT e.id, e.event_type, e.payload, e.event_sequence::text AS seq
    FROM awcms_domain_events e
    JOIN awcms_inbox_conversations c
      ON c.tenant_id = e.tenant_id
     AND c.source_ref = e.aggregate_id
     AND c.source_kind = CASE e.aggregate_type
           WHEN ${TELEGRAM_CONTACT_AGGREGATE_TYPE} THEN 'telegram'
           WHEN ${WEBSITE_SUBMISSION_AGGREGATE_TYPE} THEN 'website'
         END
    WHERE e.tenant_id = ${tenantId}
      AND e.event_type = ANY(${tx.array([...CUSTOMER_STATE_EVENT_TYPES], "text")})
      AND e.event_version = '1.0'
      AND e.recorded_at >= ${since}
      AND e.event_sequence > c.customer_state_sequence
      AND c.customer_state <> 'withdrawn'
    ORDER BY e.event_sequence DESC
    LIMIT ${CUSTOMER_STATE_SWEEP_BATCH}
  `) as {
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    seq: string;
  }[];
  let applied = 0;

  for (const event of events) {
    const outcome = await projectEvent(tx, tenantId, {
      id: event.id,
      eventType: event.event_type,
      payload: event.payload,
      eventSequence: event.seq
    });

    if (outcome === "state_applied") applied += 1;
  }

  return applied;
}

/**
 * Re-checks current assignees, one (assignee, scope) pair at a time, and
 * unassigns the ineligible.
 *
 * At most `SLA_SWEEP_BATCH` pairs per run, LEAST RECENTLY CHECKED first (#1275
 * audit, M-2): a checked pair's `assignee_checked_at` moves to `now`, so the
 * next run starts where this one stopped. With a fixed order and a LIMIT, the
 * pairs past the limit would never be checked at all, and a revoked person
 * would stay assigned there forever.
 */
export async function revokeIneligibleAssignees(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  hierarchy: BusinessScopeHierarchyPort
): Promise<number> {
  const pairs = (await tx`
    SELECT assignee_tenant_user_id AS user_id,
           business_scope_type, business_scope_id
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId} AND assignee_tenant_user_id IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY min(COALESCE(assignee_checked_at, '-infinity'::timestamptz)), 1, 2, 3
    LIMIT ${SLA_SWEEP_BATCH}
  `) as {
    user_id: string;
    business_scope_type: string | null;
    business_scope_id: string | null;
  }[];
  let revoked = 0;

  for (const pair of pairs) {
    const scope =
      pair.business_scope_type && pair.business_scope_id
        ? { type: pair.business_scope_type, id: pair.business_scope_id }
        : null;
    const eligibility = await assigneeEligibility(
      tx,
      tenantId,
      pair.user_id,
      scope,
      now,
      hierarchy
    );

    if (eligibility.eligible) {
      // Bookkeeping only: no version move, so no staff edit is conflicted.
      await tx`
        UPDATE awcms_inbox_conversations
        SET assignee_checked_at = ${now}
        WHERE tenant_id = ${tenantId}
          AND assignee_tenant_user_id = ${pair.user_id}
          AND business_scope_type IS NOT DISTINCT FROM ${pair.business_scope_type}
          AND business_scope_id IS NOT DISTINCT FROM ${pair.business_scope_id}::uuid
      `;
      continue;
    }

    const rows = (await tx`
      UPDATE awcms_inbox_conversations
      SET assignee_tenant_user_id = NULL, assigned_at = NULL,
          assignee_checked_at = NULL,
          version = version + 1, updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND assignee_tenant_user_id = ${pair.user_id}
        AND business_scope_type IS NOT DISTINCT FROM ${pair.business_scope_type}
        AND business_scope_id IS NOT DISTINCT FROM ${pair.business_scope_id}::uuid
      RETURNING id
    `) as { id: string }[];

    for (const row of rows) {
      await tx`
        INSERT INTO awcms_inbox_activity
          (tenant_id, conversation_id, kind, subject_tenant_user_id, detail_code)
        VALUES (${tenantId}, ${row.id}, 'assignee_revoked', ${pair.user_id},
                ${eligibility.reason})
      `;
    }

    revoked += rows.length;
  }

  return revoked;
}

/** Stamps due, unstamped breaches once and tells each assignee once. */
export async function stampBreaches(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  notifier: WorkflowNotificationPort,
  correlationId: string
): Promise<{ breached: number; notified: number }> {
  const due = (await tx`
    SELECT id, assignee_tenant_user_id, response_due_kind
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId}
      AND response_due_at IS NOT NULL
      AND sla_breached_at IS NULL
      AND response_due_at <= ${now}
    ORDER BY response_due_at, id
    LIMIT ${SLA_SWEEP_BATCH}
    FOR UPDATE SKIP LOCKED
  `) as {
    id: string;
    assignee_tenant_user_id: string | null;
    response_due_kind: string | null;
  }[];
  const perAssignee = new Map<string, number>();

  for (const row of due) {
    await tx`
      UPDATE awcms_inbox_conversations
      SET sla_breached_at = ${now}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${row.id}
    `;
    await tx`
      INSERT INTO awcms_inbox_activity
        (tenant_id, conversation_id, kind, subject_tenant_user_id, detail_code)
      VALUES (${tenantId}, ${row.id}, 'sla_breached', ${row.assignee_tenant_user_id},
              ${row.response_due_kind})
    `;

    if (row.assignee_tenant_user_id) {
      perAssignee.set(
        row.assignee_tenant_user_id,
        (perAssignee.get(row.assignee_tenant_user_id) ?? 0) + 1
      );
    }
  }

  let notified = 0;

  for (const [assignee, count] of perAssignee) {
    const outcome = await notifier.enqueueNotification(tx, {
      tenantId,
      templateKey: SLA_BREACH_TEMPLATE_KEY,
      recipientTenantUserIds: [assignee],
      // Counts only: no customer reference travels in a notification.
      variables: { breachedCount: String(count) },
      correlationId
    });

    // A tenant without the template (or an unreachable assignee) queues nothing.
    if (outcome.queued > 0) notified += 1;
  }

  return { breached: due.length, notified };
}

export async function runSlaForTenant(
  sql: Bun.SQL,
  tenantId: string,
  deps: SlaJobDeps,
  options: { now?: Date; correlationId: string; dryRun?: boolean }
): Promise<SlaTenantResult | "skipped"> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      if (
        !(await resolveModuleEnabled(
          tx,
          tenantId,
          OMNICHANNEL_INBOX_MODULE_KEY
        ))
      ) {
        return "skipped" as const;
      }

      const now = options.now ?? new Date();

      if (options.dryRun) {
        const rows = (await tx`
          SELECT count(*)::int AS total FROM awcms_inbox_conversations
          WHERE tenant_id = ${tenantId} AND response_due_at IS NOT NULL
            AND sla_breached_at IS NULL AND response_due_at <= ${now}
        `) as { total: number }[];

        return {
          customerStateApplied: 0,
          revoked: 0,
          breached: rows[0]?.total ?? 0,
          notified: 0
        };
      }

      const customerStateApplied = await applyRecentCustomerStateChanges(
        tx,
        tenantId,
        now
      );
      const revoked = await revokeIneligibleAssignees(
        tx,
        tenantId,
        now,
        deps.hierarchy
      );
      const stamped = await stampBreaches(
        tx,
        tenantId,
        now,
        deps.notifier,
        options.correlationId
      );

      return { customerStateApplied, revoked, ...stamped };
    },
    { workClass: "maintenance" }
  );
}

export async function runSlaJob(
  sql: Bun.SQL,
  deps: SlaJobDeps,
  options: {
    now?: Date;
    correlationId: string;
    dryRun?: boolean;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
  }
): Promise<SlaJobSummary> {
  const summary: SlaJobSummary = {
    inert: false,
    tenantsChecked: 0,
    tenantsSkipped: 0,
    tenantsErrored: 0,
    aborted: false,
    totals: { customerStateApplied: 0, revoked: 0, breached: 0, notified: 0 }
  };

  if (!isOmnichannelInboxEnabled(options.env)) {
    summary.inert = true;
    return summary;
  }

  for (const tenant of await fetchActiveTenants(sql)) {
    if (options.signal?.aborted) {
      summary.aborted = true;
      break;
    }

    summary.tenantsChecked += 1;

    try {
      const result = await runSlaForTenant(sql, tenant.id, deps, options);

      if (result === "skipped") {
        summary.tenantsSkipped += 1;
        continue;
      }

      summary.totals.customerStateApplied += result.customerStateApplied;
      summary.totals.revoked += result.revoked;
      summary.totals.breached += result.breached;
      summary.totals.notified += result.notified;
    } catch (error) {
      // tx-swallow-ok: The handle here is a pooled client, not a transaction:
      // the failing tenant's own transaction was already rolled back by
      // withTenantOrThrow, so nothing is left aborted and the next tenant runs.
      summary.tenantsErrored += 1;
      log("error", "omnichannel_inbox.sla.tenant_error", {
        tenantId: tenant.id,
        errorName: error instanceof Error ? error.name : "unknown"
      });
    }
  }

  return summary;
}
