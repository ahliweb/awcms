/**
 * The subscription ladder — ADR-0084, Gelombang 5 PR 5.2 of Issue #423.
 *
 * `evaluateSubscriptionTransition` is pure, so the whole ladder is walked here
 * against a clock the test owns: 40 simulated days in a few lines, with no
 * database and no waiting. That is the reason the decision was split out of the
 * job at all.
 *
 * The properties worth stating up front, because each has a test that would fail
 * if it stopped holding:
 *
 * - it only ever walks DOWN (no reachable input restores service);
 * - it is IDEMPOTENT (running the job ten times is running it once), which comes
 *   from anchoring to dates the billing cycle owns rather than to when the job
 *   last ran;
 * - a missing date reads as "nothing scheduled", never as "expired".
 */
import { describe, expect, test } from "bun:test";

import { ENTITLING_SUBSCRIPTION_STATUSES } from "../src/modules/identity-access/domain/entitlement";
import {
  MAX_ENTITLEMENT_LOSSES_PER_RUN,
  partitionPlannedTransitions
} from "../src/modules/identity-access/application/subscription-lifecycle-job";
import {
  DEFAULT_SUBSCRIPTION_LADDER_POLICY,
  evaluateSubscriptionTransition,
  transitionEndsEntitlement,
  type SubscriptionSnapshot,
  type SubscriptionStatus
} from "../src/modules/identity-access/domain/subscription-transition";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-08-01T00:00:00.000Z");

const at = (days: number): Date => new Date(T0.getTime() + days * DAY);

function snapshot(
  overrides: Partial<SubscriptionSnapshot> & { status: SubscriptionStatus }
): SubscriptionSnapshot {
  return {
    currentPeriodEnd: null,
    trialEndsAt: null,
    graceEndsAt: null,
    ...overrides
  };
}

describe("the ladder walks one rung at a time, and only downward", () => {
  test("a trial that runs out lands on past_due, NOT on active", () => {
    // Landing on `active` would mean every trial silently becomes a free
    // subscription the moment nobody acts — forgetting to bill made
    // indistinguishable from deciding not to.
    const transition = evaluateSubscriptionTransition(
      at(10),
      snapshot({ status: "trialing", trialEndsAt: at(7) })
    );

    expect(transition?.to).toBe("past_due");
  });

  test("a trial still running produces nothing", () => {
    expect(
      evaluateSubscriptionTransition(
        at(3),
        snapshot({ status: "trialing", trialEndsAt: at(7) })
      )
    ).toBeNull();
  });

  test("an active subscription past its period end goes past_due", () => {
    expect(
      evaluateSubscriptionTransition(
        at(31),
        snapshot({ status: "active", currentPeriodEnd: at(30) })
      )?.to
    ).toBe("past_due");
  });

  test("an active subscription with NO period end is open-ended, not expired", () => {
    // The opposite reading turns a data-entry omission into an outage.
    expect(
      evaluateSubscriptionTransition(
        at(3650),
        snapshot({ status: "active", currentPeriodEnd: null })
      )
    ).toBeNull();
  });

  test("past_due becomes grace only after the configured window, and carries an end date", () => {
    const base = snapshot({ status: "past_due", currentPeriodEnd: at(30) });
    const { pastDueDays, graceDays } = DEFAULT_SUBSCRIPTION_LADDER_POLICY;

    expect(
      evaluateSubscriptionTransition(at(30 + pastDueDays - 1), base)
    ).toBeNull();

    const escalated = evaluateSubscriptionTransition(
      at(30 + pastDueDays),
      base
    );

    expect(escalated?.to).toBe("grace");
    // The CHECK on `awcms_tenant_subscriptions` requires a `grace` row to carry
    // one, so an absent value here would be a constraint violation at apply
    // time — a job that crashes rather than a customer who is warned.
    expect(escalated?.graceEndsAt?.getTime()).toBe(
      at(30 + pastDueDays + graceDays).getTime()
    );
  });

  test("grace becomes suspended when its own end date passes", () => {
    expect(
      evaluateSubscriptionTransition(
        at(52),
        snapshot({ status: "grace", graceEndsAt: at(51) })
      )?.to
    ).toBe("suspended");
  });

  test("suspended and cancelled are terminal for the clock", () => {
    for (const status of ["suspended", "cancelled"] as const) {
      expect(
        evaluateSubscriptionTransition(
          at(9999),
          snapshot({
            status,
            currentPeriodEnd: at(1),
            trialEndsAt: at(1),
            graceEndsAt: at(1)
          })
        )
      ).toBeNull();
    }
  });

  test("NO reachable input produces an upward move", () => {
    // The safety property stated as an exhaustive search rather than a comment.
    // A clock cannot observe a payment, so a ladder that could return `active`
    // would be restoring service on the strength of a date being wrong.
    const RANK: Record<SubscriptionStatus, number> = {
      trialing: 0,
      active: 1,
      past_due: 2,
      grace: 3,
      suspended: 4,
      cancelled: 5
    };

    const statuses = Object.keys(RANK) as SubscriptionStatus[];
    const dates = [null, at(-5), at(0), at(5)];
    let observed = 0;

    for (const status of statuses) {
      for (const currentPeriodEnd of dates) {
        for (const trialEndsAt of dates) {
          for (const graceEndsAt of dates) {
            for (const day of [-10, 0, 10, 100]) {
              const transition = evaluateSubscriptionTransition(
                at(day),
                snapshot({
                  status,
                  currentPeriodEnd,
                  trialEndsAt,
                  graceEndsAt
                })
              );

              if (transition === null) continue;

              observed += 1;
              expect(RANK[transition.to]).toBeGreaterThan(RANK[status]);
            }
          }
        }
      }
    }

    // Without this the loop above passes vacuously if the evaluator ever starts
    // returning null for everything — the assertion would never run.
    expect(observed).toBeGreaterThan(20);
  });
});

