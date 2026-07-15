export type ActiveSession = {
  id: string;
  tenant_id: string;
  identity_id: string;
};

export async function resolveActiveSession(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<ActiveSession | null> {
  const rows = await tx`
    SELECT id, tenant_id, identity_id, expires_at, revoked_at
    FROM awcms_sessions
    WHERE tenant_id = ${tenantId} AND token_hash = ${tokenHash}
  `;
  const session = rows[0] as
    | {
        id: string;
        tenant_id: string;
        identity_id: string;
        expires_at: Date;
        revoked_at: Date | null;
      }
    | undefined;

  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= now.getTime()) return null;

  return {
    id: session.id,
    tenant_id: session.tenant_id,
    identity_id: session.identity_id
  };
}

export function extractBearerToken(
  authorizationHeader: string | null
): string | null {
  if (!authorizationHeader) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());

  return match?.[1] ?? null;
}
