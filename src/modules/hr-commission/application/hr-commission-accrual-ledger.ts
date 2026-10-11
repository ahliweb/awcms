/**
 * The commission accrual ledger (Issue #951, ADR-0132, `docs/awcms/hr-payroll.md`
 * sections 6.2 and 6.3).
 *
 * ## Exactly once
 *
 * The unique key `(tenant, source type, ref, line, employment, operation)` is the
 * authority (`sql/188`). `accrueCommission` reads it first so a redelivery is
 * answered without touching the rule, and inserts with `ON CONFLICT DO NOTHING`
 * so two RACING deliveries cannot both insert: the loser waits for the winner's
 * commit, inserts nothing, and re-reads the row. A replay with the same canonical
 * request (`accrualRequestDigest`) returns the original whatever has happened to
 * the accrual or the rule since; a different request for the same identity is a
 * conflict, never a silent success.
 *
 * ## Which rule, and why under lock
 *
 * The PUBLISHED version of the rule key whose window contains the event's own
 * date (`selectEffectiveRule`), never `now()`. The published versions of the key
 * and the employment are read `FOR SHARE`: a concurrent retire, terminate or
 * soft delete queues behind this transaction rather than slipping between the
 * check and the insert, and the insert trigger re-checks under the same locks
 * (the database is the authority; this file pre-checks so a refusal is an
 * outcome and not an aborted transaction).
 *
 * ## Transitions
 *
 * `transitionAccrual` locks the row `FOR UPDATE` and applies one edge. Two
 * racing transitions serialise on the row; the second sees the first's status and
 * is refused (`invalid_state`). The transition log row is written by the
 * database, not here (`sql/188`), so status and log cannot diverge.
 *
 * ## Audit and masking
 *
 * Audit rows carry what happened, to which accrual and which rule version —
 * NEVER an amount, a base, a rate, a source reference or a payment reference.
 * Earnings are financial data about a person; the ledger row is the record of the
 * amount and the correlation id joins it to the audit row.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type {
  CommissionAccrualOutcome,
  CommissionAccrualRecord,
  CommissionAccrualRequest
} from "../../_shared/ports/commission-accrual-port";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  ACCRUAL_ACTION_TARGET,
  employmentEarnsOn,
  sodViolation,
  transitionTarget,
  type AccrualAction,
  type AccrualStatus,
  type SodRefusal
} from "../domain/hr-commission-accrual-state";
import {
  accrualRequestDigest,
  validateAccrualRequest
} from "../domain/hr-commission-accrual-validation";
import { type RoundingMode } from "../domain/hr-commission-decimal";
import {
  CommissionEvaluationError,
  evaluateCommission,
  selectEffectiveRule
} from "../domain/hr-commission-evaluation";
import { HR_COMMISSION_MODULE_KEY } from "../domain/hr-commission-permissions";
import type { CommissionCalculation } from "../domain/hr-commission-types";

export const ACCRUAL_PAGE_SIZE = 100;

type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

export type CommissionAccrual = CommissionAccrualRecord & {
  ruleId: string;
  sourceType: string;
  sourceRef: string;
  sourceLine: string;
  operation: "accrue";
  calculation: CommissionCalculation;
  baseAmount: string | null;
  units: number | null;
  rate: string | null;
  fixedAmount: string | null;
  occurredAt: string;
  occurredOn: string;
  createdAt: string;
  approvedAt: string | null;
  releasedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  voidedAt: string | null;
  voidReasonCode: string | null;
};

export type CommissionTransition = {
  seq: number;
  fromStatus: AccrualStatus | null;
  toStatus: AccrualStatus;
  actorTenantUserId: string | null;
  reasonCode: string | null;
  occurredAt: string;
};

type AccrualRow = {
  id: string;
  employment_id: string;
  rule_id: string;
  rule_key: string;
  rule_version: number;
  source_type: string;
  source_ref: string;
  source_line: string;
  operation: "accrue";
  calculation: CommissionCalculation;
  base_amount: string | null;
  units: number | null;
  rate: string | null;
  fixed_amount: string | null;
  amount: string;
  currency_code: string;
  occurred_at: Date | string;
  occurred_on: string;
  request_digest: string;
  status: AccrualStatus;
  created_at: Date | string;
  approved_at: Date | string | null;
  released_at: Date | string | null;
  paid_at: Date | string | null;
  payment_reference: string | null;
  voided_at: Date | string | null;
  void_reason_code: string | null;
};

const ACCRUAL_SELECT = `
  id, employment_id, rule_id, rule_key, rule_version::int AS rule_version,
  source_type, source_ref, source_line, operation, calculation,
  base_amount::text AS base_amount, units::int AS units, rate::text AS rate,
  fixed_amount::text AS fixed_amount, amount::text AS amount,
  currency_code::text AS currency_code, occurred_at,
  to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, request_digest, status,
  created_at, approved_at, released_at, paid_at, payment_reference, voided_at,
  void_reason_code`;

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value);

function trimDecimal(value: string | null): string | null {
  if (value === null || !value.includes(".")) {
    return value;
  }

  return value.replace(/0+$/, "").replace(/\.$/, "");
}

function mapAccrual(row: AccrualRow): CommissionAccrual {
  return {
    id: row.id,
    employmentId: row.employment_id,
    ruleId: row.rule_id,
    ruleKey: row.rule_key,
    ruleVersion: Number(row.rule_version),
    status: row.status,
    amount: row.amount,
    currencyCode: row.currency_code,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceLine: row.source_line,
    operation: row.operation,
    calculation: row.calculation,
    baseAmount: trimDecimal(row.base_amount),
    units: row.units === null ? null : Number(row.units),
    rate: trimDecimal(row.rate),
    fixedAmount: trimDecimal(row.fixed_amount),
    occurredAt: iso(row.occurred_at),
    occurredOn: row.occurred_on,
    createdAt: iso(row.created_at),
    approvedAt: isoOrNull(row.approved_at),
    releasedAt: isoOrNull(row.released_at),
    paidAt: isoOrNull(row.paid_at),
    paymentReference: row.payment_reference,
    voidedAt: isoOrNull(row.voided_at),
    voidReasonCode: row.void_reason_code
  };
}

function toRecord(accrual: CommissionAccrual): CommissionAccrualRecord {
  return {
    id: accrual.id,
    employmentId: accrual.employmentId,
    ruleKey: accrual.ruleKey,
    ruleVersion: accrual.ruleVersion,
    status: accrual.status,
    amount: accrual.amount,
    currencyCode: accrual.currencyCode
  };
}

// --- Reads --------------------------------------------------------------------

export function parseAccrualCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export type AccrualListFilters = {
  employmentId?: string;
  status?: AccrualStatus;
  sourceType?: string;
};

export async function listAccruals(
  tx: Bun.SQL,
  tenantId: string,
  filters: AccrualListFilters,
  cursor?: KeysetCursor
): Promise<{ accruals: CommissionAccrual[]; nextCursor: string | null }> {
  const employmentId = filters.employmentId ?? null;
  const status = filters.status ?? null;
  const sourceType = filters.sourceType ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(ACCRUAL_SELECT)},
           ${tx.unsafe(keysetCursorCreatedAtSql("a"))} AS created_at_cursor
    FROM awcms_hr_commission_accruals a
    WHERE a.tenant_id = ${tenantId}
      AND (${employmentId}::uuid IS NULL OR a.employment_id = ${employmentId}::uuid)
      AND (${status}::text IS NULL OR a.status = ${status}::text)
      AND (${sourceType}::text IS NULL OR a.source_type = ${sourceType}::text)
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (a.created_at, a.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${ACCRUAL_PAGE_SIZE}
  `) as (AccrualRow & { created_at_cursor: string })[];

  const last = rows[rows.length - 1];

  return {
    accruals: rows.map(mapAccrual),
    nextCursor:
      rows.length === ACCRUAL_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export async function getAccrual(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<{
  accrual: CommissionAccrual;
  transitions: CommissionTransition[];
} | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(ACCRUAL_SELECT)}
    FROM awcms_hr_commission_accruals
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as AccrualRow[];

  if (!rows[0]) {
    return null;
  }

  const transitions = (await tx`
    SELECT seq::int AS seq, from_status, to_status, actor_tenant_user_id,
           reason_code, occurred_at
    FROM awcms_hr_commission_transitions
    WHERE tenant_id = ${tenantId} AND accrual_id = ${id}
    ORDER BY seq
  `) as {
    seq: number;
    from_status: AccrualStatus | null;
    to_status: AccrualStatus;
    actor_tenant_user_id: string | null;
    reason_code: string | null;
    occurred_at: Date | string;
  }[];

  return {
    accrual: mapAccrual(rows[0]),
    transitions: transitions.map((row) => ({
      seq: Number(row.seq),
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorTenantUserId: row.actor_tenant_user_id,
      reasonCode: row.reason_code,
      occurredAt: iso(row.occurred_at)
    }))
  };
}

// --- Accrue -------------------------------------------------------------------

type PublishedRuleRow = {
  id: string;
  rule_key: string;
  version_no: number;
  status: string;
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
};

async function findBySource(
  tx: Bun.SQL,
  tenantId: string,
  request: CommissionAccrualRequest
): Promise<AccrualRow | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(ACCRUAL_SELECT)}
    FROM awcms_hr_commission_accruals
    WHERE tenant_id = ${tenantId}
      AND source_type = ${request.source.type}
      AND source_ref = ${request.source.ref}
      AND source_line = ${request.source.line ?? ""}
      AND employment_id = ${request.employmentId}::uuid
      AND operation = 'accrue'
  `) as AccrualRow[];

  return rows[0] ?? null;
}

function answerExisting(
  row: AccrualRow,
  digest: string
): CommissionAccrualOutcome {
  return row.request_digest === digest
    ? { outcome: "replayed", accrual: toRecord(mapAccrual(row)) }
    : { outcome: "source_conflict", accrualId: row.id };
}

/**
 * Accrue a commission for one sale fact. See the file header and
 * `_shared/ports/commission-accrual-port.ts` for the contract. Writes the ledger
 * row only: authorization and the audit row are the caller's.
 */
