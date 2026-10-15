/**
 * `booking` allocation and hold-expiry rules as PURE functions (Issue #939,
 * ADR-0131; docs/awcms/booking.md section 5.1 and 8.1).
 *
 * Nothing here touches a database, a clock or the network. The application layer
 * (`application/booking-allocator.ts`, `booking-hold-expiry.ts`,
 * `booking-hold-service.ts`) reads the facts, calls these functions and writes the
 * answer. What lives here is what a test can pin without PostgreSQL: how long a
 * hold lives, which occupied range a slot claims, in which order units are
 * attempted, how a database error maps to a refusal, and how long a deadlocked
 * writer waits before it retries.
 *
 * ## The guarantee is not in this file
 *
 * The guarantee against double-booking is the exclusion constraint of `sql/180`
 * (booking.md section 4 and 8.1). Nothing in this module -- and nothing in the
 * allocator that calls it -- is what makes a second claim for a held unit fail:
 * it is what makes the loser's answer a named refusal rather than a raw database
 * error, and what keeps the common case to one INSERT per unit.
 */
import { isLocalDate } from "./booking-time";
import { STAY_REFUSALS } from "./booking-stay";

/** Hold lifetime, in seconds (booking.md section 5.1: clamped to `[60, max_hold_seconds]`, default 900, max 86 400). */
export const HOLD_LIMITS = {
  minSeconds: 60,
  defaultSeconds: 900,
  maxSeconds: 86_400
} as const;

export const ALLOCATOR_LIMITS = {
  /** A resource has at most this many units (CHECK in `sql/180`); a claim is `k` inserts, so `k` is capped with it. */
  maxUnitsPerClaim: 500,
  /**
   * How many times one claim re-reads the free units after losing a race. Each
   * round that lost to a concurrent writer finds that writer's row committed (or
   * waited for it), so a handful of rounds is "lost every race there was", not
   * "try forever".
   */
  maxRounds: 6,
  /** Candidates read beyond the units still needed, so one lost race does not cost a round trip. */
  candidateSlack: 16,
  /** A deadlocked claim is retried at most this many times (booking.md section 8.1 rule 3), then refused. */
  maxDeadlockRetries: 3,
  /** Exponential backoff base for those retries, milliseconds. */
  retryBaseMs: 20
} as const;

export type HoldPolicy = {
  /** `settings.default_hold_seconds`, `null` = module default. */
  tenantDefaultSeconds: number | null;
  /** `settings.max_hold_seconds`, `null` = module maximum. */
  tenantMaxSeconds: number | null;
};

/**
 * The hold lifetime for a request: the caller's `holdSeconds` (or the tenant's
 * default, or the module's) clamped to `[60, max]`. Integer seconds; a NaN or
 * non-positive request falls back to the default rather than producing a hold
 * that expires immediately or never.
 */
export function resolveHoldSeconds(
  requested: number | null | undefined,
  policy: HoldPolicy
): number {
  const max = Math.min(
    policy.tenantMaxSeconds ?? HOLD_LIMITS.maxSeconds,
    HOLD_LIMITS.maxSeconds
  );
  const fallback = Math.min(
    policy.tenantDefaultSeconds ?? HOLD_LIMITS.defaultSeconds,
    max
  );
  const wanted =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : fallback;

  return Math.max(HOLD_LIMITS.minSeconds, Math.min(wanted, max));
}

export type SlotWindowInput = {
  startsAtMs: number;
  durationSeconds: number;
  setupSeconds: number;
  cleanupSeconds: number;
};

export type SlotWindow = {
  startsAtMs: number;
  endsAtMs: number;
  /** `[occupiedFromMs, occupiedToMs)` is what the exclusion constraint tests (booking.md section 2.3). */
  occupiedFromMs: number;
  occupiedToMs: number;
};

/**
 * The service interval and the occupied range of one slot. The occupied range is
 * the service interval widened by the offering's setup before and cleanup after;
 * both are snapshotted onto the item, so editing the offering never rewrites a
 * booking. Returns `null` for input that cannot describe a slot.
 */
export function deriveSlotWindow(input: SlotWindowInput): SlotWindow | null {
  const { startsAtMs, durationSeconds, setupSeconds, cleanupSeconds } = input;

  if (
    !Number.isSafeInteger(startsAtMs) ||
    !Number.isSafeInteger(durationSeconds) ||
    !Number.isSafeInteger(setupSeconds) ||
    !Number.isSafeInteger(cleanupSeconds) ||
    durationSeconds <= 0 ||
    setupSeconds < 0 ||
    cleanupSeconds < 0
  ) {
    return null;
  }

  const endsAtMs = startsAtMs + durationSeconds * 1000;

  return {
    startsAtMs,
    endsAtMs,
    occupiedFromMs: startsAtMs - setupSeconds * 1000,
    occupiedToMs: endsAtMs + cleanupSeconds * 1000
  };
}

