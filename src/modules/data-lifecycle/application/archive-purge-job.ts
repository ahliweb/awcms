/**
 * Bounded archive/purge engine (ported from awcms-micro Issue #745, ADR-0037).
 * Built ENTIRELY on top of the shared worker runner (`src/lib/jobs/*`) — this
 * file adds no new locking/batching/retry-classification mechanism of its own,
 * only orchestrates `runBoundedBatches` over this module's own descriptors (NOT
 * `iterateTenantsInBatches` — that helper bounds ONE resource per tenant; one
 * tenant pass here spans MULTIPLE descriptors, so the outer tenant loop and
 * per-descriptor `runBoundedBatches` calls are composed directly instead).
 * `scripts/data-lifecycle-archive-purge.ts` wraps `runDataLifecycleArchivePurge`
 * with `runJob` (advisory lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON
 * telemetry) exactly the way `scripts/audit-log-purge.ts` already does.
 *
 * Two execution modes per descriptor (`HighVolumeTableDescriptor.executionMode`,
 * `_shared/module-contract.ts`):
 * - `"delegated"` — READ-ONLY: a dry-run snapshot is computed and recorded to
 *   `awcms_data_lifecycle_runs` for backlog visibility, but this engine NEVER
 *   mutates the table. Real purge stays owned by the adopter's own job (e.g.
 *   `bun run logs:audit:purge`).
 * - `"generic"` — this engine performs the real, bounded archive (if
 *   `archive.archivable`) then purge, using ONLY metadata the owning module
 *   declared in its own descriptor (table/tenant/cursor column names, batch
 *   limit) — never touching a table without that contract (ADR-0013 §6).
 *
 * Legal hold is re-checked at the START of every batch pass (fresh
 * `fetchActiveLegalHoldsForPlanning` per pass) — a hold created mid-backlog
 * takes effect on the very next pass, not just the next scheduled invocation.
 *
 * Only `deletion.mode === "hard_delete"` is executed by this engine today — a
 * descriptor declaring `executionMode: "generic"` with a different deletion mode
 * is a configuration error this engine refuses (reported as a per-descriptor
 * error, never silently mis-executed); see module README §Limitations.
 *
 * KNOWN LIMITATION (cursor ties at a batch boundary): resume is strictly
 * "cursor > lastProcessedValue" (see `runGenericArchivePass`/
 * `runGenericPurgePass`). If more rows share the EXACT SAME cursor value than
 * fit in one `batchLimit`-sized page, the ones past the page cutoff are skipped
 * forever on resume — fail-safe in direction (rows are never purged twice or
 * purged-without-archive), but a real, undrained backlog remnant.
 * `timestamptz` has microsecond resolution, so this requires many rows genuinely
 * sharing one microsecond, which no registered descriptor's real write pattern
 * produces today. A future fix would need a composite (cursorValue, id)
 * tie-breaking cursor.
 *
 * CONFIRMED BUG, FIXED (millisecond/microsecond round-trip): a cursor value read
 * back from Postgres as a JS `Date` (`toDate()` below) loses everything below 1
 * millisecond — `timestamptz` itself is microsecond-resolution. This silently
 * under-purged by exactly one row per archive/purge cycle in practice.
 * `runGenericPurgePass` now pads the archived-through upper bound by
 * `CURSOR_BOUNDARY_SAFETY_MARGIN_MS` (1ms) — guaranteed `>=` the true value of
 * the boundary row (max possible truncation is 999 microseconds), at the cost of
 * a narrower, much rarer edge case: a genuinely different, not-yet-archived row
 * landing within that same 1ms window would also be purged early. The
 * constant/helper lives in `domain/cursor-boundary.ts` —
 * `application/dry-run-planner.ts`'s informational `archivedCount`/
 * `purgeableCount` query must apply the SAME margin, so both files import one
 * shared source instead of each re-deriving it.
 *
 * TOCTOU fix: `activeHolds` is re-fetched at the START of EVERY batch pass
 * (inside the `runBoundedBatches` callback for both archive and purge), so a
 * hold created between passes takes effect on the very next pass, not just the
 * next invocation.
 */
