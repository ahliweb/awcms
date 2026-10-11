/**
 * Commission rule versions (Issue #950, ADR-0132, `docs/awcms/hr-payroll.md`
 * section 6.1).
 *
 * ## Lifecycle
 *
 * `draft` (editable) -> `published` (immutable, eligible to apply) -> `retired`
 * (immutable, no longer applies); a draft may also be retired (abandoned). The
 * database is the authority (`sql/182`: an immutability trigger and a
 * no-overlap trigger); this file pre-checks every refusal the triggers can
 * raise and maps it to an outcome, because a failed statement aborts a Postgres
 * transaction and the handler could no longer answer 409.
 *
 * ## Concurrency
 *
 * Create and publish take the SAME transaction-scoped advisory lock as the
 * overlap trigger (per tenant and rule), so two creates cannot draw the same
 * version number and two publishes of overlapping windows serialise: the second
 * sees the first's committed row and is refused with the conflicting version.
 *
 * Audit rows carry what happened and to which rule version (key and number),
 * never a rate, an amount or a name — the audit log is not the place for a
 * tenant's commercial terms.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { RoundingMode } from "../domain/hr-commission-decimal";
import { HR_COMMISSION_MODULE_KEY } from "../domain/hr-commission-permissions";
import type {
  CommissionCalculation,
  CommissionRuleStatus
} from "../domain/hr-commission-types";
import { isBackdatedWindow } from "../domain/hr-commission-accrual-state";
import { ruleContentDigest } from "../domain/hr-commission-digest";
import type {
  CreateRuleInput,
  UpdateRuleInput
} from "../domain/hr-commission-validation";

export const RULE_PAGE_SIZE = 100;

type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

export type CommissionRule = {
  id: string;
  ruleKey: string;
  versionNo: number;
  status: CommissionRuleStatus;
  name: string;
  sourceType: string;
  calculation: CommissionCalculation;
  rate: string | null;
  fixedAmount: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  currencyCode: string;
  roundingMode: RoundingMode;
  roundingScale: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Version token of the editable terms; name it when editing or publishing. */
  contentDigest: string;
  createdAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
  /** The window started before the UTC date it was published on (stamped by the database). */
  publishBackdated: boolean;
  /** The publisher's reason for a back-dated window; `null` otherwise. */
  backdatedReason: string | null;
};

type RuleRow = {
  id: string;
  rule_key: string;
  version_no: number;
  status: CommissionRuleStatus;
  name: string;
  source_type: string;
  calculation: CommissionCalculation;
  rate: string | null;
  fixed_amount: string | null;
  min_amount: string | null;
  max_amount: string | null;
  currency_code: string;
  rounding_mode: RoundingMode;
  rounding_scale: number;
  effective_from: string;
  effective_to: string | null;
  created_at: Date | string;
  published_at: Date | string | null;
  retired_at: Date | string | null;
  publish_backdated: boolean;
  backdated_reason: string | null;
};

const RULE_SELECT = `
  id, rule_key, version_no, status, name, source_type, calculation,
  rate::text AS rate, fixed_amount::text AS fixed_amount,
  min_amount::text AS min_amount, max_amount::text AS max_amount,
  currency_code::text AS currency_code, rounding_mode,
  rounding_scale::int AS rounding_scale,
  to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
  to_char(effective_to, 'YYYY-MM-DD') AS effective_to,
  created_at, published_at, retired_at, publish_backdated, backdated_reason`;

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** `"2.500000"` -> `"2.5"`, `"10.000000"` -> `"10"`: the stored scale is not part of the value. */
function trimDecimal(value: string | null): string | null {
  if (value === null || !value.includes(".")) {
    return value;
  }

  return value.replace(/0+$/, "").replace(/\.$/, "");
}

function mapRule(row: RuleRow): CommissionRule {
  const terms = {
    id: row.id,
    ruleKey: row.rule_key,
    versionNo: row.version_no,
    status: row.status,
    name: row.name,
    sourceType: row.source_type,
    calculation: row.calculation,
    rate: trimDecimal(row.rate),
    fixedAmount: trimDecimal(row.fixed_amount),
    minAmount: trimDecimal(row.min_amount),
    maxAmount: trimDecimal(row.max_amount),
    currencyCode: row.currency_code,
    roundingMode: row.rounding_mode,
    roundingScale: Number(row.rounding_scale),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to
  };

  return {
    ...terms,
    contentDigest: ruleContentDigest(terms),
    createdAt: iso(row.created_at),
    publishedAt: row.published_at ? iso(row.published_at) : null,
    retiredAt: row.retired_at ? iso(row.retired_at) : null,
    publishBackdated: row.publish_backdated,
    backdatedReason: row.backdated_reason
  };
}

