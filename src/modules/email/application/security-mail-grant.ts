/**
 * Who may enqueue SECURITY mail (Issue #1161 audit H-1 of PR #1272).
 *
 * A `security` purpose is not held back by an `unsubscribed` or a
 * provider-reported suppression (ADR-0151 section 4). That exemption is only
 * safe if a `security` message is one the SYSTEM decided to send (a password
 * reset, an invitation, a security notice), never one a caller composed. The
 * purpose follows from the template category, and a template category is
 * something a request body can name, so the category alone cannot be the
 * authority.
 *
 * Two layers:
 *
 * 1. The routes that take a `templateKey` from a request
 *    (`/api/v1/email/announcements`, `.../preview`) refuse every security
 *    category with `422 TEMPLATE_CATEGORY_RESERVED`.
 * 2. Defence in depth: `enqueueAnnouncement` and `enqueueDirectAddressEmail`
 *    refuse a security category unless the caller presents this grant. It is
 *    held by the internal ports that send security mail
 *    (`auth-notification-port-adapter.ts`), and `tests/email-mailketing-webhook.test.ts`
 *    pins which source files may import it.
 */
export const SECURITY_MAIL_GRANT: unique symbol = Symbol(
  "awcms.email.security-mail-grant"
);

export type SecurityMailGrant = typeof SECURITY_MAIL_GRANT;

/** Thrown when security mail is enqueued without the grant. */
export class SecurityMailNotPermittedError extends Error {
  constructor() {
    super(
      "security mail (auth.* / system.security_notice) may only be enqueued by an internal security port"
    );
    this.name = "SecurityMailNotPermittedError";
  }
}

/** Throws unless a `security` purpose comes with the grant. */
export function assertSecurityMailPermitted(
  purpose: "transactional" | "security",
  grant: SecurityMailGrant | undefined
): void {
  if (purpose === "security" && grant !== SECURITY_MAIL_GRANT) {
    throw new SecurityMailNotPermittedError();
  }
}