export async function accrueCommission(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  rawRequest: CommissionAccrualRequest,
  now: Date = new Date()
): Promise<CommissionAccrualOutcome> {
  const validation = validateAccrualRequest(rawRequest, now);

  if (!validation.valid) {
    return {
      outcome: "input_invalid",
      message: validation.errors
        .map((error) => `${error.field}: ${error.message}`)
        .join("; ")
    };
  }

  const request: CommissionAccrualRequest = {
    ...validation.value,
    employmentId: validation.value.employmentId.toLowerCase()
  };
  const digest = accrualRequestDigest(request);

  // A redelivery is answered from the ledger, before anything else is looked at.
  const existing = await findBySource(tx, tenantId, request);

  if (existing) {
    return answerExisting(existing, digest);
  }

  const employments = (await tx`
    SELECT to_char(hired_on, 'YYYY-MM-DD') AS hired_on,
           to_char(terminated_on, 'YYYY-MM-DD') AS terminated_on,
           deleted_at IS NOT NULL AS deleted
    FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${request.employmentId}::uuid
    FOR SHARE
  `) as { hired_on: string; terminated_on: string | null; deleted: boolean }[];

  const employment = employments[0];

  if (!employment) {
    return { outcome: "employment_not_found" };
  }

  if (
    !employmentEarnsOn(
      {
        hiredOn: employment.hired_on,
        terminatedOn: employment.terminated_on,
        deleted: employment.deleted
      },
      request.occurredOn
    )
  ) {
    return { outcome: "employment_not_eligible" };
  }

  const published = (await tx`
    SELECT id, rule_key, version_no::int AS version_no, status, source_type,
           calculation, rate::text AS rate, fixed_amount::text AS fixed_amount,
           min_amount::text AS min_amount, max_amount::text AS max_amount,
           currency_code::text AS currency_code, rounding_mode,
           rounding_scale::int AS rounding_scale,
           to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           to_char(effective_to, 'YYYY-MM-DD') AS effective_to
    FROM awcms_hr_commission_rules
    WHERE tenant_id = ${tenantId} AND rule_key = ${request.ruleKey}
      AND status = 'published'
    FOR SHARE
  `) as PublishedRuleRow[];

  const selection = selectEffectiveRule(
    published.map((row) => ({
      ...row,
      ruleKey: row.rule_key,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to
    })),
    request.ruleKey,
    request.occurredOn
  );

  if (selection.outcome === "none") {
    return { outcome: "no_effective_rule" };
  }

  if (selection.outcome === "ambiguous") {
    return { outcome: "rule_ambiguous" };
  }

  const rule = selection.rule;

  if (rule.source_type !== request.source.type) {
    return {
      outcome: "source_type_mismatch",
      expectedSourceType: rule.source_type
    };
  }

  if (rule.currency_code !== request.currencyCode) {
    return {
      outcome: "currency_mismatch",
      expectedCurrencyCode: rule.currency_code
    };
  }

  let amount: string;

  try {
    amount = evaluateCommission(
      {
        calculation: rule.calculation,
        rate: trimDecimal(rule.rate),
        fixedAmount: trimDecimal(rule.fixed_amount),
        minAmount: trimDecimal(rule.min_amount),
        maxAmount: trimDecimal(rule.max_amount),
        currencyCode: rule.currency_code,
        roundingMode: rule.rounding_mode,
        roundingScale: Number(rule.rounding_scale)
      },
      { baseAmount: request.baseAmount, units: request.units }
    ).amount;
  } catch (error) {
    if (
      error instanceof CommissionEvaluationError &&
      error.code === "INPUT_INVALID"
    ) {
      return { outcome: "input_invalid", message: error.message };
    }

    throw error;
  }

  const inserted = (await tx`
    INSERT INTO awcms_hr_commission_accruals
      (tenant_id, employment_id, rule_id, rule_key, rule_version, source_type,
       source_ref, source_line, operation, calculation, base_amount, units,
       rate, fixed_amount, amount, currency_code, occurred_at, occurred_on,
       request_digest, correlation_id, created_by)
    VALUES (${tenantId}, ${request.employmentId}::uuid, ${rule.id},
            ${rule.rule_key}, ${Number(rule.version_no)}, ${request.source.type},
            ${request.source.ref}, ${request.source.line ?? ""}, 'accrue',
            ${rule.calculation}, ${request.baseAmount ?? null}::numeric,
            ${request.units ?? null}::integer, ${rule.rate}::numeric,
            ${rule.fixed_amount}::numeric, ${amount}::numeric,
            ${rule.currency_code}, ${request.occurredAt.toISOString()}::timestamptz,
            ${request.occurredOn}::date, ${digest},
            ${request.correlationId ?? null}, ${actorTenantUserId})
    ON CONFLICT ON CONSTRAINT awcms_hr_commission_accruals_source_key DO NOTHING
    RETURNING ${tx.unsafe(ACCRUAL_SELECT)}
  `) as AccrualRow[];

  if (inserted[0]) {
    return { outcome: "accrued", accrual: toRecord(mapAccrual(inserted[0])) };
  }

  // A racing delivery won the unique key; it has committed (ON CONFLICT waited
  // for it), so re-read and answer as a replay.
  const winner = await findBySource(tx, tenantId, request);

  if (!winner) {
    throw new Error(
      "commission accrual conflict without a visible winner (should be impossible)"
    );
  }

  return answerExisting(winner, digest);
}

