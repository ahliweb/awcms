import { defineMiddleware } from "astro/middleware";
import {
  createClientFromEnv,
  createScopedClient,
  getTenant,
} from "./lib/supabase";
import { extractPathAfterTenant, extractTenantFromPath } from "./lib/url";

const TRACKING_VISITOR_COOKIE = "awcms_visitor_id";
const TRACKING_SESSION_COOKIE = "awcms_session_id";
const CONSENT_COOKIE = "awcms_consent";

const parseCookies = (cookieHeader: string | null) => {
  if (!cookieHeader) return {} as Record<string, string>;
  return cookieHeader.split(";").reduce(
    (acc, chunk) => {
      const [rawKey, ...rawValue] = chunk.trim().split("=");
      if (!rawKey) return acc;
      acc[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.join("="));
      return acc;
    },
    {} as Record<string, string>,
  );
};

const buildCookie = (
  name: string,
  value: string,
  options: { maxAge?: number } = {},
) => {
  const segments = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAge) {
    segments.push(`Max-Age=${options.maxAge}`);
  }
  segments.push("Path=/");
  segments.push("SameSite=Lax");
  return segments.join("; ");
};

const getClientIp = (request: Request) => {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();

  return request.headers.get("x-real-ip") || "";
};

const detectDeviceType = (userAgent: string) => {
  const ua = userAgent.toLowerCase();
  if (/(ipad|tablet|kindle|playbook|silk)|(android(?!.*mobile))/i.test(ua)) {
    return "tablet";
  }
  if (/mobi|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    return "mobile";
  }
  if (/bot|crawler|spider|crawling/i.test(ua)) {
    return "bot";
  }
  return "desktop";
};

const shouldTrackRequest = (request: Request, pathname: string) => {
  if (request.method !== "GET") return false;
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("text/html")) return false;

  const skipPrefixes = [
    "/_astro",
    "/_image",
    "/favicon",
    "/robots",
    "/sitemap",
    "/manifest",
    "/assets",
  ];
  if (skipPrefixes.some((prefix) => pathname.startsWith(prefix))) return false;

  const skipExtensions = [
    ".ico",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".svg",
    ".gif",
    ".css",
    ".js",
    ".map",
    ".json",
    ".xml",
    ".txt",
  ];
  return !skipExtensions.some((ext) => pathname.endsWith(ext));
};

const ensureId = () => {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (!webCrypto?.getRandomValues) {
    throw new Error("Crypto unavailable for ID generation.");
  }
  if (typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `awcms-${hex}`;
};

/**
 * AWCMS Public Middleware
 *
 * Resolves tenant context from:
 * 1. Path parameter (PRIMARY - e.g., /primary/articles)
 * 2. Host/subdomain (FALLBACK - for legacy compatibility)
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) {
    return next();
  }

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
      const host =
        import.meta.env.DEV && import.meta.env.VITE_DEV_TENANT_HOST
          ? import.meta.env.VITE_DEV_TENANT_HOST
          : url.hostname || "";

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
      const host = url.hostname || "";

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
    locals.locale = locale === "id" || locale === "en" ? locale : "en";

    // 8. Fetch Tenant Settings (SEO + Site Info)
    if (tenantId) {
      const { data: settingsData } = await SafeSupabase.from("settings")
        .select("key, value")
        .eq("tenant_id", tenantId)
        .in("key", [
          "seo_global",
          "site_info",
          "contact_info",
          "analytics_consent",
        ]);

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
      if (contactInfo)
        locals.contact_info = contactInfo as Record<string, unknown>;

      const analyticsConsent = parseSetting(settingsMap.analytics_consent);
      if (analyticsConsent) {
        locals.analytics_consent = analyticsConsent as Record<string, unknown>;
      }
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

    const cookieHeader = request.headers.get("cookie");
    const cookies = parseCookies(cookieHeader);
    const cookieUpdates: string[] = [];

    if (localeFromUrl && locale) {
      const expires = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toUTCString();
      cookieUpdates.push(
        `lang=${locale}; Path=/; Expires=${expires}; SameSite=Lax`,
      );
    }

    const shouldTrack = shouldTrackRequest(request, pathname);
    let visitorId = cookies[TRACKING_VISITOR_COOKIE];
    let sessionId = cookies[TRACKING_SESSION_COOKIE];

    if (shouldTrack) {
      if (!visitorId) {
        visitorId = ensureId();
        cookieUpdates.push(
          buildCookie(TRACKING_VISITOR_COOKIE, visitorId, {
            maxAge: 60 * 60 * 24 * 365,
          }),
        );
      }

      if (!sessionId) {
        sessionId = ensureId();
      }
      cookieUpdates.push(
        buildCookie(TRACKING_SESSION_COOKIE, sessionId, { maxAge: 60 * 30 }),
      );
    }

    const applyCookies = (response: Response): Response => {
      if (cookieUpdates.length === 0) return response;
      const newResponse = new Response(response.body, response);
      cookieUpdates.forEach((cookie) => {
        newResponse.headers.append("Set-Cookie", cookie);
      });
      return newResponse;
    };

    if (shouldTrack && tenantId && visitorId && sessionId) {
      const analyticsClient = createScopedClient(
        { "x-tenant-id": tenantId },
        runtimeEnv,
      );

      if (analyticsClient) {
        const analyticsPath = resolvedFromPath
          ? extractPathAfterTenant(logicalPath)
          : logicalPath || "/";
        const normalizedPath = analyticsPath.startsWith("/")
          ? analyticsPath
          : `/${analyticsPath}`;

        const referrer = request.headers.get("referer") || "";
        const userAgent = request.headers.get("user-agent") || "";
        const deviceType = detectDeviceType(userAgent);
        const ipAddress = getClientIp(request);
        const consentState = cookies[CONSENT_COOKIE] || "unknown";
        const country = request.headers.get("cf-ipcountry") || "";
        const region =
          request.headers.get("cf-region") ||
          request.headers.get("cf-region-code") ||
          "";

        const utmSource = url.searchParams.get("utm_source") || "";
        const utmMedium = url.searchParams.get("utm_medium") || "";
        const utmCampaign = url.searchParams.get("utm_campaign") || "";
        const utmTerm = url.searchParams.get("utm_term") || "";
        const utmContent = url.searchParams.get("utm_content") || "";

        try {
          const { error } = await analyticsClient
            .from("analytics_events")
            .insert({
              tenant_id: tenantId,
              event_type: "page_view",
              path: normalizedPath,
              visitor_id: visitorId,
              session_id: sessionId,
              referrer: referrer || null,
              utm_source: utmSource || null,
              utm_medium: utmMedium || null,
              utm_campaign: utmCampaign || null,
              utm_term: utmTerm || null,
              utm_content: utmContent || null,
              ip_address: ipAddress || null,
              user_agent: userAgent || null,
              device_type: deviceType || null,
              country: country === "XX" ? null : country,
              region: region || null,
              consent_state: consentState || "unknown",
            });

          if (error) {
            console.warn("[Analytics] Failed to log page view:", error.message);
          }
        } catch (err) {
          console.warn("[Analytics] Logging error:", err);
        }
      }
    }

    // Rewrite only if ref code was stripped (locale prefix is kept for page routing)
    if (refMatch) {
      // console.log(`[Middleware] Rewriting ref path: ${pathname} -> ${logicalPath}`);
      const response = await next(logicalPath);
      return applyCookies(response);
    }

    const response = await next();
    return applyCookies(response);
  } catch (e) {
    console.error("[Middleware] CRITICAL ERROR:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return new Response(`Critical Middleware Error: ${errorMessage}`, {
      status: 500,
    });
  }
});
