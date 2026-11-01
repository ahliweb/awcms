/**
 * The poster: drains the commission intake queue into the ledger (Issue #1189,
 * ADR-0147 section 3). Runs as `awcms_app` (the job `hr-commission:intents:post`),
 * NEVER as the worker: it is the one place that holds the payroll privileges.
 *
 * ## One posting core
 *
 * It calls the existing `accrueCommission` / `voidCommissionBySource` inside a
 * tenant transaction with the STORED actor, then writes the audit row of a NEW
 * accrual exactly as `POST /accruals` does (`auditAccrued`); a void rides the
 * ledger's own transition core, which audits and publishes
 * `awcms.hr.commission.voided`. So the audit row, the domain event, the
 * transition-log row, the SoD snapshot and the triggers are the synchronous
 * path's own: there is no second implementation of any of them.
 *
 * ## Three transactions, and why
 *
 *   1. CLAIM (short): lapsed poison is failed, then due rows are taken
 *      `FOR UPDATE SKIP LOCKED` and moved to `posting` with `attempts + 1` and
 *      a lease. Two posters (or a poster that crashed) never take the same row
 *      twice within a lease.
 *   2. POST (one per row): re-lock the row, ask the ledger, settle the row. The
 *      ledger write and the settlement commit together, so a crash can never
 *      leave an accrual posted with its intake row still `posting` forever and
 *      cannot post twice either: if the process dies after the ledger commit the
 *      row is simply settled by the same transaction, and if it dies before,
 *      nothing was written and the lapsed lease makes the row claimable again.
 *      The ledger's own unique key makes the retry a `replayed`, which is `posted`.
 *   3. RETRY / POISON (after a transient error): the failed transaction rolled
 *      back, so a fresh one returns the row to `pending` with a back-off, or, at
 *      the attempt cap, ends it `failed`.
 *
 * The lease token is `attempts`: every settlement states the `attempts` value it
 * claimed under, so a stale poster whose lease lapsed cannot overwrite the row
 * of the poster that took over.
 *
 * ## Business refusals are terminal, errors are retried
 *
 * A ledger outcome that is not a success (`no_effective_rule`, `source_conflict`,
 * `period_closed`, ...) is `refused`: it is a fact about the request, retrying it
 * changes nothing, and a human reads it in the exceptions list. An exception
 * (database trouble, a defect) is retried with a bounded back-off and ends
 * `failed`. Neither the log nor the audit row ever carries an amount, a base, a
 * rule or an error MESSAGE (a driver message can echo row values): only ids,
 * codes and the error's class and SQLSTATE.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import type {
  CommissionAccrualRequest,
  CommissionVoidRequest
} from "../../_shared/ports/commission-accrual-port";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  INTAKE_CLAIM_BATCH,
  INTAKE_LEASE_SECONDS,
  INTAKE_MAX_ATTEMPTS,
  INTAKE_RETENTION_DEFAULT_DAYS,
  INTAKE_STALE_PENDING_SECONDS,
  INTAKE_DEFER_DELAY_SECONDS,
  INTAKE_EXCEPTION_RETENTION_DAYS,
  attemptsExhausted,
  clampRetentionDays,
  decideVoidOrigin,
  retryDelaySeconds,
  sourceRefFingerprint,
  settleAccrueOutcome,
  settleVoidOutcome,
  type IntakeKind,
  type IntakeSettlement
} from "../domain/hr-commission-intake";
import { HR_COMMISSION_MODULE_KEY } from "../domain/hr-commission-permissions";
import {
  accrueCommission,
  auditAccrued,
  voidCommissionBySource
} from "./hr-commission-accrual-ledger";

const RESOURCE_TYPE = "hr_commission_intent";
const MAX_PASSES_PER_TENANT = 20;
export const INTAKE_PURGE_BATCH = 1000;

export type PostingCore = {
  accrue: typeof accrueCommission;
  voidBySource: typeof voidCommissionBySource;
};

const DEFAULT_CORE: PostingCore = {
  accrue: accrueCommission,
  voidBySource: voidCommissionBySource
};

export type PosterOptions = {
  claimBatch?: number;
  leaseSeconds?: number;
  /** Retention of `posted` rows; clamped to the declared floor and ceiling (7..90). */
  retentionDays?: number;
  /** Retention of `refused` and `failed` rows (default and ceiling 90); clamped the same way. */
  exceptionRetentionDays?: number;
  maxPasses?: number;
  /** When true, skip `purgeTerminalIntents` (used by multi-round fair job scheduling on pass > 0). */
  skipPurge?: boolean;
  correlationId?: string;
  /** Count what would happen; write nothing. */
  dryRun?: boolean;
  /**
   * TEST SEAM. The posting core the poster calls; production never sets it. It
   * exists so a test can make the ledger throw (a transient error, poison) or
   * crash after writing, which no real input can do on demand.
   */
  ledger?: PostingCore;
};

