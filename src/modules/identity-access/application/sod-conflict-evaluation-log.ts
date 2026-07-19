/**
 * Append-only SoD conflict-check decision log (Issue #181, epic #177 Wave 2
 * authorization). Ported from awcms-mini
 * (`identity-access/application/sod-conflict-evaluation-log.ts`, Issue #746) —
 * recorded regardless of outcome, the same "append-always" convention
 * `recordDecisionLog` (`decision-log.ts`) established for ordinary ABAC
 * decisions (issue #181: "Setiap deny/override/exception lifecycle masuk audit
 * dan decision log").
 */
import type { KeysetCursor } from "../../_shared/keyset-pagination";

export type SoDConflictEvaluationInput = {
  ruleKey: string;
  subjectTenantUserId: string | null;
  triggerContext: "assignment_create" | "high_risk_decision";
  conflictDetected: boolean;
  resolvedVia: "none" | "exception" | "denied";
  decisionReason: string;
  metadata?: Record<string, unknown>;
};

export async function recordSoDConflictEvaluation(
  tx: Bun.SQL,
  tenantId: string,
  input: SoDConflictEvaluationInput
): Promise<void> {
  await tx`
    INSERT INTO awcms_sod_conflict_evaluations
      (tenant_id, rule_key, subject_tenant_user_id, trigger_context, conflict_detected,
       resolved_via, decision_reason, metadata)
    VALUES (
      ${tenantId}, ${input.ruleKey}, ${input.subjectTenantUserId}, ${input.triggerContext},
      ${input.conflictDetected}, ${input.resolvedVia}, ${input.decisionReason},
      ${input.metadata ?? {}}
    )
  `;
}

export type SoDConflictEvaluationRow = {
  id: string;
  tenantId: string;
  ruleKey: string;
  subjectTenantUserId: string | null;
  triggerContext: "assignment_create" | "high_risk_decision";
  conflictDetected: boolean;
  resolvedVia: "none" | "exception" | "denied";
  decisionReason: string;
  occurredAt: Date;
  /** Full-precision `occurred_at` text for keyset pagination (see `keyset-pagination.ts`) — never a JS `Date`. */
  occurredAtCursor: string;
};

type SoDConflictEvaluationDbRow = {
  id: string;
  tenant_id: string;
  rule_key: string;
  subject_tenant_user_id: string | null;
  trigger_context: SoDConflictEvaluationRow["triggerContext"];
  conflict_detected: boolean;
  resolved_via: SoDConflictEvaluationRow["resolvedVia"];
  decision_reason: string;
  occurred_at: Date;
  occurred_at_cursor: string;
};

function toRow(row: SoDConflictEvaluationDbRow): SoDConflictEvaluationRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruleKey: row.rule_key,
    subjectTenantUserId: row.subject_tenant_user_id,
    triggerContext: row.trigger_context,
    conflictDetected: row.conflict_detected,
    resolvedVia: row.resolved_via,
    decisionReason: row.decision_reason,
    occurredAt: row.occurred_at,
    occurredAtCursor: row.occurred_at_cursor
  };
}

export type ListSoDConflictEvaluationsFilter = {
  ruleKey?: string;
  conflictDetected?: boolean;
};

/**
 * Keyset-paginated (`(occurred_at, id) < cursor`), newest first — the
 * "paginated/filtered/permission-gated/safe-error" list endpoint the
 * acceptance criteria call for. Safe projection: no request/resource payload,
 * only the small fixed fields above (rule key, subject id, trigger context,
 * outcome, reason, timestamp) — minimizes PII per issue #181's explicit
 * requirement.
 */
export async function listSoDConflictEvaluations(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListSoDConflictEvaluationsFilter & {
    limit: number;
    cursor?: KeysetCursor | null;
  }
): Promise<SoDConflictEvaluationRow[]> {
  const cursorCreatedAt = filter.cursor?.createdAt ?? null;
  const cursorId = filter.cursor?.id ?? null;

  // `to_char(occurred_at ...)` is inlined as a literal SQL fragment (this
  // table sorts on `occurred_at`, not `created_at`) — the same full-precision
  // cursor expression `email-message-directory.ts` inlines for `created_at`,
  // so the microsecond precision survives the cursor round-trip (Issue #158's
  // row-skip bug fix). Never `tx.unsafe()` INSIDE a tagged template — that
  // builds a whole raw string, it does not compose as a fragment.
  const rows = (await tx`
    SELECT id, tenant_id, rule_key, subject_tenant_user_id, trigger_context,
      conflict_detected, resolved_via, decision_reason, occurred_at,
      to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS occurred_at_cursor
    FROM awcms_sod_conflict_evaluations
    WHERE tenant_id = ${tenantId}
      AND (${filter.ruleKey ?? null}::text IS NULL OR rule_key = ${filter.ruleKey ?? null})
      AND (
        ${filter.conflictDetected ?? null}::boolean IS NULL
        OR conflict_detected = ${filter.conflictDetected ?? null}
      )
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (occurred_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${filter.limit}
  `) as SoDConflictEvaluationDbRow[];

  return rows.map(toRow);
}
