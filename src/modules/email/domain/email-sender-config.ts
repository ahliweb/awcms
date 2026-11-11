/**
 * Tenant-sender configuration of `email` (Issue #1160, ADR-0151 section 2).
 * Pure, like `email-config.ts`. A SEPARATE file on purpose: the enqueue path
 * (reached by many jobs through the auth and workflow notification ports) must
 * not import a file that names the deployment's Mailketing credential variable,
 * or every one of those jobs would be granted it
 * (`tests/jobs-env-scoped-reach.test.ts`). `email-config.ts` re-exports these.
 */

/**
 * The deployment switch for tenant-owned Mailketing senders. OFF unless exactly
 * `"true"` (ADR-0151 "nothing changes for any deployment until ... an account is
 * configured"): with it off an explicit sender is refused at enqueue, the
 * default-sender policy is neither consulted nor settable, and the dispatcher
 * claims no tenant-sender row (they wait, untouched). The deployment sender
 * (`sender_account_id` NULL) is unaffected either way.
 */
export function isEmailSenderRoutingEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.EMAIL_SENDER_ROUTING_ENABLED?.trim() === "true";
}

export const DEFAULT_EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES = 360;
export const DEFAULT_EMAIL_MAILKETING_CREDIT_FLOOR = 100;
export const DEFAULT_EMAIL_SENDER_RATE_PER_HOUR = 300;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** A sender's verification or its account's credit older than this is STALE, and a stale fact holds the send (never assumed fine). */
export function resolveEmailSenderHealthMaxAgeMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  return (
    positiveInteger(
      env.EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES,
      DEFAULT_EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES
    ) * 60_000
  );
}

/** Below this reported Mailketing credit balance every sender of the account is held (ADR-0151 section 6). `0` holds only on an unknown balance. */
export function resolveEmailMailketingCreditFloor(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.EMAIL_MAILKETING_CREDIT_FLOOR;
  const value = Number(raw);

  return raw !== undefined &&
    raw.trim() !== "" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : DEFAULT_EMAIL_MAILKETING_CREDIT_FLOOR;
}

/** Timeout of one read-only account probe; the same `EMAIL_SEND_TIMEOUT_MS` the sender uses (default 10s). */
export function resolveEmailSenderProbeTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  return positiveInteger(env.EMAIL_SEND_TIMEOUT_MS, 10_000);
}

/** The local cap on what ONE tenant sender may send per trailing hour (ADR-0151 M9: cap outgoing traffic locally). */
export function resolveEmailSenderRatePerHour(
  env: NodeJS.ProcessEnv = process.env
): number {
  return positiveInteger(
    env.EMAIL_SENDER_RATE_PER_HOUR,
    DEFAULT_EMAIL_SENDER_RATE_PER_HOUR
  );
}
