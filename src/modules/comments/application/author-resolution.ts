/**
 * Optional registered-author resolution for the PUBLIC comment surfaces (ADR-0041,
 * ported from awcms-micro Issue #271). A public comment endpoint resolves the tenant from the request
 * host, not a session — but a logged-in visitor may still carry a session cookie.
 * When a valid, active session for the RESOLVED tenant is present, this maps it to
 * the visitor's `tenant_user` id so the comment is attributed as `registered`;
 * otherwise the author is `anonymous`. It never grants any admin capability — it
 * only classifies the author for policy purposes.
 */
import { resolveActiveSession } from "../../identity-access/application/session-lookup";

export type ResolvedAuthor = {
  authorKind: "anonymous" | "registered";
  authorUserId: string | null;
};

export async function resolveOptionalRegisteredAuthor(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string | null,
  now: Date
): Promise<ResolvedAuthor> {
  if (!tokenHash) return { authorKind: "anonymous", authorUserId: null };

  const session = await resolveActiveSession(tx, tenantId, tokenHash, now);
  if (!session) return { authorKind: "anonymous", authorUserId: null };

  const rows = (await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND identity_id = ${session.identity_id}
      AND status = 'active'
  `) as { id: string }[];

  if (!rows[0]) return { authorKind: "anonymous", authorUserId: null };
  return { authorKind: "registered", authorUserId: rows[0].id };
}
