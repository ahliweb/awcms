/**
 * Recent module-management activity for ONE module (Issue #261, ported from
 * awcms-micro).
 *
 * Read-only, bounded, tenant-scoped through RLS like every other audit query
 * here. It answers the question an operator has on a module's detail panel —
 * "what has been done to this module lately?" — which `listAuditEvents` cannot,
 * because that filters by `resource_type`, not by which module a row is about.
 *
 * ## Which resource types count
 *
 * Exactly those the module-management write surfaces record against a MODULE
 * KEY: tenant enable/disable, settings update, health check, and preset apply.
 *
 * `module_registry` is deliberately absent. Descriptor sync is a registry-wide
 * operation whose `resource_id` is not a module key, so including it would
 * match zero rows while implying to the next reader that it might match some.
 */

/**
 * `resource_id` on these rows is the module key — that is what makes a
 * per-module lookup possible at all.
 */
const RELEVANT_RESOURCE_TYPES = [
  "tenant_module",
  "module_settings",
  "module_health",
  "module_preset"
] as const;

/** Hard ceiling regardless of what the caller asks for: this feeds an admin panel, never an export. */
export const MODULE_AUDIT_SUMMARY_MAX_LIMIT = 50;
export const MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT = 20;

export type ModuleAuditSummaryEntry = {
  action: string;
  resourceType: string;
  severity: string;
  message: string;
  createdAt: string;
};

/** Clamps to `[1, MAX]`, and treats a non-finite or non-integer input as the default rather than trusting it. */
export function boundAuditSummaryLimit(limit: unknown): number {
  const parsed =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.trunc(limit)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MODULE_AUDIT_SUMMARY_MAX_LIMIT);
}

export async function fetchModuleAuditSummary(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  limit: number = MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT
): Promise<ModuleAuditSummaryEntry[]> {
  const rows = (await tx`
    SELECT action, resource_type, severity, message, created_at
    FROM awcms_audit_events
    WHERE tenant_id = ${tenantId}
      AND resource_id = ${moduleKey}
      AND resource_type = ANY(${[...RELEVANT_RESOURCE_TYPES]}::text[])
    ORDER BY created_at DESC, id DESC
    LIMIT ${boundAuditSummaryLimit(limit)}
  `) as {
    action: string;
    resource_type: string;
    severity: string;
    message: string;
    created_at: Date;
  }[];

  return rows.map((row) => ({
    action: row.action,
    resourceType: row.resource_type,
    severity: row.severity,
    message: row.message,
    createdAt: row.created_at.toISOString()
  }));
}