export type PosterTenantResult = {
  /** Why nothing was claimed: the module or the switch is off. */
  skipped: "module_disabled" | "intake_disabled" | "actor_inactive" | null;
  /** The system actor stamped on this run's postings (never the worker's claim). */
  intakeActor?: string | null;
  claimed: number;
  posted: number;
  refused: number;
  failed: number;
  retried: number;
  deferred: number;
  purged: number;
  /** Seconds the oldest live row has waited, after the run. */
  oldestLiveAgeSeconds: number | null;
};

export function emptyPosterResult(): PosterTenantResult {
  return {
    skipped: null,
    claimed: 0,
    posted: 0,
    refused: 0,
    failed: 0,
    retried: 0,
    deferred: 0,
    purged: 0,
    oldestLiveAgeSeconds: null
  };
}

type ClaimedRow = {
  id: string;
  kind: IntakeKind;
  source_type: string;
  source_ref: string;
  source_line: string;
  employment_id: string;
  rule_key: string | null;
  base_amount: string | null;
  units: number | null;
  currency_code: string | null;
  occurred_at: Date | string | null;
  occurred_on: string | null;
  reason: string | null;
  claimed_by_tenant_user_id: string | null;
  correlation_id: string | null;
  attempts: number;
  deferrals: number;
  created_at: Date | string;
  age_seconds: number;
  kind_turn?: number;
  kind_rank?: number;
};

const CLAIMED_COLUMNS = `i.id, i.kind, i.source_type, i.source_ref, i.source_line,
  i.employment_id, i.rule_key, i.base_amount::text AS base_amount, i.units,
  i.currency_code::text AS currency_code, i.occurred_at,
  to_char(i.occurred_on, 'YYYY-MM-DD') AS occurred_on, i.reason,
  i.claimed_by_tenant_user_id, i.correlation_id, i.attempts, i.deferrals, i.created_at,
  extract(epoch FROM (now() - i.created_at))::float8 AS age_seconds`;

/**
 * Is the module switched on for the tenant (no row means on), and the intake
 * switch? Also returns the tenant's intake system actor, the ONLY identity this
 * poster ever stamps: the worker's own claim about who acted is not trusted.
 * When skipped, also reports whether the tenant has any rows in the intake
 * table so idle tenants skip purge and live-age transactions (Issue #1211).
 */
async function gate(
  sql: Bun.SQL,
  tenantId: string
): Promise<{
  skipped: PosterTenantResult["skipped"];
  actor: string | null;
  hasRows: boolean;
}> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const checkHasRows = async (): Promise<boolean> => {
        const present = (await tx`
          SELECT 1 AS present
          FROM awcms_hr_commission_intents
          WHERE tenant_id = ${tenantId}
          LIMIT 1
        `) as unknown[];

        return present.length > 0;
      };

      const module = (await tx`
        SELECT enabled FROM awcms_tenant_modules
        WHERE tenant_id = ${tenantId} AND module_key = ${HR_COMMISSION_MODULE_KEY}
      `) as { enabled: boolean }[];

      if (module[0] && module[0].enabled === false) {
        return {
          skipped: "module_disabled" as const,
          actor: null,
          hasRows: await checkHasRows()
        };
      }

      const setting = (await tx`
        SELECT s.commission_intake_enabled, s.intake_actor_tenant_user_id,
               (u.id IS NOT NULL) AS actor_active
        FROM awcms_hr_commission_intake_settings AS s
        LEFT JOIN awcms_tenant_users AS u
          ON u.tenant_id = s.tenant_id AND u.id = s.intake_actor_tenant_user_id
         AND u.status = 'active'
        WHERE s.tenant_id = ${tenantId}
      `) as {
        commission_intake_enabled: boolean;
        intake_actor_tenant_user_id: string | null;
        actor_active: boolean;
      }[];
      const row = setting[0];

      if (row?.commission_intake_enabled !== true) {
        return {
          skipped: "intake_disabled" as const,
          actor: null,
          hasRows: await checkHasRows()
        };
      }

      // The actor is re-validated every tick: a deactivated system actor stops
      // the queue (nothing is claimed) instead of stamping an inactive identity.
      return row.intake_actor_tenant_user_id && row.actor_active
        ? {
            skipped: null,
            actor: row.intake_actor_tenant_user_id,
            hasRows: true
          }
        : {
            skipped: "actor_inactive" as const,
            actor: null,
            hasRows: await checkHasRows()
          };
    },
    { workClass: "maintenance" }
  );
}

