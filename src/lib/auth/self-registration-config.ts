/**
 * Deployment gate for public self-registration (Wave 2 delta auth).
 *
 * OFF unless `AUTH_SELF_REGISTRATION_ENABLED=true`, and that default is the
 * whole point: an always-on public endpoint that writes a row is a spam surface
 * every deployment would inherit whether or not it wants applicants. When the
 * switch is off, `POST /api/v1/auth/register` answers `404` and `/register`
 * renders a "not available" page — the same shape as a route that does not
 * exist, so the switch itself is not discoverable.
 *
 * Deployment-level, matching `AUTH_MFA_ENABLED` and `AUTH_SSO_ENABLED` rather
 * than being a per-tenant setting. That is a real limitation on a multi-tenant
 * deployment — turning it on opens registration for EVERY tenant — and it is
 * recorded as a follow-up in `identity-access/README.md` rather than papered
 * over. It is the conservative direction: the default is closed, and an
 * operator who flips it is making one explicit decision about one deployment.
 */
export function isSelfRegistrationEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.AUTH_SELF_REGISTRATION_ENABLED === "true";
}
