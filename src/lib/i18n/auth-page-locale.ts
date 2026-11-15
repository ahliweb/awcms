/**
 * The language of the pre-session auth pages — `/login`, `/forgot-password`,
 * `/reset-password` (ADR-0095).
 *
 * These pages render before any session, so the middleware can resolve their
 * locale only from the cookie and `Accept-Language`
 * (`context.locals.locale`). This resolves the ADR-0095 chain one step further
 * than the middleware can, for these pages only:
 *
 *   cookie (an explicit choice) -> the tenant's default -> `Accept-Language` -> `en`
 *
 * The stored principal preference is not a step: there is no principal yet.
 *
 * ## The tenant step must not be an oracle
 *
 * The page's language is observable by anyone who can load it, so a tenant
 * default may be used ONLY when the tenant is already known to the page by a
 * route that tells the visitor nothing they could not already see:
 *
 *   - the single active tenant of a one-tenant deployment (the picker's
 *     `single` mode already prints that tenant's name on the page), or
 *   - the tenant carried by a reset link whose parameters were AUTHENTICATED
 *     (the sealed `?p=` shape — AES-256-GCM, so only this deployment can have
 *     issued it). A plain `?tenantId=` is attacker-chosen: honouring it would
 *     make the page language answer "does this tenant exist, and what is its
 *     default locale", so callers must pass `null` for it.
 *
 * Never from a typed or selected tenant id, never from the login identifier,
 * and never from whether an account exists. A failed lookup never fails the
 * page: it just contributes no opinion.
 */
import { getDatabaseClient } from "../database/client";
import type { Locale } from "./locales";
import { coerceLocale } from "./negotiate";
import { resolveRequestLocale, LOCALE_COOKIE_NAME } from "./request-locale";

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the default locale of an ACTIVE tenant; `null` when unknown or on any failure. */
export type TenantDefaultLocaleReader = (
  tenantId: string
) => Promise<string | null>;

/**
 * Builds the reader over a client getter. One root-table read with no tenant
 * context (there is none yet); `awcms_tenants` is the RLS-free root table, as
 * for the tenant picker. The UUID shape guard keeps arbitrary text away from
 * the query. The client is injected so a test can run it as the real
 * `awcms_app` role instead of whatever the process-wide client happens to be.
 */
export function createTenantDefaultLocaleReader(
  getClient: () => Bun.SQL
): TenantDefaultLocaleReader {
  return async (tenantId) => {
    if (!UUID_SHAPE.test(tenantId)) return null;

    try {
      const rows = (await getClient()`
        SELECT default_locale FROM awcms_tenants
        WHERE id = ${tenantId} AND status = 'active'
      `) as { default_locale: string | null }[];

      return rows[0]?.default_locale ?? null;
    } catch {
      return null;
    }
  };
}

/** The production reader: the runtime client (`awcms_app`). */
export const readActiveTenantDefaultLocale: TenantDefaultLocaleReader =
  createTenantDefaultLocaleReader(getDatabaseClient);

/**
 * Which tenant `/reset-password` may name to the resolver. ONLY the tenant that
 * came out of a SEALED link whose token also opened; a plain `?tenantId=` (or a
 * plain value alongside a broken seal) is attacker-chosen and yields `null`.
 * Pure, so the anti-oracle rule is tested by behaviour, not by source text.
 */
export function tenantForResetLocale(input: {
  /** The raw `?p=` value (empty when absent). */
  sealed: string;
  /** Whether the opened link carried a token. */
  hasToken: boolean;
  /** The tenant id taken from the opened seal, or `""` when none. */
  openedTenantId: string;
}): string | null {
  return input.sealed && input.hasToken && input.openedTenantId
    ? input.openedTenantId
    : null;
}

export async function resolveAuthPageLocale(input: {
  cookies: { get(name: string): { value: string } | undefined };
  request: Request;
  /**
   * A tenant the page knows WITHOUT an oracle (see the file header), or `null`.
   * The caller is responsible for that property; this function cannot check it.
   */
  tenantId: string | null;
  readTenantDefault?: TenantDefaultLocaleReader;
}): Promise<Locale> {
  const cookieValue = input.cookies.get(LOCALE_COOKIE_NAME)?.value ?? null;
  const acceptLanguage = input.request.headers.get("accept-language");
  let tenantDefault: string | null = null;

  // An explicit choice outranks the tenant's default, so the lookup is skipped for it.
  if (!coerceLocale(cookieValue) && input.tenantId) {
    try {
      tenantDefault = await (
        input.readTenantDefault ?? readActiveTenantDefaultLocale
      )(input.tenantId);
    } catch {
      tenantDefault = null;
    }
  }

  return resolveRequestLocale({ cookieValue, tenantDefault, acceptLanguage });
}

const AUTH_PAGE_PATH =
  /^\/(?:[a-z]{2}(?:-[A-Za-z0-9]+)?\/)?(?:login|forgot-password|reset-password)\/?$/;

/** Whether `pathname` is one of the pre-session auth pages. */
export function isAuthPagePath(pathname: string): boolean {
  return AUTH_PAGE_PATH.test(pathname);
}

/**
 * The body of these pages varies with the language cookie and
 * `Accept-Language`, so no shared cache may store one. This is stamped
 * UNCONDITIONALLY — it does not depend on `EDGE_CACHE_MODE`, which is off by
 * default and then leaves a response with no cache headers at all (a cache in
 * front of the origin could serve one reader's language to another).
 * `Vary` is appended, not replaced. Returns the same response.
 */
export function applyAuthPageCacheHeaders(
  pathname: string,
  response: Response
): Response {
  if (!isAuthPagePath(pathname)) return response;

  response.headers.set("Cache-Control", "private, no-store");

  const present = (response.headers.get("Vary") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  const missing = ["Cookie", "Accept-Language"].filter(
    (name) => !present.includes(name.toLowerCase())
  );

  if (!present.includes("*") && missing.length > 0) {
    const existing = response.headers.get("Vary");
    response.headers.set(
      "Vary",
      existing ? `${existing}, ${missing.join(", ")}` : missing.join(", ")
    );
  }

  return response;
}