/**
 * Settle poison first, then take the due rows in fair order across kinds and
 * employments (Issue #1211): within each kind (`accrue`, `void`), rows are
 * interleaved across `employment_id`, and `accrue` and `void` alternate turn by
 * turn (`accrue` first in each pair so an accrual posts before its reversal).
 * A flood of one kind or one employment cannot starve the others.
 */
async function claim(
  sql: Bun.SQL,
  tenantId: string,
  batch: number,
  leaseSeconds: number
): Promise<{ rows: ClaimedRow[]; poisoned: number }> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      // A row claimed to the cap whose lease lapsed means every attempt died
      // mid-flight: end it rather than claim it a cap + 1st time.
      const poison = (await tx`
        UPDATE awcms_hr_commission_intents
        SET status = 'failed', outcome_code = 'attempts_exhausted'
        WHERE tenant_id = ${tenantId} AND status = 'posting'
          AND next_attempt_at <= now() AND attempts >= ${INTAKE_MAX_ATTEMPTS}
        RETURNING id
      `) as { id: string }[];

      for (const row of poison) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: HR_COMMISSION_MODULE_KEY,
          action: "hr_commission.intake.failed",
          resourceType: RESOURCE_TYPE,
          resourceId: row.id,
          severity: "warning",
          message: "A commission intake request ended without being posted.",
          attributes: { outcomeCode: "attempts_exhausted" }
        });
      }

      const rows = (await tx`
        WITH by_employment AS (
          SELECT
            id,
            kind,
            created_at,
            row_number() OVER (
              PARTITION BY kind, employment_id
              ORDER BY created_at, id
            ) AS emp_seq
          FROM awcms_hr_commission_intents
          WHERE tenant_id = ${tenantId}
            AND status IN ('pending', 'posting')
            AND next_attempt_at <= now()
            AND attempts < ${INTAKE_MAX_ATTEMPTS}
        ),
        ranked AS (
          SELECT
            id,
            created_at,
            row_number() OVER (
              PARTITION BY kind
              ORDER BY emp_seq, created_at, id
            ) AS kind_turn,
            CASE WHEN kind = 'accrue' THEN 0 ELSE 1 END AS kind_rank
          FROM by_employment
        ),
        -- Pick the batch from the ranking alone, then lock ONLY those rows. The
        -- ranking is never joined back to the whole table: right after a flood
        -- the table statistics are stale, and a join planned on them rescans
        -- the ranking per row.
        picked AS MATERIALIZED (
          SELECT id, kind_turn, kind_rank
          FROM ranked
          ORDER BY kind_turn, kind_rank, created_at, id
          LIMIT ${batch}
        ),
        due AS (
          SELECT i.id, picked.kind_turn, picked.kind_rank
          FROM picked
          JOIN awcms_hr_commission_intents AS i ON i.id = picked.id
          WHERE i.tenant_id = ${tenantId}
            AND i.status IN ('pending', 'posting')
            AND i.next_attempt_at <= now()
            AND i.attempts < ${INTAKE_MAX_ATTEMPTS}
          FOR UPDATE OF i SKIP LOCKED
        )
        UPDATE awcms_hr_commission_intents AS i
        SET status = 'posting',
            attempts = i.attempts + 1,
            next_attempt_at = now() + make_interval(secs => ${leaseSeconds})
        FROM due
        WHERE i.id = due.id AND i.tenant_id = ${tenantId}
        RETURNING ${tx.unsafe(CLAIMED_COLUMNS)},
                  due.kind_turn::int AS kind_turn,
                  due.kind_rank::int AS kind_rank
      `) as ClaimedRow[];

      // Preserve the fair claim order (and accrue before void within each turn).
      rows.sort(
        (a, b) =>
          (a.kind_turn ?? 0) - (b.kind_turn ?? 0) ||
          (a.kind_rank ?? 0) - (b.kind_rank ?? 0) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
          a.id.localeCompare(b.id)
      );

      return { rows, poisoned: poison.length };
    },
    { workClass: "maintenance" }
  );
}