/** Byte-wise (code-unit) comparison: locale-independent, so every process agrees on the order. */
export function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type UnitRef = { resourceId: string; unitId: string; ordinal: number };

/**
 * The fixed global order in which units are INSERTED (booking.md section 8.1
 * rule 3): `resource_id` ascending bytewise, then `ordinal`. Two writers
 * claiming several units acquire them in the same order, so they cannot wait on
 * each other in a cycle. (Which units are CHOSEN is the pool's preference order,
 * `sort_order` then `ordinal`; this orders the chosen set.)
 */
export function insertionOrder<T extends UnitRef>(units: readonly T[]): T[] {
  return [...units].sort(
    (a, b) =>
      compareBytes(a.resourceId, b.resourceId) ||
      a.ordinal - b.ordinal ||
      compareBytes(a.unitId, b.unitId)
  );
}

/**
 * Splits the free candidates (already in preference order) into the `need`
 * units to try FIRST, in insertion order, and the spare ones to fall back to
 * when one of those is lost to a concurrent writer.
 */
export function planAttempts<T extends UnitRef>(
  candidates: readonly T[],
  need: number
): T[] {
  const first = insertionOrder(candidates.slice(0, need));

  return [...first, ...candidates.slice(need)];
}

/** What a placement can refuse with, and the HTTP status a route will answer it with (booking.md section 3). */
export const PLACEMENT_REFUSALS = {
  SLOT_UNAVAILABLE: 409,
  CONTENTION_RETRY: 409,
  HOLD_LIMIT_EXCEEDED: 429,
  PARTY_SIZE_OUT_OF_RANGE: 409,
  QUANTITY_EXCEEDS_UNITS: 422,
  BOOKING_MODE_MISMATCH: 409,
  EXTERNAL_REF_IN_USE: 409,
  RESOURCE_NOT_FOUND: 404,
  OFFERING_NOT_FOUND: 404,
  // The stay refusals (Issue #940, ADR-0135): dates the zone does not have,
  // the offering's night limits, a pool that mixes zones.
  ...STAY_REFUSALS
} as const;

export type PlacementRefusalCode = keyof typeof PLACEMENT_REFUSALS;

/** How a database error is read by the allocator. `null` = not ours, rethrow. */
export type DatabaseFailureKind =
  "exclusion_conflict" | "deadlock" | "external_ref_in_use";

/**
 * Classifies a PostgreSQL error by SQLSTATE (`errno` in Bun.SQL, not `code`).
 *
 *  * `23P01` -- an exclusion constraint refused the row. The allocator's
 *    `ON CONFLICT DO NOTHING` absorbs this in the normal case, so seeing it
 *    escape means a path that did not go through the allocator (or a server that
 *    raised it anyway): the answer is still "the slot is taken".
 *  * `40P01` -- deadlock victim. Retryable, a bounded number of times.
 *  * `23505` on the natural-key backstop -- an adapter retrying with a fresh
 *    Idempotency-Key against an external reference that is already live.
 */
export function classifyDatabaseFailure(
  errno: string | null | undefined,
  constraint: string | null | undefined
): DatabaseFailureKind | null {
  if (errno === "23P01") {
    return "exclusion_conflict";
  }

  if (errno === "40P01") {
    return "deadlock";
  }

  if (
    errno === "23505" &&
    constraint === "awcms_booking_reservations_external_ref_key"
  ) {
    return "external_ref_in_use";
  }

  return null;
}

/**
 * Backoff before the `attempt`-th retry (0-based): exponential with full jitter
 * on the upper half, so two victims of the same deadlock do not wake together
 * and collide again. `random` is injected so a test can pin it.
 */
export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random
): number {
  const ceiling = ALLOCATOR_LIMITS.retryBaseMs * 2 ** Math.max(0, attempt);

  return Math.floor(ceiling / 2 + random() * (ceiling / 2));
}

/** A hold that is due: its expiry has passed on the DATABASE clock. Pure twin of the SQL predicate. */
export function isHoldDue(holdExpiresAtMs: number, nowMs: number): boolean {
  return holdExpiresAtMs <= nowMs;
}

/**
 * Seconds past expiry, never negative: how late the reaper is for one hold. The
 * reconciliation reports the largest of these as the reaper's lag.
 */
export function overdueSeconds(holdExpiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - holdExpiresAtMs) / 1000));
}

/**
 * How long after its expiry a `held` reservation is still "just waiting for the
 * next sweep" rather than evidence of a stuck job. The reaper runs every minute;
 * five minutes tolerates a few missed ticks without hiding a job that stopped.
 */
export const REAPER_GRACE_SECONDS = 300;

// ---------------------------------------------------------------------------
// Placing a hold: the typed input and its structural validation
// ---------------------------------------------------------------------------

export type ValidationIssue = {
  field: string;
  message: string;
  /** A refusal code the issue maps to, when it has one (a malformed stay date is `STAY_DATES_INVALID`, booking.md section 2.5). */
  code?: string;
};

