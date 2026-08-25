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
 *
 * A batch of one, deliberately: `recordAuditEvents` below holds the only copy
 * of the column list, the redaction call and the null handling, so the singular
 * and plural forms cannot drift into writing different rows for the same input.
 */
export async function recordAuditEvent(
  tx: Bun.SQL,
  input: AuditEventInput
): Promise<void> {
  await recordAuditEvents(tx, [input]);
}

/**
 * The same write for a WHOLE batch — one statement, not one per event.
 *
 * ## Why this exists
 *
 * Every sweep job in this repo audits per item: the scheduled publish/unpublish
 * sweeps, workflow escalation, the backfills. At a batch bound of 200 that is
 * 200 round trips whose only variation is the message, on the one reserved
 * `maintenance` connection the job holds for the duration. The read side of
 * this pattern was fixed long ago (`fetchPostTermIdsForPosts`, "three round
 * trips per page, not fifty-one"); the write side had nobody counting.
 *
 * ## `jsonb_to_recordset`, not `unnest`
 *
 * The `INSERT ... SELECT unnest(...)` idiom used elsewhere in this repo
 * (`syncPostTermAssignments`, `comment-retention.ts`) takes one array per
 * column, and this table has EIGHT nullable columns plus a `jsonb` one. Bun's
 * array binding cannot carry a NULL — it writes the literal string `null`
 * without throwing — so the unnest shape would need a sentinel and a `NULLIF`
 * per nullable column, eight chances to get it silently wrong.
 *
 * One `jsonb` parameter carrying the rows sidesteps all of it: JSON `null` maps
 * to SQL NULL, `attributes` stays a real nested object rather than a string,
 * and the column types are declared once in the `AS entry (...)` list. The
 * value is bound directly (`${rows}::jsonb`) — `JSON.stringify(rows)::jsonb`
 * would store the jsonb SCALAR STRING, the trap `db:jsonb-binding:check` exists
 * to refuse.
 *
 * Rows are inserted in one statement, so they share one `created_at`: the
 * column defaults to `now()`, which is TRANSACTION START, so the per-item loop
 * this replaces already stamped every row of a sweep identically. Ordering
 * within a batch was never expressed by the timestamp and is not lost here.
 *
 * A batch mixing tenants is refused by RLS's `WITH CHECK`, exactly as the
 * singular form is — there is no JS-side re-implementation of a boundary the
 * database already enforces.
 */
export async function recordAuditEvents(
  tx: Bun.SQL,
  inputs: readonly AuditEventInput[]
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }

  const rows = inputs.map((input) => ({
    tenant_id: input.tenantId,
    actor_tenant_user_id: input.actorTenantUserId ?? null,
    actor_tenant_id: input.actorTenantId ?? null,
    delegated_grant_id: input.delegatedGrantId ?? null,
    module_key: input.moduleKey,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    severity: input.severity ?? "info",
    message: input.message,
    attributes: redactSensitiveAttributes(input.attributes) ?? null,
    correlation_id: input.correlationId ?? null
  }));

  await tx`
    INSERT INTO awcms_audit_events
      (tenant_id, actor_tenant_user_id, actor_tenant_id, delegated_grant_id,
       module_key, action, resource_type, resource_id,
       severity, message, attributes, correlation_id)
    SELECT entry.tenant_id, entry.actor_tenant_user_id, entry.actor_tenant_id,
           entry.delegated_grant_id, entry.module_key, entry.action,
           entry.resource_type, entry.resource_id, entry.severity,
           entry.message, entry.attributes, entry.correlation_id
    FROM jsonb_to_recordset(${rows}::jsonb) AS entry (
      tenant_id uuid,
      actor_tenant_user_id uuid,
      actor_tenant_id uuid,
      delegated_grant_id uuid,
      module_key text,
      action text,
      resource_type text,
      resource_id text,
      severity text,
      message text,
      attributes jsonb,
      correlation_id text
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