function toAccrueRequest(row: ClaimedRow): CommissionAccrualRequest {
  return {
    employmentId: row.employment_id,
    ruleKey: row.rule_key!,
    source: {
      type: row.source_type,
      ref: row.source_ref,
      ...(row.source_line === "" ? {} : { line: row.source_line })
    },
    ...(row.base_amount === null ? {} : { baseAmount: row.base_amount }),
    ...(row.units === null ? {} : { units: Number(row.units) }),
    currencyCode: row.currency_code!,
    occurredAt: new Date(row.occurred_at!),
    occurredOn: row.occurred_on!,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {})
  };
}

function toVoidRequest(row: ClaimedRow): CommissionVoidRequest {
  return {
    source: {
      type: row.source_type,
      ref: row.source_ref,
      ...(row.source_line === "" ? {} : { line: row.source_line })
    },
    employmentId: row.employment_id,
    reason: row.reason!,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {})
  };
}

type RowOutcome = "posted" | "refused" | "failed" | "retried" | "deferred";

/**
 * Runs `work` and returns its failure as a value. The work opens its OWN
 * transaction (and has rolled it back by the time it throws), so catching here is
 * outside any open transaction: nothing is swallowed from a live one.
 */
export async function settled<T>(
  work: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The class and SQLSTATE of an error, never its message (a driver message can echo row values). */
export function describeError(error: unknown): {
  errorName: string;
  sqlstate?: string;
} {
  const errno = (error as { errno?: unknown } | null)?.errno;

  return {
    errorName:
      error instanceof Error ? error.constructor.name || error.name : "unknown",
    ...(typeof errno === "string" || typeof errno === "number"
      ? { sqlstate: String(errno) }
      : {})
  };
}

/** One row, one transaction: ledger write and settlement commit together. */
async function post(
  sql: Bun.SQL,
  tenantId: string,
  row: ClaimedRow,
  correlationId: string | undefined,
  core: PostingCore,
  intakeActor: string
): Promise<RowOutcome> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx): Promise<RowOutcome> => {
      // Still ours? A poster whose lease lapsed while it worked finds the row
      // re-claimed (attempts moved) or settled, and does nothing.
      const held = (await tx`
        SELECT id FROM awcms_hr_commission_intents
        WHERE tenant_id = ${tenantId} AND id = ${row.id}
          AND status = 'posting'
          AND attempts = ${row.attempts}
          AND deferrals = ${row.deferrals}
        FOR UPDATE
      `) as { id: string }[];

      if (held.length === 0) {
        return "deferred";
      }

      // The identity on the ledger and the audit is the tenant's configured
      // intake system actor. What the worker CLAIMED is kept only as an
      // attribute (`claimedBy`) and is never used to authorize or stamp.
      const actor = intakeActor;
      const claimedBy = row.claimed_by_tenant_user_id;
      const fingerprint = sourceRefFingerprint(row.source_ref);
      const stamp = row.correlation_id ?? correlationId;
      let settlement: IntakeSettlement;

      if (row.kind === "accrue") {
        const request = toAccrueRequest(row);
        const outcome = await core.accrue(tx, tenantId, actor, request);

        if (outcome.outcome === "accrued") {
          await auditAccrued(
            tx,
            tenantId,
            { actorTenantUserId: actor, correlationId: stamp },
            outcome.accrual,
            request.source.type
          );
        }

        settlement = settleAccrueOutcome(outcome);
      } else {
        // A void is posted only for an accrual THIS intake created, so a
        // compromised worker cannot void a manually created accrual by naming
        // its source. Until that origin exists the void waits (the accrue may
        // not have been posted yet), then it is refused.
        const origin = (await tx`
          SELECT 1 AS present
          FROM awcms_hr_commission_intents
          WHERE tenant_id = ${tenantId} AND kind = 'accrue'
            AND status = 'posted' AND outcome_code = 'accrued'
            AND source_type = ${row.source_type}
            AND source_ref = ${row.source_ref}
            AND source_line = ${row.source_line}
            AND employment_id = ${row.employment_id}::uuid
          LIMIT 1
        `) as unknown[];
        // An accrue for the same sale still live in the queue (stuck, not yet
        // settled) keeps the void waiting past the grace window.
        const live =
          origin.length > 0
            ? []
            : ((await tx`
                SELECT 1 AS present
                FROM awcms_hr_commission_intents
                WHERE tenant_id = ${tenantId} AND kind = 'accrue'
                  AND status IN ('pending', 'posting')
                  AND source_type = ${row.source_type}
                  AND source_ref = ${row.source_ref}
                  AND source_line = ${row.source_line}
                  AND employment_id = ${row.employment_id}::uuid
                LIMIT 1
              `) as unknown[]);
        const decision = decideVoidOrigin(
          origin.length > 0,
          Number(row.age_seconds),
          live.length > 0
        );

        if (decision === "proceed") {
          settlement = settleVoidOutcome(
            await core.voidBySource(tx, tenantId, actor, toVoidRequest(row))
          );
        } else if (decision === "defer") {
          settlement = {
            disposition: "defer",
            outcomeCode: "awaiting_accrual"
          };
        } else {
          settlement = {
            disposition: "refused",
            outcomeCode: "no_intake_origin"
          };
        }
      }

      if (settlement.disposition === "defer") {
        // Waiting is not an error: give the claim back so it does not spend the
        // retry budget meant for failures, and increment the separate deferrals
        // counter (L7, Issue #1211).
        await tx`
          UPDATE awcms_hr_commission_intents
          SET status = 'pending',
              attempts = attempts - 1,
              deferrals = deferrals + 1,
              next_attempt_at = now() + make_interval(secs => ${INTAKE_DEFER_DELAY_SECONDS})
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
        `;

        return "deferred";
      }

      await tx`
        UPDATE awcms_hr_commission_intents
        SET status = ${settlement.disposition},
            outcome_code = ${settlement.outcomeCode}
        WHERE tenant_id = ${tenantId} AND id = ${row.id}
      `;

      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: actor,
        moduleKey: HR_COMMISSION_MODULE_KEY,
        action:
          settlement.disposition === "refused"
            ? "hr_commission.intake.refused"
            : "hr_commission.intake.posted",
        resourceType: RESOURCE_TYPE,
        resourceId: row.id,
        severity: settlement.disposition === "refused" ? "warning" : "info",
        message:
          settlement.disposition === "refused"
            ? "A commission intake request was refused by the ledger."
            : "A commission intake request was posted.",
        attributes: {
          kind: row.kind,
          outcomeCode: settlement.outcomeCode,
          sourceType: row.source_type,
          sourceRefFingerprint: fingerprint,
          employmentId: row.employment_id,
          claimedBy
        },
        correlationId: stamp
      });

      return settlement.disposition;
    },
    { workClass: "maintenance" }
  );
}

