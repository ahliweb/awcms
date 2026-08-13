import { redactSensitiveAttributes } from "../../_shared/redaction";

export type AuditEventInput = {
  tenantId: string;
  actorTenantUserId?: string;
  /**
   * ADR-0091 — the tenant the ACTOR belongs to, set only when it differs from
   * `tenantId`.
   *
   * Absent is the ordinary case and means "the actor is one of ours", not "we
   * do not know". Writing it on every row would duplicate `tenantId` on 99.9%
   * of them, and a column that almost always equals its neighbour stops being
   * read — which is precisely when the one row where it differs goes unnoticed.
   */
  actorTenantId?: string;
  /**
   * ADR-0091 — the delegated-access grant (ADR-0090) that made this action
   * possible. Paired with `actorTenantId` by a CHECK in `sql/118`: a row may not
   * claim to be under a grant without saying whose.
   */
  delegatedGrantId?: string;
  moduleKey: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  severity?: "info" | "warning" | "critical";
  message: string;
  attributes?: Record<string, unknown>;
  correlationId?: string;
};

export type AuditEventRecord = {
  id: string;
  actorTenantUserId: string | null;
  moduleKey: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  severity: string;
  message: string;
  attributes: Record<string, unknown> | null;
  correlationId: string | null;
  createdAt: Date;
};

/**
 * Writes one row to `awcms_audit_events`. Tenant-scoped, RLS-protected.
 * `attributes` is redacted here before the INSERT — never persist raw
 * password/token/NPWP/NIK/phone/email values, even if a caller forgot to
 * redact them first.
 */
export async function recordAuditEvent(
  tx: Bun.SQL,
  input: AuditEventInput
): Promise<void> {
  const redactedAttributes = redactSensitiveAttributes(input.attributes);

  await tx`
    INSERT INTO awcms_audit_events
      (tenant_id, actor_tenant_user_id, actor_tenant_id, delegated_grant_id,
       module_key, action, resource_type, resource_id,
       severity, message, attributes, correlation_id)
    VALUES (
      ${input.tenantId}, ${input.actorTenantUserId ?? null},
      ${input.actorTenantId ?? null}, ${input.delegatedGrantId ?? null},
      ${input.moduleKey}, ${input.action},
      ${input.resourceType}, ${input.resourceId ?? null}, ${input.severity ?? "info"},
      ${input.message}, ${redactedAttributes ?? null}, ${input.correlationId ?? null}
    )
  `;
}

export type ListAuditEventsOptions = {
  resourceType?: string;
  limit?: number;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

export async function listAuditEvents(
  tx: Bun.SQL,
  tenantId: string,
  options: ListAuditEventsOptions = {}
): Promise<AuditEventRecord[]> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_LIST_LIMIT, 1),
    MAX_LIST_LIMIT
  );
  const resourceType = options.resourceType ?? null;

  const rows = (await tx`
    SELECT id, actor_tenant_user_id, module_key, action, resource_type, resource_id,
      severity, message, attributes, correlation_id, created_at
    FROM awcms_audit_events
    WHERE tenant_id = ${tenantId}
      AND (${resourceType}::text IS NULL OR resource_type = ${resourceType})
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as Array<{
    id: string;
    actor_tenant_user_id: string | null;
    module_key: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    severity: string;
    message: string;
    attributes: Record<string, unknown> | null;
    correlation_id: string | null;
    created_at: Date;
  }>;

  return rows.map((row) => ({
    id: row.id,
    actorTenantUserId: row.actor_tenant_user_id,
    moduleKey: row.module_key,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    severity: row.severity,
    message: row.message,
    attributes: row.attributes,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  }));
}
