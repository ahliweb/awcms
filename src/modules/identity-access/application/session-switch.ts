/**
 * The SOURCE-tenant half of a tenant switch — ADR-0088, Gelombang 7 PR 7.4.
 *
 * A switch spans two tenants, and one `withTenant` sets exactly one tenant
 * context, so it is necessarily two transactions: read who is asking (here),
 * then enter the target (`tenant-entry.ts`, opened by `withPublicAuthTenant`).
 *
 * ## Why the openings live here rather than in the route
 *
 * `bun run api:tenant-route:check` rejects a new route file that opens its own
 * tenant transaction, and it is right to: the factory is what carries the guard
 * chain and the mandatory work class. This route cannot use the factory —
 * `defineTenantRoute` would authorize against the SOURCE tenant while the work
 * belongs to the TARGET — so the openings are named here instead, the same
 * shape `withPublicAuthTenant` took for the unauthenticated auth surfaces.
 * That is the fourth instance of an established pattern, not a way around a
 * gate.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";

/** What the source session must prove before it may become another tenant's. */
export type SwitchSource = {
  sessionId: string;
  /** The HUMAN behind the session — what actually crosses the tenant boundary. */
  principalId: string;
  /** `password` | `sso` | `handoff` | `switch`; the non-switchable rule reads it. */
  originAuth: string;
};

/**
 * Resolves the live session behind `tokenHash` in its own tenant, or `null`.
 *
 * `null` covers unknown, revoked, expired, AND an identity with no principal
 * link. The last one fails closed on purpose: with no principal there is no
 * human to carry across, and guessing which identity in the target tenant is
 * "the same person" is precisely the inference this whole wave replaced with a
 * row.
 */
export async function loadSwitchSource(
  sql: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<SwitchSource | null> {
  return withTenantOrThrow<SwitchSource | null>(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT s.id, s.origin_auth, i.principal_id
        FROM awcms_sessions s
        JOIN awcms_identities i
          ON i.id = s.identity_id AND i.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${tenantId}
          AND s.token_hash = ${tokenHash}
          AND s.revoked_at IS NULL
          AND s.expires_at > ${now}
      `) as {
        id: string;
        origin_auth: string;
        principal_id: string | null;
      }[];

      const row = rows[0];

      if (!row?.principal_id) return null;

      return {
        sessionId: row.id,
        principalId: row.principal_id,
        originAuth: row.origin_auth
      };
    },
    { workClass: "interactive" }
  );
}

/**
 * Ends the source session AFTER the target session exists.
 *
 * Ordering is the safety property: revoking first would strand a person in no
 * tenant at all whenever the target refuses them. The failure mode of a switch
 * must be "you are still where you were", never "you are nowhere".
 *
 * The audit row names no destination, mirroring the target-side row that names
 * no source: neither tenant is entitled to learn where else this human works.
 */
export async function completeSwitchOut(
  sql: Bun.SQL,
  input: {
    tenantId: string;
    sessionId: string;
    now: Date;
    correlationId?: string;
  }
): Promise<void> {
  await withTenantOrThrow(
    sql,
    input.tenantId,
    async (tx) => {
      await tx`
        UPDATE awcms_sessions SET revoked_at = ${input.now}
        WHERE id = ${input.sessionId} AND revoked_at IS NULL
      `;

      await recordAuditEvent(tx, {
        tenantId: input.tenantId,
        moduleKey: "identity_access",
        action: "session_tenant_switched_out",
        resourceType: "session",
        resourceId: input.sessionId,
        severity: "info",
        message: "Session ended: switched to another tenant.",
        attributes: { method: "switch" },
        correlationId: input.correlationId
      });
    },
    { workClass: "interactive" }
  );
}