/** After a transient error: back to `pending` with a back-off, or `failed` at the cap. */
async function retryOrFail(
  sql: Bun.SQL,
  tenantId: string,
  row: ClaimedRow
): Promise<"retried" | "failed" | "deferred"> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      if (attemptsExhausted(row.attempts)) {
        const failed = (await tx`
          UPDATE awcms_hr_commission_intents
          SET status = 'failed', outcome_code = 'error'
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
            AND status = 'posting'
            AND attempts = ${row.attempts}
            AND deferrals = ${row.deferrals}
          RETURNING id
        `) as { id: string }[];

        if (failed.length === 0) {
          return "deferred" as const;
        }

        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: HR_COMMISSION_MODULE_KEY,
          action: "hr_commission.intake.failed",
          resourceType: RESOURCE_TYPE,
          resourceId: row.id,
          severity: "warning",
          message: "A commission intake request ended without being posted.",
          attributes: {
            kind: row.kind,
            outcomeCode: "error",
            sourceType: row.source_type,
            sourceRefFingerprint: sourceRefFingerprint(row.source_ref),
            claimedBy: row.claimed_by_tenant_user_id
          }
        });

        return "failed" as const;
      }

      const retried = (await tx`
        UPDATE awcms_hr_commission_intents
        SET status = 'pending',
            next_attempt_at = now() + make_interval(secs => ${retryDelaySeconds(row.attempts)})
        WHERE tenant_id = ${tenantId} AND id = ${row.id}
          AND status = 'posting'
          AND attempts = ${row.attempts}
          AND deferrals = ${row.deferrals}
        RETURNING id
      `) as { id: string }[];

      return retried.length > 0 ? ("retried" as const) : ("deferred" as const);
    },
    { workClass: "maintenance" }
  );
}

