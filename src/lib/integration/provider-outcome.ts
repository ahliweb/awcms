/**
 * Third-party call outcome taxonomy and default-deny routing policy
 * (Issue #1410). A PURE, versioned, provider-neutral decision contract.
 *
 * What this is NOT: a dispatcher, a gateway, a queue, or a client. It performs
 * no I/O, reads no environment, holds no credentials and never calls a
 * provider. Domains keep their own port and outbox (ADR-0006) and may — in a
 * separate, opt-in change — ask this module "given what I observed, what am I
 * allowed to do next?". No live adapter calls it today.
 *
 * Two functions:
 *  - `classifyProviderCall` turns raw evidence (HTTP status, semantic body
 *    verdict, transport failure) into ONE `ProviderOutcome`.
 *  - `decideRouting` turns an outcome plus domain facts into ONE action.
 *
 * Invariant that every rule below serves: a call that MAY have reached the
 * provider (`accepted`, `unknown`) is never repeated against ANOTHER provider
 * automatically, and for financial operations is never repeated at all until
 * a reconciliation or an authorised human has settled what happened.
 */

/** Bump on any change in classification or decision semantics. */
export const PROVIDER_OUTCOME_CONTRACT_VERSION = "1.0.0";

/** Upper bound on a provider-supplied `Retry-After` we will honour. */
export const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

export const OPERATION_KINDS = [
  "read_only",
  "write",
  "financial",
  "notification"
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/**
 * - `succeeded`        the provider says the work is DONE (delivered/settled).
 * - `accepted`         the provider took the request; completion not yet known
 *                      (queued, pending settlement). Acceptance is NOT delivery.
 * - `not_sent`         PROVABLY nothing reached the provider (or the provider
 *                      rejected it before processing, e.g. 429).
 * - `confirmed_failed` the provider authoritatively said it did not perform it.
 * - `unknown`          the request may or may not have been processed.
 */
export const OUTCOME_KINDS = [
  "succeeded",
  "accepted",
  "not_sent",
  "confirmed_failed",
  "unknown"
] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

/** Whether a `confirmed_failed` is about the request itself or about the provider/account. */
export type FailureScope = "request" | "provider";

export type ProviderOutcome = {
  kind: OutcomeKind;
  /** Only meaningful for `confirmed_failed`; absent means unspecified (treated as request-level, i.e. no failover). */
  failureScope?: FailureScope;
  /** Provider-requested wait, already clamped to [0, MAX_RETRY_AFTER_MS]. */
  retryAfterMs?: number;
};

export type ProviderCallEvidence =
  | {
      kind: "not_sent_proven";
      cause:
        "circuit_open" | "local_validation" | "connect_refused" | "dns_failure";
    }
  | {
      kind: "transport_error_after_send_possible";
      cause: "timeout" | "connection_reset" | "unreadable_body";
    }
  | {
      kind: "http";
      status: number;
      /**
       * The caller's verdict on the BODY. A 200 whose payload says
       * `success:false` is `failure`; a 200 with no recognisable verdict is
       * `unrecognized` (never assumed to be success).
       */
      semantic?: "success" | "failure" | "unrecognized";
      /** For a semantic success: finished (`final`) or merely queued (`asynchronous`). Default `asynchronous` (acceptance, not delivery). */
      completion?: "final" | "asynchronous";
      /** Raw `Retry-After` header (delta-seconds or HTTP-date). */
      retryAfter?: string | null;
    };

/**
 * Parse a `Retry-After` header (RFC 9110: delta-seconds or HTTP-date) into
 * milliseconds, clamped to [0, MAX_RETRY_AFTER_MS]. Anything unparseable or
 * negative yields `undefined` — never a guess.
 */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  nowMs: number = Date.now()
): number | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value === "") return undefined;
  let ms: number;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    // An HTTP-date always carries letters; this keeps "-5" from parsing as a year.
    if (!/[A-Za-z]/.test(value)) return undefined;
    const at = Date.parse(value);
    if (Number.isNaN(at)) return undefined;
    ms = at - nowMs;
  }
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/** Classify raw evidence into exactly one outcome. Pure and total. */
export function classifyProviderCall(
  evidence: ProviderCallEvidence,
  nowMs: number = Date.now()
): ProviderOutcome {
  if (evidence.kind === "not_sent_proven") return { kind: "not_sent" };
  if (evidence.kind === "transport_error_after_send_possible") {
    return { kind: "unknown" };
  }
  const { status } = evidence;
  const retryAfterMs = parseRetryAfterMs(evidence.retryAfter, nowMs);
  const withRetry = (o: ProviderOutcome): ProviderOutcome =>
    retryAfterMs === undefined ? o : { ...o, retryAfterMs };

  if (!Number.isInteger(status)) return { kind: "unknown" };
  if (status >= 200 && status < 300) {
    switch (evidence.semantic) {
      case "failure":
        return { kind: "confirmed_failed" };
      case "success":
        return evidence.completion === "final"
          ? { kind: "succeeded" }
          : { kind: "accepted" };
      default:
        return { kind: "unknown" };
    }
  }
  // Rate limited: rejected before processing by definition of the status.
  if (status === 429) return withRetry({ kind: "not_sent" });
  if (status === 401 || status === 402 || status === 403) {
    return { kind: "confirmed_failed", failureScope: "provider" };
  }
  // 408/409 say nothing reliable about whether work happened.
  if (status === 408 || status === 409) return { kind: "unknown" };
  if (status >= 400 && status < 500) {
    return { kind: "confirmed_failed", failureScope: "request" };
  }
  // 1xx, 3xx, 5xx and anything else: may have been processed.
  return withRetry({ kind: "unknown" });
}

