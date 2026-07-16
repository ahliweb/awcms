/**
 * Template category → allowed variable names (Issue #498, epic #492).
 * `template_key` (`sql/020`'s format check, dot-separated) doubles as the
 * category for allowlist purposes — there is no separate `category`
 * column; a template's own key already identifies its category.
 *
 * Base categories are fixed here. `derived.*` is an **extension
 * namespace** (per the issue: "derived.transactional as an extension
 * category pattern for derived apps") — a derived application registers
 * its own `derived.<name>` categories via
 * `registerDerivedEmailTemplateCategory` before using them; an
 * unregistered `derived.*` category is rejected (fail-closed), not
 * implicitly allowed with an empty/unlimited allowlist.
 */

export const BASE_EMAIL_TEMPLATE_CATEGORIES = [
  "auth.password_reset",
  "system.announcement",
  "system.security_notice",
  "system.maintenance",
  "workflow.task_assigned",
  "workflow.decision_required",
  "derived.transactional"
] as const;

const BASE_CATEGORY_ALLOWLISTS: Readonly<Record<string, readonly string[]>> = {
  "auth.password_reset": ["userName", "resetUrl", "expiresInMinutes"],
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
  "derived.transactional": ["userName", "subject", "body", "actionUrl"]
};

const derivedCategoryAllowlists = new Map<string, readonly string[]>();

/**
 * Derived apps call this once at startup to register their own
 * `derived.<name>` category (e.g. `derived.order_confirmation`) with its
 * allowed variable names, before any template using that category is
 * created or rendered. Throws if `category` is not `derived.`-prefixed —
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
    derivedCategoryAllowlists.has(category)
  );
}

/** `null` for an unrecognized category — callers must treat that as a validation error, never as "no restrictions". */
export function getAllowedVariablesForCategory(
  category: string
): readonly string[] | null {
  return (
    BASE_CATEGORY_ALLOWLISTS[category] ??
    derivedCategoryAllowlists.get(category) ??
    null
  );
}