export type PurgeOptions = {
  /** `posted` rows that are NOT a void origin, older than this many days (clamped to 7..90). Default 30. */
  postedDays?: number;
  /** `refused`, `failed` and void-origin rows (a posted accrue that settled `accrued`) older than this many days (clamped to 7..90). Default 90. */
  exceptionDays?: number;
  now?: Date;
};

function purgeCutoffs(options: PurgeOptions) {
  const now = options.now ?? new Date();
  const day = 24 * 60 * 60 * 1000;

  return {
    posted: new Date(
      now.getTime() -
        clampRetentionDays(
          options.postedDays ?? INTAKE_RETENTION_DEFAULT_DAYS
        ) *
          day
    ),
    exception: new Date(
      now.getTime() -
        clampRetentionDays(
          options.exceptionDays ?? INTAKE_EXCEPTION_RETENTION_DAYS
        ) *
          day
    )
  };
}

/**
 * Retention, in bounded batches. `posted` rows go at the window; `refused` and
 * `failed` rows, which a human may still need to read, are kept longer (the
 * ceiling). Both windows are clamped to the declared floor and ceiling whatever
 * the caller passes. Pending and posting are work and never deleted.
 */
export async function purgeTerminalIntents(
  sql: Bun.SQL,
  tenantId: string,
  options: PurgeOptions = {}
): Promise<number> {
  const cutoff = purgeCutoffs(options);

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const deleted = (await tx`
        DELETE FROM awcms_hr_commission_intents
        WHERE tenant_id = ${tenantId}
          AND id IN (
            SELECT id FROM awcms_hr_commission_intents
            WHERE tenant_id = ${tenantId}
              AND (
                (status = 'posted'
                  AND NOT (kind = 'accrue' AND outcome_code = 'accrued')
                  AND updated_at < ${cutoff.posted.toISOString()}::timestamptz)
                OR (
                  (status IN ('refused', 'failed')
                    OR (status = 'posted' AND kind = 'accrue' AND outcome_code = 'accrued'))
                  AND updated_at < ${cutoff.exception.toISOString()}::timestamptz)
              )
            ORDER BY updated_at
            LIMIT ${INTAKE_PURGE_BATCH}
            FOR UPDATE SKIP LOCKED
          )
        RETURNING id
      `) as { id: string }[];

      return deleted.length;
    },
    { workClass: "maintenance" }
  );
}

async function previewTenant(
  sql: Bun.SQL,
  tenantId: string,
  options: PurgeOptions
): Promise<Pick<PosterTenantResult, "claimed" | "purged">> {
  const cutoff = purgeCutoffs(options);

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const due = (await tx`
        SELECT count(*)::int AS total FROM awcms_hr_commission_intents
        WHERE tenant_id = ${tenantId} AND status IN ('pending', 'posting')
          AND next_attempt_at <= now()
      `) as { total: number }[];
      const expired = (await tx`
        SELECT count(*)::int AS total FROM awcms_hr_commission_intents
        WHERE tenant_id = ${tenantId}
          AND (
            (status = 'posted'
              AND NOT (kind = 'accrue' AND outcome_code = 'accrued')
              AND updated_at < ${cutoff.posted.toISOString()}::timestamptz)
            OR (
              (status IN ('refused', 'failed')
                OR (status = 'posted' AND kind = 'accrue' AND outcome_code = 'accrued'))
              AND updated_at < ${cutoff.exception.toISOString()}::timestamptz)
          )
      `) as { total: number }[];

      return {
        claimed: Number(due[0]?.total ?? 0),
        purged: Number(expired[0]?.total ?? 0)
      };
    },
    { workClass: "maintenance" }
  );
}

