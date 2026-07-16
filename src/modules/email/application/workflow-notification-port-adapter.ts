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
