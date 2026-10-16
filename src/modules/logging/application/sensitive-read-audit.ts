/**
 * Rate-aware audit of sensitive reads (Issue #978, finding PS-18 (a);
 * `docs/awcms/hr-payroll.md` sections 11.3 and 13.2).
 *
 * `recordSensitiveRead` is what a route calls, inside the SAME transaction that
 * reads the data, after it has authorised the read:
 *
 *     await recordSensitiveRead(tx, {
 *       tenantId,
 *       actorTenantUserId,
 *       permission: "hr_payroll.compensation.read",
 *       itemCount: rows.length,
 *       resourceIds: rows.map((row) => row.employmentId),
 *       correlationId
 *     });
 *
 * ## What it records, and what it can never record
 *
 * Actor, kind, ids and counts. The input type has no field for a value, and the
 * ids are validated to be UUIDs, so an amount, a name or a note cannot be passed
 * in by accident: `"1500000.00"` is refused, not stored. The audit row's message
 * is a constant. (`attributes` additionally goes through the shared redaction in
 * `recordAuditEvent`.)
 *
 * ## Fail-closed
 *
 * It runs on the caller's `tx`. If the counter upsert or the audit insert
 * throws, the caller's transaction aborts and the read returns nothing. A
 * sensitive read that cannot be recorded does not happen. (This is the opposite
 * posture to the shared rate limiter's fail-open, and deliberately: that one
 * protects availability of logins, this one is the evidence.)
 *
 * ## Coalescing, so browsing does not flood the log
 *
 * The policy (`_shared/sensitive-reads.ts`) gives a window. Within a fixed
 * window, per `(tenant, actor, module, kind)`:
 *
 * - the FIRST read opens the window and writes one audit row;
 * - later reads only increment the counter in `awcms_sensitive_read_windows`
 *   (one statement, atomic under concurrency: `INSERT ... ON CONFLICT DO
 *   UPDATE`, no read-modify-write);
 * - a further audit row, at `warning`, is written when the window's read count
 *   or item count first reaches a power of ten from {@link MILESTONE_FLOOR_READS}
 *   / {@link MILESTONE_FLOOR_ITEMS}, carrying the running totals. So a reader
 *   who pages a thousand times costs three rows, and one who dumps ten thousand
 *   records in a single call is a `warning` on the call itself.
 *
 * `coalesceWindowSeconds: 0` (exports) skips the counter: every call is its own
 * row, at the policy's severity, because one file out is one decision.
 *
 * The window is a fixed bucket of the wall clock (`floor(epoch / window)`), not
 * a sliding one. The bound is the point (rows grow with the number of windows
 * touched, not reads); a sliding window would need a row per read to be exact.
 */
import {
  findSensitiveReadPolicy,
  moduleKeyOfPermission,
  type SensitiveReadPolicy
} from "../../_shared/sensitive-reads";
import { recordAuditEvent } from "./audit-log";

/** A power of ten at or above this many reads in a window is a milestone. */
export const MILESTONE_FLOOR_READS = 10;

/** A power of ten at or above this many records in a window is a milestone. */
export const MILESTONE_FLOOR_ITEMS = 100;

/** At most this many record ids ride in one audit row; a call naming more writes several rows, so no id is ever dropped. */
export const MAX_AUDITED_RESOURCE_IDS = 20;

/** Distinct ids remembered per window to suppress duplicate rows. Bounded; past it an id is re-audited (more rows, never fewer). */
export const SEEN_IDS_CAP = 500;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SensitiveReadInput = {
  tenantId: string;
  /** The tenant user who performed the read. */
  actorTenantUserId: string;
  /** The permission the read was authorised under; selects the policy. */
  permission: string;
  /** How many records the read returned (a count). Defaults to 1. */
  itemCount?: number;
  /** Ids (UUIDs) of the records the read covered. Capped in the row. */
  resourceIds?: readonly string[];
  correlationId?: string;
  /**
   * HOW the reader reached the records: `all` (a permission over everyone),
   * `reports` (the manager chain), `role_grant`. Recorded as an attribute so a
   * trail can tell an HR dump from a supervisor's look at their reports (Issue
   * #1083, M-2). A short lower-case token, never free text.
   */
  mode?: string;
  /** Injectable clock for tests. */
  now?: Date;
};

export type SensitiveReadOutcome = {
  /** Whether an audit row was written by THIS call. */
  audited: boolean;
  /** Why: a new window, a milestone, or an uncoalesced policy. */
  reason:
    "window_opened" | "milestone" | "new_ids" | "uncoalesced" | "coalesced";
  readCount: number;
  itemCount: number;
};

/** The smallest power of ten `floor * 10^k` that `value` has reached and `previous` had not. */
export function crossedDecade(
  previous: number,
  value: number,
  floor: number
): boolean {
  for (let step = floor; step <= value; step *= 10) {
    if (previous < step) return true;
  }

  return false;
}