async function liveAge(sql: Bun.SQL, tenantId: string): Promise<number | null> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT extract(epoch FROM (now() - min(created_at)))::float8 AS age
        FROM awcms_hr_commission_intents
        WHERE tenant_id = ${tenantId} AND status IN ('pending', 'posting')
      `) as { age: number | null }[];
      const age = rows[0]?.age;

      return age === null || age === undefined
        ? null
        : Math.max(0, Math.floor(age));
    },
    { workClass: "maintenance" }
  );
}

/**
 * One tenant, to quiescence (bounded by `maxPasses`): claim, post each row,
 * retry or fail on error, then purge. With the switch off (or the module
 * disabled) nothing is claimed; retention housekeeping still runs.
 */
export async function runIntakePosterForTenant(
  sql: Bun.SQL,
  tenantId: string,
  options: PosterOptions = {}
): Promise<PosterTenantResult> {
  const result = emptyPosterResult();
  const batch = options.claimBatch ?? INTAKE_CLAIM_BATCH;
  const lease = options.leaseSeconds ?? INTAKE_LEASE_SECONDS;
  const purgeOptions: PurgeOptions = {
    postedDays: options.retentionDays ?? INTAKE_RETENTION_DEFAULT_DAYS,
    exceptionDays: options.exceptionRetentionDays
  };
  const maxPasses = options.maxPasses ?? MAX_PASSES_PER_TENANT;

  const opened = await gate(sql, tenantId);

  result.skipped = opened.skipped;
  result.intakeActor = opened.actor;

  if (opened.skipped === "actor_inactive") {
    // Once per tick and tenant: intake is on but the system actor is not an
    // active user any more, so nothing is claimed until someone fixes it.
    log("warning", "hr_commission.intake.actor_inactive", { tenantId });
  }

  if (result.skipped !== null && !opened.hasRows) {
    return result;
  }

  if (options.dryRun) {
    const preview = await previewTenant(sql, tenantId, purgeOptions);

    result.claimed = result.skipped === null ? preview.claimed : 0;
    result.purged = preview.purged;
    result.oldestLiveAgeSeconds = await liveAge(sql, tenantId);

    return result;
  }

  if (result.skipped === null) {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const { rows, poisoned } = await claim(sql, tenantId, batch, lease);

      result.failed += poisoned;
      result.claimed += rows.length;

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const posted = await settled(() =>
          post(
            sql,
            tenantId,
            row,
            options.correlationId,
            options.ledger ?? DEFAULT_CORE,
            opened.actor!
          )
        );
        let outcome: RowOutcome;

        if (posted.ok) {
          outcome = posted.value;
        } else {
          log("warning", "hr_commission.intake.post_error", {
            tenantId,
            intentId: row.id,
            kind: row.kind,
            attempts: row.attempts,
            ...describeError(posted.error)
          });

          const recovered = await settled(() =>
            retryOrFail(sql, tenantId, row)
          );

          if (recovered.ok) {
            outcome = recovered.value;
          } else {
            // The row stays `posting`; its lease lapses and it is claimed again.
            log("error", "hr_commission.intake.settle_error", {
              tenantId,
              intentId: row.id,
              ...describeError(recovered.error)
            });
            outcome = "deferred";
          }
        }

        result[outcome] += 1;
      }
    }
  }

  if (!options.skipPurge) {
    result.purged = await purgeTerminalIntents(sql, tenantId, purgeOptions);
  }
  result.oldestLiveAgeSeconds = await liveAge(sql, tenantId);

  if (
    result.oldestLiveAgeSeconds !== null &&
    result.oldestLiveAgeSeconds > INTAKE_STALE_PENDING_SECONDS &&
    result.skipped === null
  ) {
    log("warning", "hr_commission.intake.stalled", {
      tenantId,
      oldestLiveAgeSeconds: result.oldestLiveAgeSeconds
    });
  }

  return result;
}