/**
 * What a caller (the reservation route of Issue #941, an adapter through the
 * port, a test) asks `placeHold` for. Typed and already parsed: an RFC 3339
 * instant has become epoch milliseconds, a body has become fields. Business
 * policy that belongs to the CREATE handler -- opening hours, lead time, horizon,
 * `reservations.override` -- is evaluated by that handler before this runs
 * (see `booking-hold-service.ts`).
 */
export type PlaceHoldInput = {
  offeringId: string;
  /** Exactly one of `resourceId` / `poolId`. */
  resourceId?: string;
  poolId?: string;
  /**
   * Exactly one of `startsAtMs` (a slot: an instant) and `stay` (a night range:
   * local dates in the resource's zone, ADR-0135). A client never sends an end,
   * a buffer or an instant for a stay: the server derives them.
   */
  startsAtMs?: number;
  stay?: { checkInDate: string; checkOutDate: string };
  partySize: number;
  /** Units claimed at once (all-or-none), 1..500. */
  quantity: number;
  holdSeconds?: number | null;
  /** Opaque token of the commerce authority (O12); `null` = walk-in. */
  externalCustomerRef?: string | null;
  externalRef?: { type: string; id: string } | null;
  source?: string;
  /** Free text, at most 500 characters; classified, never logged, audited or put in an event. */
  customerNote?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same shapes the CHECK constraints of `sql/180` enforce, so a bad value is a 400 with a field name, not a database error. */
const CUSTOMER_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SOURCE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const EXTERNAL_REF_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export function validatePlaceHold(input: PlaceHoldInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) =>
    issues.push({ field, message });

  if (!UUID_PATTERN.test(input.offeringId)) {
    add("offeringId", "offeringId must be a UUID.");
  }

  const hasResource = input.resourceId !== undefined;
  const hasPool = input.poolId !== undefined;

  if (hasResource === hasPool) {
    add("resourceId", "Send exactly one of resourceId or poolId.");
  }

  if (hasResource && !UUID_PATTERN.test(input.resourceId!)) {
    add("resourceId", "resourceId must be a UUID.");
  }

  if (hasPool && !UUID_PATTERN.test(input.poolId!)) {
    add("poolId", "poolId must be a UUID.");
  }

  if (input.stay !== undefined) {
    if (input.startsAtMs !== undefined) {
      add(
        "startsAt",
        "Send either startsAt (a slot) or stay (check-in and check-out dates), not both."
      );
    }

    if (!isLocalDate(input.stay.checkInDate)) {
      issues.push({
        field: "stay.checkInDate",
        message: "checkInDate must be a calendar date YYYY-MM-DD.",
        code: "STAY_DATES_INVALID"
      });
    }

    if (!isLocalDate(input.stay.checkOutDate)) {
      issues.push({
        field: "stay.checkOutDate",
        message: "checkOutDate must be a calendar date YYYY-MM-DD.",
        code: "STAY_DATES_INVALID"
      });
    }
  } else if (
    input.startsAtMs === undefined ||
    !Number.isSafeInteger(input.startsAtMs)
  ) {
    add("startsAt", "startsAt must be a valid instant.");
  }

  if (
    !Number.isInteger(input.partySize) ||
    input.partySize < 1 ||
    input.partySize > 500
  ) {
    add("partySize", "partySize must be an integer from 1 to 500.");
  }

  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > ALLOCATOR_LIMITS.maxUnitsPerClaim
  ) {
    add("quantity", "quantity must be an integer from 1 to 500.");
  }

  if (
    input.holdSeconds !== undefined &&
    input.holdSeconds !== null &&
    (!Number.isFinite(input.holdSeconds) || input.holdSeconds <= 0)
  ) {
    add("holdSeconds", "holdSeconds must be a positive number of seconds.");
  }

  if (
    input.externalCustomerRef !== undefined &&
    input.externalCustomerRef !== null &&
    !CUSTOMER_REF_PATTERN.test(input.externalCustomerRef)
  ) {
    add(
      "externalCustomerRef",
      "externalCustomerRef must be an opaque token (no spaces, no '@'), at most 128 characters."
    );
  }

  if (input.externalRef !== undefined && input.externalRef !== null) {
    if (!EXTERNAL_REF_TYPE_PATTERN.test(input.externalRef.type)) {
      add(
        "externalRef.type",
        "externalRef.type must be a short lowercase code."
      );
    }

    if (
      typeof input.externalRef.id !== "string" ||
      input.externalRef.id.length < 1 ||
      input.externalRef.id.length > 128
    ) {
      add("externalRef.id", "externalRef.id must be 1 to 128 characters.");
    }
  }

  if (input.source !== undefined && !SOURCE_PATTERN.test(input.source)) {
    add("source", "source must be a short lowercase code.");
  }

  if (
    input.customerNote !== undefined &&
    input.customerNote !== null &&
    input.customerNote.length > 500
  ) {
    add("customerNote", "customerNote must be at most 500 characters.");
  }

  return issues;
}
