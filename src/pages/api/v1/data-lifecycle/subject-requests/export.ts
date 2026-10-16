import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { recordSensitiveRead } from "../../../../../modules/logging/application/sensitive-read-audit";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import type { AccessRequest } from "../../../../../modules/identity-access/domain/access-control";
import {
  isPayrollBoundaryTable,
  stripPayrollRows,
  storedRowIds,
  type ExportedTable
} from "../../../../../modules/data-lifecycle/domain/subject-export-payroll";
import { listModules } from "../../../../../modules";
import { buildSubjectPlan } from "../../../../../modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../../../../modules/data-lifecycle/domain/subject-data-registry";
import {
  loadColumnTypes,
  readSubjectExport,
  readSubjectRowsByIds
} from "../../../../../modules/data-lifecycle/application/subject-data-executor";
import {
  recordExportDisclosure,
  resolveSubject
} from "../../../../../modules/data-lifecycle/application/subject-request-service";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";

/**
 * `POST /api/v1/data-lifecycle/subject-requests/export` — ADR-0094, Issue #557.
 *
 * Everything this tenant holds about one data subject, assembled from the
 * `subjectData` registry rather than from a hand-written table list.
 *
 * ## Audited as a DISCLOSURE, not as a read
 *
 * ADR-0094 Decision 3: "anyone who can export any subject can exfiltrate the
 * whole user base one request at a time". So the audit row says
 * `subject_data.disclosed` at `critical`, and a durable row lands in
 * `awcms_subject_requests` in the same transaction. A read that left no trace
 * would make that sentence unverifiable.
 *
 * ## Pay is gated twice (Issue #1018)
 *
 * A payroll-boundary table (today `awcms_hr_commission_accruals`) is read only
 * for a caller who ALSO holds that table's own read permission
 * (`PAYROLL_EXPORT_GUARDS`); otherwise it is WITHHELD and named in `withheld`,
 * and a read that does happen is recorded through `recordSensitiveRead`. A
 * stored replay is a read as well and re-checks both.
 *
 * ## The response states its own coverage
 *
 * `unanswered` carries every table the plan deliberately does NOT reach —
 * global (ADR-0094 Decision 1) or matchable by no column — each with the reason
 * its owning module wrote. A subject-access report that is incomplete and does
 * not say so is worse than none, because it is signed.
 *
 * High-risk mutation in the audit sense even though it only reads: it requires
 * `Idempotency-Key`, so a retried disclosure replays rather than producing a
 * second `disclosed` row that reads like a second disclosure.
 */
const IDEMPOTENCY_SCOPE = "data_lifecycle_subject_export";

/**
 * Payroll-boundary tables (Issue #1018, `payroll-data-boundary.ts`) and the
 * SECOND permission each needs on top of `subject_request.export`.
 *
 * `subject_request.export` is a privacy-office authority, and a person's pay is
 * guarded by a narrower one on purpose (small-cohort risk). Holding the first
 * must not quietly hand over what only the second may read. So an exportable
 * payroll table is read only when the caller ALSO passes its own read guard; if
 * not, it is WITHHELD and the response says so (`withheld`), never silently
 * dropped. A payroll table with no entry here is withheld too: a descriptor
 * that turns `exportable` on cannot widen who sees pay by itself (default
 * deny). Written as literal objects: `access:permissions:enforcement:check`
 * recognises a guard by seeing the three fields together.
 */
const PAYROLL_EXPORT_GUARDS: Readonly<Record<string, AccessRequest>> = {
  awcms_hr_commission_accruals: {
    moduleKey: "hr_commission",
    activityCode: "accruals",
    action: "read"
  }
};

async function authorizePayrollTable(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  tableName: string
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const guard = PAYROLL_EXPORT_GUARDS[tableName];

  if (!guard) {
    return {
      allowed: false,
      reason:
        "payroll_boundary: no read permission is registered for this table"
    };
  }

  const decision = await authorizeInTransaction(
    tx,
    tenantId,
    tokenHash,
    now,
    guard
  );

  return decision.allowed
    ? { allowed: true }
    : {
        allowed: false,
        reason: `payroll_boundary: the caller does not hold ${guard.moduleKey}.${guard.activityCode}.${guard.action}`
      };
}

/**
 * Records the sensitive read for a payroll table that was actually handed out.
 * Today only the commission accruals have a policy; any other payroll-boundary
 * table is withheld before it gets here (no registered guard).
 */
