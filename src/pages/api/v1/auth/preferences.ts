/**
 * `GET|POST /api/v1/auth/preferences` — the signed-in human's display
 * preferences (ADR-0095).
 *
 * ## No permission, deliberately
 *
 * Self-service, on the same reasoning as `GET /api/v1/auth/sessions`: the subject
 * IS the caller, and neither verb accepts a `tenantUserId` to act on. Inventing
 * an `identity_access.preferences.update` permission would install the
 * latent-authz trap ADR-0058 §E describes — an action nothing seeds denies
 * everyone, tenant owner included, while the route reads as correctly guarded.
 *
 * Changing somebody ELSE's language is not a feature, so there is no permissioned
 * sibling to point at.
 *
 * ## Why POST also sets the cookie
 *
 * The stored preference is the DURABLE copy — it follows the human to their next
 * device. The cookie is the IMMEDIATE one: it outranks the stored value in
 * `resolveRequestLocale`, so the page the reader is looking at changes language on
 * the next render rather than on their next login. Writing only the row would
 * make the switch appear not to work; writing only the cookie is what
 * `/api/v1/auth/preferences/locale` does for readers who have no session yet.
 *
 * ## Why `theme` lives here too
 *
 * `ThemeToggle` has always persisted to `localStorage`, which is per-device by
 * construction. That stays the fast path — the toggle keeps working with no
 * network at all — and this endpoint adds the durable copy, which
 * `AdminLayout` feeds to the head script through `data-tenant-default-theme`. The
 * precedence falls out correctly without touching the init script's bytes (and so
 * without invalidating its CSP hash): `localStorage` wins on a device the reader
 * has used, the stored preference applies on a new one.
 */
import { fail, jsonResponse } from "../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME
} from "../../../../lib/i18n/request-locale";
import { coerceLocale } from "../../../../lib/i18n/negotiate";
import { sameOriginPathOr } from "../../../../lib/security/same-origin-path";
import {
  coerceThemeMode,
  readPreferences,
  resolvePrincipalIdForIdentity,
  writePreferences,
  type ThemeMode
} from "../../../../modules/identity-access/application/principal-preference-store";
import { resolveActiveSession } from "../../../../modules/identity-access/application/session-lookup";
import type { Locale } from "../../../../lib/i18n/locales";

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

/**
 * Generous, because the cost of a false refusal here is a reader stuck in a
 * language they cannot read, and the cost of an accepted call is one upsert of a
 * two-character string. It exists to stop a script hammering the endpoint, not to
 * ration a legitimate person's clicks.
 */
const RATE_LIMIT = { maxAttempts: 60, windowMs: 60_000 };

function authRequired(): Response {
  return fail(
    401,
    "AUTH_REQUIRED",
    "Authentication required.",
    {},
    undefined,
    NO_STORE_HEADERS
  );
}

function tenantRequired(): Response {
  return fail(
    400,
    "TENANT_REQUIRED",
    "Tenant context is required.",
    {},
    undefined,
    NO_STORE_HEADERS
  );
}

/** See the identical helper in `preferences/locale.ts` for why this is needed. */
function safeReturnTo(raw: string | null): string {
  return sameOriginPathOr(raw, "/admin");
}

interface SubmittedPreferences {
  /** Absent = "not submitted, leave alone"; null = "reset to not chosen". */
  readonly locale?: Locale | null;
  readonly theme?: ThemeMode | null;
  readonly wantsRedirect: boolean;
  readonly returnTo: string | null;
}

/**
 * Reads the body BEFORE the transaction opens.
 *
 * That placement is not cosmetic: `await request.formData()` waits on the CLIENT,
 * and doing it inside `withTenant` would hold a reserved pool connection — and
 * its work-class slot — for as long as a caller chooses to take sending its body.
 * `prepare` exists for exactly this.
 *
 * The absent/null distinction is load-bearing. sql/128 models "not chosen" as
 * `NULL` and withholds `DELETE`, so a reset must be expressible; but a request
 * that mentions only `locale` must not thereby wipe `theme`. Absent and null
 * therefore cannot collapse into one value.
 */
