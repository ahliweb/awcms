import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  grantMarketingConsent,
  listConsents,
  type ConsentEntry
} from "../../../../../modules/whatsapp-delivery/application/whatsapp-consent-directory";
import { resolveWhatsappDefaultCountryCode } from "../../../../../modules/whatsapp-delivery/domain/whatsapp-config";
import { validateConsentGrantInput } from "../../../../../modules/whatsapp-delivery/domain/whatsapp-validation";
import {
  loadSenderAccess,
  type SenderAccess,
  type SenderAccessContext,
  type SenderAccessGuard
} from "../../../../../modules/whatsapp-delivery/infrastructure/channel-account-access-loader";

/**
 * Issue #1231 audit L-1: a consent row may list several brands, and which
 * brands a person opted in for is itself information about another brand's
 * customers. A caller sees only the brands they HOLD (the business-scope rule of
 * `channel_accounts`, decided once per scope per request through the access
 * chokepoint). With the channel module unavailable, no brand is shown (default
 * deny); the rest of the entry (masked number, status) is unchanged.
 */
async function onlyHeldScopes(
  context: SenderAccessContext,
  access: SenderAccess | null,
  guard: SenderAccessGuard,
  entries: ConsentEntry[]
): Promise<ConsentEntry[]> {
  const filtered: ConsentEntry[] = [];

  for (const entry of entries) {
    const kept: ConsentEntry["businessScopes"] = [];

    if (access) {
      for (const grant of entry.businessScopes) {
        if (
          await access.scopeCovered(context, guard, {
            type: grant.type,
            id: grant.id
          })
        ) {
          kept.push(grant);
        }
      }
    }

    filtered.push({ ...entry, businessScopes: kept });
  }

  return filtered;
}

/**
 * `GET /api/v1/whatsapp/consents` (Issue #963) — recorded marketing consents,
 * masked recipients only. Consent is a per-recipient record; nothing about
 * segments or campaign audiences is stored or returned here. `businessScopes`
 * lists only the brands the caller holds (Issue #1231 audit L-1).
 */
export const GET = defineTenantRoute<{
  status?: "granted" | "withdrawn";
  limit: number;
}>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const status = (url.searchParams.get("status") ?? "").trim();

    if (status !== "" && status !== "granted" && status !== "withdrawn") {
      return fail(
        422,
        "VALIDATION_FAILED",
        "status must be granted or withdrawn."
      );
    }

    const raw = (url.searchParams.get("limit") ?? "").trim();
    const limit = raw === "" ? 50 : Number(raw);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return fail(
        422,
        "VALIDATION_FAILED",
        "limit must be an integer between 1 and 200."
      );
    }

    return { ...(status === "" ? {} : { status }), limit };
  },
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "consents",
    action: "read"
  },
  handler: async (context) => {
    const { tx, tenantId, prepared } = context;
    const page = await listConsents(tx, tenantId, {
      ...(prepared.status ? { status: prepared.status } : {}),
      limit: prepared.limit
    });
    const entries = await onlyHeldScopes(
      context,
      await loadSenderAccess(),
      {
        moduleKey: "whatsapp_delivery",
        activityCode: "consents",
        action: "read"
      },
      page.entries
    );

    return ok({ entries, hasMore: page.hasMore });
  }
});

/**
 * `POST /api/v1/whatsapp/consents` (Issue #963) — record an explicit marketing
 * opt-in with its source (ADR-0133 section 4: "explicit, per recipient, per
 * channel, recorded opt-in with source and time"). Naturally idempotent for a
 * granted row: the unique key is (tenant, recipient, purpose), so a retry
 * re-stamps the same row instead of adding one. The body is validated AFTER
 * authorization.
 *
 * ## Reinstating over an opt-out is a different, high-risk act
 *
 * A grant over a WITHDRAWN row reverses someone's opt-out, so it is never
 * implicit: it is refused (409) unless the body says `reinstateWithdrawn: true`
 * with an `evidenceRef`, it needs `consents.restore` (high-risk) INSTEAD of
 * `consents.create`, it is refused for `source: "import"`, and the withdrawal
 * stays in the row's `withdrawal_history`. The primary guard only proves the
 * caller holds one of the two keys; the handler then authorizes the one THIS
 * body needs, so holding `create` alone cannot reinstate.
 *
 * ## The brand it was collected for (Issue #1231 M4, option (c))
 *
 * `businessScope` records the brand the opt-in was collected for; marketing of
 * that brand is then eligible, marketing of another brand is not. Omitted or
 * `null` is an opt-in for the tenant itself, which covers only marketing that
 * names no scope. The scope is a REQUEST, not a fact: the caller must hold it
 * through the access chokepoint (the business-scope confinement of
 * `channel_accounts`, the same rule as the sender policy), it must resolve to a
 * real scope of this tenant (`422 SCOPE_UNRESOLVED`), and a caller confined to
 * brands cannot record the unscoped, tenant-level opt-in (`403`). Default-deny
 * when the channel module cannot be loaded.
 */
