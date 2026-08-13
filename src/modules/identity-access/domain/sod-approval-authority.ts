/**
 * Who may approve an exception to a PARTICULAR SoD rule (Issue #545).
 *
 * ## The field that was declared and never read
 *
 * `SoDRuleDescriptor.exceptionPolicy.requiresApprovalPermission` is described
 * by the module contract as "the permission key a DIFFERENT tenant user must
 * hold to approve an exception to THIS rule, never the same permission the
 * rule itself conflicts over". `sod-rule-registry.ts` refuses a rule that
 * omits it or misspells it. `sod-exception-service.ts` said in prose that it
 * was "gated at the route".
 *
 * Nothing read it. The approve route asked the chokepoint for the fixed
 * `identity_access.business_scope_exceptions.approve` and stopped there, and
 * the one rule this base ships names exactly that key — so the two coincided
 * and the omission was invisible. The first module to declare a rule
 * approvable only by, say, a finance controller would have had that
 * requirement silently ignored while three artefacts said otherwise: a
 * control that reads as enforced and is not.
 *
 * ## Why this is a pure function and not four lines in the route
 *
 * The interesting part is not "does the route call the chokepoint" — the
 * chokepoint gate proves that — but WHICH request it should ask about, and
 * what it should do when the rule cannot be found. Those are three branches
 * with a fail-closed default, and a branch that leans the wrong way here
 * approves a segregation-of-duties bypass. Pure, they are testable without a
 * database; in the route, they would only be reachable through an HTTP test
 * that needs one.
 */
import type { SoDRuleDescriptor } from "../../_shared/module-contract";
import { parsePermissionKey, type AccessRequest } from "./access-control";

export type SoDApprovalAuthority =
  /** The rule asks for nothing beyond the fixed approve permission. */
  | { outcome: "base_only" }
  /** The rule names its own checker permission; the caller must hold it TOO. */
  | { outcome: "additional"; request: AccessRequest }
  /** Nobody may approve this one. */
  | {
      outcome: "refused";
      code: "SOD_RULE_UNKNOWN" | "SOD_RULE_APPROVAL_PERMISSION_INVALID";
      message: string;
    };

/**
 * `baseApprovalKey` is passed in rather than hard-coded so the caller and this
 * function cannot disagree about which gate already ran — the whole point of
 * the `additional` outcome is that it is the SECOND one.
 */
export function resolveSoDApprovalAuthority(
  ruleKey: string,
  rules: readonly SoDRuleDescriptor[],
  baseApprovalKey: string
): SoDApprovalAuthority {
  const rule = rules.find((candidate) => candidate.ruleKey === ruleKey);

  // An exception's whole meaning is "proceed despite THIS rule", so an
  // override nobody can describe is one nobody can review. It is also already
  // inert — the evaluator resolves exceptions by rule key, and no decision
  // consults a rule that is gone — which is why refusing costs nothing that
  // was working. Rejecting and revoking stay available, so an operator can
  // still clean the row up.
  if (!rule) {
    return {
      outcome: "refused",
      code: "SOD_RULE_UNKNOWN",
      message:
        "No installed module declares that SoD rule, so an exception to it cannot be approved. It can still be rejected or revoked."
    };
  }

  const required = rule.exceptionPolicy.requiresApprovalPermission;

  // Absent is legitimate: the registry only requires the field when
  // `allowed` is true, and a rule that forbids exceptions has no pending row
  // to approve in the first place (the create path refuses it). Treating
  // absent as "base only" therefore changes nothing that can occur, while
  // treating it as a refusal would break the one case that can.
  if (!required || required === baseApprovalKey) {
    return { outcome: "base_only" };
  }

  const request = parsePermissionKey(required);

  // Unparseable DENIES rather than falling through to the base gate. The
  // registry check makes this unreachable for a rule that shipped through CI,
  // and "the declared checker permission is malformed" must never be the
  // reason a bypass is approved by someone the rule did not name.
  if (!request) {
    return {
      outcome: "refused",
      code: "SOD_RULE_APPROVAL_PERMISSION_INVALID",
      message:
        "That rule declares an approval permission this deployment cannot parse."
    };
  }

  return { outcome: "additional", request };
}
