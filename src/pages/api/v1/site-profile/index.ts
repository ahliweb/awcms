import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import {
  validateSiteProfileInput,
  type SiteProfileInput
} from "../../../../modules/site-profile/domain/site-profile-validation";
import {
  fetchSiteProfile,
  upsertSiteProfile
} from "../../../../modules/site-profile/application/site-profile-directory";
import {
  SITE_PROFILE_ACTIVITY_CODE,
  SITE_PROFILE_MODULE_KEY
} from "../../../../modules/site-profile/domain/site-profile-permissions";

/**
 * `GET`/`PUT /api/v1/site-profile` (Issue #596, ADR-0102) — this tenant's site
 * chrome: masthead tagline, footer copyright, logo/favicon, editorial address,
 * contact details and social links.
 *
 * `PUT` is a FULL REPLACE, not a patch. Every field is optional and every
 * absent one is stored as `null`, which is what the screen sends: a form that
 * submits its whole state cannot express "leave this one alone", and pretending
 * otherwise would make clearing a wrong phone number impossible.
 *
 * It requires an `Idempotency-Key` and is audited. That is not ceremony for a
 * settings screen — these values render on EVERY public page, so a change here
 * changes what every reader of the site sees, and "who changed the newsroom's
 * published address" is a question that gets asked.
 */

const IDEMPOTENCY_SCOPE = "site_profile_update";

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: SITE_PROFILE_MODULE_KEY,
    activityCode: SITE_PROFILE_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId }) =>
    // Never `null`: a tenant that has saved nothing gets the empty profile, so
    // a consumer has one shape to render and never branches on "no row yet".
    ok(await fetchSiteProfile(tx, tenantId))
});

type Prepared = { idempotencyKey: string; input: SiteProfileInput };

export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  // Body read and validation happen here, BEFORE the tenant transaction opens:
  // neither touches the database, so an unauthorized caller costs an in-memory
  // parse rather than a pooled connection, and nothing is written before
  // authorization either way.
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateSiteProfileInput(bodyRead.value);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Site profile is invalid.",
        {},
        validation.errors
      );
    }

    return { idempotencyKey, input: validation.value };
  },
  authorize: {
    moduleKey: SITE_PROFILE_MODULE_KEY,
    activityCode: SITE_PROFILE_ACTIVITY_CODE,
    action: "update"
  },
  handler: async ({ tx, auth, prepared, tenantId, locals }) => {
    const requestHash = computeRequestHash(prepared.input);

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const saved = await upsertSiteProfile(
      tx,
      tenantId,
      prepared.input,
      auth.context.tenantUserId
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: SITE_PROFILE_MODULE_KEY,
      action: "site_profile.profile.update",
      resourceType: "site_profile",
      resourceId: tenantId,
      severity: "info",
      message: "Tenant site profile updated.",
      // The VALUES are deliberately absent — an editorial address and a phone
      // number are contact data, and the audit log is read by more people than
      // the screen is. Recording WHICH FIELDS are now set answers "who blanked
      // the contact block" without copying that data into a second store.
      attributes: {
        fieldsSet: Object.entries(saved)
          .filter(([, value]) =>
            Array.isArray(value) ? value.length > 0 : value !== null
          )
          .map(([field]) => field)
          .sort()
      },
      correlationId: locals.correlationId
    });

    const responseBody = { success: true as const, data: saved };

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      responseBody
    );

    return jsonResponse(responseBody, { status: 200 });
  }
});
