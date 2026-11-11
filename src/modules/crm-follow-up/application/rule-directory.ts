/**
 * Follow-up rules and their immutable revisions (Issue #1165, ADR-0159
 * section 3). A rule is created with revision 1; changing it publishes the
 * next revision (an identical definition is refused); a revision is never
 * edited (sql/369 trigger and no UPDATE grant). Every write takes the rule row
 * `FOR UPDATE` and checks the caller's `expectedVersion`.
 */
import {
  MAX_RULES_LISTED,
  type TriggerKind
} from "../domain/crm-follow-up-constants";
import {
  definitionFromRow,
  definitionHash,
  weekdayMaskOf,
  type RevisionRow,
  type RuleDefinition
} from "../domain/rule-definition";

type Sql = Bun.SQL;

export type RevisionView = {
  id: string;
  revisionNumber: number;
  definition: RuleDefinition;
  definitionHash: string;
  publishedAt: string;
  publishedBy: string | null;
};

export type RuleView = {
  id: string;
  code: string;
  name: string;
  status: "active" | "archived";
  currentRevisionNumber: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  currentRevision: RevisionView | null;
};

type RuleRow = {
  id: string;
  code: string;
  name: string;
  status: "active" | "archived";
  current_revision_number: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type FullRevisionRow = RevisionRow & {
  id: string;
  rule_id: string;
  revision_number: number;
  definition_hash: string;
  published_at: Date;
  published_by: string | null;
};

function revisionView(row: FullRevisionRow): RevisionView {
  return {
    id: row.id,
    revisionNumber: Number(row.revision_number),
    definition: definitionFromRow(row),
    definitionHash: row.definition_hash,
    publishedAt: row.published_at.toISOString(),
    publishedBy: row.published_by
  };
}

function ruleView(row: RuleRow, current: RevisionView | null): RuleView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    currentRevisionNumber: Number(row.current_revision_number),
    version: Number(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    currentRevision: current
  };
}

const REVISION_COLUMNS = `
  r.id, r.rule_id, r.revision_number, r.trigger_kind, r.pipeline_id,
  r.stage_category, r.stage_key, r.task_title, r.due_after_minutes,
  r.escalate_after_minutes, r.escalation_tenant_user_id, r.assignee_mode,
  r.fixed_assignee_tenant_user_id, r.notify_on_assign, r.notify_on_due,
  r.max_open_per_lead, r.time_zone, r.working_days, r.work_start_minute,
  r.work_end_minute, r.holidays, r.definition_hash, r.published_at,
  r.published_by`;

async function fetchRevisions(
  tx: Sql,
  tenantId: string,
  ruleId: string
): Promise<FullRevisionRow[]> {
  return (await tx.unsafe(
    `SELECT ${REVISION_COLUMNS}
       FROM awcms_crm_follow_up_rule_revisions r
      WHERE r.tenant_id = $1 AND r.rule_id = $2
      ORDER BY r.revision_number DESC
      LIMIT 200`,
    [tenantId, ruleId]
  )) as FullRevisionRow[];
}

/** Users the definition names must be ACTIVE users of this tenant. */
export async function unknownUsersIn(
  tx: Sql,
  tenantId: string,
  definition: RuleDefinition
): Promise<string[]> {
  const named = [
    definition.assignee.tenantUserId,
    definition.escalation?.recipientTenantUserId ?? null
  ].filter((id): id is string => id !== null);

  if (named.length === 0) return [];

  const rows = (await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId}
      AND id = ANY(${tx.array(named, "uuid")})
      AND status = 'active'
  `) as { id: string }[];
  const found = new Set(rows.map((row) => row.id));

  return named.filter((id) => !found.has(id));
}

async function insertRevision(
  tx: Sql,
  tenantId: string,
  ruleId: string,
  revisionNumber: number,
  definition: RuleDefinition,
  actor: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_crm_follow_up_rule_revisions
      (tenant_id, rule_id, revision_number, trigger_kind, pipeline_id,
       stage_category, stage_key, task_title, due_after_minutes,
       escalate_after_minutes, escalation_tenant_user_id, assignee_mode,
       fixed_assignee_tenant_user_id, notify_on_assign, notify_on_due,
       max_open_per_lead, time_zone, working_days, work_start_minute,
       work_end_minute, holidays, definition_hash, published_by)
    VALUES
      (${tenantId}, ${ruleId}, ${revisionNumber}, ${definition.trigger.kind},
       ${definition.trigger.pipelineId}, ${definition.trigger.stageCategory},
       ${definition.trigger.stageKey}, ${definition.taskTitle},
       ${definition.dueAfterMinutes},
       ${definition.escalation?.afterMinutes ?? null},
       ${definition.escalation?.recipientTenantUserId ?? null},
       ${definition.assignee.mode}, ${definition.assignee.tenantUserId},
       ${definition.notify.onAssign}, ${definition.notify.onDue},
       ${definition.maxOpenPerLead}, ${definition.calendar.timeZone},
       ${weekdayMaskOf(definition)}, ${definition.calendar.workStartMinute},
       ${definition.calendar.workEndMinute},
       ${tx.array(definition.calendar.holidays, "text")},
       ${definitionHash(definition)}, ${actor})
  `;
}

