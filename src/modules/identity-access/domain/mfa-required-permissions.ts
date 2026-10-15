/**
 * Which permissions require an enrolled MFA factor to EXERCISE (ADR-0141,
 * finding PS-13 of the `hr_payroll` phase-3 security review).
 *
 * ## The gap this closes
 *
 * ADR-0027 gave the tenant an MFA policy and ADR-0141 §4 taught every caller to
 * apply step-up CONDITIONALLY — only to a person who has a factor, because an
 * unconditional `requireStepUp` permanently locks out everyone without one.
 * Both are right, and together they leave a hole: a holder with no factor is
 * simply not asked for anything, so the permissions that move money or disclose
 * a recoverable secret are exercised on a password alone. The tenant policy
 * cannot close it from the permission's side — `required_for_privileged`
 * classifies on "any non-read permission" and is an all-or-nothing setting for
 * the whole tenant, defaulting to `optional`.
 *
 * ## What this is, and what it is not
 *
 * A permission declares `requiresMfaEnrolment: true` in its module descriptor.
 * The chokepoint then refuses an otherwise-ALLOWED decision when the acting
 * person has no active factor. That is a statement about what the caller CAN
 * do, not a demand that they do it now:
 *
 * - It is not a step-up. A fresh second-factor proof is still the owning
 *   module's conditional call (`requireStepUp` behind `getMfaStatus`), which
 *   this flag makes always-applicable for the people it admits — an enrolled
 *   holder is exactly who the conditional applies to.
 * - It is not unconditional. The people it refuses can always un-refuse
 *   themselves: enrolment needs a session and no permission.
 *
 * ## Code, not a column
 *
 * Read from the module registry, never from the database, for the argument
 * ADR-0053 §3 makes about `scope`: a flag a row could clear is a requirement a
 * single UPDATE removes while every check stays green. Hence no migration.
 *
 * ## Cost
 *
 * Computed once, lazily, from the registry — no query, and nothing further runs
 * for a request whose permission is not in the set (the overwhelming majority).
 * Lazy for the same import-order reason `platform-scope.ts` is: this file is
 * reached from `access-guard.ts`, which routes import, while `listModules()`
 * pulls every `module.ts`.
 */
import type { ModuleDescriptor } from "../../_shared/module-contract";
import { listModules } from "../../index";
import { permissionKey } from "./access-control";
import {
  MFA_ENROLMENT_PATH,
  MFA_ENROLMENT_REQUIRED_CODE,
  MFA_ENROLMENT_REQUIRED_POLICY
} from "./mfa-enrolment-refusal";

export {
  MFA_ENROLMENT_PATH,
  MFA_ENROLMENT_REQUIRED_CODE,
  MFA_ENROLMENT_REQUIRED_POLICY
};

/**
 * Every `module.activity.action` whose descriptor declares
 * `requiresMfaEnrolment: true`, over the given modules. Pure, so the registry
 * rules and the test fixtures share one definition of "flagged".
 */
export function collectMfaRequiredPermissionKeys(
  modules: readonly Pick<ModuleDescriptor, "key" | "permissions">[]
): ReadonlySet<string> {
  const keys = new Set<string>();

  for (const module of modules) {
    for (const permission of module.permissions ?? []) {
      if (permission.requiresMfaEnrolment === true) {
        keys.add(
          permissionKey(module.key, permission.activityCode, permission.action)
        );
      }
    }
  }

  return keys;
}

let cached: ReadonlySet<string> | null = null;

/** The flagged keys of the composed registry. Memoized: it is build-time constant. */
export function mfaRequiredPermissionKeys(): ReadonlySet<string> {
  if (cached) return cached;

  cached = collectMfaRequiredPermissionKeys(listModules());
  return cached;
}

export function isMfaRequiredPermissionKey(key: string): boolean {
  return mfaRequiredPermissionKeys().has(key);
}

/** Test seam — the registry is constant in production, never re-read. */
export function resetMfaRequiredPermissionCacheForTests(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type MfaEnrolmentFacts = {
  /** The permission being exercised is flagged `requiresMfaEnrolment`. */
  required: boolean;
  /** The request is authenticated by a machine credential, not a person's session. */
  viaMachineCredential: boolean;
  /** The acting person has an ACTIVE factor (a pending, unconfirmed one does not count). */
  enrolled: boolean;
  /** `AUTH_MFA_ENABLED` — whether a person can enrol on this deployment at all. */
  enrolmentAvailable: boolean;
};

export type MfaEnrolmentVerdict =
  | { outcome: "satisfied" }
  | {
      outcome: "refused";
      /** Which refusal, for the audit trail and the caller's remediation. */
      reason: "not_enrolled" | "enrolment_unavailable" | "machine_credential";
      message: string;
    };

/**
 * Whether an allowed decision on a flagged permission may stand. Deny-only: it
 * returns `satisfied` for everything it does not refuse, and has no way to turn
 * a deny into an allow.
 *
 * Three refusals, deliberately distinct because each has a different remedy and
 * a caller handed the wrong one is a support ticket:
 *
 * - `not_enrolled` — the person can fix this themselves, now. The message says
 *   where.
 * - `enrolment_unavailable` — `AUTH_MFA_ENABLED` is off, so nobody on this
 *   deployment CAN enrol. Fail-closed rather than inert (contrast ADR-0027 §9,
 *   where an inert policy merely withheld a login nicety): an inert flag here
 *   would silently re-open the exact hole it exists to close, on the deployments
 *   least likely to have noticed. The remedy belongs to an operator, and the
 *   message says so instead of sending the person to a screen that cannot help.
 * - `machine_credential` — a service credential cannot hold a factor, so no
 *   remedy exists for it. Said plainly, so nobody goes looking for one.
 *
 * The messages carry no identifier, no permission key and no tenant detail: the
 * caller already holds the permission (this runs only after an allow), and the
 * response is not the place to teach anyone else what is flagged.
 */
export function evaluateMfaEnrolmentRequirement(
  facts: MfaEnrolmentFacts
): MfaEnrolmentVerdict {
  if (!facts.required) return { outcome: "satisfied" };

  if (facts.viaMachineCredential) {
    return {
      outcome: "refused",
      reason: "machine_credential",
      message:
        "This action requires a person with an enrolled multi-factor authentication factor. A service credential cannot perform it."
    };
  }

  if (facts.enrolled) return { outcome: "satisfied" };

  if (!facts.enrolmentAvailable) {
    return {
      outcome: "refused",
      reason: "enrolment_unavailable",
      message:
        "This action requires an enrolled multi-factor authentication factor, but enrolment is not enabled on this deployment. Ask an administrator to enable it."
    };
  }

  return {
    outcome: "refused",
    reason: "not_enrolled",
    message: `This action requires an enrolled multi-factor authentication factor. Enrol one in your account settings (${MFA_ENROLMENT_PATH}), then retry.`
  };
}
