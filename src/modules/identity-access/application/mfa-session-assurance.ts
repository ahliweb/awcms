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
  currentCredentialEpoch,
  sessionCredentialCurrent
} from "./session-credential-epoch";
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
    SELECT s.id, s.identity_id, s.assurance_level, s.stepped_up_at,
           s.expires_at, s.revoked_at
    FROM awcms_sessions s
    WHERE s.tenant_id = ${tenantId} AND s.token_hash = ${tokenHash}
      AND ${sessionCredentialCurrent(tx)}
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
/**
 * The five values `awcms_sessions.origin_auth` may hold, matching `sql/117`'s
 * CHECK exactly. `switch` is ADR-0088 and is produced by exactly one caller:
 * `POST /api/v1/auth/session/switch`, which refuses every value in
 * {@link NON_SWITCHABLE_ORIGIN_AUTH} — so a `switch` session is password-rooted
 * by construction. `delegated` is ADR-0090.
 */
export type SessionOriginAuth =
  "password" | "sso" | "handoff" | "switch" | "delegated";

/**
 * Sessions that may NOT move to another tenant, and the one place that answers
 * it — `switch.ts` used to spell the list inline, which is fine for two values
 * and quietly wrong the moment a third arrives somewhere else.
 *
 * What makes a switch safe is that the session's root is a GLOBAL credential no
 * single tenant can issue. Each value here fails that test in its own way:
 *
 * - `sso` — tenant B's IdP administrator can assert `alice@corp.com`, an address
 *   their own IdP is entitled to claim. Allowing the switch turns that into a
 *   session in tenant A, where Alice actually works: a complete cross-tenant
 *   takeover in which no single step breaks a rule (ADR-0088).
 * - `handoff` — a BFF code minted under one tenant's authority (ADR-0050).
 * - `delegated` — a session that exists because tenant C granted access to a
 *   partner (ADR-0090). A grant FOR tenant C that can be walked into tenant D is
 *   not a grant; it is an entry point.
 */
export const NON_SWITCHABLE_ORIGIN_AUTH: readonly SessionOriginAuth[] = [
  "sso",
  "handoff",
  "delegated"
];

/**
 * How a session came to exist, plus what it looked like when it did
 * (`sql/100`).
 *
 * Passed in rather than derived here: `summarizeUserAgent` needs the `Request`,
 * which this application-layer function does not have and should not acquire —
 * handing an HTTP object to a function that already takes a transaction would
 * make it a route in everything but name.
 *
 * `originAuth` has no default. Every caller mints a session for a REASON, and a
 * default would quietly stamp the most common one onto whichever issuer forgot
 * to say — which is exactly the field somebody will later use to reason about
 * blast radius.
 */
export type SessionIssueContext = {
  originAuth: SessionOriginAuth;
  clientIpHash?: string | null;
  userAgentSummary?: string | null;
};

export async function createSessionWithAssurance(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    identityId: string;
    assuranceLevel: SessionAssuranceLevel;
    ttlMin: number;
    now: Date;
    issue: SessionIssueContext;
  }
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(input.now.getTime() + input.ttlMin * 60_000);
  const steppedUpAt = input.assuranceLevel === "aal2" ? input.now : null;

  await tx`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at,
       assurance_level, last_authenticated_at, stepped_up_at,
       client_ip_hash, user_agent_summary, origin_auth, credential_epoch)
    VALUES (
      ${input.tenantId}, ${input.identityId}, ${tokenHash}, ${expiresAt},
      ${input.assuranceLevel}, ${input.now}, ${steppedUpAt},
      ${input.issue.clientIpHash ?? null}, ${input.issue.userAgentSummary ?? null},
      ${input.issue.originAuth},
      ${currentCredentialEpoch(tx, input.tenantId, input.identityId)}
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

    // The rotated session CARRIES the original row's issue context forward.
    // A step-up raises assurance; it does not re-authenticate, so stamping it
    // `password` here would rewrite an SSO session's provenance at the moment
    // somebody proves a second factor — the one moment the record matters most.
    const origin = (await tx`
      SELECT client_ip_hash, user_agent_summary, origin_auth
      FROM awcms_sessions WHERE id = ${input.session.sessionId}
    `) as {
      client_ip_hash: string | null;
      user_agent_summary: string | null;
      origin_auth: SessionOriginAuth;
    }[];

    const created = await createSessionWithAssurance(tx, {
      tenantId: input.tenantId,
      identityId: input.session.identityId,
      assuranceLevel: "aal2",
      ttlMin: input.ttlMin,
      now: input.now,
      issue: {
        originAuth: origin[0]?.origin_auth ?? "password",
        clientIpHash: origin[0]?.client_ip_hash ?? null,
        userAgentSummary: origin[0]?.user_agent_summary ?? null
      }
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