export type CreateRuleOutcome =
  | { outcome: "created"; rule: RuleView }
  | { outcome: "code_taken" }
  | { outcome: "unknown_users"; userIds: string[] };

export async function createRule(
  tx: Sql,
  tenantId: string,
  actor: string,
  input: { code: string; name: string; definition: RuleDefinition }
): Promise<CreateRuleOutcome> {
  const unknown = await unknownUsersIn(tx, tenantId, input.definition);

  if (unknown.length > 0) return { outcome: "unknown_users", userIds: unknown };

  const existing = (await tx`
    SELECT id FROM awcms_crm_follow_up_rules
    WHERE tenant_id = ${tenantId} AND code = ${input.code}
  `) as { id: string }[];

  if (existing[0]) return { outcome: "code_taken" };

  const rows = (await tx`
    INSERT INTO awcms_crm_follow_up_rules
      (tenant_id, code, name, current_revision_number, created_by, updated_by)
    VALUES (${tenantId}, ${input.code}, ${input.name}, 1, ${actor}, ${actor})
    RETURNING id
  `) as { id: string }[];
  const ruleId = rows[0]!.id;

  await insertRevision(tx, tenantId, ruleId, 1, input.definition, actor);

  return { outcome: "created", rule: (await fetchRule(tx, tenantId, ruleId))! };
}

export async function fetchRule(
  tx: Sql,
  tenantId: string,
  ruleId: string
): Promise<RuleView | null> {
  const rows = (await tx`
    SELECT id, code, name, status, current_revision_number, version,
           created_at, updated_at
    FROM awcms_crm_follow_up_rules
    WHERE tenant_id = ${tenantId} AND id = ${ruleId}
  `) as RuleRow[];
  const row = rows[0];

  if (!row) return null;

  const revisions = await fetchRevisions(tx, tenantId, ruleId);
  const current = revisions.find(
    (revision) =>
      Number(revision.revision_number) === Number(row.current_revision_number)
  );

  return ruleView(row, current ? revisionView(current) : null);
}

export async function fetchRuleWithRevisions(
  tx: Sql,
  tenantId: string,
  ruleId: string
): Promise<{ rule: RuleView; revisions: RevisionView[] } | null> {
  const rule = await fetchRule(tx, tenantId, ruleId);

  if (!rule) return null;

  return {
    rule,
    revisions: (await fetchRevisions(tx, tenantId, ruleId)).map(revisionView)
  };
}

export async function listRules(
  tx: Sql,
  tenantId: string
): Promise<RuleView[]> {
  const rules = (await tx`
    SELECT id, code, name, status, current_revision_number, version,
           created_at, updated_at
    FROM awcms_crm_follow_up_rules
    WHERE tenant_id = ${tenantId}
    ORDER BY code
    LIMIT ${MAX_RULES_LISTED}
  `) as RuleRow[];

  if (rules.length === 0) return [];

  const current = (await tx.unsafe(
    `SELECT ${REVISION_COLUMNS}
       FROM awcms_crm_follow_up_rule_revisions r
       JOIN awcms_crm_follow_up_rules u
         ON u.tenant_id = r.tenant_id AND u.id = r.rule_id
        AND u.current_revision_number = r.revision_number
      WHERE r.tenant_id = $1`,
    [tenantId]
  )) as FullRevisionRow[];
  const byRule = new Map(current.map((row) => [row.rule_id, row]));

  return rules.map((row) => {
    const revision = byRule.get(row.id);

    return ruleView(row, revision ? revisionView(revision) : null);
  });
}