import { withTenant } from "../../../lib/database/tenant-context";
import {
  fetchActiveTenants,
  runBoundedBatches,
  type TenantRow
} from "../../../lib/jobs/batching";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { listModules } from "../../index";
import type { HighVolumeTableDescriptor } from "../../_shared/module-contract";
import { collectHighVolumeTableDescriptors } from "../domain/lifecycle-registry";
import {
  evaluateLegalHoldForDescriptor,
  type LegalHoldRecord
} from "../domain/legal-hold";
import { applyCursorBoundarySafetyMargin } from "../domain/cursor-boundary";
import { DATA_LIFECYCLE_MODULE_KEY } from "../domain/data-lifecycle-permissions";
import type { ArchivePort } from "../domain/archive-port";
import { planLifecycleDryRun } from "./dry-run-planner";
import { fetchActiveLegalHoldsForPlanning } from "./legal-hold-service";
import { getCursor, upsertCursor } from "./cursor-store";
import {
  findArchivedThroughCursor,
  insertArchiveManifest
} from "./manifest-store";
import { recordLifecycleRun } from "./run-record-store";

export const DATA_LIFECYCLE_ARCHIVE_SCHEMA_VERSION = "1";

const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function assertSafeIdentifier(name: string, kind: "table" | "column"): string {
  const pattern = kind === "table" ? TABLE_NAME_PATTERN : COLUMN_NAME_PATTERN;

  if (!pattern.test(name)) {
    throw new Error(
      `data-lifecycle archive/purge: refusing to build SQL from an unsafe ${kind} identifier: ${JSON.stringify(name)}.`
    );
  }

  return name;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function computeCutoff(descriptor: HighVolumeTableDescriptor, now: Date): Date {
  return new Date(
    now.getTime() - descriptor.defaultRetentionDays * 24 * 60 * 60 * 1000
  );
}

/**
 * One bounded archive pass: SELECT (in a tenant transaction) -> write (OUTSIDE
 * any DB transaction, ADR-0006-style provider boundary) -> record manifest +
 * advance cursor (in a new tenant transaction). Returns `{ count: 0 }` once
 * nothing is left to archive (or the descriptor is held).
 *
 * TOCTOU fix: holds are re-fetched FRESH inside this pass's own transaction,
 * every time this function is called — `runBoundedBatches` calls it once per
 * pass, so a hold created between two passes of the SAME invocation now stops
 * the very next pass, not just the next scheduled invocation.
 */
async function runGenericArchivePass(
  sql: Bun.SQL,
  descriptor: HighVolumeTableDescriptor,
  tenantId: string,
  cutoff: Date,
  archivePort: ArchivePort,
  correlationId: string
): Promise<{ count: number }> {
  const tableName = assertSafeIdentifier(descriptor.tableName, "table");
  const tenantColumn = assertSafeIdentifier(
    descriptor.tenantColumn ?? "tenant_id",
    "column"
  );
  const cursorColumn = assertSafeIdentifier(descriptor.cursorColumn, "column");

  const selection = await withTenant(
    sql,
    tenantId,
    async (tx) => {
      const freshHolds = await fetchActiveLegalHoldsForPlanning(tx, tenantId);
      if (evaluateLegalHoldForDescriptor(freshHolds, descriptor.key).held) {
        return { rows: [], resumeAfter: null, held: true as const };
      }

      const cursor = await getCursor(tx, tenantId, descriptor.key, "archive");
      const resumeAfter = cursor?.cursorValue ?? null;
      // CURSOR_BOUNDARY_SAFETY_MARGIN_MS applied to the LOWER bound too (mirrors
      // the purge upper-bound fix above, same root cause): the stored
      // `resumeAfter` was itself written from a JS `Date` on a PREVIOUS pass, so
      // it is truncated DOWN from the true value of the row that produced it.
      // Comparing the un-padded value with a plain `>` let that exact same
      // boundary row satisfy `cursor > resumeAfter` AGAIN on every subsequent
      // pass (its real value is always >= the truncated one).
      const resumeAfterBound = resumeAfter
        ? applyCursorBoundarySafetyMargin(resumeAfter)
        : null;

      const rows = (
        resumeAfterBound
          ? await tx.unsafe(
              `SELECT * FROM ${tableName} WHERE ${tenantColumn} = $1 AND ${cursorColumn} < $2 AND ${cursorColumn} >= $3 ORDER BY ${cursorColumn} ASC LIMIT $4`,
              [tenantId, cutoff, resumeAfterBound, descriptor.batchLimit]
            )
          : await tx.unsafe(
              `SELECT * FROM ${tableName} WHERE ${tenantColumn} = $1 AND ${cursorColumn} < $2 ORDER BY ${cursorColumn} ASC LIMIT $3`,
              [tenantId, cutoff, descriptor.batchLimit]
            )
      ) as Record<string, unknown>[];

      return { rows, resumeAfter, held: false as const };
    },
    { workClass: "maintenance" }
  );

  if (selection.held) {
    return { count: 0 };
  }

  if (selection.rows.length === 0) {
    await withTenant(
      sql,
      tenantId,
      (tx) =>
        upsertCursor(tx, tenantId, descriptor.key, "archive", {
          cursorValue: selection.resumeAfter,
          status: "completed"
        }),
      { workClass: "maintenance" }
    );
    return { count: 0 };
  }

  const newCursorValue = toDate(
    selection.rows[selection.rows.length - 1]![descriptor.cursorColumn]
  );

  const writeResult = await archivePort.write({
    descriptorKey: descriptor.key,
    tenantId,
    format: descriptor.archive.format ?? "jsonl",
    schemaVersion: DATA_LIFECYCLE_ARCHIVE_SCHEMA_VERSION,
    rows: selection.rows,
    cursorRangeStart: selection.resumeAfter,
    cursorRangeEnd: newCursorValue
  });

  await withTenant(
    sql,
    tenantId,
    async (tx) => {
      await insertArchiveManifest(tx, tenantId, {
        descriptorKey: descriptor.key,
        archivePort: archivePort.kind,
        artifactLocation: writeResult.artifactLocation,
        rowCount: writeResult.rowCount,
        cursorRangeStart: selection.resumeAfter,
        cursorRangeEnd: newCursorValue,
        checksumHex: writeResult.checksumHex,
        schemaVersion: DATA_LIFECYCLE_ARCHIVE_SCHEMA_VERSION,
        format: descriptor.archive.format ?? "jsonl",
        restoreProcedureRef: writeResult.restoreProcedureRef,
        correlationId
      });
      await upsertCursor(tx, tenantId, descriptor.key, "archive", {
        cursorValue: newCursorValue,
        status: "in_progress"
      });
    },
    { workClass: "maintenance" }
  );

  return { count: selection.rows.length };
}

/**
 * One bounded purge pass — pure DB operation (no external I/O), so
 * SELECT+DELETE+cursor-advance all happen in ONE transaction, mirroring
 * `purgeExpiredAuditEvents`'s bounded-DELETE-with-RETURNING shape.
 *
 * TOCTOU fix: holds are re-fetched FRESH inside this pass's own transaction on
 * every call — see `runGenericArchivePass`'s matching comment above.
 */
async function runGenericPurgePass(
  sql: Bun.SQL,
  descriptor: HighVolumeTableDescriptor,
  tenantId: string,
  cutoff: Date,
  correlationId: string
): Promise<{ count: number }> {
  if (descriptor.deletion.mode !== "hard_delete") {
    throw new Error(
      `data-lifecycle archive/purge: descriptor "${descriptor.key}" declares executionMode "generic" with deletion.mode "${descriptor.deletion.mode}" — only "hard_delete" is implemented by this engine today (see module README Limitations). Refusing to execute.`
    );
  }

  const tableName = assertSafeIdentifier(descriptor.tableName, "table");
  const tenantColumn = assertSafeIdentifier(
    descriptor.tenantColumn ?? "tenant_id",
    "column"
  );
  const cursorColumn = assertSafeIdentifier(descriptor.cursorColumn, "column");

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const freshHolds = await fetchActiveLegalHoldsForPlanning(tx, tenantId);
      if (evaluateLegalHoldForDescriptor(freshHolds, descriptor.key).held) {
        return { count: 0 };
      }

      let archivedThroughBound: Date | null = null;
      if (descriptor.archive.archivable) {
        const archivedThrough = await findArchivedThroughCursor(
          tx,
          tenantId,
          descriptor.key
        );
        if (!archivedThrough) {
          // Archivable but nothing archived yet — never purge ahead of the
          // archive step (would silently defeat the archive policy).
          return { count: 0 };
        }
        // CURSOR_BOUNDARY_SAFETY_MARGIN_MS: `archivedThrough` came back from
        // Postgres as a JS `Date`, which only has millisecond resolution —
        // `timestamptz` has microsecond resolution, so the TRUE value of the row
        // that produced this boundary is silently TRUNCATED DOWN by up to 999
        // microseconds on this round-trip. Padding the upper bound by 1ms
        // guarantees it stays >= the true boundary row's value, so that row is
        // correctly included — see this file's own header "KNOWN LIMITATION" for
        // the narrow remaining edge case this trades for.
        archivedThroughBound = applyCursorBoundarySafetyMargin(archivedThrough);
      }

      const deleted = (await tx.unsafe(
        `DELETE FROM ${tableName}
         WHERE id IN (
           SELECT id FROM ${tableName}
           WHERE ${tenantColumn} = $1 AND ${cursorColumn} < $2
             AND ($3::timestamptz IS NULL OR ${cursorColumn} <= $3)
           ORDER BY ${cursorColumn} ASC
           LIMIT $4
         )
         RETURNING ${cursorColumn} AS cursor_value`,
        [tenantId, cutoff, archivedThroughBound, descriptor.batchLimit]
      )) as { cursor_value: unknown }[];

      if (deleted.length === 0) {
        await upsertCursor(tx, tenantId, descriptor.key, "purge", {
          cursorValue: null,
          status: "completed"
        });
        return { count: 0 };
      }

      const maxCursorValue = deleted
        .map((row) => toDate(row.cursor_value))
        .reduce((max, value) => (value > max ? value : max));

      await upsertCursor(tx, tenantId, descriptor.key, "purge", {
        cursorValue: maxCursorValue,
        status: "in_progress"
      });

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: DATA_LIFECYCLE_MODULE_KEY,
        action: "purge",
        resourceType: descriptor.key,
        severity: "warning",
        message: `Purged ${deleted.length} row(s) of "${descriptor.key}" past its retention cutoff (generic engine).`,
        attributes: {
          descriptorKey: descriptor.key,
          purgedCount: deleted.length,
          cutoffIso: cutoff.toISOString()
        },
        correlationId
      });

      return { count: deleted.length };
    },
    { workClass: "maintenance" }
  );
}

