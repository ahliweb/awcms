/**
 * Concrete adapter for `WorkflowNotificationPort` (ADR-0011) — owned by
 * `email`, the module that actually implements notification delivery.
 * Wraps the existing `enqueueAnnouncement` (Issue #497) unchanged: this
 * adapter adds no new provider integration, it only targets `workflow`'s
 * recipients through the announcement mechanism that already exists.
 *
 * Only a composition root (a `src/pages/api/v1/workflows/**` route, or
 * `scripts/workflow-escalations-dispatch.ts`) may import this file —
 * never `workflow-approval/application/**`/`domain/**`.
 *
 * ## NOTHING IMPORTS IT TODAY (finding D15)
 *
 * Zero importers, and the two composition roots that would inject it carried a
 * comment saying the `email` module "has not been ported yet" — so the adapter
 * and the comment were each other's alibi, and `notify` nodes silently did
 * nothing while every file involved appeared to explain why.
 *
 * The comments are corrected; the injection is deliberately still not done.
 * Nothing can reach the path: `startWorkflowInstance` has no caller and no
 * route creates a workflow instance, so no task exists to decide on. This file
 * is kept rather than deleted because it is the correct wiring for the change
 * that gives instance creation a caller — at which point injecting it, and
 * testing that a `notify` node actually enqueues, belong together.
 */
import { enqueueAnnouncement } from "./announcement-directory";
import type {
  WorkflowNotificationPort,
  WorkflowNotificationRequest
} from "../../_shared/ports/workflow-notification-port";

export function createEmailWorkflowNotificationAdapter(): WorkflowNotificationPort {
  return {
    async enqueueNotification(
      tx: Bun.SQL,
      request: WorkflowNotificationRequest
    ): Promise<void> {
      await enqueueAnnouncement(
        tx,
        request.tenantId,
        request.templateKey,
        request.variables,
        { type: "users", userIds: request.recipientTenantUserIds },
        request.correlationId ?? crypto.randomUUID()
      );
    }
  };
}
