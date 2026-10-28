/**
 * Per-account capability records and the fail-closed use check
 * (Issue #1140, ADR-0148 I2).
 *
 * Two different questions, kept apart on purpose:
 *
 * - {@link setAccountCapability} — "may an administrator RECORD this capability
 *   as granted?" It refuses cells the provider matrix can never allow, and a
 *   `restricted` cell without contract evidence, so a bad grant is rejected when
 *   it is written, not only when it is used.
 * - {@link resolveCapability} — "may this account do X RIGHT NOW?" The decision
 *   {@link evaluateCapability} makes from the matrix, the stored row, the
 *   account's status and its connection's grant. Re-evaluated on every call:
 *   a revoked connection or a disabled account denies at once, whatever the row
 *   still says. A caller must treat a thrown error the same as a denial.
 */
import {
  CONTRACT_EVIDENCE_KINDS,
  CHANNEL_CAPABILITIES,
  PROVIDER_MATRIX_VERSION,
  cellGrantability,
  evaluateCapability,
  getProviderRow,
  type CapabilityDenialCode,
  type CapabilityEvidenceKind,
  type CapabilityRowFacts,
  type ChannelCapability,
  type MatrixCell
} from "../domain/provider-matrix";
import type { SetCapabilityInput } from "../domain/channel-accounts-validation";
import { fetchAccountRecord } from "./account-directory";

type CapabilityRow = {
  capability: ChannelCapability;
  state: CapabilityRowFacts["state"];
  evidence_kind: CapabilityEvidenceKind | null;
  evidence_ref: string | null;
  matrix_version: number;
  verified_at: Date | null;
  updated_at: Date;
};

export type CapabilityView = {
  capability: ChannelCapability;
  matrixCell: MatrixCell;
  state: CapabilityRowFacts["state"] | "absent";
  evidenceKind: CapabilityEvidenceKind | null;
  evidenceRef: string | null;
  matrixVersion: number | null;
  verifiedAt: string | null;
  /** The use decision NOW, with the reason code when denied. */
  effective: { allowed: true } | { allowed: false; code: CapabilityDenialCode };
};