/** The audit row of a NEW accrual (a replay audits nothing). No amount, base, rate or source reference. */
export async function auditAccrued(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  accrual: CommissionAccrualRecord,
  sourceType: string
): Promise<void> {
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_COMMISSION_MODULE_KEY,
    action: "hr_commission.accrual.accrued",
    resourceType: "hr_commission_accrual",
    resourceId: accrual.id,
    severity: "info",
    message: "Commission accrued.",
    attributes: {
      employmentId: accrual.employmentId,
      ruleKey: accrual.ruleKey,
      ruleVersion: accrual.ruleVersion,
      sourceType,
      operation: "accrue"
    },
    correlationId: actor.correlationId
  });
}

// --- Transitions --------------------------------------------------------------

export type TransitionExtras = {
  reasonCode?: string | null;
  paymentReference?: string | null;
};

export type TransitionOutcome =
  | { outcome: "ok"; accrual: CommissionAccrual }
  | { outcome: "not_found" }
  | { outcome: "invalid_state"; status: AccrualStatus }
  | { outcome: "sod_violation"; kind: SodRefusal }
  | { outcome: "actor_required" };

/**
 * Applies one edge of the accrual machine under `FOR UPDATE`. `actor` must be a
 * person: every edge stamps who did it (a system actor is refused here as it is
 * by the lifecycle CHECK).
 */
