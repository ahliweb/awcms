import type { AstroCookies } from "astro";

import { getDatabaseClient } from "../database/client";
import { withTenant } from "../database/tenant-context";
import {
  fetchGrantedPermissionKeys,
  resolveTenantContext
} from "../../modules/identity-access/application/auth-context";
import { hashSessionToken } from "./session-token";

export const SESSION_COOKIE_NAME = "awcms_session";
export const TENANT_COOKIE_NAME = "awcms_tenant_id";

export type SsrContext = {
  tenantId: string;
  tenantUserId: string;
  identityId: string;
  roles: string[];
  permissions: Set<string>;
};

/**
 * Resolves the authenticated tenant/session context for an SSR page render
 * from the two auth cookies. Returns null (never throws) whenever cookies
 * are missing or the session is invalid/expired/revoked.
 */
export async function resolveSsrContext(
  cookies: AstroCookies,
  now: Date
): Promise<SsrContext | null> {
  const tenantId = cookies.get(TENANT_COOKIE_NAME)?.value ?? null;
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  if (!tenantId || !sessionToken) return null;

  try {
    const sql = getDatabaseClient();
    const tokenHash = hashSessionToken(sessionToken);

    return await withTenant(sql, tenantId, async (tx) => {
      const context = await resolveTenantContext(tx, tenantId, tokenHash, now);
      if (!context) return null;

      const permissions = await fetchGrantedPermissionKeys(
        tx,
        tenantId,
        context.tenantUserId
      );

      return {
        tenantId: context.tenantId,
        tenantUserId: context.tenantUserId,
        identityId: context.identityId,
        roles: context.roles,
        permissions
      };
    });
  } catch {
    return null;
  }
}