describe("idempotence — running the job ten times is running it once", () => {
  test("re-evaluating an already-transitioned row does not move it again", () => {
    // The anchor is `current_period_end`, a date the BILLING cycle owns, not
    // "when the row entered past_due". A job that ran late — or twice — would
    // otherwise extend the ladder by restating its own start.
    const { pastDueDays } = DEFAULT_SUBSCRIPTION_LADDER_POLICY;
    const afterEscalation = snapshot({
      status: "grace",
      currentPeriodEnd: at(30),
      graceEndsAt: at(30 + pastDueDays + 7)
    });

    for (const day of [30 + pastDueDays, 30 + pastDueDays + 1]) {
      expect(
        evaluateSubscriptionTransition(at(day), afterEscalation)
      ).toBeNull();
    }
  });

  test("a past_due row with no anchor at all is inert, not escalated", () => {
    // Already inconsistent. Suspending a customer on the strength of an
    // inconsistency is the wrong direction to fail.
    expect(
      evaluateSubscriptionTransition(
        at(9999),
        snapshot({
          status: "past_due",
          currentPeriodEnd: null,
          trialEndsAt: null
        })
      )
    ).toBeNull();
  });

  test("a past_due trial falls back to the trial end as its anchor", () => {
    const { pastDueDays } = DEFAULT_SUBSCRIPTION_LADDER_POLICY;

    expect(
      evaluateSubscriptionTransition(
        at(7 + pastDueDays),
        snapshot({ status: "past_due", trialEndsAt: at(7) })
      )?.to
    ).toBe("grace");
  });
});

describe("what a transition COSTS", () => {
  test("only leaving the entitling set costs the customer anything", () => {
    expect(transitionEndsEntitlement({ to: "past_due", reason: "x" })).toBe(
      false
    );
    expect(transitionEndsEntitlement({ to: "grace", reason: "x" })).toBe(false);
    expect(transitionEndsEntitlement({ to: "suspended", reason: "x" })).toBe(
      true
    );
    expect(transitionEndsEntitlement({ to: "cancelled", reason: "x" })).toBe(
      true
    );
  });

  test("it is DERIVED from the entitling set, so the two cannot disagree", () => {
    // If somebody adds `paused` to `ENTITLING_SUBSCRIPTION_STATUSES` and forgets
    // this predicate, there is nothing to forget — that is the point of deriving
    // it. This test pins the derivation rather than the answers.
    for (const status of ENTITLING_SUBSCRIPTION_STATUSES) {
      expect(
        transitionEndsEntitlement({
          to: status as SubscriptionStatus,
          reason: "x"
        })
      ).toBe(false);
    }
  });
});

