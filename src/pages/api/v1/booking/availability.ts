import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { checkSharedRateLimit } from "../../../../lib/security/rate-limit";
import { answerAvailability } from "../../../../modules/booking/application/booking-availability-directory";
import { resolveStaffAvailability } from "../../../../modules/booking/application/booking-staff-availability-consumer";
import { loadStaffAvailabilityPort } from "../../../../modules/booking/module";
import { BOOKING_GUARDS } from "../../../../modules/booking/domain/booking-permissions";
import {
  parseAvailabilityQuery,
  type AvailabilityRequest
} from "../../../../modules/booking/domain/booking-validation";

/**
 * Keyed on the AUTHENTICATED principal (a tenant user id is globally unique), never
 * on the tenant header: a key an attacker can rotate buys nothing
 * (tests/auth-source-rate-limit.test.ts).
 *
 * One availability search is a handful of indexed reads plus a pure calculation,
 * but it is the endpoint a public-facing adapter will hammer, so it is limited
 * per principal: the thing that can loop is a caller holding a token.
 */
const RATE_LIMIT = { maxAttempts: 120, windowMs: 60_000 };

/**
 * `GET /api/v1/booking/availability` -- is there room? Read-only: it persists
 * nothing, claims nothing, and the answer can be stale by the time it is read
 * (the allocator's exclusion constraint, not this endpoint, is what prevents a
 * double booking). Gated by `booking.availability.read`.
 *
 * A slot resource is asked with `from`/`to` (RFC 3339 with an offset, a window
 * of at most 31 days); a stay resource with `checkInDate`/`checkOutDate`.
 * Slots are bounded (`limit`, 500 at most, `truncated` says whether more
 * exist).
 */
export const GET = defineTenantRoute<AvailabilityRequest>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const parsed = parseAvailabilityQuery(url.searchParams);

    return parsed.valid
      ? parsed.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, parsed.errors);
  },
  authorize: BOOKING_GUARDS.availability.read,
  handler: async ({ tx, tenantId, tokenHash, auth, prepared, now }) => {
    const limited = await checkSharedRateLimit(
      `booking-availability:${auth.context.tenantUserId ?? tokenHash}`,
      RATE_LIMIT,
      now.getTime()
    );

    if (!limited.allowed) {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many availability searches. Try again shortly.",
        {},
        undefined,
        { "retry-after": String(limited.retryAfterSec) }
      );
    }

    const staff = await resolveStaffAvailability(
      tx,
      tenantId,
      loadStaffAvailabilityPort
    );
    const result = await answerAvailability(tx, tenantId, prepared, staff);

    switch (result.outcome) {
      case "ok":
        return ok(result.answer, {}, { "cache-control": "private, no-store" });
      case "not_found":
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          result.what === "resource"
            ? "Resource not found."
            : "Service offering not found."
        );
      case "mode_mismatch":
        return fail(409, "BOOKING_MODE_MISMATCH", result.message);
      case "too_many_units":
        return fail(
          422,
          "QUANTITY_EXCEEDS_UNITS",
          `The resource has ${result.units} active unit(s); quantity is larger.`
        );
    }
  }
});
