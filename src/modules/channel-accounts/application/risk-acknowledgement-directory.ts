/**
 * Provider risk acknowledgements and device attestation (Issue #1142, ADR-0148
 * section 4 and 7). The table is `awcms_channel_provider_risk_acknowledgements`
 * (`sql/340`).
 *
 * Everything here runs inside the caller's tenant-scoped transaction; every
 * statement names `tenant_id` on top of RLS.
 *
 * ## Why a device is "attested", not "verified"
 *
 * The control plane's invariant is that account health is REPORTED by a connector
 * and never asserted by a person (`GET .../health`). StarSender documents no
 * side-effect-free device-status call (the only evidenced endpoint is the send),
 * so there is nothing a connector could verify without messaging somebody. The
 * one honest alternative to a device that can never connect is an explicit,
 * audited, separately permissioned human attestation, recorded as health with the
 * fixed reason `OPERATOR_ATTESTED` so nothing downstream mistakes it for a vendor
 * confirmation. It needs the attesting person's own active acknowledgement of the
 * CURRENT text, so "operator" in the acknowledgement is the same person who says
 * the device is paired. If StarSender evidences a status call, a connector
 * replaces this with a real check and this path can be removed.
 */
import { recordAccountHealth, fetchAccountRecord } from "./account-directory";
import {
  resolveRiskAcknowledgement,
  type ResolvedRiskAcknowledgement,
  type RiskAcknowledgementProvider
} from "../domain/risk-acknowledgements";

export const RISK_ACK_REVOKED_STATUS_REASON = "RISK_ACK_REVOKED";
export const OPERATOR_ATTESTED_REASON = "OPERATOR_ATTESTED";

const MAX_LIST = 100;

export type RiskAcknowledgementView = {
  id: string;
  provider: RiskAcknowledgementProvider;
  tenantUserId: string;
  textVersion: string;
  acknowledgedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  /** The text version it was recorded against is the one in force now. */
  current: boolean;
};

type AckRow = {
  id: string;
  provider: RiskAcknowledgementProvider;
  tenant_user_id: string;
  text_version: string;
  acknowledged_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
};

function toView(row: AckRow, currentVersion: string): RiskAcknowledgementView {
  return {
    id: row.id,
    provider: row.provider,
    tenantUserId: row.tenant_user_id,
    textVersion: row.text_version,
    acknowledgedAt: row.acknowledged_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    revokedBy: row.revoked_by,
    current: row.text_version === currentVersion
  };
}

export async function listRiskAcknowledgements(
  tx: Bun.SQL,
  tenantId: string,
  provider: RiskAcknowledgementProvider
): Promise<RiskAcknowledgementView[]> {
  const current = resolveRiskAcknowledgement(provider).entry.textVersion;
  const rows = (await tx`
    SELECT id, provider, tenant_user_id, text_version, acknowledged_at,
           revoked_at, revoked_by
    FROM awcms_channel_provider_risk_acknowledgements
    WHERE tenant_id = ${tenantId} AND provider = ${provider}
    ORDER BY acknowledged_at DESC, id DESC
    LIMIT ${MAX_LIST}
  `) as AckRow[];

  return rows.map((row) => toView(row, current));
}

export type AcknowledgeOutcome =
  | {
      outcome: "recorded";
      created: boolean;
      acknowledgement: RiskAcknowledgementView;
    }
  | { outcome: "refused"; code: "TEXT_NOT_APPROVED" | "TEXT_VERSION_STALE" };

/**
 * Records the ACTING person's acknowledgement of the current text. Refused when
 * a human has not approved the text (fail closed) or when `textVersion` is not
 * the one in force (a stale form). A second acknowledgement of the same version
 * by the same person answers the existing record, so a double submit is harmless.
 */