/** The per-(tenant, rule) lock the overlap trigger also takes; re-taking it in one transaction is free. */
async function lockRule(
  tx: Bun.SQL,
  tenantId: string,
  ruleKey: string
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`hr_commission_rule:${tenantId}:${ruleKey}`}, 0)
    )
  `;
}

export function parseRuleCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export type RuleListFilters = {
  ruleKey?: string;
  status?: CommissionRuleStatus;
};

export async function listRules(
  tx: Bun.SQL,
  tenantId: string,
  filters: RuleListFilters,
  cursor?: KeysetCursor
): Promise<{ rules: CommissionRule[]; nextCursor: string | null }> {
  const ruleKey = filters.ruleKey ?? null;
  const status = filters.status ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(RULE_SELECT)},
           ${tx.unsafe(keysetCursorCreatedAtSql("r"))} AS created_at_cursor
    FROM awcms_hr_commission_rules r
    WHERE r.tenant_id = ${tenantId}
      AND (${ruleKey}::text IS NULL OR r.rule_key = ${ruleKey}::text)
      AND (${status}::text IS NULL OR r.status = ${status}::text)
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (r.created_at, r.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${RULE_PAGE_SIZE}
  `) as (RuleRow & { created_at_cursor: string })[];

  const last = rows[rows.length - 1];

  return {
    rules: rows.map(mapRule),
    nextCursor:
      rows.length === RULE_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export async function getRule(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<CommissionRule | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(RULE_SELECT)}
    FROM awcms_hr_commission_rules
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as RuleRow[];

  return rows[0] ? mapRule(rows[0]) : null;
}

type Locked = {
  id: string;
  rule_key: string;
  version_no: number;
  status: CommissionRuleStatus;
  created_by: string | null;
  updated_by: string | null;
};

