import {
  isTimestampWithinSkew,
  SYNC_SIGNATURE_VERSION_V2,
  verifySyncSignature,
  verifySyncSignatureV2
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

/**
 * Whether legacy (v1) sync signatures are still accepted. Default `true` so
 * already-deployed nodes keep working during the v2 migration. Operators close
 * the cross-tenant hole (GHSA-c972-3q5p-g3h4) completely by setting
 * `SYNC_HMAC_ALLOW_LEGACY=false` once every node has moved to v2 — v1 remains
 * cross-tenant forgeable while it is accepted.
 */
function legacyAllowed(): boolean {
  return process.env.SYNC_HMAC_ALLOW_LEGACY !== "false";
}

/**
 * Verify the HMAC auth headers of a node-to-node sync request.
 *
 * Prefers v2 (tenant+node bound). A request carrying
 * `X-AWCMS-Signature-Version: 2` is verified against the v2 material only —
 * there is no v1 fallback for it, so swapping `X-AWCMS-Tenant-ID` invalidates
 * the signature. A request without that header (or with version `1`) is a
 * legacy v1 request and is accepted only while `SYNC_HMAC_ALLOW_LEGACY` is not
 * `false`.
 */
export function verifySyncHeaders(
  tenantId: string,
  nodeCode: string,
  timestamp: string | null,
  signature: string | null,
  signatureVersion: string | null,
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

  if (signatureVersion === SYNC_SIGNATURE_VERSION_V2) {
    if (
      !verifySyncSignatureV2(
        secret,
        tenantId,
        nodeCode,
        timestamp,
        rawBody,
        signature
      )
    ) {
      return {
        ok: false,
        status: 401,
        code: "AUTH_REQUIRED",
        message: "Invalid sync signature."
      };
    }

    return { ok: true };
  }

  // No (or v1) version header: legacy signature. Reject entirely once the
  // operator has disabled legacy — this is the switch that fully closes the
  // cross-tenant hole for a fleet that has finished migrating to v2.
  if (!legacyAllowed()) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      message:
        "Legacy sync signatures are disabled; send X-AWCMS-Signature-Version: 2."
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

/**
 * Resolve an existing sync node, or register an unknown one as `inactive`.
 *
 * Auto-registration is intentionally `inactive` (security advisory
 * GHSA-c972-3q5p-g3h4): a first-contact node id is quarantined until an admin
 * approves it via `PATCH /api/v1/sync/nodes/{id}` (`status: "active"`). This
 * closes the "new node id" path — an attacker who forges a request for another
 * tenant lands on an inactive node and is rejected by the `status !== "active"`
 * gate in every sync route. Nodes already `active` are unaffected. The column
 * default is `active` (`sql/010`) for historical rows; the INSERT here makes
 * the status explicit so new rows land inactive without editing an applied
 * migration.
 */
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
    INSERT INTO awcms_sync_nodes (tenant_id, node_code, node_name, status)
    VALUES (${tenantId}, ${nodeCode}, ${nodeCode}, 'inactive')
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