export async function transitionAccrual(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  action: AccrualAction,
  actor: Actor,
  extras: TransitionExtras = {}
): Promise<TransitionOutcome> {
  if (actor.actorTenantUserId === null) {
    return { outcome: "actor_required" };
  }

  const locked = (await tx`
    SELECT status, employment_id, rule_key, rule_version::int AS rule_version,
           created_by, approved_by
    FROM awcms_hr_commission_accruals
    WHERE tenant_id = ${tenantId} AND id = ${id}
    FOR UPDATE
  `) as {
    status: AccrualStatus;
    employment_id: string;
    created_by: string | null;
    approved_by: string | null;
    rule_key: string;
    rule_version: number;
  }[];

  const row = locked[0];

  if (!row) {
    return { outcome: "not_found" };
  }

  const target = transitionTarget(row.status, action);

  if (target === null) {
    return { outcome: "invalid_state", status: row.status };
  }

  const userId = actor.actorTenantUserId;

  if (action !== "void") {
    // The beneficiary's own login. FOR SHARE: the link cannot be re-pointed
    // between this check and the UPDATE (the trigger re-checks regardless).
    const beneficiary = (await tx`
      SELECT tenant_user_id
      FROM awcms_hr_employments
      WHERE tenant_id = ${tenantId} AND id = ${row.employment_id}
      FOR SHARE
    `) as { tenant_user_id: string | null }[];
    const kind = sodViolation(action, userId, {
      beneficiaryUserId: beneficiary[0]?.tenant_user_id ?? null,
      createdBy: row.created_by,
      approvedBy: row.approved_by
    });

    if (kind !== null) {
      return { outcome: "sod_violation", kind };
    }
  }

  switch (action) {
    case "approve":
      await tx`
        UPDATE awcms_hr_commission_accruals
        SET status = 'approved', approved_at = now(), approved_by = ${userId}
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `;
      break;
    case "release":
      await tx`
        UPDATE awcms_hr_commission_accruals
        SET status = 'payable', released_at = now(), released_by = ${userId}
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `;
      break;
    case "void":
      await tx`
        UPDATE awcms_hr_commission_accruals
        SET status = 'voided', voided_at = now(), voided_by = ${userId},
            void_reason_code = ${extras.reasonCode ?? null}
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `;
      break;
    case "pay":
      await tx`
        UPDATE awcms_hr_commission_accruals
        SET status = 'paid', paid_at = now(), paid_by = ${userId},
            payment_reference = ${extras.paymentReference ?? null}
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `;
      break;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: userId,
    moduleKey: HR_COMMISSION_MODULE_KEY,
    action: `hr_commission.accrual.${action === "void" ? "voided" : action === "approve" ? "approved" : action === "release" ? "released" : "paid"}`,
    resourceType: "hr_commission_accrual",
    resourceId: id,
    severity: "warning",
    message: `Commission accrual ${ACCRUAL_ACTION_TARGET[action]}.`,
    attributes: {
      employmentId: row.employment_id,
      ruleKey: row.rule_key,
      ruleVersion: Number(row.rule_version),
      fromStatus: row.status,
      toStatus: target
    },
    correlationId: actor.correlationId
  });

  const fetched = await getAccrual(tx, tenantId, id);

  return { outcome: "ok", accrual: fetched!.accrual };
}

