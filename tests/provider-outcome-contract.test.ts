import { describe, expect, test } from "bun:test";
import {
  MAX_RETRY_AFTER_MS,
  OPERATION_KINDS,
  OUTCOME_KINDS,
  PROVIDER_OUTCOME_CONTRACT_VERSION,
  classifyProviderCall,
  decideRouting,
  parseRetryAfterMs,
  type OperationKind,
  type ProviderOutcome,
  type RoutingInput
} from "../src/lib/integration/provider-outcome";

const base = (over: Partial<RoutingInput> = {}): RoutingInput => ({
  operation: "notification",
  outcome: { kind: "unknown" },
  equivalentProviderAvailable: true,
  consent: "granted",
  idempotency: "supported",
  correlationId: "corr-1",
  budget: { sameProviderAttemptsRemaining: 2, switchesRemaining: 1 },
  reconciliationAvailable: true,
  ...over
});
const failoverOn = { failoverEnabled: true, financialFailoverAuthorized: true };
const noRetryLeft = { sameProviderAttemptsRemaining: 0, switchesRemaining: 1 };

describe("provider outcome contract: classification", () => {
  test("version is pinned", () => {
    expect(PROVIDER_OUTCOME_CONTRACT_VERSION).toBe("1.0.0");
  });
  test("proven not sent", () => {
    expect(
      classifyProviderCall({ kind: "not_sent_proven", cause: "circuit_open" })
    ).toEqual({ kind: "not_sent" });
  });
  test("timeout after a possible send is unknown", () => {
    expect(
      classifyProviderCall({
        kind: "transport_error_after_send_possible",
        cause: "timeout"
      })
    ).toEqual({ kind: "unknown" });
  });
  test("HTTP 200 with a failure body is confirmed_failed, not success", () => {
    expect(
      classifyProviderCall({ kind: "http", status: 200, semantic: "failure" })
        .kind
    ).toBe("confirmed_failed");
  });
  test("HTTP 200 with no verdict is unknown", () => {
    expect(classifyProviderCall({ kind: "http", status: 200 }).kind).toBe(
      "unknown"
    );
    expect(
      classifyProviderCall({
        kind: "http",
        status: 200,
        semantic: "unrecognized"
      }).kind
    ).toBe("unknown");
  });
  test("acceptance is not completion", () => {
    expect(
      classifyProviderCall({ kind: "http", status: 202, semantic: "success" })
        .kind
    ).toBe("accepted");
    expect(
      classifyProviderCall({
        kind: "http",
        status: 200,
        semantic: "success",
        completion: "final"
      }).kind
    ).toBe("succeeded");
  });
  test("429 is not_sent with a clamped Retry-After", () => {
    expect(
      classifyProviderCall({ kind: "http", status: 429, retryAfter: "7" })
    ).toEqual({ kind: "not_sent", retryAfterMs: 7000 });
    expect(
      classifyProviderCall({ kind: "http", status: 429, retryAfter: "99999" })
        .retryAfterMs
    ).toBe(MAX_RETRY_AFTER_MS);
  });
  test("5xx, 408, 409, 3xx are unknown; 4xx are authoritative", () => {
    for (const status of [500, 502, 503, 504, 408, 409, 302]) {
      expect(classifyProviderCall({ kind: "http", status }).kind).toBe(
        "unknown"
      );
    }
    expect(classifyProviderCall({ kind: "http", status: 422 })).toEqual({
      kind: "confirmed_failed",
      failureScope: "request"
    });
    expect(classifyProviderCall({ kind: "http", status: 402 })).toEqual({
      kind: "confirmed_failed",
      failureScope: "provider"
    });
  });
  test("Retry-After parsing: seconds, date, garbage, negative", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfterMs("30", now)).toBe(30000);
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10000);
    expect(parseRetryAfterMs("Wed, 31 Dec 2025 00:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfterMs("soon", now)).toBeUndefined();
    expect(parseRetryAfterMs("-5", now)).toBeUndefined();
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
  });
});

