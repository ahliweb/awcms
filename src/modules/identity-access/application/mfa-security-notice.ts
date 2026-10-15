/**
 * Out-of-band notice to the account's own mailbox when a second factor is added
 * to, or removed from, it (#1004, audit finding F-3 of #977).
 *
 * The notice is what turns a silent takeover into a visible one: whoever holds
 * the password can still enrol, but the legitimate owner is told, on a channel
 * the session does not control, that an authenticator now exists. It goes
 * through the existing auth-notification port (ADR-0011) and the
 * `system.security_notice` default template; this file never sends — the email
 * module's dispatcher does, outside any transaction (ADR-0006).
 *
 * `delivered: false` is a real answer (no active template for the tenant, a
 * suppressed address, no mailable account) and the caller records it in the
 * audit event, so an operator can see enrolments nobody was told about.
 */
import type { AuthNotificationPort } from "../../_shared/ports/auth-notification-port";

export const MFA_SECURITY_NOTICE_TEMPLATE_KEY = "system.security_notice";

export type MfaChangeKind = "enrolled" | "disabled";

const DESCRIPTIONS: Record<MfaChangeKind, string> = {
  enrolled:
    "An authenticator app (TOTP two-factor authentication) was added to your account. / Aplikasi autentikator (verifikasi dua langkah TOTP) ditambahkan ke akun Anda.",
  disabled:
    "Two-factor authentication (TOTP) was turned off on your account. / Verifikasi dua langkah (TOTP) dimatikan pada akun Anda."
};

/** Expands an IPv6 literal (with `::`) to exactly eight lower-case groups, or null if malformed. */
function expandIpv6(address: string): string[] | null {
  const halves = address.split("::");

  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;

  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;

  const groups = [
    ...head,
    ...(halves.length === 2 ? Array<string>(missing).fill("0") : []),
    ...tail
  ];

  return groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))
    ? groups.map((group) => group.toLowerCase().replace(/^0+(?=.)/, ""))
    : null;
}

/**
 * Coarsens an address for a message body: the owner needs enough to recognise
 * their own network, not a full address persisted in an outbox row.
 *
 * IPv4 keeps three octets (`a.b.c.x`). An IPv4-mapped IPv6 address
 * (`::ffff:a.b.c.d`) is treated as the IPv4 it carries; any other IPv6 is
 * expanded first and then truncated to its first three groups, so `2001:db8::1`
 * and `2001:db8:0:0:0:0:0:1` produce the same answer instead of the compressed
 * form leaking a different number of groups. A zone id (`%eth0`) is dropped.
 * Anything unparseable is `unknown`, never echoed.
 */
export function maskIpForNotice(ip: string): string {
  const address = ip.trim().split("%")[0] ?? "";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const candidate = mapped ? mapped[1]! : address;

  if (candidate.includes(":")) {
    const groups = expandIpv6(candidate);

    return groups ? `${groups.slice(0, 3).join(":")}::` : "unknown";
  }

  const octets = candidate.split(".");

  return octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))
    ? `${octets.slice(0, 3).join(".")}.x`
    : "unknown";
}

export async function notifyMfaChange(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    identityId: string;
    kind: MfaChangeKind;
    notifications: AuthNotificationPort;
    occurredAt: Date;
    clientIp: string;
    correlationId?: string;
  }
): Promise<{ delivered: boolean }> {
  const rows = (await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${input.tenantId} AND identity_id = ${input.identityId}
      AND status = 'active'
  `) as { id: string }[];
  const tenantUserId = rows[0]?.id;

  if (!tenantUserId) return { delivered: false };

  const result = await input.notifications.enqueueAuthNotification(tx, {
    tenantId: input.tenantId,
    templateKey: MFA_SECURITY_NOTICE_TEMPLATE_KEY,
    recipientTenantUserId: tenantUserId,
    variables: {
      eventDescription: DESCRIPTIONS[input.kind],
      occurredAt: input.occurredAt.toISOString(),
      ipAddress: maskIpForNotice(input.clientIp)
    },
    correlationId: input.correlationId
  });

  return { delivered: result.enqueued };
}
