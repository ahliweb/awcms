import {
  created,
  fail,
  jsonResponse
} from "../../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { isMachineCredentialToken } from "../../../../../lib/auth/machine-credential-token";
import { resolveTenantPrincipal } from "../../../../../modules/identity-access/application/auth-context";
import { isTenantServiceStopped } from "../../../../../modules/identity-access/domain/suspended-tenant-allowlist";
import {
  listPushSubscriptions,
  registerPushSubscription
} from "../../../../../modules/push-delivery/application/subscription-directory";
import { validateSubscriptionInput } from "../../../../../modules/push-delivery/domain/subscription-input";
import { isPushEnabled } from "../../../../../modules/push-delivery/domain/push-config";
import { parseVapidConfig } from "../../../../../modules/push-delivery/domain/vapid-config";
import { summarizeUserAgent } from "../../../../../lib/security/client-fingerprint";

/**
 * `GET|POST /api/v1/push/subscriptions` (Issue #466) — a person's OWN devices.
 *
 * ## Why self-service and not a permission
 *
 * `defineSelfServiceTenantRoute` exists for endpoints whose subject is the
 * caller (ADR-0049 §7). Registering the browser you are sitting in front of is
 * the clearest case there is: the answer to "may I subscribe this device?" is
 * "you are holding its session", and there is no id to compare against anything
 * because the route never accepts one — `tenantUserId` comes from the resolved
 * session and from nowhere else.
 *
 * Inventing a `push_delivery.subscriptions.create` permission instead would be
 * the latent-authz trap this repo has hit before: an action no role seeds, so
 * enabling notifications silently 403s for every user including the owner,
 * while the calling code reads as though it were correctly guarded. Push
 * notifications are for ordinary users, and a permission wall in front of them
 * is a wall in front of the feature.
 *
 * What DOES belong to a permission — seeing everybody's devices, cancelling
 * queued messages, sending a test — lives at `/api/v1/push/diagnostics` and its
 * siblings, behind the chokepoint.
 *
 * ## A suspended tenant may not register
 *
 * ADR-0073 made suspension a SERVICE status rather than a login status, and the
 * chokepoint enforces it for every guarded route. A self-service route has no
 * chokepoint, so it does the same check by hand — otherwise the one class of
 * endpoint that skips the guard would become the one place a suspended tenant
 * can still add outbound capacity.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

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

function onUnauthenticated(reason: "tenant" | "token"): Response {
  return reason === "tenant"
    ? fail(
        400,
        "TENANT_REQUIRED",
        "Tenant header `x-awcms-tenant-id` is required.",
        {},
        undefined,
        NO_STORE_HEADERS
      )
    : authRequired();
}

/**
 * What the browser needs before it can call `PushManager.subscribe()`.
 *
 * Returned with the device list rather than from an endpoint of its own: the
 * client needs both in the same breath, and a second round trip for a value
 * that is public by definition (it IS the `applicationServerKey` handed to the
 * browser) would be latency bought for nothing.
 *
 * `enabled: false` is a first-class answer, not an error. A deployment with no
 * VAPID key pair configured is a normal deployment — the offline/LAN profile is
 * exactly that — and the page's job is to say "push is not configured here",
 * which it cannot do if this 500s.
 */
function webPushCapability(): {
  enabled: boolean;
  applicationServerKey: string | null;
} {
  if (!isPushEnabled()) return { enabled: false, applicationServerKey: null };

  const vapid = parseVapidConfig(process.env);

  return vapid.ok
    ? { enabled: true, applicationServerKey: vapid.config.publicKey }
    : { enabled: false, applicationServerKey: null };
}

export const GET = defineSelfServiceTenantRoute({
  workClass: "interactive",
  onUnauthenticated,
  beforeTransaction: ({ token }) =>
    // A machine credential has no browser and no device. Refused with the
    // ordinary 401 before any database work, the same anti-oracle shape
    // `auth/session.ts` uses.
    isMachineCredentialToken(token) ? authRequired() : undefined,
  handler: async ({ tx, tenantId, tokenHash, now }) => {
    const principal = await resolveTenantPrincipal(
      tx,
      tenantId,
      tokenHash,
      now
    );

    if (!principal) return authRequired();

    const subscriptions = await listPushSubscriptions(tx, tenantId, {
      tenantUserId: principal.context.tenantUserId
    });

    return jsonResponse(
      {
        success: true,
        data: { subscriptions, webPush: webPushCapability() },
        meta: {}
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});

export const POST = defineSelfServiceTenantRoute({
  workClass: "interactive",
  onUnauthenticated,
  beforeTransaction: ({ token }) =>
    isMachineCredentialToken(token) ? authRequired() : undefined,
  handler: async ({ tx, tenantId, tokenHash, now, request }) => {
    const principal = await resolveTenantPrincipal(
      tx,
      tenantId,
      tokenHash,
      now
    );

    if (!principal) return authRequired();

    if (isTenantServiceStopped(principal.tenantStatus)) {
      return fail(
        403,
        "TENANT_SUSPENDED",
        "This tenant is suspended; new device registrations are not accepted."
      );
    }

    const body = await readJsonBody(request);

    if (body.tooLarge) return bodyTooLargeResponse(body.limitBytes);

    const validation = validateSubscriptionInput(body.value);

    if (!validation.valid) {
      return fail(
        422,
        "VALIDATION_FAILED",
        "Push subscription payload is invalid.",
        {},
        validation.errors
      );
    }

    const subscription = await registerPushSubscription(tx, tenantId, {
      tenantUserId: principal.context.tenantUserId,
      ...validation.value,
      userAgentSummary: summarizeUserAgent(request)
    });

    // 201 even when the row already existed and was merely re-activated.
    // Browsers re-issue `PushManager.subscribe()` on every page load once
    // permission is granted, so "created" versus "already yours" is a
    // distinction the client cannot act on and would only tempt it to branch.
    return created({ subscription });
  }
});
