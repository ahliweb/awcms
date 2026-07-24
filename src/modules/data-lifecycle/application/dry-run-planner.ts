/**
 * Dry-run lifecycle planning (ported from awcms-micro Issue #745, ADR-0037).
 * Generic, READ-ONLY across any registered `HighVolumeTableDescriptor` — the
 * acceptance criterion "dry-run performs no mutation and reports deterministic
 * categorized counts" is enforced by construction here: every statement in this
 * file is a `SELECT count(*)`, never an `INSERT`/`UPDATE`/`DELETE`.
 *
 * Legal hold is checked BEFORE anything else that could report a row purgeable —
 * this is the literal enforcement point for "legal hold overrides ordinary
 * retention/purge and cannot be silently bypassed by tenant policy" (critical
 * requirement): no `retentionDaysOverride`, no archive-policy branch, and no
 * caller-supplied option can route around the `if (evaluation.held)` early
 * return below.
 *
 * Table/column identifiers (`tableName`/`tenantColumn`/`cursorColumn`) come ONLY
 * from a `HighVolumeTableDescriptor` already validated by
 * `domain/lifecycle-registry.ts` (never raw request input) — `tx.unsafe` is used
 * with a runtime allowlist re-check on every identifier (defense in depth beyond
 * the type system), real values always bound via `$1`/`$2`/... placeholders,
 * never string-concatenated.
 */
import type { HighVolumeTableDescriptor } from "../../_shared/module-contract";
import {
  evaluateLegalHoldForDescriptor,
  type LegalHoldRecord
} from "../domain/legal-hold";
import { applyCursorBoundarySafetyMargin } from "../domain/cursor-boundary";
import { findArchivedThroughCursor } from "./manifest-store";

const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function assertSafeIdentifier(name: string, kind: "table" | "column"): string {
  const pattern = kind === "table" ? TABLE_NAME_PATTERN : COLUMN_NAME_PATTERN;

  if (!pattern.test(name)) {
    throw new Error(
      `planLifecycleDryRun: refusing to build SQL from an unsafe ${kind} identifier: ${JSON.stringify(name)}.`
    );
  }

  return name;
}

function clampRetentionDays(
  descriptor: HighVolumeTableDescriptor,
  override?: number
): number {
  if (override === undefined) {
    return descriptor.defaultRetentionDays;
  }

  return Math.min(
    Math.max(override, descriptor.retentionMinDays),
    descriptor.retentionMaxDays
  );
}

export type LifecycleDryRunResult = {
  descriptorKey: string;
  cutoffAt: Date;
  eligibleCount: number;
  heldCount: number;
  archivedCount: number;
  purgeableCount: number;
  blockedCount: number;
  matchedHoldIds: string[];
};

/**
 * Plans ONE descriptor for ONE tenant. `activeHolds` must already be fetched for
 * this exact tenant (`legal-hold-service.ts`'s
 * `fetchActiveLegalHoldsForPlanning`) — callers evaluating many descriptors in
 * one run fetch holds ONCE and pass the same array to every call, rather than
 * re-querying per descriptor.
 */
