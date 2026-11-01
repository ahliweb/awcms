/**
 * The commission intake queue, pure part (Issue #1189, ADR-0147).
 *
 * Everything here is a function of its arguments: the status machine, the retry
 * schedule, the request digest of a void, the mapping from the ledger's outcome
 * to what the intake row becomes, and the masking the exceptions list applies.
 * No database, no clock but the one passed in, so each rule is a unit test.
 */
import { createHash } from "node:crypto";

import type {
  CommissionAccrualOutcome,
  CommissionAccrualRequest,
  CommissionVoidOutcome,
  CommissionVoidRequest
} from "../../_shared/ports/commission-accrual-port";
import { accrualRequestDigest } from "./hr-commission-accrual-validation";
import type { Validated, ValidationError } from "./hr-commission-validation";

export const INTAKE_KINDS = ["accrue", "void"] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

export const INTAKE_STATUSES = [
  "pending",
  "posting",
  "posted",
  "refused",
  "failed"
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

/** Statuses nothing further happens to. Only these are purged by retention. */
export const INTAKE_TERMINAL_STATUSES = [
  "posted",
  "refused",
  "failed"
] as const;

/** A row that is neither settled nor refused is work: the exceptions list shows the others. */
export const INTAKE_EXCEPTION_STATUSES = ["refused", "failed"] as const;

/** Attempts (claims) a row gets before a transient error makes it `failed`. */
export const INTAKE_MAX_ATTEMPTS = 8;

/** How long a claim holds a row before another poster may take it. */
export const INTAKE_LEASE_SECONDS = 300;

/** Rows one claim takes per tenant. */
export const INTAKE_CLAIM_BATCH = 50;

/** Retention of terminal rows (ADR-0147: default 30 days, floor 7, ceiling 90). */
export const INTAKE_RETENTION_MIN_DAYS = 7;
export const INTAKE_RETENTION_DEFAULT_DAYS = 30;
export const INTAKE_RETENTION_MAX_DAYS = 90;

/**
 * Retention of settled rows. A `posted` row is bookkeeping and goes at the
 * window; a `refused` or `failed` row is something a human may still need to read
 * in the exceptions list, so it is kept for the ceiling. Both are clamped to
 * [floor, ceiling] at run time, whatever a caller passes.
 */
export const INTAKE_EXCEPTION_RETENTION_DAYS = INTAKE_RETENTION_MAX_DAYS;

export function clampRetentionDays(days: number): number {
  if (!Number.isFinite(days)) {
    return INTAKE_RETENTION_DEFAULT_DAYS;
  }

  return Math.min(
    INTAKE_RETENTION_MAX_DAYS,
    Math.max(INTAKE_RETENTION_MIN_DAYS, Math.floor(days))
  );
}

/**
 * How long a void may wait for the accrual it reverses. Events arrive out of
 * order and an accrue can sit behind a poster outage, so a void whose accrual has
 * not been posted by this intake yet is deferred (without spending its retry
 * budget) for this long and only then refused.
 */
export const INTAKE_VOID_GRACE_SECONDS = 24 * 60 * 60;

/** How often a waiting void is looked at again. */
export const INTAKE_DEFER_DELAY_SECONDS = 15 * 60;

/** A pending row older than this is reported as a stalled queue (a poster outage). */
export const INTAKE_STALE_PENDING_SECONDS = 15 * 60;

const EDGES: Readonly<Record<IntakeStatus, readonly IntakeStatus[]>> = {
  pending: ["pending", "posting"],
  posting: ["posting", "pending", "posted", "refused", "failed"],
  posted: [],
  refused: [],
  failed: []
};

/** The status machine the database's guard trigger also enforces. */
export function canMoveIntake(from: IntakeStatus, to: IntakeStatus): boolean {
  return EDGES[from].includes(to);
}

export function isIntakeTerminal(status: IntakeStatus): boolean {
  return (INTAKE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Seconds before a failed attempt may be tried again: 30s, 60s, 120s ... capped
 * at an hour. `attempts` is the number of claims so far (>= 1).
 */
export function retryDelaySeconds(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts, 10) - 1);

  return Math.min(3600, 30 * 2 ** exponent);
}

/** True when a row that has been claimed `attempts` times may not be claimed again. */
export function attemptsExhausted(attempts: number): boolean {
  return attempts >= INTAKE_MAX_ATTEMPTS;
}

/**
 * The canonical request of a void, hashed. An accrual uses the ledger's own
 * digest (`accrualRequestDigest`), so "the same request" means the same thing
 * here and there. A void carries the beneficiary, the source identity and the
 * reason code; the person who voided it and the correlation id are stamps, not
 * part of the request.
 */
export function voidRequestDigest(request: CommissionVoidRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "void",
        request.employmentId.toLowerCase(),
        request.source.type,
        request.source.ref,
        request.source.line ?? "",
        request.reason
      ])
    )
    .digest("hex");
}

export function intakeRequestDigest(
  kind: IntakeKind,
  request: CommissionAccrualRequest | CommissionVoidRequest
): string {
  return kind === "accrue"
    ? accrualRequestDigest(request as CommissionAccrualRequest)
    : voidRequestDigest(request as CommissionVoidRequest);
}