export async function acknowledgeRisk(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: { provider: RiskAcknowledgementProvider; textVersion: string },
  resolved: ResolvedRiskAcknowledgement = resolveRiskAcknowledgement(
    input.provider
  )
): Promise<AcknowledgeOutcome> {
  if (!resolved.approved) {
    return { outcome: "refused", code: "TEXT_NOT_APPROVED" };
  }

  if (resolved.entry.textVersion !== input.textVersion) {
    return { outcome: "refused", code: "TEXT_VERSION_STALE" };
  }

  const inserted = (await tx`
    INSERT INTO awcms_channel_provider_risk_acknowledgements
      (tenant_id, provider, tenant_user_id, text_version, text_sha256)
    VALUES (${tenantId}, ${input.provider}, ${actorTenantUserId},
            ${resolved.entry.textVersion}, ${resolved.textHash})
    ON CONFLICT (tenant_id, provider, tenant_user_id, text_version)
      WHERE revoked_at IS NULL
    DO NOTHING
    RETURNING id, provider, tenant_user_id, text_version, acknowledged_at,
              revoked_at, revoked_by
  `) as AckRow[];

  if (inserted[0]) {
    return {
      outcome: "recorded",
      created: true,
      acknowledgement: toView(inserted[0], resolved.entry.textVersion)
    };
  }

  const existing = (await tx`
    SELECT id, provider, tenant_user_id, text_version, acknowledged_at,
           revoked_at, revoked_by
    FROM awcms_channel_provider_risk_acknowledgements
    WHERE tenant_id = ${tenantId} AND provider = ${input.provider}
      AND tenant_user_id = ${actorTenantUserId}
      AND text_version = ${resolved.entry.textVersion}
      AND revoked_at IS NULL
  `) as AckRow[];

  return {
    outcome: "recorded",
    created: false,
    acknowledgement: toView(existing[0]!, resolved.entry.textVersion)
  };
}

export type RevokeOutcome =
  | {
      outcome: "revoked";
      acknowledgement: RiskAcknowledgementView;
      /** Accounts moved `connected -> degraded`: those attested under THIS acknowledgement, and every one of the provider when it was the tenant's last. */
      degradedAccounts: number;
    }
  | { outcome: "already_revoked"; acknowledgement: RiskAcknowledgementView }
  | { outcome: "not_found" };

/**
 * Stamps the revocation and degrades what depended on it, in ONE transaction:
 *
 *   * the tenant's `connected` devices of the provider that were attested under
 *     THIS acknowledgement (audit L1: a device is trusted on the strength of the
 *     person who said it was paired, not of "somebody in the tenant"), and
 *   * every `connected` device of the provider when this was the tenant's LAST
 *     active acknowledgement (including one connected by a path that recorded no
 *     attester).
 *
 * A degraded device is not usable and cannot be connected again without a new
 * acknowledgement and attestation (the `sql/340` guard). Independently, the send
 * decision re-reads the acknowledgement on every call.
 *
 * ## Why every active acknowledgement of the provider is locked first (audit M1)
 *
 * "Is this the last one?" is a question about a SET. Two concurrent revocations
 * of the last two acknowledgements each saw the other's row still active (its
 * stamp was uncommitted), each concluded "not the last", and both committed: a
 * `connected` device with no active acknowledgement. So the whole active set of
 * (tenant, provider) is locked `FOR UPDATE` in id order (a fixed order, so two
 * revokers cannot deadlock each other) BEFORE the decision, which serialises
 * revocations; the second one re-evaluates after the first commits and sees the
 * truth. {@link attestDevice} takes a `FOR SHARE` lock on the row it relies on,
 * so a revocation also waits for an attestation in flight and then sees the
 * device it just connected.
 */
export async function revokeRiskAcknowledgement(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  acknowledgementId: string
): Promise<RevokeOutcome> {
  const probe = (await tx`
    SELECT provider
    FROM awcms_channel_provider_risk_acknowledgements
    WHERE tenant_id = ${tenantId} AND id = ${acknowledgementId}
  `) as { provider: RiskAcknowledgementProvider }[];

  if (!probe[0]) return { outcome: "not_found" };

  const provider = probe[0].provider;
  const currentVersion = resolveRiskAcknowledgement(provider).entry.textVersion;
  const active = (await tx`
    SELECT id, provider, tenant_user_id, text_version, acknowledged_at,
           revoked_at, revoked_by
    FROM awcms_channel_provider_risk_acknowledgements
    WHERE tenant_id = ${tenantId} AND provider = ${provider}
      AND revoked_at IS NULL
    ORDER BY id
    FOR UPDATE
  `) as AckRow[];
  const target = active.find((row) => row.id === acknowledgementId);

  if (!target) {
    const done = (await tx`
      SELECT id, provider, tenant_user_id, text_version, acknowledged_at,
             revoked_at, revoked_by
      FROM awcms_channel_provider_risk_acknowledgements
      WHERE tenant_id = ${tenantId} AND id = ${acknowledgementId}
    `) as AckRow[];

    return {
      outcome: "already_revoked",
      acknowledgement: toView(done[0]!, currentVersion)
    };
  }

  const revoked = (await tx`
    UPDATE awcms_channel_provider_risk_acknowledgements
    SET revoked_at = now(), revoked_by = ${actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${acknowledgementId}
      AND revoked_at IS NULL
    RETURNING id, provider, tenant_user_id, text_version, acknowledged_at,
              revoked_at, revoked_by
  `) as AckRow[];
  const wasLast = active.length === 1;
  const degraded = (await tx`
    UPDATE awcms_channel_accounts
    SET status = 'degraded', status_reason = ${RISK_ACK_REVOKED_STATUS_REASON},
        updated_by = ${actorTenantUserId}, updated_at = now(),
        version = version + 1
    WHERE tenant_id = ${tenantId} AND provider = ${provider}
      AND status = 'connected' AND deleted_at IS NULL
      AND (attested_acknowledgement_id = ${acknowledgementId}
           OR ${wasLast}::boolean)
    RETURNING id
  `) as unknown[];

  return {
    outcome: "revoked",
    acknowledgement: toView(revoked[0]!, currentVersion),
    degradedAccounts: degraded.length
  };
}