describe("provider outcome contract: decision matrix", () => {
  test("succeeded completes", () => {
    expect(decideRouting(base({ outcome: { kind: "succeeded" } })).action).toBe(
      "complete"
    );
  });
  test("accepted reconciles and never repeats or switches", () => {
    expect(
      decideRouting(base({ outcome: { kind: "accepted" }, policy: failoverOn }))
        .action
    ).toBe("reconcile");
    expect(
      decideRouting(
        base({ outcome: { kind: "accepted" }, reconciliationAvailable: false })
      ).action
    ).toBe("manual_review");
  });
  test("unknown notification with idempotency retries the same provider", () => {
    expect(decideRouting(base()).action).toBe("retry_same");
  });
  test("unknown without idempotency reconciles, else manual review", () => {
    const i = base({ idempotency: "unsupported" });
    expect(decideRouting(i).action).toBe("reconcile");
    expect(decideRouting({ ...i, reconciliationAvailable: false }).action).toBe(
      "manual_review"
    );
  });
  test("unknown with failover on never switches", () => {
    expect(decideRouting(base({ policy: failoverOn })).action).not.toBe(
      "switch_provider"
    );
  });
  test("read-only unknown is safely retried; budget exhaustion stops it", () => {
    const i = base({ operation: "read_only", correlationId: undefined });
    expect(decideRouting(i).action).toBe("retry_same");
    expect(decideRouting({ ...i, budget: noRetryLeft })).toMatchObject({
      action: "manual_review",
      reason: "retry_budget_exhausted"
    });
  });
  test("5xx (unknown) honours Retry-After on retry", () => {
    const o = classifyProviderCall({
      kind: "http",
      status: 503,
      retryAfter: "3"
    });
    const d = decideRouting(base({ outcome: o }));
    expect(d.action).toBe("retry_same");
    expect(d.retryAfterMs).toBe(3000);
  });
  test("proven not sent retries; then fails over only when enabled", () => {
    const o: ProviderOutcome = { kind: "not_sent" };
    expect(decideRouting(base({ outcome: o })).action).toBe("retry_same");
    expect(
      decideRouting(base({ outcome: o, budget: noRetryLeft })).reason
    ).toBe("retry_budget_exhausted");
    expect(
      decideRouting(
        base({ outcome: o, budget: noRetryLeft, policy: failoverOn })
      ).action
    ).toBe("switch_provider");
  });
  test("failover is OFF by default", () => {
    const d = decideRouting(
      base({ outcome: { kind: "confirmed_failed", failureScope: "provider" } })
    );
    expect(d).toMatchObject({
      action: "manual_review",
      reason: "failover_disabled"
    });
  });
  test("provider-scope failure switches; request-level never does", () => {
    expect(
      decideRouting(
        base({
          outcome: { kind: "confirmed_failed", failureScope: "provider" },
          policy: failoverOn
        })
      ).action
    ).toBe("switch_provider");
    for (const outcome of [
      { kind: "confirmed_failed" },
      { kind: "confirmed_failed", failureScope: "request" }
    ] as ProviderOutcome[]) {
      expect(decideRouting(base({ outcome, policy: failoverOn })).action).toBe(
        "manual_review"
      );
    }
  });
  test("non-equivalent provider blocks the switch", () => {
    expect(
      decideRouting(
        base({
          outcome: { kind: "confirmed_failed", failureScope: "provider" },
          policy: failoverOn,
          equivalentProviderAvailable: false
        })
      ).reason
    ).toBe("no_equivalent_provider");
  });
  test("no consent holds any further send", () => {
    for (const outcome of [
      { kind: "not_sent" },
      { kind: "unknown" },
      { kind: "confirmed_failed", failureScope: "provider" }
    ] as ProviderOutcome[]) {
      expect(
        decideRouting(base({ outcome, consent: "missing", policy: failoverOn }))
          .action
      ).toBe("hold");
    }
  });
  test("switch budget exhausted and idempotency unsupported block a switch", () => {
    const o: ProviderOutcome = {
      kind: "confirmed_failed",
      failureScope: "provider"
    };
    expect(
      decideRouting(
        base({
          outcome: o,
          policy: failoverOn,
          budget: { sameProviderAttemptsRemaining: 1, switchesRemaining: 0 }
        })
      ).reason
    ).toBe("switch_budget_exhausted");
    expect(
      decideRouting(
        base({ outcome: o, policy: failoverOn, idempotency: "unsupported" })
      ).reason
    ).toBe("idempotency_unsupported");
  });
  test("missing correlation id: unknown goes to review, not_sent holds", () => {
    expect(decideRouting(base({ correlationId: "  " })).action).toBe(
      "manual_review"
    );
    expect(
      decideRouting(
        base({ outcome: { kind: "not_sent" }, correlationId: undefined })
      ).action
    ).toBe("hold");
  });
  test("financial failover needs explicit authorisation", () => {
    const i = base({
      operation: "financial",
      outcome: { kind: "not_sent" },
      budget: noRetryLeft
    });
    expect(
      decideRouting({ ...i, policy: { failoverEnabled: true } }).reason
    ).toBe("failover_not_authorised_financial");
    expect(decideRouting({ ...i, policy: failoverOn }).action).toBe(
      "switch_provider"
    );
  });
  test("malformed input is denied", () => {
    expect(
      decideRouting({ ...base(), operation: "bogus" as OperationKind }).reason
    ).toBe("invalid_input");
    expect(
      decideRouting(
        base({
          budget: { sameProviderAttemptsRemaining: -1, switchesRemaining: 0 }
        })
      ).action
    ).toBe("manual_review");
  });
});

