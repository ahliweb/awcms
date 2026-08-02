import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  decideHandoffRedemption,
  decideRedirectUri,
  generateHandoffCode,
  HANDOFF_CODE_TTL_SECONDS,
  hashBffClientSecret,
  hashHandoffCode,
  hashesEqual,
  type HandoffRejection,
  type RedirectUriRejection
} from "../domain/session-handoff";
import { createSessionWithAssurance } from "./mfa-session-assurance";
import type { SessionAssuranceLevel } from "../domain/mfa-policy";

/**
 * Data layer for the BFF session handoff (ADR-0050). Every function takes an
 * already tenant-scoped transaction (`withTenant`), same convention as the
 * other directories here.
 *
 * Two operations, two different principals:
 *
 * - {@link issueHandoffCode} runs as the HUMAN who just authenticated. It can
 *   only ever mint a code for that person's own session, which is why the route
 *   above it is self-service rather than permission-gated — inventing a
 *   permission nothing seeds would deny everyone including the owner.
 * - {@link redeemHandoffCode} runs as a registered CLIENT, server-to-server,
 *   with no session at all.
 */

export type BffClient = {
  id: string;
  clientKey: string;
  name: string;
  redirectUris: string[];
};

type BffClientRow = {
  id: string;
  client_key: string;
  name: string;
  secret_hash: string;
  redirect_uris: string[];
};

/**
 * Resolves a client by its PUBLIC key only — no secret involved. Used by the
 * issue path, where the caller is an authenticated human and the client key
 * arrives in a URL; there is nothing to authenticate the browser as the client,
 * and nothing needs to be. Binding the code to the client and its redirect_uri
 * is what constrains where it can be spent; the secret is checked when it is
 * spent.
 *
 * Disabled clients resolve to `null`: turning a client off must stop new codes
 * being issued for it immediately.
 */
export async function fetchActiveBffClientByKey(
  tx: Bun.SQL,
  tenantId: string,
  clientKey: string
): Promise<BffClient | null> {
  const rows = (await tx`
    SELECT id, client_key, name, secret_hash, redirect_uris
    FROM awcms_bff_clients
    WHERE tenant_id = ${tenantId} AND client_key = ${clientKey}
      AND disabled_at IS NULL
  `) as BffClientRow[];

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    clientKey: row.client_key,
    name: row.name,
    redirectUris: row.redirect_uris
  };
}

/**
 * Resolves a client by key AND secret, for the redeem path.
 *
 * The secret is compared in constant time against the stored hash. A wrong key
 * and a wrong secret are the same `null` to the caller: telling them apart
 * turns this into an oracle for which client keys exist.
 */
export async function authenticateBffClient(
  tx: Bun.SQL,
  tenantId: string,
  clientKey: string,
  clientSecret: string
): Promise<BffClient | null> {
  const rows = (await tx`
    SELECT id, client_key, name, secret_hash, redirect_uris
    FROM awcms_bff_clients
    WHERE tenant_id = ${tenantId} AND client_key = ${clientKey}
      AND disabled_at IS NULL
  `) as BffClientRow[];

  const row = rows[0];
  if (!row) return null;

  if (!hashesEqual(row.secret_hash, hashBffClientSecret(clientSecret))) {
    return null;
  }

  return {
    id: row.id,
    clientKey: row.client_key,
    name: row.name,
    redirectUris: row.redirect_uris
  };
}

export type IssueHandoffCodeResult =
  | { ok: true; code: string; redirectUri: string; expiresAt: Date }
  | { ok: false; reason: "unknown_client" | RedirectUriRejection };

/**
 * Mints a one-time code for the caller's OWN authenticated session.
 *
 * The `redirect_uri` is validated against the client's registered allow-list
 * BEFORE anything is written — ADR-0050 names the open redirect here as the way
 * this design fails, and a code written first and validated after is a code
 * that exists for a URI nobody approved.
 *
 * The code is bound to (client, redirect_uri, identity, assurance) at this
 * moment. Nothing credential-bearing is stored: see `sql/088`'s header for why
 * the row carries `identity_id` and an assurance level rather than a session
 * token.
 */
