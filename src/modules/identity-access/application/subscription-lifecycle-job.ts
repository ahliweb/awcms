/**
 * Subscription ladder job — ADR-0084, Gelombang 5 PR 5.2 of Issue #423.
 *
 * Walks every tenant's subscription one rung down when its clock says so, and
 * does nothing else. The decision itself is
 * `domain/subscription-transition.ts` — pure, no database, no clock of its own —
 * so the whole ladder is testable by handing it a `now`, and this file is only
 * the part that reads a row, applies the answer, and writes the audit trail.
 *
 * ## What this job deliberately CANNOT do
 *
 * It cannot suspend a tenant, and the boundary is a database privilege rather
 * than a promise: `awcms_worker` holds `SELECT` on `awcms_tenants` and nothing
 * more. See `transitionEndsEntitlement`'s header for why the plan's "connect it
 * to the suspension gate" is answered through the entitlement gate instead.
 *
 * It cannot move a subscription UP either, because the pure evaluator has no
 * shape for it. A billing job that could restore service on a timer restores it
 * when the timer is wrong.
 *
 * ## The blast-radius bound, and why a cron job needs one
 *
 * A run that would move more than `MAX_ENTITLEMENT_LOSSES_PER_RUN` tenants OUT
 * of an entitling status applies NONE of those and reports instead. Every
 * transition here is driven by dates in rows, so a single bad backfill, an
 * operator setting `current_period_end` in the past across a table, or a clock
 * skew on the worker host are all one query away from stopping service for every
 * customer at once — quietly, overnight, with no human in the loop.
 *
 * The bound is not a rate limit; it is a "this looks like a bug, not a Tuesday"
 * detector. Losses under the bound still apply, so ordinary attrition is never
 * blocked, and the run reports `partial` so the operator sees it.
 *
 * Transitions that do NOT cost entitlement (`active -> past_due`, and the move
 * into `grace`) are never withheld: they change what the customer is TOLD, not
 * what they can reach, and withholding a warning helps nobody.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  iterateTenantsInBatches,
  type BatchPassResult
} from "../../../lib/jobs/batching";
import type { JobContext } from "../../../lib/jobs/job-runner";
import {
  DEFAULT_SUBSCRIPTION_LADDER_POLICY,
  evaluateSubscriptionTransition,
  transitionEndsEntitlement,
  type SubscriptionLadderPolicy,
  type SubscriptionSnapshot,
  type SubscriptionStatus,
  type SubscriptionTransition
} from "../domain/subscription-transition";

const IDENTITY_ACCESS_MODULE_KEY = "identity_access";

/**
 * Above this many entitlement-losing transitions in ONE run, the job applies
 * none of them.
 *
 * 25 is a judgement, and the judgement is about SHAPE rather than size: real
 * attrition arrives a few tenants at a time because billing periods are spread
 * across the month, while every failure mode that matters (a bad backfill, a
 * clock skew, a period column set wrong in bulk) arrives as a cliff. A
 * deployment large enough for 25 genuine lapses in one day is large enough to
 * raise this deliberately.
 */
export const MAX_ENTITLEMENT_LOSSES_PER_RUN = 25;

export type SubscriptionLifecycleResult = {
  tenantsChecked: number;
  transitionsApplied: number;
  entitlementLosses: number;
  /** Tenants whose loss was WITHHELD because the run tripped the bound. */
  withheldTenantIds: string[];
};

type LadderPassResult = BatchPassResult;

type SubscriptionRow = {
  id: string;
  status: SubscriptionStatus;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
};

function toSnapshot(row: SubscriptionRow): SubscriptionSnapshot {
  return {
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
    graceEndsAt: row.grace_ends_at
  };
}

/**
 * Reads one tenant's subscription and returns what the ladder says, without
 * writing anything. Split from the apply step so the bound can be computed
 * across ALL tenants before any loss is applied — a bound decided per-tenant
 * would let the first 25 through and stop the 26th, which is not a bound but a
 * partial outage.
 */
