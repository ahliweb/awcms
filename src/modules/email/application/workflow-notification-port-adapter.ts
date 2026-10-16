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
 * ## Who imports it (finding D15, then #1044)
 *
 * For a long time nobody did, and the comments claimed the `email` module "has
 * not been ported yet" — the adapter and the comment were each other's alibi.
 * The workflow `notify` node still does not inject it. The first real caller is
 * `hr_workforce`'s attendance-correction settler (#1044), which tells the
 * requester the outcome through it (a lazy import from its `module.ts`
 * consumer, declared as an optional `workflow_notification` capability).
 *
 * ## Locale
 *
 * The subject is rendered here, at enqueue, and the dispatcher keeps the stored
 * subject. So it is rendered in the TENANT's default locale (the same one the
 * dispatcher renders the body in), not a fixed "en": an Indonesian tenant gets
 * an Indonesian subject over an Indonesian body.
 */
import { enqueueAnnouncement } from "./announcement-directory";
import type {
  WorkflowNotificationPort,
  WorkflowNotificationRequest
} from "../../_shared/ports/workflow-notification-port";

const DEFAULT_RENDER_LOCALE = "en";

export function createEmailWorkflowNotificationAdapter(): WorkflowNotificationPort {
  return {
    async enqueueNotification(
      tx: Bun.SQL,
      request: WorkflowNotificationRequest
    ): Promise<void> {
      // `awcms_tenants` has no RLS (the root table), as in `email-dispatch.ts`.
      const locales = (await tx`
        SELECT default_locale FROM awcms_tenants WHERE id = ${request.tenantId}
      `) as { default_locale: string }[];

      await enqueueAnnouncement(
        tx,
        request.tenantId,
        request.templateKey,
        request.variables,
        { type: "users", userIds: request.recipientTenantUserIds },
        request.correlationId ?? crypto.randomUUID(),
        locales[0]?.default_locale ?? DEFAULT_RENDER_LOCALE
      );
    }
  };
}