function assertInput(input: SensitiveReadInput): {
  policy: SensitiveReadPolicy;
  itemCount: number;
  resourceIds: string[];
} {
  const policy = findSensitiveReadPolicy(input.permission);

  if (!policy) {
    throw new Error(
      `sensitive read: no policy for permission ${JSON.stringify(input.permission)}. Add one in src/modules/_shared/sensitive-reads.ts (hr-payroll.md PS-18).`
    );
  }

  const itemCount = input.itemCount ?? 1;

  if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
    throw new Error(
      "sensitive read: itemCount must be a non-negative integer."
    );
  }

  if (input.mode !== undefined && !/^[a-z_]{1,24}$/.test(input.mode)) {
    throw new Error("sensitive read: mode must be a short lower-case token.");
  }

  const resourceIds = [...(input.resourceIds ?? [])];

  for (const id of resourceIds) {
    // A UUID, never "whatever string a caller has": this is what keeps an
    // amount, a name or an account number out of the audit row even when a
    // caller passes the wrong column.
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new Error(
        "sensitive read: resourceIds must be UUIDs. An audit row records which records were read, never what they contained."
      );
    }
  }

  return { policy, itemCount, resourceIds };
}

function auditAttributes(
  input: SensitiveReadInput,
  policy: SensitiveReadPolicy,
  itemCount: number,
  listedIds: readonly string[],
  window: { readCount: number; itemCount: number; startedAt: Date } | null,
  reason: SensitiveReadOutcome["reason"],
  chunk: { index: number; total: number }
): Record<string, unknown> {
  return {
    permission: input.permission,
    kind: policy.kind,
    ...(input.mode ? { mode: input.mode } : {}),
    reason,
    callItemCount: itemCount,
    // Every id this row is responsible for, complete (the rows of one call are
    // chunks of the same list, `idsChunk` says which).
    resourceIds: listedIds,
    idsChunk: chunk.index + 1,
    idsChunks: chunk.total,
    ...(window
      ? {
          windowSeconds: policy.coalesceWindowSeconds,
          windowStartedAt: window.startedAt.toISOString(),
          windowReadCount: window.readCount,
          windowItemCount: window.itemCount
        }
      : {})
  };
}

/** Bun returns a `uuid[]` as the text form `{a,b}`; accept either shape. */
function parseUuidArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  return value
    .replace(/^\{|\}$/g, "")
    .split(",")
    .filter((id) => id.length > 0);
}

/** The ONLY clock the window uses is the database's; `now` is honoured under test alone. */
function testClockSeconds(input: SensitiveReadInput): number | null {
  if (!input.now || process.env.NODE_ENV !== "test") return null;

  return Math.floor(input.now.getTime() / 1000);
}

/**
 * Records a sensitive read per its policy. See the file header.
 *
 * Call it AFTER authorisation and BEFORE returning data, on the same `tx`.
 *
 * ## Invariant: every distinct record id read is recorded
 *
 * Coalescing may drop REPEATS, never IDENTITIES. A window row keeps the
 * (bounded) set of ids already audited in it; a call that names an id not in
 * that set writes an audit row listing exactly the new ids, whatever the
 * window's count says. So one decoy read followed by eight targeted reads
 * leaves nine id-bearing rows, not one. Past the set's bound
 * ({@link SEEN_IDS_CAP}) an id is simply not remembered and is audited again
 * the next time, which errs toward more rows, never fewer.
 */
