import { defineMiddleware } from "astro/middleware";
import { createClientFromEnv, getTenant } from "./lib/supabase";
import { extractTenantFromPath } from "./lib/url";

/**
 * AWCMS Public Middleware
 *
 * Resolves tenant context from:
 * 1. Path parameter (PRIMARY - e.g., /primary/articles)
 * 2. Host/subdomain (FALLBACK - for legacy compatibility)
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals, url } = context;
  const pathname = url.pathname;

  try {
    // --- REFERRAL CODE LOGIC ---
    // Extract referral code from /ref/refcode paths
    // e.g., /ref/ABC123/homes/startup -> logicalPath: /homes/startup, refCode: ABC123
    let logicalPath = pathname;
    let refCode: string | null = null;
    const refMatch = pathname.match(/^\/ref\/([a-zA-Z0-9_-]+)(\/|$)/);
    if (refMatch) {
      refCode = refMatch[1];
      logicalPath = pathname.replace(/^\/ref\/[a-zA-Z0-9_-]+/, "") || "/";
    }

    // --- I18N LOGIC ---
    // Strip locale prefix for internal routing and logic
    // e.g., /id/homes/startup -> /homes/startup
    const localeMatch = logicalPath.match(/^\/(id|en)(\/|$)/);
    let locale: string | null = null;
    let localeFromUrl = false;

    if (localeMatch) {
      locale = localeMatch[1];
      localeFromUrl = true;
      logicalPath = logicalPath.replace(/^\/(id|en)/, "") || "/";
    }

    // 1. Extract tenant from path
    // Use logicalPath to ignore locale prefix
    const tenantSlugFromPath = extractTenantFromPath(logicalPath);

    // 2. Get Runtime Env for Cloudflare
    const runtimeEnv = context.locals.runtime?.env || {};

    // 3. Create request-scoped Supabase client
    const SafeSupabase = createClientFromEnv(runtimeEnv);

    if (!SafeSupabase) {
      console.error(
        "[Middleware] Failed to initialize Supabase client. Missing env vars.",
      );
      return new Response("Service Unavailable: Invalid Configuration", {
        status: 503,
      });
    }

    // 4. Resolve tenant
    let tenantId: string | null = null;
    let tenantSlug: string | null = null;
    let resolvedFromPath = false; // Track if actually resolved from PATH

    if (tenantSlugFromPath) {
      // Path-based resolution (PRIMARY)
      console.log(
        "[Middleware] Resolving tenant from path:",
        tenantSlugFromPath,
      );

      // Use SECURITY DEFINER function to bypass RLS
      const result = await SafeSupabase.rpc("get_tenant_by_slug", {
        lookup_slug: tenantSlugFromPath,
      }).maybeSingle();
      const tenantData = result.data as { id: string; slug: string } | null;
      const tenantError = result.error;

      if (tenantData) {
        tenantId = tenantData.id;
        tenantSlug = tenantData.slug;
        resolvedFromPath = true; // Actually resolved from path!
        console.log(
          "[Middleware] Tenant resolved from path:",
          tenantSlug,
          tenantId,
        );
      } else if (tenantError) {
        console.warn("[Middleware] Tenant lookup error:", tenantError.message);
      }
    }

    // 5. Fallback to host-based resolution
    if (!tenantId) {
      let host = url.hostname || "";

      // Dev override
      if (import.meta.env.DEV && import.meta.env.VITE_DEV_TENANT_HOST) {
        host = import.meta.env.VITE_DEV_TENANT_HOST;
      }

      console.log("[Middleware] Falling back to host resolution:", host);

      const { data: hostTenantId, error: hostError } = await SafeSupabase.rpc(
        "get_tenant_id_by_host",
        { lookup_host: host },
      );

      if (hostTenantId) {
        tenantId = hostTenantId as string;

        // Get tenant slug
        const { data: tenantData } = await SafeSupabase.from("tenants")
          .select("slug")
          .eq("id", tenantId)
          .single();

        if (tenantData) {
          tenantSlug = tenantData.slug;
          // Serve content directly from host without path prefix redirect
          console.log(
            "[Middleware] Tenant resolved from host:",
            tenantSlug,
            tenantId,
          );
        }
      } else if (hostError) {
        console.warn("[Middleware] Host lookup error:", hostError.message);
      }
    }

    // 6. Handle unresolved tenant
    if (!tenantId || !tenantSlug) {
      console.warn(
        `[Middleware] Tenant not found. Path: ${tenantSlugFromPath}, Pathname: ${pathname}`,
      );

      // For static assets and internal paths, let them through
      if (pathname.startsWith("/_") || pathname.startsWith("/favicon")) {
        return next();
      }

      // Fallback to 'primary' for known channel domains
      let host = url.hostname || "";

      if (
        host === "ahliweb.com" ||
        host.endsWith(".ahliweb.com") ||
        host === "localhost" ||
        host.includes("localhost:")
      ) {
        console.log("[Middleware] Fallback to primary tenant for host:", host);
        // Set primary tenant context directly (no redirect)
        tenantSlug = "primary";
        // Use SECURITY DEFINER function to bypass RLS
        const primaryResult = await SafeSupabase.rpc("get_tenant_by_slug", {
          lookup_slug: "primary",
        }).single();
        const primaryTenant = primaryResult.data as {
          id: string;
          slug: string;
        } | null;
        if (primaryTenant) {
          tenantId = primaryTenant.id;
        } else {
          return new Response("Primary tenant not configured", { status: 500 });
        }
      } else {
        return new Response("Tenant Not Found", { status: 404 });
      }
    }

    // 7. Set context for downstream components
    locals.tenant_id = tenantId!;
    locals.tenant_slug = tenantSlug!;
    locals.host = url.host || "";
    // Track how tenant was resolved - 'path' only if actually resolved from path lookup
    locals.tenant_source = resolvedFromPath ? "path" : "host";

    locals.ref_code = refCode;
    locals.locale = locale || "en"; // Default to English

    // 8. Fetch Tenant Settings (SEO + Site Info)
    if (tenantId) {
      const { data: settingsData } = await SafeSupabase.from("settings")
        .select("key, value")
        .eq("tenant_id", tenantId)
        .in("key", ["seo_global", "site_info", "contact_info"]);

      const settingsMap = (settingsData || []).reduce(
        (acc: Record<string, unknown>, row) => {
          acc[row.key] = row.value;
          return acc;
        },
        {},
      );

      const parseSetting = (value: unknown) => {
        if (!value) return null;
        if (typeof value === "string") {
          try {
            return JSON.parse(value);
          } catch (e) {
            console.warn("[Middleware] Failed to parse settings JSON:", e);
            return null;
          }
        }
        return value;
      };

      const seoValue = parseSetting(settingsMap.seo_global);
      if (seoValue) locals.seo = seoValue as Record<string, unknown>;

      const siteInfo = parseSetting(settingsMap.site_info);
      if (siteInfo) locals.site_info = siteInfo as Record<string, unknown>;

      const contactInfo = parseSetting(settingsMap.contact_info);
      if (contactInfo) locals.contact_info = contactInfo as Record<string, unknown>;
    }

    // 9. Fetch Full Tenant Data
    if (tenantId) {
      const { data: tenantProfile } = await getTenant(
        SafeSupabase,
        tenantId,
        "id",
      );
      if (tenantProfile) {
        locals.tenant = tenantProfile;
      }
    }

    // Helper to add locale cookie to response
    const addLocaleCookie = async (response: Response): Promise<Response> => {
      if (localeFromUrl && locale) {
        // Clone the response and add the Set-Cookie header
        const newResponse = new Response(response.body, response);
        // Cookie expires in 1 year
        const expires = new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toUTCString();
        newResponse.headers.append(
          "Set-Cookie",
          `lang=${locale}; Path=/; Expires=${expires}; SameSite=Lax`,
        );
        return newResponse;
      }
      return response;
    };

    // Rewrite only if ref code was stripped (locale prefix is kept for page routing)
    if (refMatch) {
      // console.log(`[Middleware] Rewriting ref path: ${pathname} -> ${logicalPath}`);
      const response = await next(logicalPath);
      return addLocaleCookie(response);
    }

    const response = await next();
    return addLocaleCookie(response);
  } catch (e) {
    console.error("[Middleware] CRITICAL ERROR:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return new Response(`Critical Middleware Error: ${errorMessage}`, {
      status: 500,
    });
  }
});