export const ROUTING_ACTIONS = [
  "hold",
  "retry_same",
  "switch_provider",
  "reconcile",
  "manual_review",
  /** Terminal success: nothing further to do. Not an outbound action. */
  "complete"
] as const;
export type RoutingAction = (typeof ROUTING_ACTIONS)[number];

export type ConsentState = "granted" | "not_required" | "missing";

export type RoutingPolicy = {
  /** Default OFF. Without it `switch_provider` is never returned. */
  failoverEnabled?: boolean;
  /**
   * Default OFF. Additionally required to fail over a FINANCIAL operation, and
   * even then only after a proven `not_sent` or authoritative provider-scope
   * failure — never after `accepted`/`unknown`. A domain sets it from an
   * authorised decision, never from client input.
   */
  financialFailoverAuthorized?: boolean;
};

export type RoutingInput = {
  operation: OperationKind;
  outcome: ProviderOutcome;
  policy?: RoutingPolicy;
  /** A provider certified equivalent (same capability, data-handling terms, region) is configured and healthy. */
  equivalentProviderAvailable: boolean;
  consent: ConsentState;
  /** Whether the provider honours an idempotency key (so a repeat cannot double-apply). */
  idempotency: "supported" | "unsupported";
  /** The id that ties the attempt to the domain's ledger/outbox row. Required for anything but read-only. */
  correlationId?: string;
  budget: {
    sameProviderAttemptsRemaining: number;
    switchesRemaining: number;
  };
  /** The domain can query the provider/ledger to learn what actually happened. */
  reconciliationAvailable: boolean;
};

export const ROUTING_REASONS = [
  "completed",
  "invalid_input",
  "no_consent",
  "missing_correlation_id",
  "provider_accepted_awaiting_completion",
  "outcome_unknown_reconcile",
  "outcome_unknown_no_reconciliation",
  "outcome_unknown_repeat_safe",
  "financial_never_automatic",
  "proven_not_sent_retry",
  "proven_not_sent_switch",
  "confirmed_failed_provider_scope_switch",
  "confirmed_failed_request_level",
  "retry_budget_exhausted",
  "failover_disabled",
  "failover_not_authorised_financial",
  "no_equivalent_provider",
  "switch_budget_exhausted",
  "idempotency_unsupported"
] as const;
export type RoutingReason = (typeof ROUTING_REASONS)[number];

export type RoutingDecision = {
  action: RoutingAction;
  reason: RoutingReason;
  /** With `retry_same`: wait at least this long (provider `Retry-After`, clamped). */
  retryAfterMs?: number;
  contractVersion: typeof PROVIDER_OUTCOME_CONTRACT_VERSION;
};

function decision(
  action: RoutingAction,
  reason: RoutingReason,
  retryAfterMs?: number
): RoutingDecision {
  return {
    action,
    reason,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    contractVersion: PROVIDER_OUTCOME_CONTRACT_VERSION
  };
}

