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
      /** Accounts moved `connected -> degraded` because this was the tenant's last active acknowledgement. */
      degradedAccounts: number;
    }
  | { outcome: "already_revoked"; acknowledgement: RiskAcknowledgementView }
  | { outcome: "not_found" };

/**
 * Stamps the revocation. When it removes the tenant's LAST active acknowledgement
 * of the provider, the tenant's `connected` accounts of that provider are moved to
 * `degraded` (reason {@link RISK_ACK_REVOKED_STATUS_REASON}) in the same
 * transaction: a degraded account is not usable, and cannot be connected again
 * without a new acknowledgement (the `sql/340` guard). Independently, the send
 * decision re-reads the acknowledgement on every call, so a revocation is
 * effective on the next claim even for an account row this never touched.
 */
export async function revokeRiskAcknowledgement(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  acknowledgementId: string
): Promise<RevokeOutcome> {
  const rows = (await tx`
    SELECT id, provider, tenant_user_id, text_version, acknowledged_at,
           revoked_at, revoked_by
    FROM awcms_channel_provider_risk_acknowledgements
    WHERE tenant_id = ${tenantId} AND id = ${acknowledgementId}
    FOR UPDATE
  `) as AckRow[];
  const row = rows[0];

  if (!row) return { outcome: "not_found" };

  const currentVersion = resolveRiskAcknowledgement(row.provider).entry
    .textVersion;

  if (row.revoked_at) {
    return {
      outcome: "already_revoked",
      acknowledgement: toView(row, currentVersion)
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

  const remaining = (await tx`
    SELECT 1 AS present
    FROM awcms_channel_provider_risk_acknowledgements
    WHERE tenant_id = ${tenantId} AND provider = ${row.provider}
      AND revoked_at IS NULL
    LIMIT 1
  `) as unknown[];

  let degradedAccounts = 0;

  if (remaining.length === 0) {
    const degraded = (await tx`
      UPDATE awcms_channel_accounts
      SET status = 'degraded', status_reason = ${RISK_ACK_REVOKED_STATUS_REASON},
          updated_by = ${actorTenantUserId}, updated_at = now(),
          version = version + 1
      WHERE tenant_id = ${tenantId} AND provider = ${row.provider}
        AND status = 'connected' AND deleted_at IS NULL
      RETURNING id
    `) as unknown[];

    degradedAccounts = degraded.length;
  }

  return {
    outcome: "revoked",
    acknowledgement: toView(revoked[0]!, currentVersion),
    degradedAccounts
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

/**
 * An explicit, audited attestation that a StarSender device is paired (see the
 * module header for why this is not a vendor verification). Needs: a device of an
 * unofficial provider, a stored credential, a `pending` or `degraded` account, and
 * the ACTING person's own active acknowledgement of the current approved text. It
 * moves the account to `connected` through the control plane's single health path
 * ({@link recordAccountHealth}) with the fixed reason `OPERATOR_ATTESTED`.
 */
export async function attestDevice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string
): Promise<AttestDeviceOutcome> {
  const account = await fetchAccountRecord(tx, tenantId, accountId, {
    lock: true
  });

  if (!account) return { outcome: "not_found" };

  if (account.provider !== "starsender" || account.accountKind !== "device") {
    return { outcome: "refused", code: "NOT_AN_UNOFFICIAL_DEVICE" };
  }

  if (account.status === "connected") return { outcome: "already_connected" };

  if (account.status !== "pending" && account.status !== "degraded") {
    return { outcome: "refused", code: "ACCOUNT_STATE_INVALID" };
  }

  if (!account.secretId) {
    return { outcome: "refused", code: "CREDENTIAL_REQUIRED" };
  }

  const resolved = resolveRiskAcknowledgement("starsender");
  const own = resolved.approved
    ? ((await tx`
        SELECT 1 AS present
        FROM awcms_channel_provider_risk_acknowledgements
        WHERE tenant_id = ${tenantId} AND provider = 'starsender'
          AND tenant_user_id = ${actorTenantUserId}
          AND text_version = ${resolved.entry.textVersion}
          AND revoked_at IS NULL
        LIMIT 1
      `) as unknown[])
    : [];

  if (own.length === 0) {
    return { outcome: "refused", code: "RISK_ACKNOWLEDGEMENT_REQUIRED" };
  }

  await recordAccountHealth(tx, tenantId, accountId, {
    state: "ok",
    reasonCode: OPERATOR_ATTESTED_REASON
  });

  return { outcome: "attested", status: "connected" };
}