export type RuleWriteOutcome =
  | { outcome: "published" | "archived"; rule: RuleView }
  | { outcome: "not_found" }
  | { outcome: "version_conflict"; currentVersion: number }
  | { outcome: "archived_rule" }
  | { outcome: "unchanged" }
  | { outcome: "unknown_users"; userIds: string[] };

async function lockRule(
  tx: Sql,
  tenantId: string,
  ruleId: string
): Promise<RuleRow | null> {
  const rows = (await tx`
    SELECT id, code, name, status, current_revision_number, version,
           created_at, updated_at
    FROM awcms_crm_follow_up_rules
    WHERE tenant_id = ${tenantId} AND id = ${ruleId}
    FOR UPDATE
  `) as RuleRow[];

  return rows[0] ?? null;
}

export async function publishRevision(
  tx: Sql,
  tenantId: string,
  actor: string,
  ruleId: string,
  input: { expectedVersion: number; definition: RuleDefinition }
): Promise<RuleWriteOutcome> {
  const rule = await lockRule(tx, tenantId, ruleId);

  if (!rule) return { outcome: "not_found" };
  if (Number(rule.version) !== input.expectedVersion) {
    return {
      outcome: "version_conflict",
      currentVersion: Number(rule.version)
    };
  }
  if (rule.status !== "active") return { outcome: "archived_rule" };

  const unknown = await unknownUsersIn(tx, tenantId, input.definition);

  if (unknown.length > 0) return { outcome: "unknown_users", userIds: unknown };

  const currentHash = (await tx`
    SELECT definition_hash FROM awcms_crm_follow_up_rule_revisions
    WHERE tenant_id = ${tenantId} AND rule_id = ${ruleId}
      AND revision_number = ${rule.current_revision_number}
  `) as { definition_hash: string }[];

  if (currentHash[0]?.definition_hash === definitionHash(input.definition)) {
    return { outcome: "unchanged" };
  }

  const next = Number(rule.current_revision_number) + 1;

  await insertRevision(tx, tenantId, ruleId, next, input.definition, actor);
  await tx`
    UPDATE awcms_crm_follow_up_rules
    SET current_revision_number = ${next}, version = version + 1,
        updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${ruleId}
  `;

  return {
    outcome: "published",
    rule: (await fetchRule(tx, tenantId, ruleId))!
  };
}

/**
 * Archive a rule: it creates no new task from now on. Tasks it already created
 * keep running (they are commitments to a lead, not rule state); stop them
 * with a stop signal or cancel them one by one.
 */
export async function archiveRule(
  tx: Sql,
  tenantId: string,
  actor: string,
  ruleId: string,
  expectedVersion: number
): Promise<RuleWriteOutcome> {
  const rule = await lockRule(tx, tenantId, ruleId);

  if (!rule) return { outcome: "not_found" };
  if (Number(rule.version) !== expectedVersion) {
    return {
      outcome: "version_conflict",
      currentVersion: Number(rule.version)
    };
  }
  if (rule.status !== "active") return { outcome: "archived_rule" };

  await tx`
    UPDATE awcms_crm_follow_up_rules
    SET status = 'archived', version = version + 1, updated_at = now(),
        updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${ruleId}
  `;

  return {
    outcome: "archived",
    rule: (await fetchRule(tx, tenantId, ruleId))!
  };
}

/** The CURRENT revision of every ACTIVE rule with this trigger. */
export async function fetchActiveRevisionsForTrigger(
  tx: Sql,
  tenantId: string,
  triggerKind: TriggerKind
): Promise<
  { ruleId: string; revisionId: string; definition: RuleDefinition }[]
> {
  const rows = (await tx.unsafe(
    `SELECT ${REVISION_COLUMNS}
       FROM awcms_crm_follow_up_rule_revisions r
       JOIN awcms_crm_follow_up_rules u
         ON u.tenant_id = r.tenant_id AND u.id = r.rule_id
        AND u.current_revision_number = r.revision_number
      WHERE r.tenant_id = $1 AND u.status = 'active' AND r.trigger_kind = $2
      ORDER BY u.code
      LIMIT ${MAX_RULES_LISTED}`,
    [tenantId, triggerKind]
  )) as FullRevisionRow[];

  return rows.map((row) => ({
    ruleId: row.rule_id,
    revisionId: row.id,
    definition: definitionFromRow(row)
  }));
}
