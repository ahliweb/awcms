/**
 * Capability port (ADR-0011) — lets `workflow-approval`'s `notify` graph
 * node fire a real notification without importing `email`'s
 * `application`/`domain` tree directly. Zero imports from any module (the
 * ADR-0011 rule for every file in this directory) — a pure TypeScript
 * interface only.
 *
 * The concrete adapter lives in the OWNING module
 * (`src/modules/email/application/workflow-notification-port-adapter.ts`).
 * Only composition roots (the workflow decision/start API routes, the
 * escalation job script) import that adapter and inject it — never
 * `workflow-approval/application/**`.
 *
 * `enqueueNotification` must be a plain DB write (an INSERT into an
 * outbox-shaped table), safe to call inside the SAME transaction as the
 * workflow state change that triggered it (AGENTS.md rule #11: provider
 * calls never run inside a DB transaction) — the email adapter satisfies
 * this by calling `email`'s existing `enqueueAnnouncement`, which only
 * enqueues; the email dispatcher sends later, outside any transaction,
 * exactly like every other provider-backed outbox in this repo.
 */

export type WorkflowNotificationRequest = {
  tenantId: string;
  templateKey: string;
  recipientTenantUserIds: string[];
  variables: Record<string, string>;
  correlationId?: string;
};

/**
 * What `enqueueNotification` did (contract 1.1.0, additive; Issue #1165 audit
 * LOW-5): `queued` is the number of outbox rows written. `0` means nothing was
 * queued (no active template for the tenant, or no reachable recipient), so a
 * caller that tracks delivery (crm_follow_up) must not record it as sent.
 * Callers written against 1.0.0 ignore the value and are unaffected.
 */
export type WorkflowNotificationOutcome = { queued: number };

export type WorkflowNotificationPort = {
  /**
   * Enqueues (never sends synchronously) a notification for the given
   * recipients. Must silently no-op (never throw) when the template does
   * not exist for the tenant — a missing notification template must never
   * block workflow progress (the `notify` node always advances to `next`
   * regardless of whether anything was actually enqueued).
   */
  enqueueNotification(
    tx: Bun.SQL,
    request: WorkflowNotificationRequest
  ): Promise<WorkflowNotificationOutcome>;
};