export async function planLifecycleDryRun(
  tx: Bun.SQL,
  descriptor: HighVolumeTableDescriptor,
  tenantId: string,
  activeHolds: readonly LegalHoldRecord[],
  now: Date,
  retentionDaysOverride?: number
): Promise<LifecycleDryRunResult> {
  if (descriptor.scope !== "tenant") {
    throw new Error(
      `planLifecycleDryRun only supports scope: "tenant" descriptors today (got "${descriptor.scope}" for "${descriptor.key}") — see module README's Limitations section.`
    );
  }

  const retentionDays = clampRetentionDays(descriptor, retentionDaysOverride);
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const tableName = assertSafeIdentifier(descriptor.tableName, "table");
  const tenantColumn = assertSafeIdentifier(
    descriptor.tenantColumn ?? "tenant_id",
    "column"
  );
  const cursorColumn = assertSafeIdentifier(descriptor.cursorColumn, "column");

  const evaluation = evaluateLegalHoldForDescriptor(
    activeHolds,
    descriptor.key
  );

  const eligibleRows = (await tx.unsafe(
    `SELECT count(*)::int AS count FROM ${tableName} WHERE ${tenantColumn} = $1 AND ${cursorColumn} < $2`,
    [tenantId, cutoff]
  )) as { count: number }[];
  const eligibleCount = eligibleRows[0]?.count ?? 0;

  if (evaluation.held) {
    return {
      descriptorKey: descriptor.key,
      cutoffAt: cutoff,
      eligibleCount,
      heldCount: eligibleCount,
      archivedCount: 0,
      purgeableCount: 0,
      blockedCount: 0,
      matchedHoldIds: evaluation.matchedHoldIds
    };
  }

  if (!descriptor.archive.archivable) {
    // No archive step required for this descriptor — every eligible row is
    // immediately purgeable, nothing is "blocked" waiting on an archive pass.
    return {
      descriptorKey: descriptor.key,
      cutoffAt: cutoff,
      eligibleCount,
      heldCount: 0,
      archivedCount: 0,
      purgeableCount: eligibleCount,
      blockedCount: 0,
      matchedHoldIds: []
    };
  }

  const archivedThrough = await findArchivedThroughCursor(
    tx,
    tenantId,
    descriptor.key
  );

  if (!archivedThrough) {
    // Archivable, but nothing has ever been archived yet for this (tenant,
    // descriptor) — every eligible row is "blocked" on an archive pass before it
    // can be purged.
    return {
      descriptorKey: descriptor.key,
      cutoffAt: cutoff,
      eligibleCount,
      heldCount: 0,
      archivedCount: 0,
      purgeableCount: 0,
      blockedCount: eligibleCount,
      matchedHoldIds: []
    };
  }

  // `applyCursorBoundarySafetyMargin`: MUST match the padding
  // `archive-purge-job.ts`'s `runGenericPurgePass` applies to the exact same
  // `archivedThrough` boundary before its real DELETE — otherwise this
  // informational `archivedCount`/`purgeableCount` can disagree with what the
  // real purge pass actually deletes at exactly the boundary row.
  const archivedThroughBound = applyCursorBoundarySafetyMargin(archivedThrough);

  const archivedRows = (await tx.unsafe(
    `SELECT count(*)::int AS count FROM ${tableName} WHERE ${tenantColumn} = $1 AND ${cursorColumn} < $2 AND ${cursorColumn} <= $3`,
    [tenantId, cutoff, archivedThroughBound]
  )) as { count: number }[];
  const archivedCount = archivedRows[0]?.count ?? 0;

  return {
    descriptorKey: descriptor.key,
    cutoffAt: cutoff,
    eligibleCount,
    heldCount: 0,
    archivedCount,
    purgeableCount: archivedCount,
    blockedCount: eligibleCount - archivedCount,
    matchedHoldIds: []
  };
}

export type LifecycleDryRunOutcome =
  | { descriptorKey: string; ok: true; result: LifecycleDryRunResult }
  | { descriptorKey: string; ok: false; errorMessage: string };

/**
 * Plans EVERY tenant-scoped descriptor in `descriptors` for one tenant, catching
 * each descriptor's failure individually (surfaced as `ok: false`) rather than
 * letting one broken/unreachable table abort the whole registry-wide plan — the
 * "error" bucket the multi-descriptor dry-run counts refer to. Global-scope
 * descriptors are skipped (not planned, not reported as an error) — see this
 * module's README Limitations section.
 */
export async function planLifecycleDryRunForAllDescriptors(
  tx: Bun.SQL,
  descriptors: readonly HighVolumeTableDescriptor[],
  tenantId: string,
  activeHolds: readonly LegalHoldRecord[],
  now: Date
): Promise<LifecycleDryRunOutcome[]> {
  const outcomes: LifecycleDryRunOutcome[] = [];

  for (const descriptor of descriptors) {
    if (descriptor.scope !== "tenant") {
      continue;
    }

    try {
      const result = await planLifecycleDryRun(
        tx,
        descriptor,
        tenantId,
        activeHolds,
        now
      );
      outcomes.push({ descriptorKey: descriptor.key, ok: true, result });
    } catch (error) {
      outcomes.push({
        descriptorKey: descriptor.key,
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return outcomes;
}