async function loadRows(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<CapabilityRow[]> {
  return (await tx`
    SELECT capability, state, evidence_kind, evidence_ref, matrix_version,
           verified_at, updated_at
    FROM awcms_channel_account_capabilities
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
  `) as CapabilityRow[];
}

async function connectionGrantState(
  tx: Bun.SQL,
  tenantId: string,
  connectionId: string | null
): Promise<string | null> {
  if (!connectionId) return null;

  const rows = (await tx`
    SELECT grant_state FROM awcms_channel_provider_connections
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `) as { grant_state: string }[];

  // A connection that cannot be read is NOT an active one.
  return rows[0]?.grant_state ?? "missing";
}

function toFacts(row: CapabilityRow): CapabilityRowFacts {
  return {
    state: row.state,
    evidenceKind: row.evidence_kind,
    evidenceRef: row.evidence_ref,
    matrixVersion: row.matrix_version
  };
}

/** Every capability of an account with its matrix cell, stored row and effective verdict. `null` when the account does not exist for this tenant. */
export async function listAccountCapabilities(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<CapabilityView[] | null> {
  const account = await fetchAccountRecord(tx, tenantId, accountId);

  if (!account) return null;

  const rows = await loadRows(tx, tenantId, accountId);
  const byCapability = new Map(rows.map((row) => [row.capability, row]));
  const grantState = await connectionGrantState(
    tx,
    tenantId,
    account.connectionId
  );
  const matrixRow = getProviderRow(account.provider);

  return CHANNEL_CAPABILITIES.map((capability) => {
    const row = byCapability.get(capability) ?? null;

    return {
      capability,
      matrixCell: matrixRow?.cells[capability] ?? "unverified",
      state: row?.state ?? "absent",
      evidenceKind: row?.evidence_kind ?? null,
      evidenceRef: row?.evidence_ref ?? null,
      matrixVersion: row?.matrix_version ?? null,
      verifiedAt: row?.verified_at?.toISOString() ?? null,
      effective: evaluateCapability({
        account: {
          provider: account.provider,
          accountKind: account.accountKind,
          status: account.status,
          connectionGrantState: grantState
        },
        capability,
        row: row ? toFacts(row) : null
      })
    };
  });
}

export type SetCapabilityOutcome =
  | { outcome: "recorded"; capability: CapabilityView }
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code:
        | "CAPABILITY_NOT_GRANTABLE"
        | "PROVIDER_BARRED"
        | "PROVIDER_UNVERIFIED"
        | "PROVIDER_RESTRICTED"
        | "ACCOUNT_STATE_INVALID";
    };

export async function setAccountCapability(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string,
  capability: ChannelCapability,
  input: SetCapabilityInput
): Promise<SetCapabilityOutcome> {
  const account = await fetchAccountRecord(tx, tenantId, accountId);

  if (!account) return { outcome: "not_found" };

  // A revoked or disabled account is not re-armed by editing its capabilities.
  if (account.status === "revoked" || account.status === "disabled") {
    if (input.state !== "denied") {
      return { outcome: "refused", code: "ACCOUNT_STATE_INVALID" };
    }
  }

  if (input.state !== "denied") {
    const grantability = cellGrantability(
      account.provider,
      account.accountKind,
      capability
    );

    if (!grantability.grantable) {
      return {
        outcome: "refused",
        code:
          grantability.code === "PROVIDER_BARRED" ||
          grantability.code === "PROVIDER_UNVERIFIED"
            ? grantability.code
            : "CAPABILITY_NOT_GRANTABLE"
      };
    }

    if (
      input.state === "granted" &&
      grantability.requiresContractEvidence &&
      !(
        input.evidenceKind &&
        CONTRACT_EVIDENCE_KINDS.includes(input.evidenceKind)
      )
    ) {
      return { outcome: "refused", code: "PROVIDER_RESTRICTED" };
    }
  }

  await tx`
    INSERT INTO awcms_channel_account_capabilities
      (tenant_id, account_id, capability, state, evidence_kind, evidence_ref,
       matrix_version, verified_at, granted_by)
    VALUES (${tenantId}, ${accountId}, ${capability}, ${input.state},
            ${input.evidenceKind}, ${input.evidenceRef},
            ${PROVIDER_MATRIX_VERSION},
            ${input.state === "granted" ? new Date() : null},
            ${actorTenantUserId})
    ON CONFLICT (tenant_id, account_id, capability) DO UPDATE
    SET state = EXCLUDED.state, evidence_kind = EXCLUDED.evidence_kind,
        evidence_ref = EXCLUDED.evidence_ref,
        matrix_version = EXCLUDED.matrix_version,
        verified_at = EXCLUDED.verified_at, granted_by = EXCLUDED.granted_by,
        updated_at = now()
  `;

  const views = await listAccountCapabilities(tx, tenantId, accountId);
  const view = views!.find((item) => item.capability === capability)!;

  return { outcome: "recorded", capability: view };
}

/**
 * THE use check. Returns a verdict; never throws for a denial. The connector
 * issues call this before every send/publish and treat anything other than
 * `{ allowed: true }` (including an exception) as refusal, with no fallback to
 * another account, sender or channel (ADR-0148 I5).
 */
export async function resolveCapability(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  capability: ChannelCapability
): Promise<
  | { allowed: true }
  | { allowed: false; code: CapabilityDenialCode | "ACCOUNT_NOT_FOUND" }
> {
  const views = await listAccountCapabilities(tx, tenantId, accountId);

  if (!views) return { allowed: false, code: "ACCOUNT_NOT_FOUND" };

  return views.find((view) => view.capability === capability)!.effective;
}
