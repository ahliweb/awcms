/**
 * The subscription ladder — ADR-0084, Gelombang 5 PR 5.2 of Issue #423.
 *
 * `trialing -> active -> past_due -> grace -> suspended`, evaluated as a PURE
 * function over a snapshot and a clock. No database, no I/O, no `new Date()`.
 *
 * ## It only ever walks DOWNWARD, and that is the safety property
 *
 * Every transition this file can produce moves a subscription toward LESS
 * service. `past_due -> active` and `trialing -> active` are payment events, not
 * clock events, and a clock cannot observe a payment — so they are deliberately
 * unrepresentable here. A function that could restore service on a timer would
 * be a function that restores service when the timer is wrong, and "the clock
 * was wrong" is the most common thing that goes wrong with billing code.
 *
 * That is the same shape as `domain/entitlement.ts` one directory over: a layer
 * whose reachable outputs are all refusals is a layer whose worst bug is
 * refusing too much, which is visible, rather than serving too much, which is
 * not.
 *
 * ## The job is the only writer, and it holds no opinions
 *
 * `bun run identity-access:subscription-lifecycle` applies whatever this returns
 * and nothing else. Splitting it this way is what makes the ladder testable
 * against a clock the test controls, and it means the interesting half of this
 * feature has no database in its test path at all.
 */

import { ENTITLING_SUBSCRIPTION_STATUSES } from "./entitlement";

export type SubscriptionStatus =
  "trialing" | "active" | "past_due" | "grace" | "suspended" | "cancelled";

/** The row, as far as the ladder is concerned. */
export type SubscriptionSnapshot = {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
};

/**
 * How long each rung lasts. Deployment-tunable rather than hard-coded, because
 * "how long do we keep serving an unpaid customer" is a commercial decision, not
 * an engineering one.
 */
export type SubscriptionLadderPolicy = {
  /** Days a lapsed subscription stays `past_due` before entering `grace`. */
  pastDueDays: number;
  /** Days `grace` lasts before service stops. */
  graceDays: number;
};

/**
 * Defaults chosen to be boring: two weeks of being chased, then one more week
 * with a visible warning, then service stops. The total (21 days) is longer than
 * a monthly billing cycle's typical retry window on purpose — a customer whose
 * card expired should not lose their site before a human has plausibly read an
 * email about it.
 */
export const DEFAULT_SUBSCRIPTION_LADDER_POLICY: SubscriptionLadderPolicy = {
  pastDueDays: 14,
  graceDays: 7
};

export type SubscriptionTransition = {
  to: SubscriptionStatus;
  /**
   * A fixed phrase, never assembled from row values. It reaches the tenant's
   * own audit trail, and a customer reading "why did my site stop" is owed a
   * sentence rather than a serialized timestamp.
   */
  reason: string;
  /**
   * Set only on the move into `grace`, because `awcms_tenant_subscriptions`
   * CHECKs that a `grace` row carries one. The ladder computes it rather than
   * the job, so "how long is grace" has exactly one answer.
   */
  graceEndsAt?: Date;
};

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * `null` when the clock has nothing to say — which is the answer for most rows
 * most of the time, including every `active` subscription inside its period and
 * every terminal one.
 *
 * `now` is passed in, never read from the clock here: a pure function of its
 * arguments is one a test can walk through 30 days in 30 lines, and this repo
 * has already recorded what happens when a time-dependent rule mixes the
 * application clock with the transaction clock.
 */