function isValid(input: RoutingInput): boolean {
  const budget = input.budget as RoutingInput["budget"] | undefined;
  const nonNeg = (n: unknown): boolean =>
    typeof n === "number" && Number.isInteger(n) && n >= 0;
  return (
    (OPERATION_KINDS as readonly string[]).includes(input.operation) &&
    (OUTCOME_KINDS as readonly string[]).includes(input.outcome?.kind) &&
    ["granted", "not_required", "missing"].includes(input.consent) &&
    ["supported", "unsupported"].includes(input.idempotency) &&
    typeof input.equivalentProviderAvailable === "boolean" &&
    typeof input.reconciliationAvailable === "boolean" &&
    budget !== undefined &&
    nonNeg(budget.sameProviderAttemptsRemaining) &&
    nonNeg(budget.switchesRemaining)
  );
}

/**
 * Decide the next step. Default-deny: every missing precondition lands on
 * `hold` or `manual_review`, never on a further outbound call.
 */
export function decideRouting(input: RoutingInput): RoutingDecision {
  if (!isValid(input)) return decision("manual_review", "invalid_input");

  const { operation, outcome } = input;
  const needsCorrelation = operation !== "read_only";
  const hasCorrelation =
    typeof input.correlationId === "string" &&
    input.correlationId.trim() !== "";

  if (outcome.kind === "succeeded") return decision("complete", "completed");

  const mayHaveReached =
    outcome.kind === "accepted" || outcome.kind === "unknown";

  if (needsCorrelation && !hasCorrelation) {
    // Without the id nothing can be reconciled or deduplicated.
    return mayHaveReached
      ? decision("manual_review", "missing_correlation_id")
      : decision("hold", "missing_correlation_id");
  }

  const retryAfterMs = outcome.retryAfterMs;

  if (outcome.kind === "accepted") {
    // Acceptance is not delivery/settlement. Never repeat, never switch.
    return input.reconciliationAvailable
      ? decision("reconcile", "provider_accepted_awaiting_completion")
      : decision("manual_review", "provider_accepted_awaiting_completion");
  }

  if (outcome.kind === "unknown") {
    if (operation === "financial") {
      // Property pinned by tests: never retry_same or switch_provider.
      return input.reconciliationAvailable
        ? decision("reconcile", "financial_never_automatic")
        : decision("manual_review", "financial_never_automatic");
    }
    if (operation === "read_only") {
      return input.budget.sameProviderAttemptsRemaining > 0
        ? decision("retry_same", "outcome_unknown_repeat_safe", retryAfterMs)
        : decision("manual_review", "retry_budget_exhausted");
    }
    // write / notification: a repeat is only safe if the provider dedups it.
    if (input.idempotency === "supported") {
      if (input.consent === "missing") return decision("hold", "no_consent");
      return input.budget.sameProviderAttemptsRemaining > 0
        ? decision("retry_same", "outcome_unknown_repeat_safe", retryAfterMs)
        : decision("manual_review", "retry_budget_exhausted");
    }
    return input.reconciliationAvailable
      ? decision("reconcile", "outcome_unknown_reconcile")
      : decision("manual_review", "outcome_unknown_no_reconciliation");
  }

  // From here the provider provably did not perform the work.
  if (outcome.kind === "confirmed_failed") {
    if (outcome.failureScope !== "provider") {
      // A bad request fails the same everywhere; do not shop it around.
      return decision("manual_review", "confirmed_failed_request_level");
    }
    return tryFailover(input, "confirmed_failed_provider_scope_switch");
  }

  // not_sent
  if (input.consent === "missing") return decision("hold", "no_consent");
  if (input.budget.sameProviderAttemptsRemaining > 0) {
    return decision("retry_same", "proven_not_sent_retry", retryAfterMs);
  }
  if (input.policy?.failoverEnabled !== true) {
    return decision("manual_review", "retry_budget_exhausted");
  }
  return tryFailover(input, "proven_not_sent_switch");
}

function tryFailover(
  input: RoutingInput,
  success: RoutingReason
): RoutingDecision {
  const { policy, operation, budget } = input;
  if (input.consent === "missing") return decision("hold", "no_consent");
  if (policy?.failoverEnabled !== true) {
    return decision("manual_review", "failover_disabled");
  }
  if (
    operation === "financial" &&
    policy.financialFailoverAuthorized !== true
  ) {
    return decision("manual_review", "failover_not_authorised_financial");
  }
  if (!input.equivalentProviderAvailable) {
    return decision("manual_review", "no_equivalent_provider");
  }
  if (operation !== "read_only" && input.idempotency !== "supported") {
    return decision("manual_review", "idempotency_unsupported");
  }
  if (budget.switchesRemaining <= 0) {
    return decision("manual_review", "switch_budget_exhausted");
  }
  return decision("switch_provider", success);
}