export type AttestDeviceOutcome =
  | { outcome: "attested"; status: "connected" }
  | { outcome: "already_connected" }
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code:
        | "NOT_AN_UNOFFICIAL_DEVICE"
        | "ACCOUNT_STATE_INVALID"
        | "CREDENTIAL_REQUIRED"
        | "RISK_ACKNOWLEDGEMENT_REQUIRED";
    };

type DeviceCheck = { ok: true } | { ok: false; result: AttestDeviceOutcome };

function checkDevice(
  account: Awaited<ReturnType<typeof fetchAccountRecord>>
): DeviceCheck {
  if (!account) return { ok: false, result: { outcome: "not_found" } };

  if (account.provider !== "starsender" || account.accountKind !== "device") {
    return {
      ok: false,
      result: { outcome: "refused", code: "NOT_AN_UNOFFICIAL_DEVICE" }
    };
  }

  if (account.status === "connected") {
    return { ok: false, result: { outcome: "already_connected" } };
  }

  if (account.status !== "pending" && account.status !== "degraded") {
    return {
      ok: false,
      result: { outcome: "refused", code: "ACCOUNT_STATE_INVALID" }
    };
  }

  if (!account.secretId) {
    return {
      ok: false,
      result: { outcome: "refused", code: "CREDENTIAL_REQUIRED" }
    };
  }

  return { ok: true };
}

/**
 * An explicit, audited attestation that a StarSender device is paired (see the
 * module header for why this is not a vendor verification). Needs: a device of an
 * unofficial provider, a stored credential, a `pending` or `degraded` account, and
 * the ACTING person's own active acknowledgement of the current approved text. It
 * moves the account to `connected` through the control plane's single health path
 * ({@link recordAccountHealth}) with the fixed reason `OPERATOR_ATTESTED`, and
 * records WHICH acknowledgement it relied on (`attested_acknowledgement_id`), so
 * revoking that one takes the device down.
 *
 * The acknowledgement row is read `FOR SHARE` and `revoked_at IS NULL` BEFORE the
 * account is locked (audit M1): a concurrent revocation of it waits for this
 * transaction and then sees the device it connected; and the lock order (acks,
 * then the account) is the one `revokeRiskAcknowledgement` uses, so the two
 * cannot deadlock.
 */
export async function attestDevice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string
): Promise<AttestDeviceOutcome> {
  // Cheap refusals first, without a lock.
  const first = checkDevice(await fetchAccountRecord(tx, tenantId, accountId));

  if (!first.ok) return first.result;

  const resolved = resolveRiskAcknowledgement("starsender");
  const own = resolved.approved
    ? ((await tx`
        SELECT id
        FROM awcms_channel_provider_risk_acknowledgements
        WHERE tenant_id = ${tenantId} AND provider = 'starsender'
          AND tenant_user_id = ${actorTenantUserId}
          AND text_version = ${resolved.entry.textVersion}
          AND revoked_at IS NULL
        LIMIT 1
        FOR SHARE
      `) as { id: string }[])
    : [];

  if (!own[0]) {
    return { outcome: "refused", code: "RISK_ACKNOWLEDGEMENT_REQUIRED" };
  }

  // Now the account, and the checks again: it may have changed while we waited.
  const second = checkDevice(
    await fetchAccountRecord(tx, tenantId, accountId, { lock: true })
  );

  if (!second.ok) return second.result;

  await recordAccountHealth(tx, tenantId, accountId, {
    state: "ok",
    reasonCode: OPERATOR_ATTESTED_REASON
  });
  await tx`
    UPDATE awcms_channel_accounts
    SET attested_acknowledgement_id = ${own[0].id}
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
  `;

  return { outcome: "attested", status: "connected" };
}