export type DataLifecycleArchivePurgeResult = {
  tenantsChecked: number;
  descriptorsGeneric: number;
  descriptorsDelegated: number;
  totalArchived: number;
  totalPurged: number;
  totalDryRunEligible: number;
  tenantsHitPassLimit: string[];
};

export type RunArchivePurgeOptions = {
  now?: Date;
  archivePort: ArchivePort;
  tenants?: TenantRow[];
  maxPasses?: number;
};

/**
 * Core logic, extracted from `scripts/data-lifecycle-archive-purge.ts`'s
 * `main()` so integration tests can exercise real multi-tenant iteration without
 * spawning a subprocess — same pattern `runAuditLogPurge`/
 * `runVisitorAnalyticsPurge` already established.
 */
export async function runDataLifecycleArchivePurge(
  sql: Bun.SQL,
  ctx: {
    dryRun: boolean;
    correlationId: string;
    signal?: AbortSignal;
  },
  options: RunArchivePurgeOptions
): Promise<DataLifecycleArchivePurgeResult> {
  const now = options.now ?? new Date();
  const allDescriptors = collectHighVolumeTableDescriptors(
    listModules()
  ).filter((descriptor) => descriptor.scope === "tenant");
  const genericDescriptors = allDescriptors.filter(
    (descriptor) => descriptor.executionMode === "generic"
  );
  const delegatedDescriptors = allDescriptors.filter(
    (descriptor) => descriptor.executionMode === "delegated"
  );

  const tenants = options.tenants ?? (await fetchActiveTenants(sql));

  let totalArchived = 0;
  let totalPurged = 0;
  let totalDryRunEligible = 0;
  const tenantsHitPassLimit: string[] = [];

  for (const tenant of tenants) {
    if (ctx.signal?.aborted) {
      break;
    }

    const activeHolds: LegalHoldRecord[] = await withTenant(
      sql,
      tenant.id,
      (tx) => fetchActiveLegalHoldsForPlanning(tx, tenant.id),
      { workClass: "maintenance" }
    );

    for (const descriptor of delegatedDescriptors) {
      const startedAt = new Date();
      const snapshot = await withTenant(
        sql,
        tenant.id,
        (tx) =>
          planLifecycleDryRun(tx, descriptor, tenant.id, activeHolds, now),
        { workClass: "maintenance" }
      );
      totalDryRunEligible += snapshot.eligibleCount;

      await withTenant(
        sql,
        tenant.id,
        (tx) =>
          recordLifecycleRun(tx, tenant.id, {
            descriptorKey: descriptor.key,
            runType: "dry_run",
            status: "completed",
            eligibleCount: snapshot.eligibleCount,
            heldCount: snapshot.heldCount,
            archivedCount: snapshot.archivedCount,
            purgeableCount: snapshot.purgeableCount,
            purgedCount: 0,
            blockedCount: snapshot.blockedCount,
            errorCount: 0,
            cutoffAt: snapshot.cutoffAt,
            correlationId: ctx.correlationId,
            startedAt,
            finishedAt: new Date()
          }),
        { workClass: "maintenance" }
      );
    }

    for (const descriptor of genericDescriptors) {
      const startedAt = new Date();
      const cutoff = computeCutoff(descriptor, now);

      // `activeHolds` here is used ONLY for this tenant-scoped REPORTING snapshot
      // (`awcms_data_lifecycle_runs`) — a once-per-tenant fetch is fine for a
      // compliance-audit record. The REAL archive/purge execution below
      // re-fetches holds fresh inside every single batch pass
      // (`runGenericArchivePass`/`runGenericPurgePass` themselves) — see the
      // TOCTOU fix comment on those functions.
      const snapshot = await withTenant(
        sql,
        tenant.id,
        (tx) =>
          planLifecycleDryRun(tx, descriptor, tenant.id, activeHolds, now),
        { workClass: "maintenance" }
      );

      let archivedThisRun = 0;
      let purgedThisRun = 0;
      let hitPassLimit = false;

      if (!ctx.dryRun) {
        if (descriptor.archive.archivable) {
          const archiveOutcome = await runBoundedBatches(
            () =>
              runGenericArchivePass(
                sql,
                descriptor,
                tenant.id,
                cutoff,
                options.archivePort,
                ctx.correlationId
              ),
            { signal: ctx.signal, maxPasses: options.maxPasses }
          );
          archivedThisRun = archiveOutcome.totalCount;
          hitPassLimit ||= archiveOutcome.hitPassLimit;
        }

        const purgeOutcome = await runBoundedBatches(
          () =>
            runGenericPurgePass(
              sql,
              descriptor,
              tenant.id,
              cutoff,
              ctx.correlationId
            ),
          { signal: ctx.signal, maxPasses: options.maxPasses }
        );
        purgedThisRun = purgeOutcome.totalCount;
        hitPassLimit ||= purgeOutcome.hitPassLimit;
      }

      totalArchived += archivedThisRun;
      totalPurged += purgedThisRun;
      if (hitPassLimit) {
        tenantsHitPassLimit.push(tenant.id);
      }

      await withTenant(
        sql,
        tenant.id,
        (tx) =>
          recordLifecycleRun(tx, tenant.id, {
            descriptorKey: descriptor.key,
            runType: ctx.dryRun
              ? "dry_run"
              : descriptor.archive.archivable
                ? "archive"
                : "purge",
            status: hitPassLimit ? "partial" : "completed",
            eligibleCount: snapshot.eligibleCount,
            heldCount: snapshot.heldCount,
            archivedCount: snapshot.archivedCount,
            purgeableCount: snapshot.purgeableCount,
            purgedCount: purgedThisRun,
            blockedCount: snapshot.blockedCount,
            errorCount: 0,
            cutoffAt: snapshot.cutoffAt,
            correlationId: ctx.correlationId,
            startedAt,
            finishedAt: new Date()
          }),
        { workClass: "maintenance" }
      );
    }
  }

  return {
    tenantsChecked: tenants.length,
    descriptorsGeneric: genericDescriptors.length,
    descriptorsDelegated: delegatedDescriptors.length,
    totalArchived,
    totalPurged,
    totalDryRunEligible,
    tenantsHitPassLimit
  };
}