export function evaluateSubscriptionTransition(
  now: Date,
  subscription: SubscriptionSnapshot,
  policy: SubscriptionLadderPolicy = DEFAULT_SUBSCRIPTION_LADDER_POLICY
): SubscriptionTransition | null {
  switch (subscription.status) {
    case "trialing": {
      // A trial that runs out has not been paid for, so it lands on `past_due`
      // rather than on `active`. Landing it on `active` would mean every trial
      // silently becomes a free subscription the moment nobody acts — the
      // failure mode where forgetting to bill is indistinguishable from
      // deciding not to.
      if (
        subscription.trialEndsAt !== null &&
        now.getTime() >= subscription.trialEndsAt.getTime()
      ) {
        return { to: "past_due", reason: "The trial period ended." };
      }

      return null;
    }

    case "active": {
      // A NULL `current_period_end` means "no end scheduled", and it must read
      // as open-ended rather than as expired. The opposite reading would
      // suspend every subscription an operator created without a period — the
      // shape of a data-entry omission becoming an outage.
      if (
        subscription.currentPeriodEnd !== null &&
        now.getTime() >= subscription.currentPeriodEnd.getTime()
      ) {
        return {
          to: "past_due",
          reason: "The billing period ended without renewal."
        };
      }

      return null;
    }

    case "past_due": {
      // Measured from the period end, not from when the row entered `past_due`.
      // The row does not record the latter, and adding a column for it would
      // let a job that ran late — or ran twice — extend the ladder by restating
      // its own start. Anchoring to a date the BILLING cycle owns makes the
      // whole ladder idempotent: running the job ten times changes nothing.
      const anchor = subscription.currentPeriodEnd ?? subscription.trialEndsAt;

      if (anchor === null) {
        // Nothing to measure from. Deliberately inert rather than defaulting to
        // "escalate now": a row that reached `past_due` with neither date is
        // already inconsistent, and suspending a customer on the strength of an
        // inconsistency is the wrong direction to fail.
        return null;
      }

      if (now.getTime() >= addDays(anchor, policy.pastDueDays).getTime()) {
        return {
          to: "grace",
          reason: "Payment was not received during the past-due window.",
          graceEndsAt: addDays(now, policy.graceDays)
        };
      }

      return null;
    }

    case "grace": {
      if (
        subscription.graceEndsAt !== null &&
        now.getTime() >= subscription.graceEndsAt.getTime()
      ) {
        return { to: "suspended", reason: "The grace period ended." };
      }

      return null;
    }

    case "suspended":
    case "cancelled":
      // Terminal for the clock. Leaving both here explicitly, rather than under
      // a `default`, is what makes adding a status to the union a compile error
      // in this file instead of a silent no-op.
      return null;
  }
}

/**
 * What a transition actually COSTS the customer: whether it moves the
 * subscription out of the set that confers its plan's entitlements.
 *
 * ## This is where the plan was not followed, and why
 *
 * `docs/awcms/program-model-keanggotaan-2026-08-09.md` has PR 5.2 "menyambung ke
 * gerbang suspensi PR 0.6" — the lapsed ladder ending in a call to
 * `suspendTenant` (ADR-0073). It does not, and the reason is a privilege rather
 * than a preference.
 *
 * `suspendTenant` writes `awcms_tenants`, and this job runs as `awcms_worker`,
 * which holds `SELECT` on that table and nothing else. Making the join literal
 * means granting a cron role `UPDATE` on the RLS-FREE ROOT TABLE — the exact
 * crown-jewel class `WORKER_ROLE_GRANTS` documents itself as protecting ("any
 * awcms_% table NOT keyed here MUST be ungranted for this role"). A billing job
 * able to write tenant status is a billing bug able to stop every tenant in the
 * installation, and no RLS policy sits between the two.
 *
 * The join still exists; it goes through the gate this wave built instead.
 * `suspended` and `cancelled` are outside `ENTITLING_SUBSCRIPTION_STATUSES`, so
 * arriving there stops the plan conferring anything and every module gated on an
 * entitlement starts refusing at the chokepoint. That is also the more
 * PROPORTIONATE answer: an unpaid invoice costs the customer the features they
 * stopped paying for, not their public site, their login, and their data access.
 *
 * Tenant suspension stays what ADR-0073 made it — a deliberate human service
 * decision (abuse, legal, a support escalation) with its own permission, its own
 * audit action, and a person's name on it.
 *
 * Derived from `ENTITLING_SUBSCRIPTION_STATUSES` rather than restating
 * `=== "suspended"`, so the two cannot disagree about what "still served" means.
 */
export function transitionEndsEntitlement(
  transition: SubscriptionTransition
): boolean {
  return !(ENTITLING_SUBSCRIPTION_STATUSES as readonly string[]).includes(
    transition.to
  );
}