export async function issueHandoffCode(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    clientKey: string;
    requestedRedirectUri: string;
    identityId: string;
    sessionId: string;
    assuranceLevel: SessionAssuranceLevel;
    actorTenantUserId: string;
    now: Date;
  },
  correlationId?: string
): Promise<IssueHandoffCodeResult> {
  const client = await fetchActiveBffClientByKey(tx, tenantId, input.clientKey);

  if (!client) {
    return { ok: false, reason: "unknown_client" };
  }

  const decision = decideRedirectUri(
    input.requestedRedirectUri,
    client.redirectUris
  );

  if (!decision.allowed) {
    // Audited even though it fails: a rejected redirect_uri is either a
    // misconfigured deployment or someone probing the allow-list, and both are
    // worth a row.
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: input.actorTenantUserId,
      moduleKey: "identity_access",
      action: "auth.session_handoff.redirect_rejected",
      resourceType: "bff_client",
      resourceId: client.id,
      severity: "warning",
      message: `Handoff redirect_uri rejected: ${decision.reason}.`,
      // The REASON, never the requested URI: an attacker-supplied string
      // written verbatim into an audit row is a log-injection surface, and the
      // reason is what an operator acts on anyway.
      attributes: { clientKey: client.clientKey, reason: decision.reason },
      correlationId
    });

    return { ok: false, reason: decision.reason };
  }

  const code = generateHandoffCode();
  const expiresAt = new Date(
    input.now.getTime() + HANDOFF_CODE_TTL_SECONDS * 1000
  );

  // `created_at` is written EXPLICITLY, not left to its `now()` default.
  // `now()` is the TRANSACTION's start instant, while `expires_at` is derived
  // from `input.now` — so in a transaction that has been open for a moment the
  // two clocks disagree and the `expires_at <= created_at + 60s` CHECK rejects
  // a perfectly ordinary code. Supplying both from one clock makes the
  // constraint mean exactly what it says: this row's own lifetime is at most
  // 60 seconds.
  await tx`
    INSERT INTO awcms_session_handoff_codes
      (tenant_id, client_id, code_hash, identity_id, assurance_level,
       redirect_uri, issued_by_session_id, created_at, expires_at)
    VALUES (
      ${tenantId}, ${client.id}, ${hashHandoffCode(code)}, ${input.identityId},
      ${input.assuranceLevel}, ${decision.redirectUri}, ${input.sessionId},
      ${input.now}, ${expiresAt}
    )
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: input.actorTenantUserId,
    moduleKey: "identity_access",
    action: "auth.session_handoff.issued",
    resourceType: "bff_client",
    resourceId: client.id,
    severity: "info",
    message: `Session handoff code issued to ${client.clientKey}.`,
    // No code, no hash. An audit row that contains the credential defeats the
    // point of hashing it.
    attributes: {
      clientKey: client.clientKey,
      assuranceLevel: input.assuranceLevel
    },
    correlationId
  });

  return { ok: true, code, redirectUri: decision.redirectUri, expiresAt };
}

export type RedeemHandoffCodeResult =
  | { ok: true; token: string; expiresAt: Date; assuranceLevel: string }
  | { ok: false; reason: HandoffRejection };

/**
 * Spends a code exactly once and mints the session it stands for.
 *
 * ## The claim is a guarded UPDATE, not read-then-write
 *
 * `UPDATE … WHERE redeemed_at IS NULL RETURNING …` is this table's
 * mutual-exclusion primitive: PostgreSQL serialises concurrent `UPDATE`s
 * against the same row, so exactly one caller ever transitions a code out of
 * unredeemed and every other gets zero rows back. Reading the row, checking
 * `redeemed_at` in TypeScript, then writing it is the version that lets two
 * concurrent redemptions both succeed — the same defect class this repo already
 * fixed in the MFA lockout counter.
 *
 * The claim happens BEFORE the session is minted, so a code cannot produce two
 * sessions even if the mint itself is slow.
 *
 * ## Every failure is one `reason`, and the route collapses them
 *
 * Unknown, expired, already-spent, wrong client, wrong redirect_uri are
 * distinguished HERE, because an operator reading the audit trail needs them.
 * The route answers one generic error, because a caller that can tell "expired"
 * from "already redeemed" learns whether a code it stole was ever valid.
 */
export async function redeemHandoffCode(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    code: string;
    client: BffClient;
    redirectUri: string;
    sessionTtlMinutes: number;
    now: Date;
  },
  correlationId?: string
): Promise<RedeemHandoffCodeResult> {
  const codeHash = hashHandoffCode(input.code);

  const existing = (await tx`
    SELECT id, client_id, redirect_uri, expires_at, redeemed_at
    FROM awcms_session_handoff_codes
    WHERE tenant_id = ${tenantId} AND code_hash = ${codeHash}
  `) as {
    id: string;
    client_id: string;
    redirect_uri: string;
    expires_at: Date;
    redeemed_at: Date | null;
  }[];

  const row = existing[0];

  const decision = decideHandoffRedemption(
    row
      ? {
          expiresAt: new Date(row.expires_at),
          redeemedAt: row.redeemed_at ? new Date(row.redeemed_at) : null,
          clientId: row.client_id,
          redirectUri: row.redirect_uri
        }
      : null,
    { clientId: input.client.id, redirectUri: input.redirectUri },
    input.now
  );

  if (!decision.ok) {
    if (row) {
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "auth.session_handoff.redeem_rejected",
        resourceType: "session_handoff_code",
        resourceId: row.id,
        severity: "warning",
        message: `Handoff redemption rejected: ${decision.reason}.`,
        attributes: {
          reason: decision.reason,
          clientKey: input.client.clientKey
        },
        correlationId
      });
    }

    return { ok: false, reason: decision.reason };
  }

  // The atomic claim. `redeemed_at IS NULL` in the WHERE is what makes this
  // single-use under concurrency; the checks above are for the REASON, not for
  // the exclusion.
  const claimed = (await tx`
    UPDATE awcms_session_handoff_codes
    SET redeemed_at = ${input.now}
    WHERE tenant_id = ${tenantId} AND id = ${row!.id}
      AND redeemed_at IS NULL
      AND expires_at > ${input.now}
    RETURNING identity_id, assurance_level
  `) as { identity_id: string; assurance_level: SessionAssuranceLevel }[];

  const won = claimed[0];

  if (!won) {
    // Lost the race, or the code expired between the read and the claim. Both
    // are "already redeemed" to the caller.
    return { ok: false, reason: "already_redeemed" };
  }

  const session = await createSessionWithAssurance(tx, {
    tenantId,
    identityId: won.identity_id,
    // Never above what the login reached: a handoff must not launder an aal1
    // login into an aal2 session.
    assuranceLevel: won.assurance_level,
    ttlMin: input.sessionTtlMinutes,
    now: input.now
  });

  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: "identity_access",
    action: "auth.session_handoff.redeemed",
    resourceType: "session_handoff_code",
    resourceId: row!.id,
    severity: "info",
    message: `Session handoff code redeemed by ${input.client.clientKey}.`,
    attributes: {
      clientKey: input.client.clientKey,
      assuranceLevel: won.assurance_level
    },
    correlationId
  });

  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    assuranceLevel: won.assurance_level
  };
}