async function lockRow(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<Locked | null> {
  const rows = (await tx`
    SELECT id, rule_key, version_no, status, created_by, updated_by
    FROM awcms_hr_commission_rules
    WHERE tenant_id = ${tenantId} AND id = ${id}
    FOR UPDATE
  `) as Locked[];

  return rows[0] ?? null;
}

// --- Writes --------------------------------------------------------------------

export async function createRule(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: CreateRuleInput
): Promise<{ outcome: "ok"; rule: CommissionRule }> {
  await lockRule(tx, tenantId, input.ruleKey);

  const next = (await tx`
    SELECT COALESCE(max(version_no), 0) + 1 AS version_no
    FROM awcms_hr_commission_rules
    WHERE tenant_id = ${tenantId} AND rule_key = ${input.ruleKey}
  `) as { version_no: number }[];

  const inserted = (await tx`
    INSERT INTO awcms_hr_commission_rules
      (tenant_id, rule_key, version_no, name, source_type, calculation, rate,
       fixed_amount, min_amount, max_amount, currency_code, rounding_mode,
       rounding_scale, effective_from, effective_to, created_by, updated_by)
    VALUES (${tenantId}, ${input.ruleKey}, ${Number(next[0]!.version_no)},
            ${input.name}, ${input.sourceType}, ${input.calculation},
            ${input.rate}::numeric, ${input.fixedAmount}::numeric,
            ${input.minAmount}::numeric, ${input.maxAmount}::numeric,
            ${input.currencyCode}, ${input.roundingMode},
            ${input.roundingScale}::smallint, ${input.effectiveFrom}::date,
            ${input.effectiveTo}::date, ${actor.actorTenantUserId},
            ${actor.actorTenantUserId})
    RETURNING id, version_no
  `) as { id: string; version_no: number }[];

  const row = inserted[0]!;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_COMMISSION_MODULE_KEY,
    action: "hr_commission.rule.created",
    resourceType: "hr_commission_rule",
    resourceId: row.id,
    severity: "info",
    message: "Commission rule draft created.",
    attributes: { ruleKey: input.ruleKey, versionNo: Number(row.version_no) },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", rule: (await getRule(tx, tenantId, row.id))! };
}

export type UpdateRuleOutcome =
  | { outcome: "ok"; rule: CommissionRule }
  | { outcome: "not_found" }
  | { outcome: "not_draft"; status: CommissionRuleStatus }
  | { outcome: "stale"; currentContentDigest: string };

export async function updateDraftRule(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  actor: Actor,
  input: UpdateRuleInput
): Promise<UpdateRuleOutcome> {
  const locked = await lockRow(tx, tenantId, id);

  if (!locked) {
    return { outcome: "not_found" };
  }

  if (locked.status !== "draft") {
    return { outcome: "not_draft", status: locked.status };
  }

  // Optimistic concurrency: the row is locked, so this read cannot move.
  const current = (await getRule(tx, tenantId, id))!;

  if (current.contentDigest !== input.expectedContentDigest) {
    return { outcome: "stale", currentContentDigest: current.contentDigest };
  }

  await tx`
    UPDATE awcms_hr_commission_rules
    SET name = ${input.name}, source_type = ${input.sourceType},
        calculation = ${input.calculation}, rate = ${input.rate}::numeric,
        fixed_amount = ${input.fixedAmount}::numeric,
        min_amount = ${input.minAmount}::numeric,
        max_amount = ${input.maxAmount}::numeric,
        currency_code = ${input.currencyCode},
        rounding_mode = ${input.roundingMode},
        rounding_scale = ${input.roundingScale}::smallint,
        effective_from = ${input.effectiveFrom}::date,
        effective_to = ${input.effectiveTo}::date,
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_COMMISSION_MODULE_KEY,
    action: "hr_commission.rule.updated",
    resourceType: "hr_commission_rule",
    resourceId: id,
    severity: "info",
    message: "Commission rule draft updated.",
    attributes: {
      ruleKey: locked.rule_key,
      versionNo: Number(locked.version_no)
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", rule: (await getRule(tx, tenantId, id))! };
}

export type PublishRuleOutcome =
  | { outcome: "ok"; rule: CommissionRule }
  | { outcome: "not_found" }
  | { outcome: "not_draft"; status: CommissionRuleStatus }
  | { outcome: "stale"; currentContentDigest: string }
  | { outcome: "self_publish" }
  | { outcome: "backdated_reason_required"; todayUtc: string }
  | { outcome: "window_overlap"; conflictingVersionNo: number };

/**
 * Publish, bound to what the publisher saw and to a second person: the stored
 * terms must still hash to `expectedContentDigest`, and nobody who created or
 * last edited the draft may publish it (maker / checker). The digest goes into
 * the audit row, so which terms were published is provable without a rate in
 * the log.
 */
export async function publishRule(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  actor: Actor,
  expectedContentDigest: string,
  backdatedReason: string | null = null
): Promise<PublishRuleOutcome> {
  const locked = await lockRow(tx, tenantId, id);

  if (!locked) {
    return { outcome: "not_found" };
  }

  if (locked.status !== "draft") {
    return { outcome: "not_draft", status: locked.status };
  }

  const current = (await getRule(tx, tenantId, id))!;

  if (current.contentDigest !== expectedContentDigest) {
    return { outcome: "stale", currentContentDigest: current.contentDigest };
  }

  if (
    actor.actorTenantUserId !== null &&
    (locked.created_by === actor.actorTenantUserId ||
      locked.updated_by === actor.actorTenantUserId)
  ) {
    return { outcome: "self_publish" };
  }

  // A window starting before today changes which rule applies to events that
  // already happened but are not accrued yet; it needs a stated reason. "Today"
  // is the UTC date of this transaction, the same instant `sql/187`'s trigger
  // uses, so the pre-check and the backstop cannot disagree.
  const todayRows = (await tx`
    SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today
  `) as { today: string }[];
  const todayUtc = todayRows[0]!.today;
  const backdated = isBackdatedWindow(current.effectiveFrom, todayUtc);

  if (backdated && backdatedReason === null) {
    return { outcome: "backdated_reason_required", todayUtc };
  }

  await lockRule(tx, tenantId, locked.rule_key);

  const conflict = (await tx`
    SELECT other.version_no
    FROM awcms_hr_commission_rules other
    JOIN awcms_hr_commission_rules mine
      ON mine.tenant_id = other.tenant_id AND mine.id = ${id}
    WHERE other.tenant_id = ${tenantId}
      AND other.rule_key = mine.rule_key
      AND other.status = 'published'
      AND other.id <> mine.id
      AND daterange(other.effective_from, other.effective_to, '[)')
          && daterange(mine.effective_from, mine.effective_to, '[)')
    ORDER BY other.version_no
    LIMIT 1
  `) as { version_no: number }[];

  if (conflict[0]) {
    return {
      outcome: "window_overlap",
      conflictingVersionNo: Number(conflict[0].version_no)
    };
  }

  await tx`
    UPDATE awcms_hr_commission_rules
    SET status = 'published', published_at = now(),
        published_by = ${actor.actorTenantUserId},
        backdated_reason = ${backdated ? backdatedReason : null},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;

  const rule = (await getRule(tx, tenantId, id))!;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_COMMISSION_MODULE_KEY,
    action: "hr_commission.rule.published",
    resourceType: "hr_commission_rule",
    resourceId: id,
    severity: "warning",
    message: "Commission rule version published.",
    attributes: {
      ruleKey: rule.ruleKey,
      versionNo: rule.versionNo,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      contentDigest: rule.contentDigest,
      backdated: rule.publishBackdated
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", rule };
}

export type RetireRuleOutcome =
  | { outcome: "ok"; rule: CommissionRule }
  | { outcome: "not_found" }
  | { outcome: "already_retired" };

export async function retireRule(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  actor: Actor
): Promise<RetireRuleOutcome> {
  const locked = await lockRow(tx, tenantId, id);

  if (!locked) {
    return { outcome: "not_found" };
  }

  if (locked.status === "retired") {
    return { outcome: "already_retired" };
  }

  await tx`
    UPDATE awcms_hr_commission_rules
    SET status = 'retired', retired_at = now(),
        retired_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_COMMISSION_MODULE_KEY,
    action: "hr_commission.rule.retired",
    resourceType: "hr_commission_rule",
    resourceId: id,
    severity: "warning",
    message: "Commission rule version retired.",
    attributes: {
      ruleKey: locked.rule_key,
      versionNo: Number(locked.version_no),
      fromStatus: locked.status
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", rule: (await getRule(tx, tenantId, id))! };
}