async function readSubmission(
  request: Request
): Promise<SubmittedPreferences | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const wantsRedirect = contentType.includes(
    "application/x-www-form-urlencoded"
  );

  try {
    if (wantsRedirect) {
      const form = await request.formData();
      const rawLocale = form.get("locale")?.toString() ?? null;
      const locale = coerceLocale(rawLocale);

      // A form that names an unsupported locale is a bug in the form, not a
      // reset request — answering 400 beats silently clearing the preference.
      if (rawLocale !== null && locale === null) {
        return fail(
          400,
          "UNSUPPORTED_LOCALE",
          "Requested locale is not supported by this build.",
          {},
          undefined,
          NO_STORE_HEADERS
        );
      }

      return {
        ...(rawLocale === null ? {} : { locale }),
        wantsRedirect: true,
        returnTo: form.get("return_to")?.toString() ?? null
      };
    }

    const body = (await request.json()) as Record<string, unknown> | null;

    if (!body || typeof body !== "object") {
      return fail(
        400,
        "INVALID_BODY",
        "Request body must be a JSON object.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    const submission: {
      locale?: Locale | null;
      theme?: ThemeMode | null;
    } = {};

    if ("locale" in body) {
      const value = body.locale;

      if (value === null) {
        submission.locale = null;
      } else {
        const locale = coerceLocale(value);

        if (!locale) {
          return fail(
            400,
            "UNSUPPORTED_LOCALE",
            "Requested locale is not supported by this build.",
            {},
            undefined,
            NO_STORE_HEADERS
          );
        }

        submission.locale = locale;
      }
    }

    if ("theme" in body) {
      const value = body.theme;

      if (value === null) {
        submission.theme = null;
      } else {
        const theme = coerceThemeMode(value);

        if (!theme) {
          return fail(
            400,
            "UNSUPPORTED_THEME",
            "Theme must be one of: system, light, dark.",
            {},
            undefined,
            NO_STORE_HEADERS
          );
        }

        submission.theme = theme;
      }
    }

    return { ...submission, wantsRedirect: false, returnTo: null };
  } catch {
    return fail(
      400,
      "INVALID_BODY",
      "Request body could not be read.",
      {},
      undefined,
      NO_STORE_HEADERS
    );
  }
}

export const GET = defineSelfServiceTenantRoute({
  workClass: "interactive",
  onUnauthenticated: (reason) =>
    reason === "tenant" ? tenantRequired() : authRequired(),
  handler: async ({ tx, tenantId, tokenHash, now }) => {
    const session = await resolveActiveSession(tx, tenantId, tokenHash, now);

    if (!session) return authRequired();

    const principalId = await resolvePrincipalIdForIdentity(
      tx,
      tenantId,
      session.identity_id
    );
    const preferences = await readPreferences(tx, principalId);

    return jsonResponse(
      {
        success: true,
        data: {
          locale: preferences.locale,
          theme: preferences.theme,
          // Stated so a client can render "follow tenant default (Indonesian)"
          // rather than an empty control it cannot explain.
          storable: principalId !== null
        },
        meta: {}
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});

export const POST = defineSelfServiceTenantRoute<SubmittedPreferences>({
  workClass: "interactive",
  onUnauthenticated: (reason) =>
    reason === "tenant" ? tenantRequired() : authRequired(),
  beforeTransaction: async ({ request, clientAddress }) => {
    const limit = await checkSharedRateLimit(
      `auth-preferences:${resolveClientIp(request, clientAddress)}`,
      RATE_LIMIT
    );

    return limit.allowed
      ? undefined
      : fail(
          429,
          "RATE_LIMITED",
          "Too many preference updates. Try again shortly.",
          {},
          undefined,
          NO_STORE_HEADERS
        );
  },
  prepare: ({ request }) => readSubmission(request),
  handler: async ({ tx, tenantId, tokenHash, now, cookies, prepared }) => {
    const session = await resolveActiveSession(tx, tenantId, tokenHash, now);

    if (!session) return authRequired();

    const principalId = await resolvePrincipalIdForIdentity(
      tx,
      tenantId,
      session.identity_id
    );

    // Read-then-write inside ONE transaction, so the axis this request does not
    // mention is carried forward rather than nulled. Two concurrent updates from
    // the same person cannot interleave into a lost theme: the row is locked by
    // the upsert, and the read that feeds it is in the same transaction.
    const existing = principalId
      ? await readPreferences(tx, principalId)
      : { locale: null, theme: null };

    const nextLocale =
      "locale" in prepared ? (prepared.locale ?? null) : existing.locale;
    const nextTheme =
      "theme" in prepared ? (prepared.theme ?? null) : existing.theme;

    // An identity with no principal (sql/112 §3 leaves that legal) has nowhere
    // durable to write. The cookie below still applies, so the switch works for
    // this browser and simply does not follow them elsewhere.
    if (principalId) {
      await writePreferences(tx, principalId, {
        locale: nextLocale,
        theme: nextTheme
      });
    }

    // The cookie is what makes the change visible on the NEXT render rather than
    // the next login. Only set when a locale was actually chosen: a reset
    // (`locale: null`) must clear the override so the tenant default and
    // `Accept-Language` can be reached again.
    if (nextLocale) {
      cookies.set(LOCALE_COOKIE_NAME, nextLocale, {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
        secure: process.env.AUTH_COOKIE_SECURE === "true"
      });
    } else if ("locale" in prepared) {
      cookies.delete(LOCALE_COOKIE_NAME, { path: "/" });
    }

    if (prepared.wantsRedirect) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: safeReturnTo(prepared.returnTo),
          ...NO_STORE_HEADERS
        }
      });
    }

    return jsonResponse(
      {
        success: true,
        data: {
          locale: nextLocale,
          theme: nextTheme,
          persisted: principalId !== null
        },
        meta: {}
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
