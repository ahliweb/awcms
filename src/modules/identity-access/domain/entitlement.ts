/**
 * Entitlement evaluation — ADR-0084, Gelombang 5 PR 5.1 of Issue #423.
 *
 * ## This file can only ever say NO
 *
 * Every exported decision function here returns `EntitlementDenial | null`.
 * There is no shape it can return that means "yes", and that is the entire
 * point: an entitlement is a STRUCTURAL gate layered on top of authorization,
 * never a source of it. A tenant that holds an entitlement has not been granted
 * anything — it has merely failed to be refused, and whatever it does next is
 * still decided by RBAC, ABAC, business scope and SoD exactly as before.
 *
 * The property is machine-checked by `bun run access:entitlement:deny-only:check`
 * rather than left to review, because the mutation that breaks it is small and
 * invisible: a helper that starts returning `{ allowed: true }` for the
 * entitled case reads like a tidy refactor and turns a deny-only gate into a
 * second grant path. ADR-0063 records the same class — a mutation that moved
 * the RBAC check above the ABAC block left every behavioural test green.
 *
 * `docs/PROJECT_STATE.md` §4 carries the matching REJECTION, and this file is
 * the shape of it: `subject.entitlements` was refused as an ABAC attribute. If
 * a tenant could write `allow when subject.entitlements contains X`, then a plan
 * downgrade would refuse through a different code path with a different sentinel
 * — two answers to one question, and the decision log unable to say which
 * mechanism spoke.
 *
 * ## Pure
 *
 * No I/O, no registry import, no clock. The caller resolves the facts (does the
 * module require anything, does the tenant hold it, is the actor the platform
 * tenant) and this file decides what they mean. Every fact arrives as an
 * argument so the whole decision is testable without a database.
 */
import type { ModuleDescriptor } from "../../_shared/module-contract";

/**
 * The one sentinel this layer writes to `awcms_abac_decision_logs.matched_policy`.
 *
 * A constant rather than a literal at each site: a decision-log consumer greps
 * for this exact string to answer "how many tenants hit a plan wall this week",
 * and a second spelling of it would make that answer quietly wrong.
 */
export const ENTITLEMENT_REQUIRED_POLICY = "entitlement_required" as const;

/**
 * The refusal, and the ONLY thing this layer can produce besides `null`.
 *
 * `entitlementKey` travels with it so the caller can name what was missing
 * without re-deriving it — and so the reason string stays a fixed phrase rather
 * than one assembled per call. The reason must never quote plan pricing or a
 * tenant's billing state: this string reaches an unauthenticated-ish surface
 * (a 403 body) and the caller may be a machine credential.
 */
export type EntitlementDenial = {
  reason: string;
  matchedPolicy: typeof ENTITLEMENT_REQUIRED_POLICY;
  entitlementKey: string;
};

/**
 * Subscription statuses that still confer their plan's entitlements.
 *
 * `past_due` and `grace` are deliberately INSIDE this set. The ladder PR 5.2
 * walks is `trialing -> active -> past_due -> grace -> suspended`, and cutting
 * service at the first missed payment would make the ladder's middle rungs
 * decorative — the whole reason they exist is that a customer keeps being served
 * while the operator chases the invoice. `suspended` and `cancelled` are outside
 * it, and `suspended` is where ADR-0073's tenant-level gate takes over.
 *
 * Exported because `resolveModuleAvailability` binds it into SQL. It must stay
 * a code constant and never become a column: a status set a row could redefine
 * is a plan wall a row could remove.
 */
export const ENTITLING_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "grace"
] as const;

/**
 * The entitlement a module's guarded surface requires, or `null` when it
 * requires none.
 *
 * Two of the three hard exemptions ADR-0084 names live here, because both are
 * properties of the MODULE rather than of the request:
 *
 * 1. **A descriptor that declares nothing requires nothing.** This is what makes
 *    the wave inert — no base module declares `requiresEntitlement`, so this
 *    returns `null` for all 22 and the chokepoint never reaches the branch.
 * 2. **`isCore` can never require one.** `module_management` is the only core
 *    module, and it is the module that re-enables everything else. An expired
 *    subscription that locks a tenant out of its own module screen is a control
 *    that bricks its own remedy — the identical argument ADR-0073 used to exempt
 *    the platform tenant from suspension. A core descriptor that declares an
 *    entitlement anyway is not honoured, and `bun run modules:compose:check`
 *    reports it rather than letting the contradiction sit in code.
 *
 * The third exemption — the acting tenant IS the platform tenant — is a property
 * of the REQUEST and therefore lives in `evaluateEntitlementRequirement` below.
 */
export function requiredEntitlementForModule(
  moduleKey: string,
  descriptors: readonly ModuleDescriptor[]
): string | null {
  const descriptor = descriptors.find((entry) => entry.key === moduleKey);

  if (!descriptor) {
    // An unknown module key is not this layer's failure to report. The guard
    // chain has already resolved a session and a module-enabled state for it;
    // inventing a refusal here would make a typo in a guard read as a billing
    // problem to whoever gets the 403.
    return null;
  }

  if (descriptor.isCore === true) {
    return null;
  }

  return descriptor.requiresEntitlement ?? null;
}

/**
 * Facts the caller resolved, all of them, so this stays pure.
 *
 * `held` is the caller's answer to "does this tenant hold the key" — the union
 * of a live direct grant and an entitling subscription's plan, resolved in the
 * single query `resolveModuleAvailability` already runs. It is a plain boolean
 * on purpose: this layer must not be able to re-derive entitlement from raw
 * rows, because a second derivation is a second place for the two to disagree.
 */
export type EntitlementFacts = {
  /** `null` — from `requiredEntitlementForModule` — means nothing is required. */
  requiredEntitlementKey: string | null;
  held: boolean;
  /**
   * The third hard exemption (ADR-0084). The platform tenant runs the control
   * plane that sells the plans; a lapsed subscription must never be able to lock
   * the operator out of the screen where subscriptions are fixed.
   *
   * Fail-CLOSED on this axis is wrong and the inversion is deliberate: an
   * unresolvable platform tenant makes this `false`, which means the operator is
   * gated like anyone else rather than everyone being treated as the operator.
   */
  actingTenantIsPlatform: boolean;
};

/**
 * `null` when there is no objection; an `EntitlementDenial` when there is.
 *
 * Read the return type as the contract it is: there is no third case and no
 * boolean, so no call site can mistake "this layer had nothing to say" for
 * "this layer approved".
 */
export function evaluateEntitlementRequirement(
  facts: EntitlementFacts
): EntitlementDenial | null {
  if (facts.requiredEntitlementKey === null) {
    return null;
  }

  if (facts.actingTenantIsPlatform) {
    return null;
  }

  if (facts.held) {
    return null;
  }

  return {
    reason: "This feature is not included in the current plan.",
    matchedPolicy: ENTITLEMENT_REQUIRED_POLICY,
    entitlementKey: facts.requiredEntitlementKey
  };
}
