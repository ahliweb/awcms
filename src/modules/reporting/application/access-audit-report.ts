export const ACCESS_AUDIT_DECISION_WINDOW_DAYS = 30;

export type AccessAuditReport = {
  decisionWindowDays: number;
  allowCount: number;
  denyCount: number;
  totalDecisionCount: number;
  auditEventCount: number;
};

/**
 * Access/audit summary (`GET /reports/access-audit`). Live
 * read-aggregation over `awcms_abac_decision_logs` (migration 005) and
 * `awcms_audit_events` (migration 007) — no new tables.
 *
 * `allowCount`/`denyCount` are windowed (last
 * `ACCESS_AUDIT_DECISION_WINDOW_DAYS` days); `totalDecisionCount` is
 * all-time. `auditEventCount` is an all-time count of the cross-module
 * audit trail (`awcms_audit_events`) used as a generic signal for "there
 * is other audit activity happening" alongside the ABAC decision counts.
 *
 * Port note (from awcms-mini): the mini base had no general-purpose
 * audit-events table and counted `profile_audit_logs` as a proxy; this
 * repo has the real cross-module `awcms_audit_events` table (owned by the
 * `logging` module), so this report counts that directly instead.
 */
export async function fetchAccessAuditReport(
  tx: Bun.SQL,
  tenantId: string
): Promise<AccessAuditReport> {
  const decisionRows = await tx`
    SELECT decision, COUNT(*) AS decision_count
    FROM awcms_abac_decision_logs
    WHERE tenant_id = ${tenantId}
      AND created_at >= now() - make_interval(days => ${ACCESS_AUDIT_DECISION_WINDOW_DAYS})
    GROUP BY decision
  `;

  let allowCount = 0;
  let denyCount = 0;

  for (const row of decisionRows as {
    decision: string;
    decision_count: string;
  }[]) {
    if (row.decision === "allow") {
      allowCount = Number(row.decision_count);
    } else if (row.decision === "deny") {
      denyCount = Number(row.decision_count);
    }
  }

  const totalRows = await tx`
    SELECT COUNT(*) AS total_count
    FROM awcms_abac_decision_logs
    WHERE tenant_id = ${tenantId}
  `;

  const auditEventRows = await tx`
    SELECT COUNT(*) AS audit_event_count
    FROM awcms_audit_events
    WHERE tenant_id = ${tenantId}
  `;

  return {
    decisionWindowDays: ACCESS_AUDIT_DECISION_WINDOW_DAYS,
    allowCount,
    denyCount,
    totalDecisionCount: Number(totalRows[0]?.total_count ?? 0),
    auditEventCount: Number(auditEventRows[0]?.audit_event_count ?? 0)
  };
}
