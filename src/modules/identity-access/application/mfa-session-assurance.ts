/**
 * Session assurance level (aal1/aal2) and step-up gate (Issue #184). New in
 * this base — awcms-mini models neither. Built on top of the existing opaque
 * `awcms_sessions` table (columns added in sql/024), so the session model is
 * unchanged: a session is still an opaque token, now additionally carrying an
 * assurance level and a server-controlled step-up freshness stamp.
 *
 * Anti-fixation: a session that RISES from aal1 to aal2 is rotated (a brand-new
 * token; the old session is revoked). A refresh of an already-aal2 session's
 * step-up stamp does not rotate — no privilege rise occurs.
 */
import type { AstroCookies } from "astro";

import { fail } from "../../_shared/api-response";
import {
  generateSessionToken,
  hashSessionToken
} from "../../../lib/auth/session-token";
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME
} from "../../../lib/auth/ssr-session";
import { resolveStepUpTtlSec } from "../../../lib/auth/mfa-config";
import {
  evaluateStepUp,
  type SessionAssuranceLevel
} from "../domain/mfa-policy";

export type SessionAssurance = {
  sessionId: string;
  identityId: string;
  assuranceLevel: SessionAssuranceLevel;
  steppedUpAt: Date | null;
  expiresAt: Date;
};

/** Resolves the active session with its assurance columns, or null if invalid/expired/revoked. */
export async function resolveSessionAssurance(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<SessionAssurance | null> {
  const rows = (await tx`
    SELECT id, identity_id, assurance_level, stepped_up_at, expires_at, revoked_at
    FROM awcms_sessions
    WHERE tenant_id = ${tenantId} AND token_hash = ${tokenHash}
  `) as {
    id: string;
    identity_id: string;
    assurance_level: SessionAssuranceLevel;
    stepped_up_at: Date | null;
    expires_at: Date;
    revoked_at: Date | null;
  }[];
  const row = rows[0];

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) return null;

  return {
    sessionId: row.id,
    identityId: row.identity_id,
    assuranceLevel: row.assurance_level,
    steppedUpAt: row.stepped_up_at ? new Date(row.stepped_up_at) : null,
    expiresAt: new Date(row.expires_at)
  };
}

/**
 * Inserts a new session at the given assurance level. For `aal2`, the
 * step-up/last-auth stamps are set to `now`. Returns the raw token (caller sets
 * cookies). This is how the login MFA challenge completion mints its session.
 */
export async function createSessionWithAssurance(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    identityId: string;
    assuranceLevel: SessionAssuranceLevel;
    ttlMin: number;
    now: Date;
  }
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(input.now.getTime() + input.ttlMin * 60_000);
  const steppedUpAt = input.assuranceLevel === "aal2" ? input.now : null;

  await tx`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at,
       assurance_level, last_authenticated_at, stepped_up_at)
    VALUES (
      ${input.tenantId}, ${input.identityId}, ${tokenHash}, ${expiresAt},
      ${input.assuranceLevel}, ${input.now}, ${steppedUpAt}
    )
  `;

  return { token, expiresAt };
}

/**
 * Raises a session to aal2. If the current session is aal1 (a privilege rise),
 * the old session is revoked and a fresh aal2 session is minted (anti-fixation)
 * — returns the new token. If the session is already aal2, only the step-up
 * stamp is refreshed in place — returns `rotated: false`, no new token.
 */
export async function stepUpSession(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    session: SessionAssurance;
    ttlMin: number;
    now: Date;
  }
): Promise<
  | { rotated: true; token: string; expiresAt: Date }
  | { rotated: false; expiresAt: Date }
> {
  if (input.session.assuranceLevel === "aal1") {
    await tx`
      UPDATE awcms_sessions SET revoked_at = ${input.now}
      WHERE id = ${input.session.sessionId} AND revoked_at IS NULL
    `;

    const created = await createSessionWithAssurance(tx, {
      tenantId: input.tenantId,
      identityId: input.session.identityId,
      assuranceLevel: "aal2",
      ttlMin: input.ttlMin,
      now: input.now
    });

    return {
      rotated: true,
      token: created.token,
      expiresAt: created.expiresAt
    };
  }

  await tx`
    UPDATE awcms_sessions
    SET stepped_up_at = ${input.now}, last_authenticated_at = ${input.now}
    WHERE id = ${input.session.sessionId}
  `;

  return { rotated: false, expiresAt: input.session.expiresAt };
}

export type StepUpGateResult =
  { ok: true; session: SessionAssurance } | { ok: false; denied: Response };

/**
 * The reusable step-up gate for high-risk actions. Call AFTER
 * `authorizeInTransaction` has confirmed the RBAC/ABAC permission: authorization
 * answers "may this role do this?", step-up answers "has this session recently
 * re-proven a second factor?". Returns a ready-to-return `403 STEP_UP_REQUIRED`
 * when the session is not currently stepped up (missing aal2 or a stale
 * step-up), so the caller does the action only on `ok: true`.
 *
 * `ttlSec` defaults to the server-controlled `AUTH_MFA_STEPUP_TTL_SEC` — never a
 * client flag.
 */
export async function requireStepUp(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  ttlSec: number = resolveStepUpTtlSec()
): Promise<StepUpGateResult> {
  const session = await resolveSessionAssurance(tx, tenantId, tokenHash, now);

  if (!session) {
    return {
      ok: false,
      denied: fail(401, "AUTH_REQUIRED", "Session is invalid or expired.")
    };
  }

  const evaluation = evaluateStepUp(
    {
      assuranceLevel: session.assuranceLevel,
      steppedUpAt: session.steppedUpAt
    },
    now,
    ttlSec
  );

  if (!evaluation.satisfied) {
    return {
      ok: false,
      denied: fail(
        403,
        "STEP_UP_REQUIRED",
        "This action requires recent multi-factor verification. Complete a step-up and retry."
      )
    };
  }

  return { ok: true, session };
}

/** Sets the auth cookies for a freshly rotated session (same options as login). */
export function setSessionCookies(
  cookies: AstroCookies,
  tenantId: string,
  token: string,
  ttlMin: number
): void {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: ttlMin * 60,
    secure: process.env.AUTH_COOKIE_SECURE === "true"
  };
  cookies.set(SESSION_COOKIE_NAME, token, cookieOptions);
  cookies.set(TENANT_COOKIE_NAME, tenantId, cookieOptions);
}