async function planTenantTransition(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  policy: SubscriptionLadderPolicy
): Promise<{
  row: SubscriptionRow;
  transition: SubscriptionTransition;
} | null> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
      SELECT id, status, current_period_end, trial_ends_at, grace_ends_at
      FROM awcms_tenant_subscriptions
      WHERE tenant_id = ${tenantId}
    `) as SubscriptionRow[];

      const row = rows[0];

      // No subscription is the normal state for every tenant until an operator
      // creates one, and it must read as "nothing to do" rather than as a lapse.
      if (!row) return null;

      const transition = evaluateSubscriptionTransition(
        now,
        toSnapshot(row),
        policy
      );

      return transition ? { row, transition } : null;
    },
    { workClass: "maintenance" }
  );
}

async function applyTenantTransition(
  sql: Bun.SQL,
  tenantId: string,
  row: SubscriptionRow,
  transition: SubscriptionTransition,
  now: Date,
  correlationId: string | undefined
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      // Re-asserting the status this row had when it was PLANNED is what makes a
      // second concurrent run harmless: the loser updates zero rows rather than
      // applying a transition computed from a state that has since moved. The
      // ladder is already idempotent by anchor date; this covers the narrower
      // window between planning and applying inside one run.
      await tx`
      UPDATE awcms_tenant_subscriptions
      SET status = ${transition.to},
          grace_ends_at = ${transition.graceEndsAt ?? row.grace_ends_at},
          updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND id = ${row.id}
        AND status = ${row.status}
    `;

      // In the TENANT's own trail, not the operator's: a customer is entitled to
      // read why their plan stopped covering something. `actorTenantUserId` is
      // null because no human did this — the same convention the business-scope
      // expiry job uses for a scheduled transition.
      await recordAuditEvent(tx, {
        tenantId,
        // Omitted rather than `null`: `RecordAuditEventInput.actorTenantUserId` is
        // `?: string`, and the writer coalesces an absent field to NULL. A
        // scheduled transition has no human actor, which is the fact the column
        // records.
        moduleKey: IDENTITY_ACCESS_MODULE_KEY,
        action: "identity_access.subscription.transitioned",
        resourceType: "tenant_subscription",
        resourceId: row.id,
        severity: transitionEndsEntitlement(transition) ? "critical" : "info",
        message: `Subscription ${row.status} -> ${transition.to}`,
        attributes: {
          fromStatus: row.status,
          toStatus: transition.to,
          reason: transition.reason,
          evaluatedAt: now.toISOString()
        },
        correlationId
      });
    },
    { workClass: "maintenance" }
  );
}

/**
 * Splits a planned run into what may be applied and what is withheld by the
 * blast-radius bound.
 *
 * PURE, and exported, because the bound is the part of this job most worth
 * testing and least worth reaching a database to test. It is also the part whose
 * failure is silent: a bound computed per-tenant instead of per-run would let
 * the first 25 losses through and stop the 26th, which is not a bound — it is a
 * partial outage with a cap on how bad it looks.
 *
 * All-or-nothing on the losses, deliberately. A run over the bound is far more
 * often a data or clock defect than genuine attrition, and applying "the first
 * 25" of a defect is applying a defect.
 */
export function partitionPlannedTransitions(
  planned: ReadonlyMap<string, { transition: SubscriptionTransition }>,
  maxLosses: number = MAX_ENTITLEMENT_LOSSES_PER_RUN
): { withheldTenantIds: string[] } {
  const lossTenantIds = [...planned.entries()]
    .filter(([, plan]) => transitionEndsEntitlement(plan.transition))
    .map(([tenantId]) => tenantId);

  return {
    withheldTenantIds: lossTenantIds.length > maxLosses ? lossTenantIds : []
  };
}

export async function runSubscriptionLifecycle(
  sql: Bun.SQL,
  ctx: JobContext,
  options?: { policy?: SubscriptionLadderPolicy; now?: Date }
): Promise<SubscriptionLifecycleResult> {
  // `JobContext` carries no clock, so the caller supplies one or we read it
  // once here — once, not per tenant, so a long run cannot have the ladder move
  // underneath it and treat two tenants by different clocks.
  const now = options?.now ?? new Date();
  const policy = options?.policy ?? DEFAULT_SUBSCRIPTION_LADDER_POLICY;

  const planned = new Map<
    string,
    { row: SubscriptionRow; transition: SubscriptionTransition }
  >();

  // Pass 1 — READ ONLY, every tenant, so the bound below sees the whole run.
  const iteration = await iterateTenantsInBatches<LadderPassResult>(
    sql,
    async (tenantId) => {
      const plan = await planTenantTransition(sql, tenantId, now, policy);

      if (plan) planned.set(tenantId, plan);

      // Always zero: one subscription per tenant means there is never a backlog
      // to drain, so a non-zero count would make `runBoundedBatches` loop
      // re-reading the same row until it hit the pass limit.
      return { count: 0 };
    },
    { signal: ctx.signal }
  );

  const partition = partitionPlannedTransitions(planned);

  let transitionsApplied = 0;
  let entitlementLosses = 0;

  // Pass 2 — apply.
  for (const [tenantId, plan] of planned) {
    if (ctx.signal?.aborted) break;

    if (partition.withheldTenantIds.includes(tenantId)) continue;

    const isLoss = transitionEndsEntitlement(plan.transition);

    if (ctx.dryRun) {
      transitionsApplied += 1;
      if (isLoss) entitlementLosses += 1;
      continue;
    }

    await applyTenantTransition(
      sql,
      tenantId,
      plan.row,
      plan.transition,
      now,
      ctx.correlationId
    );

    transitionsApplied += 1;
    if (isLoss) entitlementLosses += 1;
  }

  return {
    tenantsChecked: iteration.tenants.length,
    transitionsApplied,
    entitlementLosses,
    withheldTenantIds: partition.withheldTenantIds
  };
}
