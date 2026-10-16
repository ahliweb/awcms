/**
 * Automatic settlement of an attendance correction (#998, ADR-0132).
 *
 * The approval workflow DECIDES; `settleCorrection` materialises the verdict.
 * Until now that second step was a manual pull (`POST .../settle`), so an
 * approved correction sat `pending` until somebody with `corrections.approve`
 * remembered to call it, and nobody was told. This is the consumer that closes
 * the gap: `workflow_approval` publishes `awcms.workflow.instance.approved` /
 * `.rejected` / `.cancelled` in the SAME transaction that finishes the instance
 * (every path: a decision, a force-decision, an administrator's cancel, an
 * escalation timeout), and `hr_workforce` declares a consumer of them
 * (`module.ts`, ADR-0134). The dispatcher (`bun run domain-events:dispatch`)
 * calls this inside a tenant-scoped transaction.
 *
 * ## It reuses `settleCorrection`, it does not reimplement it
 *
 * Every rule stays where it was: the segregation-of-duties checks in
 * `settleCorrection`, and the database guard (`sql/198`) that re-reads the
 * workflow's own decision rows. There is no acting user (the workflow is the
 * actor), so the audit row carries none and says `trigger = workflow_event`;
 * `decided_by` is the human who approved or rejected, exactly as for a manual
 * settle.
 *
 * ## What it leaves for a person
 *
 * A refusal is NOT an error and is NOT retried (a retry would be refused again
 * and dead-letter a delivery that did exactly what it should): the correction
 * stays `pending`, one `warning` audit row names the outcome, and the manual
 * route remains. That covers an approval with no human approver, one the
 * requester or the employee took part in, a superseded target and an event the
 * guard refuses. A rejection or cancellation nobody is named for IS settled,
 * with `decided_by` NULL (it names who decided, never who settled).
 *
 * ## The requester is told (#1044)
 *
 * After a successful settlement the consumer queues one e-mail to the
 * requester through the `workflow_notification` port (`hr-attendance-notice.ts`):
 * outbox only, in a savepoint, never the reason. See that file.
 *
 * Anything that is NOT a refusal (a database outage, a deadlock) throws, so the
 * delivery rolls back, is retried with backoff and ends in the dead-letter
 * queue where an administrator can replay it.
 */
import type { WorkflowNotificationPort } from "../../_shared/ports/workflow-notification-port";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { HR_WORKFORCE_MODULE_KEY } from "../domain/hr-workforce-permissions";
import { settleCorrection } from "./hr-attendance-directory";
import { notifyRequesterOfSettlement } from "./hr-attendance-notice";

export type AutoSettleResult =
  | { outcome: "not_ours" }
  | { outcome: "settled"; status: string }
  | { outcome: "already_settled" }
  | { outcome: "still_pending" }
  | { outcome: "left_pending"; reason: string };

/**
 * Settle the correction whose approval instance is `workflowInstanceId`, if any.
 * Safe to call for any workflow instance: one that is not an attendance
 * correction's matches no row and does nothing.
 */
export async function settleCorrectionForInstance(
  tx: Bun.TransactionSQL,
  tenantId: string,
  workflowInstanceId: string,
  correlationId: string | undefined,
  now: Date,
  notifier?: WorkflowNotificationPort
): Promise<AutoSettleResult> {
  const rows = (await tx`
    SELECT id, status FROM awcms_hr_attendance_corrections
    WHERE tenant_id = ${tenantId} AND workflow_instance_id = ${workflowInstanceId}
  `) as { id: string; status: string }[];
  const correction = rows[0];

  if (!correction) {
    return { outcome: "not_ours" };
  }

  if (correction.status !== "pending") {
    return { outcome: "already_settled" };
  }

  const result = await settleCorrection(
    tx,
    tenantId,
    correction.id,
    { actorTenantUserId: null, correlationId },
    now
  );

  switch (result.outcome) {
    case "ok":
      // #1044: tell the requester, through the e-mail outbox (never a provider
      // call, never able to fail the settlement). Only the transition that just
      // happened notifies; `already_settled` above never gets here.
      if (notifier) {
        await notifyRequesterOfSettlement(
          tx,
          tenantId,
          correction.id,
          result.correction.status,
          notifier
        );
      }

      return { outcome: "settled", status: result.correction.status };
    case "not_found":
    case "not_pending":
      return { outcome: "already_settled" };
    case "still_pending":
      // The instance has not finished (an event for a stale or spoofed
      // aggregate id): nothing to apply and nothing to warn about.
      return { outcome: "still_pending" };
    default: {
      const reason =
        result.outcome === "apply_refused"
          ? `apply_refused:${result.reason}`
          : result.outcome;

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: HR_WORKFORCE_MODULE_KEY,
        action: "hr_workforce.attendance_correction.auto_settle_skipped",
        resourceType: "hr_attendance_correction",
        resourceId: correction.id,
        severity: "warning",
        message:
          "The workflow finished but the attendance correction was left pending for a person to settle.",
        // Ids and the outcome only. NEVER the reason.
        attributes: { workflowInstanceId, outcome: reason },
        correlationId
      });

      return { outcome: "left_pending", reason };
    }
  }
}
