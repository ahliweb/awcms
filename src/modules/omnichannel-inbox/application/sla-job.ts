/**
 * `omnichannel-inbox:sla` (Issue #1164, ADR-0160 sections 3 and 4).
 *
 * For each active tenant whose `omnichannel_inbox` module is on, in ONE
 * transaction per tenant (a failure in one tenant is logged and counted, and
 * never stops the others):
 *
 * 1. Assignee re-check: every current assignee is re-run through
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
  OMNICHANNEL_INBOX_MODULE_KEY,
  SLA_BREACH_TEMPLATE_KEY,
  SLA_SWEEP_BATCH
} from "../domain/inbox-constants";
import { assigneeEligibility } from "./assignee-eligibility";

export type SlaTenantResult = {
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

/** Re-checks every current assignee of the tenant; unassigns the ineligible. */
export async function revokeIneligibleAssignees(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  hierarchy: BusinessScopeHierarchyPort
): Promise<number> {
  const pairs = (await tx`
    SELECT DISTINCT assignee_tenant_user_id AS user_id,
           business_scope_type, business_scope_id
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId} AND assignee_tenant_user_id IS NOT NULL
    ORDER BY 1, 2, 3
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

    if (eligibility.eligible) continue;

    const rows = (await tx`
      UPDATE awcms_inbox_conversations
      SET assignee_tenant_user_id = NULL, assigned_at = NULL,
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

  for (const [assignee, count] of perAssignee) {
    await notifier.enqueueNotification(tx, {
      tenantId,
      templateKey: SLA_BREACH_TEMPLATE_KEY,
      recipientTenantUserIds: [assignee],
      // Counts only: no customer reference travels in a notification.
      variables: { breachedCount: String(count) },
      correlationId
    });
  }

  return { breached: due.length, notified: perAssignee.size };
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

        return { revoked: 0, breached: rows[0]?.total ?? 0, notified: 0 };
      }

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

      return { revoked, ...stamped };
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
    totals: { revoked: 0, breached: 0, notified: 0 }
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
