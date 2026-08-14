/**
 * Deployment configuration for the invitation surface (ADR-0082, Gelombang 4
 * of Issue #423).
 *
 * A shared resolver rather than three module-scope `Number(process.env…)`
 * constants per route, because five call sites read the same values and an
 * invitation issued with one TTL and resent with another would produce two
 * links whose expiry the admin cannot predict. `config:env:coverage:check`
 * requires the literal `process.env.NAME` spelling, which is why each is
 * written out rather than looked up through a loop.
 *
 * There is deliberately NO feature switch. `AUTH_SELF_REGISTRATION_ENABLED`
 * exists because self-registration is a PUBLIC endpoint that writes rows for
 * anonymous callers — a spam surface every deployment would inherit. An
 * invitation is the opposite direction: it can only be issued by someone
 * already holding `identity_access.invitations.create`, so there is nothing for
 * a deployment-level switch to protect. Adding one would be a new decision, not
 * a copy of that one.
 */
import { resolveDeclaredBaseUrl } from "../http/site-origin";

/** Hours a fresh or resent invitation link stays valid. Days, not minutes: unlike a password reset, nobody is standing at the screen waiting for it. */
export const DEFAULT_INVITATION_TTL_HOURS = 168;

export type InvitationConfig = {
  tokenTtlHours: number;
  invitationUrlBase: string;
};

export function resolveInvitationConfig(
  env: NodeJS.ProcessEnv = process.env
): InvitationConfig {
  const raw = Number(
    env.AUTH_INVITATION_TOKEN_TTL_HOURS ?? DEFAULT_INVITATION_TTL_HOURS
  );

  // A non-numeric, zero, or negative value falls back to the default rather
  // than producing `NaN`, which would make `now + NaN` an Invalid Date and the
  // INSERT fail on a column the operator never touched. Same posture as
  // `resolveLoginPolicyConfig`'s threshold parsing.
  const tokenTtlHours =
    Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INVITATION_TTL_HOURS;

  const appUrl = resolveDeclaredBaseUrl(env);

  return {
    tokenTtlHours,
    invitationUrlBase: `${appUrl}/accept-invitation`
  };
}

/** Attempts per `(source, tenant)` window on each public invitation endpoint. */
export function resolveInvitationRateLimit(
  env: NodeJS.ProcessEnv = process.env
): { maxAttempts: number; windowMs: number } {
  const maxAttempts = Number(env.AUTH_INVITATION_RATE_LIMIT_MAX ?? 5);
  const windowSec = Number(env.AUTH_INVITATION_RATE_LIMIT_WINDOW_SEC ?? 900);

  return {
    maxAttempts:
      Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5,
    windowMs:
      (Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 900) * 1000
  };
}
