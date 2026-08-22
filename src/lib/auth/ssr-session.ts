import type { AstroCookies } from "astro";

import { getDatabaseClient } from "../database/client";
import { withTenant } from "../database/tenant-context";
import {
  fetchGrantedPermissionKeys,
  resolveTenantPrincipal
} from "../../modules/identity-access/application/auth-context";
import { isTenantServiceStopped } from "../../modules/identity-access/domain/suspended-tenant-allowlist";
import {
  readPreferences,
  resolvePrincipalIdForIdentity
} from "../../modules/identity-access/application/principal-preference-store";
import { hashSessionToken } from "./session-token";
import type { SQL } from "bun";

/**
 * Reads the tenant's display defaults (ADR-0095 §"Keputusan 5" steps 3).
 *
 * `awcms_tenants.default_locale` has existed since sql/001 and is read by
 * `seo_distribution` for hreflang; this is its second reader.
 * `default_theme` has existed just as long and this is its FIRST — the comment
 * in `theme-init-script.ts` claiming awcms "has no per-tenant default-theme
 * column today" was simply wrong about its own schema.
 *
 * Degrades to null on any fault: chrome, not a guard.
 */
async function readTenantDisplayDefaults(
  tx: SQL,
  tenantId: string
): Promise<{
  defaultLocale: string | null;
  defaultTheme: string | null;
  tenantName: string | null;
}> {
  try {
    // `tenant_name` rides along for finding B4. `AdminLayout` used to open a
    // THIRD transaction whose first statement was
    // `SELECT tenant_name FROM awcms_tenants WHERE id = $1` — the same row this
    // query already has open, one column wider. Adding a column to a
    // primary-key read costs nothing; the transaction it removes is a
    // connection acquisition and a round trip on every `/admin/*` render.
    const rows = (await tx`
      SELECT default_locale, default_theme, tenant_name
      FROM awcms_tenants
      WHERE id = ${tenantId}
    `) as Array<{
      default_locale: string | null;
      default_theme: string | null;
      tenant_name: string | null;
    }>;

    return {
      defaultLocale: rows[0]?.default_locale ?? null,
      defaultTheme: rows[0]?.default_theme ?? null,
      tenantName: rows[0]?.tenant_name ?? null
    };
  } catch {
    return { defaultLocale: null, defaultTheme: null, tenantName: null };
  }
}

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
  /**
   * The signed-in human's stored display preferences and their tenant's
   * defaults (ADR-0095).
   *
   * Resolved INSIDE the transaction this function already opens, rather than by
   * the middleware afterwards. A second transaction per `/admin/*` request to
   * learn a two-character language code would be a real cost on every page, and
   * the queries are two keyed single-row reads joining work already in flight.
   *
   * `principalId` is nullable because `awcms_identities.principal_id` is
   * (sql/112 §3 — an identity written by a path not yet taught about principals
   * must be visibly unlinked, not a 500). A null one simply has no stored
   * preference.
   */
  display: {
    principalId: string | null;
    /** `awcms_principal_preferences.locale`, or null when not chosen. */
    preferredLocale: string | null;
    /** `awcms_principal_preferences.theme`, or null when not chosen. */
    preferredTheme: string | null;
    /** `awcms_tenants.default_locale` — the fallback below the preference. */
    tenantDefaultLocale: string | null;
    /** `awcms_tenants.default_theme` — see `theme-init-script.ts`'s seam. */
    tenantDefaultTheme: string | null;
    /**
     * `awcms_tenants.tenant_name` — the topbar label.
     *
     * Carried here because the query above already had the row open (finding
     * B4). `AdminLayout` reads it from the session rather than opening its own
     * transaction for one column.
     */
    tenantName: string | null;
  };
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

      // ADR-0095 — display preferences, in this same transaction.
      //
      // Every read below degrades to null rather than throwing: a language is
      // chrome, and a fault reading it must render the admin in the fallback
      // language, never fail the session resolution that guards 40 screens.
      const principalId = await resolvePrincipalIdForIdentity(
        tx,
        tenantId,
        context.identityId
      );
      const preferences = await readPreferences(tx, principalId);
      const tenantDefaults = await readTenantDisplayDefaults(tx, tenantId);

      return {
        tenantId: context.tenantId,
        tenantUserId: context.tenantUserId,
        identityId: context.identityId,
        roles: context.roles,
        permissions,
        tokenHash,
        display: {
          principalId,
          preferredLocale: preferences.locale,
          preferredTheme: preferences.theme,
          tenantDefaultLocale: tenantDefaults.defaultLocale,
          tenantDefaultTheme: tenantDefaults.defaultTheme,
          tenantName: tenantDefaults.tenantName
        }
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
