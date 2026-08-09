import type { AstroCookies } from "astro";

import { getDatabaseClient } from "../database/client";
import { withTenant } from "../database/tenant-context";
import {
  fetchGrantedPermissionKeys,
  resolveTenantPrincipal
} from "../../modules/identity-access/application/auth-context";
import { isTenantServiceStopped } from "../../modules/identity-access/domain/suspended-tenant-allowlist";
import { hashSessionToken } from "./session-token";

export const SESSION_COOKIE_NAME = "awcms_session";
export const TENANT_COOKIE_NAME = "awcms_tenant_id";

export type SsrContext = {
  tenantId: string;
  tenantUserId: string;
  identityId: string;
  roles: string[];
  permissions: Set<string>;
  /**
   * The session token's namespaced hash — the SAME value the API routes hand
   * to `authorizeInTransaction` (ADR-0049 carries the bearer's KIND in the
   * namespace, so nothing downstream has to be told which table to consult).
   *
   * Carried so an admin screen can reach the chokepoint at all (#450). It is
   * the stored form, never the cookie value, and it never leaves the server:
   * `Astro.locals` is not serialised into the rendered page.
   */
  tokenHash: string;
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

    const result = await withTenant(sql, tenantId, async (tx) => {
      const principal = await resolveTenantPrincipal(
        tx,
        tenantId,
        tokenHash,
        now
      );
      if (!principal) return null;

      // ADR-0073 — a suspended tenant's admin shell does not render.
      //
      // This one line covers all 32 admin screens, because `src/middleware.ts`
      // routes every `/admin/*` request through here and redirects to `/login`
      // when it answers null. Without it, suspension would stop the API and
      // leave the entire admin UI up, which is most of what an operator sees.
      //
      // It is all-or-nothing, unlike the chokepoint's permission-level
      // allow-list, and that is a real limitation rather than a design: there
      // is no screen yet that a suspended tenant needs (billing arrives in
      // Gelombang 5). When one exists, this branch has to grow the same
      // allow-list the chokepoint has — noted here so it is found then.
      if (isTenantServiceStopped(principal.tenantStatus)) return null;

      const context = principal.context;

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
        permissions,
        tokenHash
      };
    });

    // When the DB circuit breaker is open / a work-class queue is saturated,
    // `withTenant` answers with a `503` `Response` instead of running the
    // callback — which the return type now says out loud, so this branch is
    // checked rather than remembered. For SSR session resolution it means
    // "can't confirm the session right now": degrade to unauthenticated (the
    // SSR guard then redirects to /login) rather than leak a `Response` where
    // an `SsrContext` is expected.
    if (result instanceof Response) return null;

    return result;
  } catch {
    return null;
  }
}
