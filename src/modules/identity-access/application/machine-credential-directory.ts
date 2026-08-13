import {
  generateMachineCredentialToken,
  hashMachineCredentialToken
} from "../../../lib/auth/machine-credential-token";
import type { IssueMachineCredentialInput } from "../domain/machine-credential";

/**
 * Admin-side lifecycle for machine credentials (ADR-0049 §8): issue, list,
 * revoke. Authentication-time lookup lives in `machine-credential-lookup.ts` —
 * kept apart because one runs on every request and the other three times a year.
 */

/**
 * Renders a Postgres `text[]` literal.
 *
 * Bun.SQL does NOT bind a JS array as an array parameter: a tagged-template
 * `${["a", "b"]}` reaches the server as the TEXT `a,b`, which Postgres then
 * refuses to coerce into `text[]` ("malformed array literal", 22P02). A
 * one-element array is the dangerous shape — it arrives as a bare `a`, which
 * looks like a plain string all the way to the error. This is the same class of
 * trap as `${obj}::jsonb` versus `JSON.stringify(obj)` elsewhere in this repo.
 *
 * Quoting every element (and escaping `\` and `"`) rather than trusting the
 * validated key pattern: the pattern is enforced one layer up and in a CHECK
 * constraint, and a renderer that is only correct because of someone else's
 * validation is one refactor from being wrong.
 */
export function toPostgresTextArray(values: readonly string[]): string {
  const escaped = values.map(
    (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
  );

  return `{${escaped.join(",")}}`;
}

export type MachineCredentialSummary = {
  id: string;
  name: string;
  tenantUserId: string;
  allowedPermissionKeys: string[];
  /**
   * ADR-0092. Empty on every credential issued before the write class existed,
   * and on every read-only one issued since. Projected rather than reduced to a
   * boolean because the operational question during an incident is not "can
   * this write" but "what can it write, and from where".
   */
  allowedWriteActions: string[];
  allowedIpCidrs: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdByTenantUserId: string;
  createdAt: Date;
  /** Derived, not stored — `expired`/`revoked`/`active` is a function of the clock. */
  status: "active" | "expired" | "revoked";
};

type MachineCredentialRow = {
  id: string;
  name: string;
  tenant_user_id: string;
  allowed_permission_keys: string[];
  allowed_write_actions: string[];
  allowed_ip_cidrs: string[];
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_by_tenant_user_id: string;
  created_at: Date;
};

function toSummary(
  row: MachineCredentialRow,
  now: Date
): MachineCredentialSummary {
  return {
    id: row.id,
    name: row.name,
    tenantUserId: row.tenant_user_id,
    allowedPermissionKeys: row.allowed_permission_keys,
    allowedWriteActions: row.allowed_write_actions,
    allowedIpCidrs: row.allowed_ip_cidrs,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdByTenantUserId: row.created_by_tenant_user_id,
    createdAt: row.created_at,
    status: row.revoked_at
      ? "revoked"
      : new Date(row.expires_at).getTime() <= now.getTime()
        ? "expired"
        : "active"
  };
}

export async function listMachineCredentials(
  tx: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<MachineCredentialSummary[]> {
  // No `token_hash` in the projection. Not because a hash is directly usable —
  // it is not — but because an endpoint that hands out per-credential secret
  // material is one refactor away from handing out something that is.
  const rows = (await tx`
    SELECT id, name, tenant_user_id, allowed_permission_keys,
           allowed_write_actions, allowed_ip_cidrs, expires_at,
           last_used_at, revoked_at, created_by_tenant_user_id, created_at
    FROM awcms_machine_credentials
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT 200
  `) as MachineCredentialRow[];

  return rows.map((row) => toSummary(row, now));
}

export type IssueMachineCredentialResult =
  | { outcome: "issued"; credential: MachineCredentialSummary; token: string }
  | { outcome: "tenant_user_not_found" };

/**
 * Mints a credential. The plaintext token is returned to the caller exactly
 * once and is never stored — only its `mc-sha256:` hash reaches the database.
 */
export async function issueMachineCredential(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: IssueMachineCredentialInput,
  now: Date
): Promise<IssueMachineCredentialResult> {
  // Checked explicitly rather than left to the composite FK: a raw 23503 gives
  // the caller a database error where the honest answer is "that service
  // account is not in this tenant". RLS keeps this read tenant-scoped, so a
  // tenant user id from another tenant is simply not found.
  const serviceAccountRows = (await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND id = ${input.tenantUserId}
  `) as { id: string }[];

  if (!serviceAccountRows[0]) return { outcome: "tenant_user_not_found" };

  const token = generateMachineCredentialToken(tenantId);

  const rows = (await tx`
    INSERT INTO awcms_machine_credentials
      (tenant_id, tenant_user_id, name, token_hash, allowed_permission_keys,
       allowed_write_actions, allowed_ip_cidrs,
       expires_at, created_by_tenant_user_id)
    VALUES (
      ${tenantId}, ${input.tenantUserId}, ${input.name},
      ${hashMachineCredentialToken(token)},
      ${toPostgresTextArray(input.allowedPermissionKeys)}::text[],
      -- Both rendered, never omitted. sql/121 defaults them to the empty
      -- array, so a write class that forgot one column would land as a
      -- read-only credential and look like it worked.
      ${toPostgresTextArray(input.allowedWriteActions)}::text[],
      ${toPostgresTextArray(input.allowedIpCidrs)}::text[],
      ${input.expiresAt}, ${actorTenantUserId}
    )
    RETURNING id, name, tenant_user_id, allowed_permission_keys,
              allowed_write_actions, allowed_ip_cidrs, expires_at,
              last_used_at, revoked_at, created_by_tenant_user_id, created_at
  `) as MachineCredentialRow[];

  const inserted = rows[0];

  if (!inserted) {
    throw new Error("Machine credential insert returned no row.");
  }

  return {
    outcome: "issued",
    credential: toSummary(inserted, now),
    token
  };
}

export type RevokeMachineCredentialResult =
  | { outcome: "revoked"; credential: MachineCredentialSummary }
  | { outcome: "not_found" }
  | { outcome: "already_revoked" };

export async function revokeMachineCredential(
  tx: Bun.SQL,
  tenantId: string,
  credentialId: string,
  actorTenantUserId: string,
  now: Date
): Promise<RevokeMachineCredentialResult> {
  // Single conditional UPDATE, not read-then-write: two operators revoking the
  // same leaked credential concurrently must both end with it revoked and
  // exactly one audit entry, not a lost update.
  const rows = (await tx`
    UPDATE awcms_machine_credentials
    SET revoked_at = ${now},
        revoked_by_tenant_user_id = ${actorTenantUserId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${credentialId} AND revoked_at IS NULL
    RETURNING id, name, tenant_user_id, allowed_permission_keys,
              allowed_write_actions, allowed_ip_cidrs, expires_at,
              last_used_at, revoked_at, created_by_tenant_user_id, created_at
  `) as MachineCredentialRow[];

  const revoked = rows[0];

  if (revoked)
    return { outcome: "revoked", credential: toSummary(revoked, now) };

  const existingRows = (await tx`
    SELECT id FROM awcms_machine_credentials
    WHERE tenant_id = ${tenantId} AND id = ${credentialId}
  `) as { id: string }[];

  return existingRows[0]
    ? { outcome: "already_revoked" }
    : { outcome: "not_found" };
}
