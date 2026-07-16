import {
  isTimestampWithinSkew,
  verifySyncSignature
} from "../domain/sync-hmac";

export type SyncAuthFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type SyncAuthSuccess = {
  ok: true;
  node: { id: string; status: string };
};

const DEFAULT_MAX_SKEW_SECONDS = 300;

export function verifySyncHeaders(
  timestamp: string | null,
  signature: string | null,
  rawBody: string
): SyncAuthFailure | { ok: true } {
  if (process.env.AWCMS_SYNC_ENABLED !== "true") {
    return {
      ok: false,
      status: 403,
      code: "ACCESS_DENIED",
      message: "Sync is disabled."
    };
  }

  const secret = process.env.AWCMS_SYNC_HMAC_SECRET;

  if (!secret) {
    return {
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Sync HMAC secret is not configured."
    };
  }

  if (!timestamp || !signature) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Sync timestamp and signature headers are required."
    };
  }

  const maxSkewSeconds = Number(
    process.env.AWCMS_SYNC_MAX_SKEW_SEC ?? DEFAULT_MAX_SKEW_SECONDS
  );

  if (!isTimestampWithinSkew(timestamp, new Date(), maxSkewSeconds)) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Sync timestamp is outside the allowed skew."
    };
  }

  if (!verifySyncSignature(secret, timestamp, rawBody, signature)) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Invalid sync signature."
    };
  }

  return { ok: true };
}

export async function resolveOrRegisterSyncNode(
  tx: Bun.SQL,
  tenantId: string,
  nodeCode: string
): Promise<{ id: string; status: string } | null> {
  const existing = await tx`
    SELECT id, status FROM awcms_sync_nodes
    WHERE tenant_id = ${tenantId} AND node_code = ${nodeCode}
  `;

  if (existing[0]) {
    return existing[0] as { id: string; status: string };
  }

  const inserted = await tx`
    INSERT INTO awcms_sync_nodes (tenant_id, node_code, node_name)
    VALUES (${tenantId}, ${nodeCode}, ${nodeCode})
    ON CONFLICT (tenant_id, node_code) DO NOTHING
    RETURNING id, status
  `;

  if (inserted[0]) {
    return inserted[0] as { id: string; status: string };
  }

  const rows = await tx`
    SELECT id, status FROM awcms_sync_nodes
    WHERE tenant_id = ${tenantId} AND node_code = ${nodeCode}
  `;

  return (rows[0] as { id: string; status: string } | undefined) ?? null;
}