/** What an intake row becomes after the poster has asked the ledger. */
export type IntakeSettlement =
  | { disposition: "posted"; outcomeCode: string }
  | { disposition: "refused"; outcomeCode: string }
  /** Not final: try again later (the accrual this void reverses is still queued). */
  | { disposition: "defer"; outcomeCode: string };

/**
 * `accrue` outcomes. A success or a replay is `posted`; every other outcome is a
 * business refusal: terminal, never retried (a human reads it in the exceptions
 * list). `source_conflict` is the same identity with a different request.
 */
export function settleAccrueOutcome(
  outcome: CommissionAccrualOutcome
): IntakeSettlement {
  switch (outcome.outcome) {
    case "accrued":
    case "replayed":
      return { disposition: "posted", outcomeCode: outcome.outcome };
    default:
      return { disposition: "refused", outcomeCode: outcome.outcome };
  }
}

/**
 * `void` outcomes, once the ledger has been asked. `voided` and `already_voided`
 * are `posted`. `period_closed` is routed to a human and never silently voided.
 * Everything else, `not_found` included, is a terminal refusal: whether to ask
 * the ledger at all is {@link decideVoidOrigin}'s question.
 */
export function settleVoidOutcome(
  outcome: CommissionVoidOutcome
): IntakeSettlement {
  switch (outcome.outcome) {
    case "voided":
    case "already_voided":
      return { disposition: "posted", outcomeCode: outcome.outcome };
    default:
      return { disposition: "refused", outcomeCode: outcome.outcome };
  }
}

/**
 * May this void be posted? A void is posted only for an accrual that THIS intake
 * created (an intake `accrue` row that settled `accrued`). The worker is not
 * trusted to name what to reverse: without that origin it could void a manually
 * created accrual. Until the origin exists the void WAITS (the accrue may simply
 * not have been posted yet), for the grace window, and only then is refused.
 */
export function decideVoidOrigin(
  originPosted: boolean,
  ageSeconds: number,
  accrueStillLive: boolean = false
): "proceed" | "defer" | "refuse" {
  if (originPosted) {
    return "proceed";
  }

  // While the accrue for the same sale is itself still in the queue (pending or
  // posting, e.g. stuck behind a poster outage), the void keeps waiting PAST the
  // grace window: refusing it would let the accrue post later and leave a live
  // commission for a sale that was voided.
  if (accrueStillLive) {
    return "defer";
  }

  return ageSeconds < INTAKE_VOID_GRACE_SECONDS ? "defer" : "refuse";
}

/**
 * A short, non-reversible fingerprint of a source reference for audit rows: it
 * lets an operator match an audit row to an exceptions row without putting the
 * reference (an order number) in the trail.
 */
export function sourceRefFingerprint(sourceRef: string): string {
  return createHash("sha256").update(sourceRef).digest("hex").slice(0, 12);
}

/** The alphabet of a source reference, reused for the correlation id. */
export const INTAKE_CORRELATION_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Masks an identifier for the exceptions list: enough to recognise, not enough to use. */
export function maskIdentifier(value: string): string {
  if (value.length <= 6) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 6, 8))}${value.slice(-2)}`;
}

export function maskUuid(value: string): string {
  return value.length >= 13
    ? `${value.slice(0, 8)}-****-${value.slice(-4)}`
    : maskIdentifier(value);
}

// --- The setting's body ----------------------------------------------------------

export type IntakeSettingInput = {
  commissionIntakeEnabled: boolean;
  /** The system actor the poster stamps. `undefined` keeps the stored one, `null` clears it. */
  intakeActorTenantUserId?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `PUT /intake/settings` body: `{ "commissionIntakeEnabled": boolean,
 * "intakeActorTenantUserId"?: uuid | null }`. Strict: any other key is refused,
 * and a string such as `"true"` is not a boolean. Whether an actor is present
 * when the switch goes ON is checked against the stored value by the store.
 */
export function validateIntakeSettingBody(
  raw: unknown
): Validated<IntakeSettingInput> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be a JSON object." }]
    };
  }

  const body = raw as Record<string, unknown>;
  const errors: ValidationError[] = [];

  for (const key of Object.keys(body)) {
    if (
      key !== "commissionIntakeEnabled" &&
      key !== "intakeActorTenantUserId"
    ) {
      errors.push({ field: key, message: `${key} is not an accepted field.` });
    }
  }

  if (typeof body.commissionIntakeEnabled !== "boolean") {
    errors.push({
      field: "commissionIntakeEnabled",
      message: "commissionIntakeEnabled must be true or false."
    });
  }

  const actor = body.intakeActorTenantUserId;

  if (
    actor !== undefined &&
    actor !== null &&
    !(typeof actor === "string" && UUID_PATTERN.test(actor))
  ) {
    errors.push({
      field: "intakeActorTenantUserId",
      message: "intakeActorTenantUserId must be a tenant user UUID or null."
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          commissionIntakeEnabled: body.commissionIntakeEnabled as boolean,
          ...(actor === undefined
            ? {}
            : {
                intakeActorTenantUserId:
                  actor === null ? null : (actor as string).toLowerCase()
              })
        }
      };
}