async function recordPayrollRead(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    actorTenantUserId: string;
    tableName: string | undefined;
    rows: readonly Record<string, unknown>[];
    correlationId: string | undefined;
  }
): Promise<void> {
  if (input.tableName !== "awcms_hr_commission_accruals") return;

  await recordSensitiveRead(tx, {
    tenantId: input.tenantId,
    actorTenantUserId: input.actorTenantUserId,
    permission: "hr_commission.accruals.read",
    itemCount: input.rows.length,
    resourceIds: input.rows.map((row) => String(row.id)),
    correlationId: input.correlationId
  });
}

type Prepared = {
  idempotencyKey: string;
  subjectTenantUserId: string;
  reason: string;
  requestHash: string;
};

export const POST = defineTenantRoute<Prepared>({
  // Not `reporting`: this is an operator waiting on a page under a statutory
  // clock, not a scheduled batch, and it reads a bounded set of rows for ONE
  // person.
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody<{
      tenantUserId?: unknown;
      reason?: unknown;
    }>(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    const body = (bodyRead.value ?? {}) as {
      tenantUserId?: unknown;
      reason?: unknown;
    };

    const subjectTenantUserId =
      typeof body.tenantUserId === "string" ? body.tenantUserId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!subjectTenantUserId) {
      return fail(400, "VALIDATION_ERROR", "tenantUserId is required.");
    }
    // Required for the same reason erasure requires one: the audit row is the
    // control, and "exported by X" without "because Y" cannot be reviewed.
    if (reason.length < 8) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "reason is required and must say why the disclosure is being made."
      );
    }

    return {
      idempotencyKey,
      subjectTenantUserId,
      reason,
      requestHash: computeRequestHash(body)
    };
  },
  authorize: {
    moduleKey: "data_lifecycle",
    activityCode: "subject_request",
    action: "export"
  },
  handler: async ({ tx, auth, prepared, tenantId, locals, tokenHash, now }) => {
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      userIdempotencyActor(auth.context.tenantUserId)
    );

    if (existing) {
      if (existing.requestHash !== prepared.requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      // A replay hands back a body that stands for a person's earnings. The
      // STORED body holds no payroll rows (audit M2, only their ids), so the
      // rows are RE-READ here, after the caller's permission is checked NOW (it
      // may have been revoked since), and the read is recorded again (the same
      // rule the accrual replays follow, #978 re-audit L-A).
      const stored = existing.responseBody as {
        data?: {
          subject?: { tenantUserId?: string };
          tables?: ExportedTable[];
          truncatedTables?: string[];
          withheld?: { key: string; reason: string }[];
        };
      } | null;
      const storedTables = stored?.data?.tables;

      if (
        !stored ||
        !storedTables ||
        !storedTables.some((table) => isPayrollBoundaryTable(table))
      ) {
        return jsonResponse(existing.responseBody, {
          status: existing.responseStatus
        });
      }

      const kept: ExportedTable[] = [];
      const replayWithheld = [...(stored.data?.withheld ?? [])];
      const replayTruncated = new Set(stored.data?.truncatedTables ?? []);
      const replayResolution = await resolveSubject(
        tx,
        tenantId,
        stored.data?.subject?.tenantUserId ?? prepared.subjectTenantUserId
      );
      const replayPlan = replayResolution.resolved
        ? buildSubjectPlan(
            collectSubjectDataDescriptors(listModules()),
            replayResolution.subject
          )
        : null;

      for (const table of storedTables) {
        const name = table.tableName ?? "";
        const key = table.key ?? name;

        if (!isPayrollBoundaryTable(table)) {
          kept.push(table);
          continue;
        }

        const verdict = await authorizePayrollTable(
          tx,
          tenantId,
          tokenHash,
          now,
          name
        );
        const entry = replayPlan?.exportEntries.find(
          (candidate) => candidate.key === key
        );

        if (!verdict.allowed || !entry) {
          replayWithheld.push({
            key,
            reason: verdict.allowed
              ? "payroll_boundary: the table is no longer exportable for this subject"
              : verdict.reason
          });
          // A table that is withheld was not cut short: never both lists.
          replayTruncated.delete(key);
          continue;
        }

        const rows = await readSubjectRowsByIds(
          tx,
          tenantId,
          entry,
          await loadColumnTypes(tx, [entry.tableName]),
          storedRowIds(table)
        );

        await recordPayrollRead(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          tableName: name,
          rows,
          correlationId: locals.correlationId ?? undefined
        });

        const {
          payrollRowIds: _ids,
          payrollRowsStripped: _marker,
          ...rest
        } = table;
        kept.push({ ...rest, rows });
      }

      return jsonResponse(
        {
          ...(existing.responseBody as object),
          data: {
            ...stored.data,
            tables: kept,
            truncatedTables: [...replayTruncated],
            withheld: replayWithheld
          }
        },
        { status: existing.responseStatus }
      );
    }

    const resolution = await resolveSubject(
      tx,
      tenantId,
      prepared.subjectTenantUserId
    );

    if (!resolution.resolved) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "No such tenant user in this tenant."
      );
    }

    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      resolution.subject
    );
    // Payroll-boundary tables need their own read permission (see
    // PAYROLL_EXPORT_GUARDS). Decided per table, before anything is read.
    const withheld: { key: string; reason: string }[] = [];
    const readable: (typeof plan.exportEntries)[number][] = [];

    for (const entry of plan.exportEntries) {
      if (!isPayrollBoundaryTable(entry)) {
        readable.push(entry);
        continue;
      }

      const verdict = await authorizePayrollTable(
        tx,
        tenantId,
        tokenHash,
        now,
        entry.tableName
      );

      if (verdict.allowed) {
        readable.push(entry);
      } else {
        withheld.push({ key: entry.key, reason: verdict.reason });
      }
    }

    const exportPlan = { ...plan, exportEntries: readable };
    const columnTypes = await loadColumnTypes(
      tx,
      exportPlan.exportEntries.map((entry) => entry.tableName)
    );
    const tables = await readSubjectExport(
      tx,
      tenantId,
      exportPlan,
      columnTypes
    );
    // The read of a person's earnings is itself an event (PS-18): one audit row
    // per payroll table read, ids and a count and never an amount.
    for (const table of tables) {
      if (isPayrollBoundaryTable(table)) {
        await recordPayrollRead(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          tableName: table.tableName,
          rows: table.rows,
          correlationId: locals.correlationId ?? undefined
        });
      }
    }

    const rowCount = tables.reduce((sum, table) => sum + table.rows.length, 0);
    // Finding C5 — the export is row-capped now, so "incomplete" is a state
    // that can occur and must never be silent. It rides in the response
    // alongside `unanswered` (this file's own coverage statement) and into the
    // audit event, because a disclosure record that says "we gave them
    // everything" when a table was cut short is the record being wrong about
    // the one thing it exists to establish.
    const truncatedTables = tables
      .filter((table) => table.truncated)
      .map((table) => table.key);

    const record = await recordExportDisclosure(tx, tenantId, {
      subjectTenantUserId: prepared.subjectTenantUserId,
      reason: prepared.reason,
      requestedBy: auth.context.tenantUserId,
      tablesAnswered: plan.entries.length,
      tablesUnanswered: plan.unansweredEntries.length,
      rowsAffected: rowCount,
      correlationId: locals.correlationId ?? null
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "data_lifecycle",
      // Not `subject_data.read`. The verb is what a reviewer scans for, and
      // this row exists so "who disclosed whose data" is answerable.
      action: "subject_data.disclosed",
      resourceType: "subject_request",
      resourceId: record.id,
      severity: "critical",
      message:
        truncatedTables.length > 0
          ? `Subject-access export disclosed for tenant user ${prepared.subjectTenantUserId} — INCOMPLETE, ${truncatedTables.length} table(s) hit the row cap`
          : `Subject-access export disclosed for tenant user ${prepared.subjectTenantUserId}`,
      attributes: {
        subjectTenantUserId: prepared.subjectTenantUserId,
        reason: prepared.reason,
        tablesRead: tables.length,
        rowCount,
        tablesUnanswered: plan.unansweredEntries.length,
        tablesTruncated: truncatedTables,
        tablesWithheld: withheld.map((entry) => entry.key)
      },
      correlationId: locals.correlationId ?? undefined
    });

    const successResponse = ok({
      request: record,
      subject: { tenantUserId: prepared.subjectTenantUserId },
      tables,
      // The report's own coverage statement — see this file's header.
      unanswered: plan.unansweredEntries,
      // The second half of that statement (finding C5): which tables were cut
      // short. Empty means the report is complete, which is a claim worth being
      // able to make explicitly rather than by the absence of a warning.
      truncatedTables,
      // Payroll-boundary tables the caller may not read (Issue #1018). Empty
      // means nothing was held back for lack of permission.
      withheld
    });
    const successBody = (await successResponse.clone().json()) as {
      data: { tables: ExportedTable[] };
    };
    // Audit M2: the idempotency store lives 30 days outside the payroll
    // boundary, so it keeps payroll ids and a marker, never the rows.
    const storedBody = {
      ...successBody,
      data: {
        ...successBody.data,
        tables: stripPayrollRows(successBody.data.tables)
      }
    };

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      userIdempotencyActor(auth.context.tenantUserId),
      prepared.requestHash,
      200,
      storedBody
    );

    return successResponse;
  }
});