export async function recordSensitiveRead(
  tx: Bun.SQL,
  input: SensitiveReadInput
): Promise<SensitiveReadOutcome> {
  const { policy, itemCount, resourceIds } = assertInput(input);
  const moduleKey = moduleKeyOfPermission(input.permission);
  const distinctIds = [...new Set(resourceIds.map((id) => id.toLowerCase()))];

  /** One row per chunk of ids, so no id is ever dropped from the trail. */
  const writeRows = async (
    severity: "info" | "warning",
    ids: readonly string[],
    window: { readCount: number; itemCount: number; startedAt: Date } | null,
    reason: SensitiveReadOutcome["reason"]
  ) => {
    const chunks: string[][] = [];

    for (let at = 0; at < ids.length; at += MAX_AUDITED_RESOURCE_IDS) {
      chunks.push(ids.slice(at, at + MAX_AUDITED_RESOURCE_IDS));
    }

    if (chunks.length === 0) chunks.push([]);

    for (const [index, chunk] of chunks.entries()) {
      await recordAuditEvent(tx, {
        tenantId: input.tenantId,
        actorTenantUserId: input.actorTenantUserId,
        moduleKey,
        action: policy.kind,
        resourceType: policy.resourceType,
        resourceId: chunk.length === 1 ? chunk[0] : undefined,
        severity,
        // A constant: nothing about the data, or about the person, is in it.
        message: `Sensitive read recorded: ${policy.resourceType}`,
        attributes: auditAttributes(
          input,
          policy,
          itemCount,
          chunk,
          window,
          reason,
          { index, total: chunks.length }
        ),
        correlationId: input.correlationId
      });
    }
  };

  if (policy.coalesceWindowSeconds === 0) {
    await writeRows(policy.severity, distinctIds, null, "uncoalesced");

    return {
      audited: true,
      reason: "uncoalesced",
      readCount: 1,
      itemCount
    };
  }

  const windowSeconds = policy.coalesceWindowSeconds;
  const incoming = distinctIds.slice(0, SEEN_IDS_CAP);

  // First the row is LOCKED and its audited ids read (so racing readers
  // serialise and the second sees the first's ids; a locking read cannot share
  // a statement with the write to the same row, it returns nothing). Then ONE
  // statement writes. A continuing window increments in place; a later window
  // replaces the counters and the id set (`read_count = 1` is how the caller
  // recognises that it opened one). An EARLIER window (a late-arriving
  // transaction) never rewinds the row. The window is computed from the
  // DATABASE clock, so an application host with a wrong clock cannot slide the
  // boundary.
  const [previous] = (await tx`
    SELECT seen_ids
    FROM awcms_sensitive_read_windows
    WHERE tenant_id = ${input.tenantId}
      AND actor_tenant_user_id = ${input.actorTenantUserId}
      AND module_key = ${moduleKey}
      AND kind = ${policy.kind}
    FOR UPDATE
  `) as Array<{ seen_ids: string | string[] }>;

  const [state] = (await tx`
    WITH cur AS (
      SELECT to_timestamp(
               floor(
                 COALESCE(${testClockSeconds(input)}::double precision,
                          extract(epoch FROM clock_timestamp()))
                 / ${windowSeconds}::double precision
               ) * ${windowSeconds}::double precision
             ) AS window_start,
             ARRAY(SELECT jsonb_array_elements_text(${incoming}::jsonb))::uuid[] AS ids
    )
    INSERT INTO awcms_sensitive_read_windows AS w
      (tenant_id, actor_tenant_user_id, module_key, kind,
       window_start, read_count, item_count, seen_ids, last_read_at)
    SELECT ${input.tenantId}, ${input.actorTenantUserId}, ${moduleKey}, ${policy.kind},
           cur.window_start, 1, ${itemCount}, cur.ids, now()
    FROM cur
    ON CONFLICT (tenant_id, actor_tenant_user_id, module_key, kind)
    DO UPDATE SET
      window_start = GREATEST(w.window_start, EXCLUDED.window_start),
      read_count = CASE
        WHEN EXCLUDED.window_start > w.window_start THEN 1
        ELSE w.read_count + 1
      END,
      item_count = CASE
        WHEN EXCLUDED.window_start > w.window_start THEN EXCLUDED.item_count
        ELSE w.item_count + EXCLUDED.item_count
      END,
      seen_ids = CASE
        WHEN EXCLUDED.window_start > w.window_start THEN EXCLUDED.seen_ids
        ELSE (
          SELECT COALESCE((array_agg(merged.id))[1:${SEEN_IDS_CAP}::int], '{}'::uuid[])
          FROM (
            SELECT DISTINCT unnested.id
            FROM unnest(w.seen_ids || EXCLUDED.seen_ids) AS unnested (id)
          ) AS merged
        )
      END,
      last_read_at = now()
    RETURNING w.read_count, w.item_count, w.window_start
  `) as Array<{
    read_count: number;
    item_count: string | number;
    window_start: Date;
  }>;

  const readCount = Number(state!.read_count);
  const windowItems = Number(state!.item_count);
  const opened = readCount === 1;
  const window = {
    readCount,
    itemCount: windowItems,
    startedAt: state!.window_start
  };

  // A new window forgets the previous window's ids: the trail is per window.
  const alreadyAudited = new Set(
    opened
      ? []
      : parseUuidArray(previous?.seen_ids).map((id) => id.toLowerCase())
  );
  const newIds = distinctIds.filter((id) => !alreadyAudited.has(id));

  if (opened) {
    // Severity of an OPENING row is the policy's, raised to `warning` when this
    // single call already crossed the item milestone (a bulk dump in one go).
    const bulk = crossedDecade(0, itemCount, MILESTONE_FLOOR_ITEMS);

    await writeRows(
      bulk ? "warning" : policy.severity,
      newIds,
      window,
      "window_opened"
    );

    return {
      audited: true,
      reason: "window_opened",
      readCount,
      itemCount: windowItems
    };
  }

  const milestone =
    crossedDecade(readCount - 1, readCount, MILESTONE_FLOOR_READS) ||
    crossedDecade(windowItems - itemCount, windowItems, MILESTONE_FLOOR_ITEMS);

  if (milestone) {
    await writeRows("warning", newIds, window, "milestone");

    return {
      audited: true,
      reason: "milestone",
      readCount,
      itemCount: windowItems
    };
  }

  if (newIds.length > 0) {
    await writeRows(policy.severity, newIds, window, "new_ids");

    return {
      audited: true,
      reason: "new_ids",
      readCount,
      itemCount: windowItems
    };
  }

  return {
    audited: false,
    reason: "coalesced",
    readCount,
    itemCount: windowItems
  };
}
