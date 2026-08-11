/**
 * Concrete adapter for `AuthNotificationPort` (ADR-0011) — owned by `email`,
 * the module that actually implements delivery. Same shape as
 * `workflow-notification-port-adapter.ts`: it wraps the existing
 * `enqueueAnnouncement` unchanged and adds no new provider integration.
 *
 * Only a composition root (`src/pages/api/v1/auth/password/forgot.ts`) may
 * import this file — never `identity-access/application/**`.
 *
 * Two details that are NOT incidental:
 *
 * - `enqueueAnnouncement` returns `null` when the tenant has no ACTIVE template
 *   for the key, and an empty recipient list when the address is suppressed or
 *   the tenant user is inactive. Both collapse to `enqueued: false` here, which
 *   the caller audits — see the port's own doc comment.
 * - `userName` is deliberately NOT passed in `variables`:
 *   `enqueueAnnouncement` sets it per recipient from the profile's display
 *   name, and passing one here would be overwritten anyway. The
 *   `auth.password_reset` template's declared variables (`email-template-categories.ts`)
 *   are therefore satisfied by `resetUrl` + `expiresInMinutes` from the caller
 *   plus `userName` from the resolver.
 */
import { enqueueAnnouncement } from "./announcement-directory";
import { enqueueDirectAddressEmail } from "./direct-address-notification";
import type {
  AuthAddressNotificationRequest,
  AuthNotificationPort,
  AuthNotificationRequest,
  AuthNotificationResult
} from "../../_shared/ports/auth-notification-port";

export function createEmailAuthNotificationAdapter(): AuthNotificationPort {
  return {
    async enqueueAuthNotification(
      tx: Bun.SQL,
      request: AuthNotificationRequest
    ): Promise<AuthNotificationResult> {
      const result = await enqueueAnnouncement(
        tx,
        request.tenantId,
        request.templateKey,
        request.variables,
        { type: "users", userIds: [request.recipientTenantUserId] },
        request.correlationId ?? crypto.randomUUID()
      );

      return { enqueued: (result?.recipientCount ?? 0) > 0 };
    },

    /**
     * Delegates to `enqueueDirectAddressEmail` rather than `enqueueAnnouncement`
     * — the latter resolves recipients through `awcms_tenant_users` and would
     * return an empty list for every invitee, which is exactly the account
     * assumption this operation exists to escape. Still enqueue-only: the
     * dispatcher sends later, outside any transaction (ADR-0006).
     */
    async enqueueAuthAddressNotification(
      tx: Bun.SQL,
      request: AuthAddressNotificationRequest
    ): Promise<AuthNotificationResult> {
      return enqueueDirectAddressEmail(
        tx,
        request.tenantId,
        request.templateKey,
        request.recipientAddress,
        request.variables,
        request.correlationId ?? crypto.randomUUID()
      );
    }
  };
}
