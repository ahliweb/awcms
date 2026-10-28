/**
 * The write side the CONSUMER reaches, and the reads/setting the ADMIN reaches
 * (Issue #1189, ADR-0147): the per-tenant switch, `submitIntent` (the whole of
 * what `CommissionIntakePort` does), and the exceptions list.
 *
 * ## What `submitIntent` does and does not touch
 *
 * It runs as whichever role the caller's transaction has (`awcms_worker` for a
 * domain-event consumer). It READS exactly one thing, the tenant's switch (a
 * boolean, not payroll data), and it WRITES exactly one thing, the intake row.
 * It touches no rule, no employment, no accrual and nothing in the payroll
 * family: the worker holds no privilege on them and this file never asks. The
 * insert is a bare `INSERT ... ON CONFLICT DO NOTHING` with NO conflict target
 * and NO `RETURNING`: PostgreSQL then reads no arbiter and no returned column, so
 * INSERT alone is enough (a named arbiter or a RETURNING would need SELECT on a
 * table the worker must not read). Whether a row was written is the statement's
 * row count.
 *
 * ## Why a savepoint
 *
 * An employment id that does not exist in the tenant violates the composite
 * foreign key. Left alone that would abort the CONSUMER's transaction and the
 * event would be retried forever; in a savepoint it becomes `input_invalid` and
 * the caller's transaction stays usable. The same goes for the guard trigger's
 * refusal when the switch is turned off between the read and the insert.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type {
  CommissionAccrualRequest,
  CommissionVoidRequest
} from "../../_shared/ports/commission-accrual-port";
import type { CommissionIntakeOutcome } from "../../_shared/ports/commission-intake-port";
import {
  validateAccrualRequest,
  validateVoidRequest
} from "../domain/hr-commission-accrual-validation";
import {
  INTAKE_CORRELATION_PATTERN,
  intakeRequestDigest,
  maskIdentifier,
  maskUuid,
  type IntakeKind,
  type IntakeStatus
} from "../domain/hr-commission-intake";

/** The tenant's switch. No row means off (default-deny). */
export async function readIntakeEnabled(
  tx: Bun.SQL,
  tenantId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT commission_intake_enabled
    FROM awcms_hr_commission_intake_settings
    WHERE tenant_id = ${tenantId}
  `) as { commission_intake_enabled: boolean }[];

  return rows[0]?.commission_intake_enabled === true;
}

export type IntakeSetting = {
  commissionIntakeEnabled: boolean;
  /** The system actor the poster stamps on the ledger and the audit; null until set. */
  intakeActorTenantUserId: string | null;
  /** `unset`, `active`, or `actor_inactive` (the poster claims nothing until it is fixed). */
  intakeActorStatus: "unset" | "active" | "actor_inactive";
  updatedAt: string | null;
};

type SettingRow = {
  commission_intake_enabled: boolean;
  intake_actor_tenant_user_id: string | null;
  actor_active: boolean;
  updated_at: Date;
};

const SETTING_SELECT = `s.commission_intake_enabled, s.intake_actor_tenant_user_id,
  (u.id IS NOT NULL) AS actor_active, s.updated_at`;

function toSetting(row: SettingRow | undefined): IntakeSetting {
  const actor = row?.intake_actor_tenant_user_id ?? null;

  return {
    commissionIntakeEnabled: row?.commission_intake_enabled === true,
    intakeActorTenantUserId: actor,
    intakeActorStatus:
      actor === null
        ? "unset"
        : row?.actor_active
          ? "active"
          : "actor_inactive",
    updatedAt: row ? new Date(row.updated_at).toISOString() : null
  };
}

/** Reads the whole row: an APP-role read (the route). The worker has a column grant and never calls this. */
export async function getIntakeSetting(
  tx: Bun.SQL,
  tenantId: string
): Promise<IntakeSetting> {
  const rows = (await tx`
    SELECT ${tx.unsafe(SETTING_SELECT)}
    FROM awcms_hr_commission_intake_settings AS s
    LEFT JOIN awcms_tenant_users AS u
      ON u.tenant_id = s.tenant_id AND u.id = s.intake_actor_tenant_user_id
     AND u.status = 'active'
    WHERE s.tenant_id = ${tenantId}
  `) as SettingRow[];

  return toSetting(rows[0]);
}

export type SetIntakeSettingResult =
  | { outcome: "ok"; previous: IntakeSetting; setting: IntakeSetting }
  /** Switching ON needs an intake system actor (in the body or already stored). */
  | { outcome: "actor_required" }
  /** The named actor is not an active user of this tenant. */
  | { outcome: "actor_invalid" };

/**
 * Upserts the switch and the intake system actor. `intakeActor` `undefined` keeps
 * the stored one, `null` clears it. The caller authorizes and audits (the route
 * does both). The actor is validated as an ACTIVE user of this tenant: it is the
 * identity every posted accrual and audit row will carry, because the worker's
 * own claim about who acted is never trusted.
 */
export async function setIntakeEnabled(
  tx: Bun.SQL,
  tenantId: string,
  enabled: boolean,
  updatedBy: string,
  intakeActor?: string | null
): Promise<SetIntakeSettingResult> {
  const existing = toSetting(
    (
      (await tx`
        SELECT ${tx.unsafe(SETTING_SELECT)}
        FROM awcms_hr_commission_intake_settings AS s
        LEFT JOIN awcms_tenant_users AS u
          ON u.tenant_id = s.tenant_id AND u.id = s.intake_actor_tenant_user_id
         AND u.status = 'active'
        WHERE s.tenant_id = ${tenantId}
        FOR UPDATE OF s
      `) as SettingRow[]
    )[0]
  );
  const actor =
    intakeActor === undefined ? existing.intakeActorTenantUserId : intakeActor;

  if (enabled && actor === null) {
    return { outcome: "actor_required" };
  }

  if (actor !== null) {
    const found = (await tx`
      SELECT 1 AS present FROM awcms_tenant_users
      WHERE tenant_id = ${tenantId} AND id = ${actor}::uuid AND status = 'active'
    `) as unknown[];

    if (found.length === 0) {
      return { outcome: "actor_invalid" };
    }
  }

  const rows = (await tx`
    INSERT INTO awcms_hr_commission_intake_settings
      (tenant_id, commission_intake_enabled, intake_actor_tenant_user_id, updated_by)
    VALUES (${tenantId}, ${enabled}, ${actor}::uuid, ${updatedBy})
    ON CONFLICT (tenant_id) DO UPDATE SET
      commission_intake_enabled = EXCLUDED.commission_intake_enabled,
      intake_actor_tenant_user_id = EXCLUDED.intake_actor_tenant_user_id,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING commission_intake_enabled, intake_actor_tenant_user_id,
              (intake_actor_tenant_user_id IS NOT NULL) AS actor_active,
              updated_at
  `) as SettingRow[];

  // The actor was validated as active a moment ago, in this transaction.
  return { outcome: "ok", previous: existing, setting: toSetting(rows[0]) };
}

/** A correlation id is queued verbatim, so it keeps to the source-reference alphabet. */
function correlationAcceptable(value: string | undefined): boolean {
  return value === undefined || INTAKE_CORRELATION_PATTERN.test(value);
}

const CORRELATION_REFUSAL: CommissionIntakeOutcome = {
  outcome: "input_invalid",
  message:
    "correlationId must be 1-128 characters of A-Z a-z 0-9 _ . : - for the intake queue."
};

type InsertValues = {
  kind: IntakeKind;
  sourceType: string;
  sourceRef: string;
  sourceLine: string;
  employmentId: string;
  ruleKey: string | null;
  baseAmount: string | null;
  units: number | null;
  currencyCode: string | null;
  occurredAt: string | null;
  occurredOn: string | null;
  reason: string | null;
  actor: string | null;
  correlationId: string | null;
  digest: string;
};

async function insertIntent(
  tx: Bun.TransactionSQL,
  tenantId: string,
  values: InsertValues
): Promise<CommissionIntakeOutcome> {
  let written: number;

  try {
    written = await tx.savepoint(async (sp) => {
      const result = (await sp`
        INSERT INTO awcms_hr_commission_intents
          (tenant_id, kind, source_type, source_ref, source_line, employment_id,
           rule_key, base_amount, units, currency_code, occurred_at,
           occurred_on, reason, claimed_by_tenant_user_id, correlation_id,
           request_digest)
        VALUES (${tenantId}, ${values.kind}, ${values.sourceType},
                ${values.sourceRef}, ${values.sourceLine},
                ${values.employmentId}::uuid, ${values.ruleKey},
                ${values.baseAmount}::numeric, ${values.units}::integer,
                ${values.currencyCode}, ${values.occurredAt}::timestamptz,
                ${values.occurredOn}::date, ${values.reason},
                ${values.actor}::uuid, ${values.correlationId},
                ${values.digest})
        ON CONFLICT DO NOTHING
      `) as unknown as { count: number };

      return Number(result.count);
    });
  } catch (error) {
    const code = String((error as { errno?: unknown })?.errno ?? "");

    // 23503: the employment (or actor) is not in this tenant. 55000: the
    // guard trigger refused (the switch was turned off after the read).
    if (code === "23503") {
      return {
        outcome: "input_invalid",
        message: "employmentId or the actor does not exist in this tenant."
      };
    }

    // 23514: a CHECK refused the row. The driver's detail would echo the failing
    // row (a base amount, a reference), so say nothing about it.
    if (code === "23514") {
      return {
        outcome: "input_invalid",
        message: "The request was refused by a database constraint."
      };
    }

    if (code === "55000") {
      return { outcome: "disabled" };
    }

    throw error;
  }

  return { outcome: written > 0 ? "queued" : "duplicate" };
}

/**
 * `CommissionIntakePort.submitAccrual`. Validation first (the same validator the
 * ledger runs), then the switch, then the one insert.
 */
export async function submitAccrualIntent(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  rawRequest: CommissionAccrualRequest,
  now: Date = new Date()
): Promise<CommissionIntakeOutcome> {
  const validation = validateAccrualRequest(rawRequest, now);

  if (!validation.valid) {
    return {
      outcome: "input_invalid",
      message: validation.errors
        .map((error) => `${error.field}: ${error.message}`)
        .join("; ")
    };
  }

  const request = {
    ...validation.value,
    employmentId: validation.value.employmentId.toLowerCase()
  };

  if (!correlationAcceptable(request.correlationId)) {
    return CORRELATION_REFUSAL;
  }

  if (!(await readIntakeEnabled(tx, tenantId))) {
    return { outcome: "disabled" };
  }

  return insertIntent(tx as Bun.TransactionSQL, tenantId, {
    kind: "accrue",
    sourceType: request.source.type,
    sourceRef: request.source.ref,
    sourceLine: request.source.line ?? "",
    employmentId: request.employmentId,
    ruleKey: request.ruleKey,
    baseAmount: request.baseAmount ?? null,
    units: request.units ?? null,
    currencyCode: request.currencyCode,
    occurredAt: request.occurredAt.toISOString(),
    occurredOn: request.occurredOn,
    reason: null,
    actor: actorTenantUserId,
    correlationId: request.correlationId ?? null,
    digest: intakeRequestDigest("accrue", request)
  });
}

/** `CommissionIntakePort.submitVoid`. A void with no person is `actor_required`. */
export async function submitVoidIntent(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  rawRequest: CommissionVoidRequest
): Promise<CommissionIntakeOutcome> {
  const validation = validateVoidRequest(rawRequest);

  if (!validation.valid) {
    return {
      outcome: "input_invalid",
      message: validation.errors
        .map((error) => `${error.field}: ${error.message}`)
        .join("; ")
    };
  }

  if (actorTenantUserId === null) {
    return { outcome: "actor_required" };
  }

  const request = {
    ...validation.value,
    employmentId: validation.value.employmentId.toLowerCase()
  };

  if (!correlationAcceptable(request.correlationId)) {
    return CORRELATION_REFUSAL;
  }

  if (!(await readIntakeEnabled(tx, tenantId))) {
    return { outcome: "disabled" };
  }

  return insertIntent(tx as Bun.TransactionSQL, tenantId, {
    kind: "void",
    sourceType: request.source.type,
    sourceRef: request.source.ref,
    sourceLine: request.source.line ?? "",
    employmentId: request.employmentId,
    ruleKey: null,
    baseAmount: null,
    units: null,
    currencyCode: null,
    occurredAt: null,
    occurredOn: null,
    reason: request.reason,
    actor: actorTenantUserId,
    correlationId: request.correlationId ?? null,
    digest: intakeRequestDigest("void", request)
  });
}

// --- The admin read -------------------------------------------------------------

export const INTAKE_EXCEPTION_PAGE_SIZE = 50;

export type IntakeException = {
  id: string;
  kind: IntakeKind;
  status: "refused" | "failed";
  outcomeCode: string;
  sourceType: string;
  /** Masked: enough to recognise an order, not enough to use. */
  sourceRefMasked: string;
  employmentIdMasked: string;
  attempts: number;
  submittedAt: string;
  settledAt: string;
};

export type IntakeExceptionPage = {
  exceptions: IntakeException[];
  nextCursor: string | null;
  /** Counts only; no amount. */
  summary: IntakeSummary;
};

export type IntakeSummary = {
  commissionIntakeEnabled: boolean;
  counts: Record<IntakeStatus, number>;
  /** Seconds the oldest still-live row has waited (null when none). */
  oldestLiveAgeSeconds: number | null;
};

type ExceptionRow = {
  id: string;
  kind: IntakeKind;
  status: "refused" | "failed";
  outcome_code: string;
  source_type: string;
  source_ref: string;
  employment_id: string;
  attempts: number;
  created_at: Date;
  updated_at: Date;
  cursor_ts: string;
};

/** Opaque keyset cursor over `(updated_at, id)`; `null` when malformed (the route answers 400). */
export function parseExceptionCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function summarizeIntake(
  tx: Bun.SQL,
  tenantId: string
): Promise<IntakeSummary> {
  const counts: Record<IntakeStatus, number> = {
    pending: 0,
    posting: 0,
    posted: 0,
    refused: 0,
    failed: 0
  };
  const grouped = (await tx`
    SELECT status, count(*)::int AS count
    FROM awcms_hr_commission_intents
    WHERE tenant_id = ${tenantId}
    GROUP BY status
  `) as { status: IntakeStatus; count: number }[];

  for (const row of grouped) {
    counts[row.status] = Number(row.count);
  }

  const oldest = (await tx`
    SELECT extract(epoch FROM (now() - min(created_at)))::float8 AS age
    FROM awcms_hr_commission_intents
    WHERE tenant_id = ${tenantId} AND status IN ('pending', 'posting')
  `) as { age: number | null }[];
  const age = oldest[0]?.age;

  return {
    commissionIntakeEnabled: await readIntakeEnabled(tx, tenantId),
    counts,
    oldestLiveAgeSeconds:
      age === null || age === undefined ? null : Math.max(0, Math.floor(age))
  };
}

/**
 * The refused and failed requests of this tenant, newest settlement first, keyset
 * paginated. An outcome code and masked ids only: no amount, no rule, no actor.
 */
export async function listIntakeExceptions(
  tx: Bun.SQL,
  tenantId: string,
  cursor?: KeysetCursor
): Promise<IntakeExceptionPage> {
  const limit = INTAKE_EXCEPTION_PAGE_SIZE;
  const rows = (await tx`
    SELECT id, kind, status, outcome_code, source_type, source_ref,
           employment_id, attempts, created_at, updated_at,
           ${tx.unsafe(utcMicrosecondTextSql("updated_at"))} AS cursor_ts
    FROM awcms_hr_commission_intents
    WHERE tenant_id = ${tenantId}
      AND status IN ('refused', 'failed')
      AND (${cursor?.createdAt ?? null}::timestamptz IS NULL
           OR (updated_at, id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    ORDER BY updated_at DESC, id DESC
    LIMIT ${limit + 1}
  `) as ExceptionRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    exceptions: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      outcomeCode: row.outcome_code,
      sourceType: row.source_type,
      sourceRefMasked: maskIdentifier(row.source_ref),
      employmentIdMasked: maskUuid(row.employment_id),
      attempts: Number(row.attempts),
      submittedAt: new Date(row.created_at).toISOString(),
      settledAt: new Date(row.updated_at).toISOString()
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeKeysetCursor(last.cursor_ts, last.id)
        : null,
    summary: await summarizeIntake(tx, tenantId)
  };
}