export const POST = defineTenantRoute<{ payload: unknown }>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const read = await readJsonBody(request);

    if (read.tooLarge) {
      return bodyTooLargeResponse(read.limitBytes);
    }

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { payload: read.value };
  },
  authorize: [
    {
      moduleKey: "whatsapp_delivery",
      activityCode: "consents",
      action: "create"
    },
    {
      moduleKey: "whatsapp_delivery",
      activityCode: "consents",
      action: "restore"
    }
  ],
  handler: async (context) => {
    const {
      tx,
      tenantId,
      auth,
      prepared,
      locals,
      request,
      clientAddress,
      tokenHash,
      now
    } = context;
    const validation = validateConsentGrantInput(
      prepared.payload,
      resolveWhatsappDefaultCountryCode()
    );

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Consent request is invalid.",
        {},
        validation.errors
      );
    }

    const reinstating = validation.value.reinstateWithdrawn === true;
    const needed = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      {
        moduleKey: "whatsapp_delivery",
        activityCode: "consents",
        action: reinstating ? "restore" : "create"
      },
      { clientIp: resolveClientIp(request, clientAddress) }
    );

    if (!needed.allowed) {
      return needed.denied;
    }

    const access = await loadSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

    const scopeRefusal = await access.authorizeScope(
      context,
      {
        moduleKey: "whatsapp_delivery",
        activityCode: "consents",
        action: reinstating ? "restore" : "create"
      },
      validation.value.businessScope
    );

    if (scopeRefusal) return scopeRefusal;

    const result = await grantMarketingConsent(
      tx,
      tenantId,
      auth.context.tenantUserId,
      validation.value,
      { correlationId: locals.correlationId }
    );

    if (result.outcome === "misconfigured") {
      return fail(
        503,
        "WHATSAPP_HASH_KEYS_UNAVAILABLE",
        "WhatsApp recipient hashing is not configured on this deployment."
      );
    }

    if (result.outcome === "invalid_phone") {
      return fail(400, "VALIDATION_ERROR", result.reason);
    }

    if (result.outcome === "withdrawn_requires_reinstatement") {
      return fail(
        409,
        "CONSENT_WITHDRAWN",
        "That recipient opted out. Reinstating needs reinstateWithdrawn, an evidenceRef and the consents.restore permission."
      );
    }

    if (result.outcome === "scope_limit_reached") {
      return fail(
        422,
        "CONSENT_SCOPE_LIMIT",
        "This consent already lists the maximum number of brands."
      );
    }

    if (result.outcome === "reinstatement_refused") {
      return fail(
        422,
        "REINSTATEMENT_REFUSED",
        result.reason === "import_source"
          ? "An opt-out cannot be reversed by an import."
          : "Reinstating an opt-out needs an evidenceRef."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "whatsapp_delivery",
      action: result.reinstated
        ? "whatsapp_consent.reinstated"
        : "whatsapp_consent.granted",
      resourceType: "whatsapp_consent",
      resourceId: result.entry.id,
      severity: result.reinstated ? "warning" : "info",
      message: result.reinstated
        ? "WhatsApp marketing opt-in reinstated over a recorded opt-out."
        : "WhatsApp marketing consent recorded.",
      attributes: {
        purpose: result.entry.purpose,
        source: result.entry.source,
        recipientMasked: result.entry.recipientMasked,
        businessScope: validation.value.businessScope,
        ...(result.reinstated
          ? { evidenceRef: validation.value.evidenceRef }
          : {})
      },
      correlationId: locals.correlationId
    });

    const [entry] = await onlyHeldScopes(
      context,
      access,
      {
        moduleKey: "whatsapp_delivery",
        activityCode: "consents",
        action: reinstating ? "restore" : "create"
      },
      [result.entry]
    );

    return ok(entry);
  }
});
