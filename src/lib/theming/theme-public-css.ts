/**
 * Public theme token stylesheet composition root (ADR-0034 Fase 3; ported from
 * awcms-micro Issue #269/ADR-0029 §7). Lives in `src/lib` because it wires the
 * public-tenant resolver + the `module_management` enablement gate into
 * `theming`'s render resolver (never a cross-module import inside the module's
 * own application/domain).
 *
 * `GET /theming/{tenantCode}/tokens.css` — resolves the request's tenant FROM
 * THE `tenantCode` PATH SEGMENT (ADR-0009: awcms resolves public tenants by an
 * explicit `tenantCode`, not a Host/subdomain — this base defaults to a
 * LAN-first/offline topology with no guaranteed public DNS/TLS per tenant; this
 * is the port adaptation of awcms-micro's Host-based resolver), then serves that
 * tenant's ACTIVE published theme tokens as `text/css`. It ALWAYS returns a valid
 * 200: an unresolved/inactive tenant, a tenant with `theming` disabled, and a
 * tenant with no active theme all serve the DEFAULT theme's tokens — so there is
 * NO "does this code map to an active tenant" enumeration/timing oracle (the
 * response is always a stylesheet; only the token values a tenant chose to
 * publish differ).
 *
 * The stylesheet is same-origin, so it is served under the app's existing CSP
 * `style-src 'self'` without any inline `<style>` — the whole reason token values
 * ship as an external stylesheet (ADR-0029 §7: never weaken CSP).
 */
import { getDatabaseClient } from "../database/client";
import { withTenant } from "../database/tenant-context";
import { resolvePublicTenantByCode } from "../tenant/public-tenant-resolver";
import { fetchTenantModuleEntry } from "../../modules/module-management/application/tenant-module-lifecycle";
import { THEMING_MODULE_KEY } from "../../modules/theming/domain/theme-permissions";
import {
  defaultThemeCss,
  resolveActiveThemeCssForTenant,
  type ResolvedThemeCss
} from "../../modules/theming/application/theme-render-resolver";

/** ETag from a render fingerprint (strong validator). */
function etagFor(css: ResolvedThemeCss): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(css.fingerprint);
  return `"${hasher.digest("hex").slice(0, 32)}"`;
}

function cssResponse(css: ResolvedThemeCss, status = 200): Response {
  return new Response(css.css, {
    status,
    headers: {
      "content-type": "text/css; charset=utf-8",
      etag: etagFor(css),
      // Public, tenant-first (tenantCode determines tenant), safe to cache/CDN.
      "cache-control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=600"
    }
  });
}

function notModified(css: ResolvedThemeCss): Response {
  return new Response(null, {
    status: 304,
    headers: {
      etag: etagFor(css),
      "cache-control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=600"
    }
  });
}

/**
 * Serve the active theme tokens CSS for the request's resolved tenant (always
 * 200/304). `tenantCode` is the public path segment; an unknown or inactive code
 * resolves to `null` and serves the default tokens (no enumeration oracle).
 */
export async function serveActiveThemeTokensCss(
  request: Request,
  tenantCode: string
): Promise<Response> {
  const sql = getDatabaseClient();
  const tenant = tenantCode
    ? await resolvePublicTenantByCode(sql, tenantCode)
    : null;

  let resolved: ResolvedThemeCss;
  if (!tenant) {
    resolved = defaultThemeCss();
  } else {
    resolved = await withTenant(sql, tenant.tenantId, async (tx) => {
      const entry = await fetchTenantModuleEntry(
        tx,
        tenant.tenantId,
        THEMING_MODULE_KEY
      );
      if (!(entry?.tenantEnabled ?? false)) return defaultThemeCss();
      return resolveActiveThemeCssForTenant(tx, tenant.tenantId);
    });
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etagFor(resolved)) {
    return notModified(resolved);
  }
  return cssResponse(resolved);
}