// --- Reconciliation -----------------------------------------------------------

export type LedgerBalance = {
  currencyCode: string;
  status: AccrualStatus;
  count: number;
  total: string;
};

export type LedgerReconciliation = {
  /** Accruals whose status is not their latest transition's target (or that have none). */
  statusMismatches: string[];
  /** Accruals whose transition chain has a gap, a reorder or a missing birth. */
  brokenChains: string[];
  /** Totals by currency and status, read from the accruals' own status. */
  balances: LedgerBalance[];
  /** The same totals, derived from each accrual's LATEST TRANSITION. */
  balancesFromTransitions: LedgerBalance[];
  /** True exactly when there is no mismatch, no broken chain and the two balance sets are equal. */
  reconciled: boolean;
};

/**
 * Proves the ledger's balances against its transition log (an operator or job
 * query, not a request path: it scans the tenant's whole ledger). Reads only;
 * the database makes the answer "reconciled" by construction, so anything else
 * means rows were changed outside the application's role.
 */
export async function reconcileAccruals(
  tx: Bun.SQL,
  tenantId: string
): Promise<LedgerReconciliation> {
  const mismatches = (await tx`
    WITH latest AS (
      SELECT DISTINCT ON (accrual_id) accrual_id, to_status
      FROM awcms_hr_commission_transitions
      WHERE tenant_id = ${tenantId}
      ORDER BY accrual_id, seq DESC
    )
    SELECT a.id
    FROM awcms_hr_commission_accruals a
    LEFT JOIN latest l ON l.accrual_id = a.id
    WHERE a.tenant_id = ${tenantId} AND a.status IS DISTINCT FROM l.to_status
    ORDER BY a.id
  `) as { id: string }[];

  const broken = (await tx`
    SELECT DISTINCT accrual_id AS id
    FROM (
      SELECT accrual_id, from_status,
             lag(to_status) OVER (PARTITION BY accrual_id ORDER BY seq) AS previous
      FROM awcms_hr_commission_transitions
      WHERE tenant_id = ${tenantId}
    ) t
    WHERE from_status IS DISTINCT FROM previous
    ORDER BY id
  `) as { id: string }[];

  type BalanceRow = {
    currency_code: string;
    status: AccrualStatus;
    count: number;
    total: string;
  };
  const mapBalance = (row: BalanceRow): LedgerBalance => ({
    currencyCode: row.currency_code,
    status: row.status,
    count: Number(row.count),
    total: row.total
  });

  const direct = (await tx`
    SELECT currency_code::text AS currency_code, status, count(*)::int AS count,
           sum(amount)::text AS total
    FROM awcms_hr_commission_accruals
    WHERE tenant_id = ${tenantId}
    GROUP BY currency_code, status
    ORDER BY currency_code, status
  `) as BalanceRow[];

  const derived = (await tx`
    WITH latest AS (
      SELECT DISTINCT ON (accrual_id) accrual_id, to_status
      FROM awcms_hr_commission_transitions
      WHERE tenant_id = ${tenantId}
      ORDER BY accrual_id, seq DESC
    )
    SELECT a.currency_code::text AS currency_code, l.to_status AS status,
           count(*)::int AS count, sum(a.amount)::text AS total
    FROM awcms_hr_commission_accruals a
    JOIN latest l ON l.accrual_id = a.id
    WHERE a.tenant_id = ${tenantId}
    GROUP BY a.currency_code, l.to_status
    ORDER BY a.currency_code, l.to_status
  `) as BalanceRow[];

  const balances = direct.map(mapBalance);
  const balancesFromTransitions = derived.map(mapBalance);

  return {
    statusMismatches: mismatches.map((row) => row.id),
    brokenChains: broken.map((row) => row.id),
    balances,
    balancesFromTransitions,
    reconciled:
      mismatches.length === 0 &&
      broken.length === 0 &&
      JSON.stringify(balances) === JSON.stringify(balancesFromTransitions)
  };
}