describe("the ladder end-to-end, walked day by day", () => {
  test("a lapsed monthly subscription takes exactly 21 days to stop serving", () => {
    // The number a customer support person needs, asserted rather than left to
    // be re-derived from two constants in another file.
    const { pastDueDays, graceDays } = DEFAULT_SUBSCRIPTION_LADDER_POLICY;

    let status: SubscriptionStatus = "active";
    let current = snapshot({ status, currentPeriodEnd: at(30) });
    const timeline: { day: number; to: SubscriptionStatus }[] = [];

    for (let day = 30; day <= 30 + pastDueDays + graceDays + 1; day += 1) {
      const transition = evaluateSubscriptionTransition(at(day), current);

      if (!transition) continue;

      timeline.push({ day, to: transition.to });
      status = transition.to;
      current = {
        ...current,
        status,
        graceEndsAt: transition.graceEndsAt ?? current.graceEndsAt
      };
    }

    expect(timeline).toEqual([
      { day: 30, to: "past_due" },
      { day: 30 + pastDueDays, to: "grace" },
      { day: 30 + pastDueDays + graceDays, to: "suspended" }
    ]);

    expect(pastDueDays + graceDays).toBe(21);
  });
});

describe("the blast-radius bound", () => {
  const plan = (to: SubscriptionStatus) => ({
    transition: { to, reason: "x" }
  });

  const runOf = (
    losses: number,
    warnings = 0
  ): Map<
    string,
    { transition: { to: SubscriptionStatus; reason: string } }
  > => {
    const map = new Map<
      string,
      { transition: { to: SubscriptionStatus; reason: string } }
    >();
    for (let i = 0; i < losses; i += 1) map.set(`loss-${i}`, plan("suspended"));
    for (let i = 0; i < warnings; i += 1)
      map.set(`warn-${i}`, plan("past_due"));
    return map;
  };

  test("an ordinary run applies everything", () => {
    expect(partitionPlannedTransitions(runOf(3, 40)).withheldTenantIds).toEqual(
      []
    );
  });

  test("a run exactly AT the bound still applies", () => {
    expect(
      partitionPlannedTransitions(runOf(MAX_ENTITLEMENT_LOSSES_PER_RUN))
        .withheldTenantIds
    ).toEqual([]);
  });

  test("one over the bound withholds ALL of them, not the excess", () => {
    // The distinction is the whole point. Applying "the first 25" of a defect
    // is applying a defect, and it would look like a capped incident rather
    // than a stopped one.
    const withheld = partitionPlannedTransitions(
      runOf(MAX_ENTITLEMENT_LOSSES_PER_RUN + 1)
    ).withheldTenantIds;

    expect(withheld).toHaveLength(MAX_ENTITLEMENT_LOSSES_PER_RUN + 1);
  });

  test("warnings are never withheld, however many there are", () => {
    // `past_due` and `grace` change what the customer is TOLD, not what they can
    // reach. Withholding a warning helps nobody.
    const withheld = partitionPlannedTransitions(
      runOf(0, 5000)
    ).withheldTenantIds;

    expect(withheld).toEqual([]);
  });

  test("a flood of warnings cannot mask a flood of losses", () => {
    // The bound counts LOSSES, not transitions. Counting transitions would let
    // 25 real suspensions ride in under a run that also warned 500 tenants.
    const withheld = partitionPlannedTransitions(
      runOf(MAX_ENTITLEMENT_LOSSES_PER_RUN + 1, 500)
    ).withheldTenantIds;

    expect(withheld).toHaveLength(MAX_ENTITLEMENT_LOSSES_PER_RUN + 1);
    expect(withheld.every((id) => id.startsWith("loss-"))).toBe(true);
  });
});