describe("provider outcome contract: properties", () => {
  const bools = [true, false];
  const consents = ["granted", "not_required", "missing"] as const;
  const idem = ["supported", "unsupported"] as const;
  const policies = [undefined, { failoverEnabled: true }, failoverOn] as const;
  const budgets = [0, 2].flatMap((a) =>
    [0, 1].map((s) => ({
      sameProviderAttemptsRemaining: a,
      switchesRemaining: s
    }))
  );
  const scopes = [undefined, "request", "provider"] as const;

  function* allInputs(): Generator<RoutingInput> {
    for (const operation of OPERATION_KINDS)
      for (const kind of OUTCOME_KINDS)
        for (const failureScope of scopes)
          for (const equivalentProviderAvailable of bools)
            for (const consent of consents)
              for (const idempotency of idem)
                for (const correlationId of ["c", undefined])
                  for (const policy of policies)
                    for (const budget of budgets)
                      for (const reconciliationAvailable of bools)
                        yield {
                          operation,
                          outcome: { kind, failureScope },
                          equivalentProviderAvailable,
                          consent,
                          idempotency,
                          correlationId,
                          policy,
                          budget,
                          reconciliationAvailable
                        };
  }

  test("accepted/unknown NEVER switch provider, for any operation", () => {
    for (const i of allInputs()) {
      if (i.outcome.kind === "accepted" || i.outcome.kind === "unknown") {
        expect(decideRouting(i).action).not.toBe("switch_provider");
      }
    }
  });
  test("financial accepted/unknown never retry_same or switch", () => {
    for (const i of allInputs()) {
      if (
        i.operation === "financial" &&
        (i.outcome.kind === "accepted" || i.outcome.kind === "unknown")
      ) {
        expect(["reconcile", "manual_review"]).toContain(
          decideRouting(i).action
        );
      }
    }
  });
  test("switch_provider requires every precondition", () => {
    let switched = 0;
    for (const i of allInputs()) {
      if (decideRouting(i).action !== "switch_provider") continue;
      switched++;
      expect(i.policy?.failoverEnabled).toBe(true);
      expect(i.equivalentProviderAvailable).toBe(true);
      expect(i.consent).not.toBe("missing");
      expect(i.budget.switchesRemaining).toBeGreaterThan(0);
      expect(["not_sent", "confirmed_failed"]).toContain(i.outcome.kind);
      if (i.operation !== "read_only") expect(i.idempotency).toBe("supported");
      if (i.operation === "financial") {
        expect(i.policy?.financialFailoverAuthorized).toBe(true);
      }
    }
    expect(switched).toBeGreaterThan(0);
  });
  test("with default policy there is never a switch", () => {
    for (const i of allInputs()) {
      if (i.policy === undefined) {
        expect(decideRouting(i).action).not.toBe("switch_provider");
      }
    }
  });
  test("deterministic and always versioned", () => {
    for (const i of allInputs()) {
      const a = decideRouting(i);
      expect(decideRouting(i)).toEqual(a);
      expect(a.contractVersion).toBe(PROVIDER_OUTCOME_CONTRACT_VERSION);
    }
  });
});
