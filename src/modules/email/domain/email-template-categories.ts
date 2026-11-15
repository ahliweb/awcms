import { requireExtensionPointModules } from "../../_shared/extension-point-source";

/**
 * Template category → allowed variable names (Issue #498, epic #492).
 * `template_key` (`sql/020`'s format check, dot-separated) doubles as the
 * category for allowlist purposes — there is no separate `category`
 * column; a template's own key already identifies its category.
 *
 * Base categories are fixed here. `derived.*` is an **extension
 * namespace** (per the issue: "derived.transactional as an extension
 * category pattern for derived apps") — a domain module in `src/modules/`
 * DECLARES its own `derived.<name>` categories in its descriptor
 * (`ModuleDescriptor.emailTemplateCategories`, ADR-0164); an undeclared
 * `derived.*` category is rejected (fail-closed), not implicitly allowed with
 * an empty/unlimited allowlist.
 *
 * Descriptor declarations are resolved ON DEMAND from the source a composition
 * root installed (`_shared/extension-point-source.ts`: the web entry and the
 * dispatcher scripts), so this file does not import the module list and drag
 * every descriptor into the closure of each job that enqueues a base-category
 * e-mail. A `derived.*` lookup in a process with no source installed THROWS;
 * it is never "unknown, no variables" (that omission rendered a one-time code
 * as an empty string, Issue #1277). `registerDerivedEmailTemplateCategory`
 * remains for tests only; `bun run extension-points:check` rejects any other
 * caller.
 */

export const BASE_EMAIL_TEMPLATE_CATEGORIES = [
  "auth.password_reset",
  "auth.invitation",
  "system.announcement",
  "system.security_notice",
  "system.maintenance",
  "workflow.task_assigned",
  "workflow.decision_required",
  // #1044 — `hr_workforce` tells a correction's requester how it ended. One
  // category per outcome so each is translated whole (no outcome word is ever
  // passed in as a variable, where it would stay English in an Indonesian mail).
  "hr.attendance_correction_applied",
  "hr.attendance_correction_rejected",
  "hr.attendance_correction_cancelled",
  // #1165 (ADR-0159) — `crm_follow_up` tells a member of STAFF about a follow-up
  // task (never the lead). One category per kind, so each is translated whole.
  "crm.follow_up_assigned",
  "crm.follow_up_due",
  "crm.follow_up_escalated",
  "derived.transactional"
] as const;

const BASE_CATEGORY_ALLOWLISTS: Readonly<Record<string, readonly string[]>> = {
  "auth.password_reset": ["userName", "resetUrl", "expiresInMinutes"],
  // No `userName`, and its absence is the decision. Every other category gets
  // one from the recipient's profile, because every other category is
  // addressed to an account. An invitee has none — the only name this system
  // holds for them is the one the inviter typed, so the template greets them
  // with `inviteeName` and names the tenant and the person who invited them.
  "auth.invitation": [
    "inviteeName",
    "inviterName",
    "tenantName",
    "invitationUrl",
    "expiresInHours"
  ],
  "system.announcement": ["userName", "title", "body", "actionUrl"],
  "system.security_notice": [
    "userName",
    "eventDescription",
    "occurredAt",
    "ipAddress"
  ],
  "system.maintenance": [
    "userName",
    "maintenanceWindow",
    "expectedDuration",
    "impactDescription"
  ],
  "workflow.task_assigned": [
    "userName",
    "taskTitle",
    "assignedBy",
    "dueAt",
    "taskUrl"
  ],
  "workflow.decision_required": [
    "userName",
    "workflowName",
    "requestedBy",
    "decisionUrl"
  ],
  // The employee and the date the correction is about. NEVER the correction's
  // reason (sensitive free text): there is deliberately no variable for it.
  "hr.attendance_correction_applied": [
    "userName",
    "employeeName",
    "correctionDate"
  ],
  "hr.attendance_correction_rejected": [
    "userName",
    "employeeName",
    "correctionDate"
  ],
  "hr.attendance_correction_cancelled": [
    "userName",
    "employeeName",
    "correctionDate"
  ],
  // The task title (tenant-authored configuration), its due instant and a short
  // opaque reference. NEVER the lead's name, contact value or a note: there is
  // deliberately no variable for any of them (ADR-0159 section 2).
  "crm.follow_up_assigned": ["userName", "taskTitle", "dueAt", "taskReference"],
  "crm.follow_up_due": ["userName", "taskTitle", "dueAt", "taskReference"],
  "crm.follow_up_escalated": [
    "userName",
    "taskTitle",
    "dueAt",
    "taskReference"
  ],
  "derived.transactional": ["userName", "subject", "body", "actionUrl"]
};

const derivedCategoryAllowlists = new Map<string, readonly string[]>();

/** The allow-list a module DECLARED for `category`, or `undefined`. First declaration wins; duplicates are a gate failure, not a runtime race. */
function declaredCategoryAllowlist(
  category: string
): readonly string[] | undefined {
  if (!category.startsWith("derived.")) {
    return undefined;
  }

  for (const module of requireExtensionPointModules(
    `The e-mail category "${category}"`
  )) {
    for (const entry of module.emailTemplateCategories ?? []) {
      if (entry.category === category) {
        return entry.allowedVariables;
      }
    }
  }

  return undefined;
}

/**
 * TEST-ONLY seam. A module declares its category in its descriptor
 * (`emailTemplateCategories`, ADR-0164); calling this from application code is
 * the process-local registration that Issue #1277 removed. Throws if `category` is not `derived.`-prefixed —
 * base categories are fixed and not extensible this way.
 */
export function registerDerivedEmailTemplateCategory(
  category: string,
  allowedVariables: readonly string[]
): void {
  if (!category.startsWith("derived.")) {
    throw new Error(
      `Only "derived.*" categories can be registered; got "${category}".`
    );
  }

  derivedCategoryAllowlists.set(category, allowedVariables);
}

/** Test-only: clears derived category registrations between tests. */
export function resetDerivedEmailTemplateCategoriesForTests(): void {
  derivedCategoryAllowlists.clear();
}

export function isKnownEmailTemplateCategory(category: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(BASE_CATEGORY_ALLOWLISTS, category) ||
    derivedCategoryAllowlists.has(category) ||
    declaredCategoryAllowlist(category) !== undefined
  );
}

/** `null` for an unrecognized category — callers must treat that as a validation error, never as "no restrictions". */
export function getAllowedVariablesForCategory(
  category: string
): readonly string[] | null {
  return (
    BASE_CATEGORY_ALLOWLISTS[category] ??
    derivedCategoryAllowlists.get(category) ??
    declaredCategoryAllowlist(category) ??
    null
  );
}
