/**
 * Capability port (ADR-0011) — lets `identity_access` deliver an
 * authentication email (today: the password-reset link) without importing
 * `email`'s `application`/`domain` tree. Zero imports from any module (the
 * ADR-0011 rule for every file in this directory) — a pure TypeScript interface
 * only.
 *
 * The concrete adapter lives in the OWNING module
 * (`src/modules/email/application/auth-notification-port-adapter.ts`). Only
 * composition roots (`src/pages/api/v1/auth/password/*.ts`) import that adapter
 * and inject it — never `identity-access/application/**`.
 *
 * ## Why a port and not an INSERT
 *
 * `awcms_email_messages` is `email`'s table. A module never writes into another
 * module's tables (ADR-0013 §6) — awcms-micro's original password-reset service
 * did exactly that, and this port is the adaptation. It also means a deployment
 * that swaps the delivery mechanism changes one adapter, not the auth flow.
 *
 * ## Enqueue only, never send
 *
 * `enqueueAuthNotification` must be a plain DB write into an outbox-shaped
 * table, safe to call inside the SAME transaction as the reset-token INSERT
 * that triggered it (AGENTS.md rule #11: provider calls never run inside a DB
 * transaction). The email adapter satisfies this by delegating to `email`'s
 * `enqueueAnnouncement`, which only enqueues; the dispatcher sends later,
 * outside any transaction.
 *
 * ## `enqueued: false` is a real answer, not an error
 *
 * Unlike `WorkflowNotificationPort` — whose contract is "silently no-op" —
 * this port REPORTS non-delivery, because the caller audits it: a tenant whose
 * `auth.password_reset` template was never seeded, or whose address is on the
 * suppression list, produces a reset request that no user will ever receive,
 * and an operator has to be able to see that in the audit trail. The HTTP
 * response stays generic either way (account-enumeration safety does not care
 * which of the two happened).
 */

export type AuthNotificationRequest = {
  tenantId: string;
  templateKey: string;
  /** Exactly one recipient — an auth email is always addressed to one account. */
  recipientTenantUserId: string;
  variables: Record<string, string>;
  correlationId?: string;
};

/**
 * An auth email addressed to a raw ADDRESS rather than to an account
 * (Gelombang 4 of Issue #423, ADR-0082 — the invitation).
 *
 * A second operation, not a nullable `recipientTenantUserId` on the first. The
 * whole point of an invitation is that its recipient has no membership row yet,
 * so the account-shaped request above cannot express it — and making that field
 * optional would leave every existing caller one typo away from enqueueing a
 * message with nobody to deliver it to, which is a runtime discovery rather
 * than a compile-time one.
 *
 * `variables` carries the recipient's name explicitly, because there is no
 * profile to read one from: the only name this system holds for an invitee is
 * the one the inviter typed.
 */
export type AuthAddressNotificationRequest = {
  tenantId: string;
  templateKey: string;
  /** The address itself. Normalized for hashing/suppression by the adapter, never by the caller. */
  recipientAddress: string;
  variables: Record<string, string>;
  correlationId?: string;
};

export type AuthNotificationResult = {
  /** `false` when nothing was queued (no active template for the tenant, or the recipient address is suppressed). */
  enqueued: boolean;
};

export type AuthNotificationPort = {
  enqueueAuthNotification(
    tx: Bun.SQL,
    request: AuthNotificationRequest
  ): Promise<AuthNotificationResult>;
  enqueueAuthAddressNotification(
    tx: Bun.SQL,
    request: AuthAddressNotificationRequest
  ): Promise<AuthNotificationResult>;
};
