/**
 * Bounded batching helpers (Issue #697, epic #679, platform-hardening —
 * shared worker runner). Generalizes the `MAX_PASSES_PER_TENANT` loop
 * already duplicated, with small variations, across `scripts/audit-log-
 * purge.ts`, `scripts/form-draft-purge.ts`, `scripts/object-sync-
 * dispatch.ts`, and `scripts/email-dispatch.ts`: call a bounded-size
 * operation repeatedly for one tenant until either a pass affects zero rows
 * (backlog drained) or a safety-bound number of passes is hit (one huge
 * backlog must never make a single scheduled run run forever, or hold one
 * unbounded transaction/memory allocation).
 *
 * This module only decides *when to stop looping* — the actual per-pass row
 * limit (the `LIMIT`/`batchLimit` clause in the underlying SQL) stays owned
 * by each domain function (e.g. `purgeExpiredAuditEvents`'s own
 * `batchLimit` option, `AUDIT_EVENT_PURGE_BATCH_LIMIT`), exactly as before —
 * this is intentionally NOT a second, competing place that also tries to
 * clamp item counts (`scripts/visitor-analytics-purge.ts`'s own header
 * warns against exactly that kind of divergent re-derivation).
 *
 * Adoption is incremental (Issue #697 scope: migrate 2 representative jobs,
 * not all of them) — existing scripts using their own inline
 * `MAX_PASSES_PER_TENANT` loop remain valid and are not required to switch
 * to this helper immediately; see `docs/awcms/deployment-profiles.md`
 * §Shared worker runner.
 *
 * PR #713 security review follow-up (Issue #697, security-auditor High
 * finding): both `runBoundedBatches` and `iterateTenantsInBatches` now
 * accept an optional `signal` and check `signal.aborted` at the start of
 * each pass/tenant iteration, stopping promptly (before starting the NEXT
 * pass/tenant) once a `job-runner.ts` timeout or SIGTERM/SIGINT fires.
 * This is "cooperative" cancellation — the CURRENT in-flight pass (already
 * an `await`ed statement/transaction) still runs to completion; only the
 * NEXT one is skipped. That is a deliberately small, bounded window (one
 * `batchLimit`-sized statement, not an unbounded number of further
 * tenants/passes) — closing it further would need mid-statement query
 * cancellation, out of scope here. This narrows, but by itself does not
 * eliminate, the "handler still running after `runJob` returns `timeout`/
 * `terminated`" window — `job-runner.ts` additionally does not release the
 * advisory lock until the handler has ACTUALLY stopped (bounded by a grace
 * period), which is what actually closes the mutual-exclusion gap; see that
 * file's own doc comment.
 */

export type TenantRow = { id: string };

/** Every batched job iterates only `active` tenants — mirrors every existing script's own `SELECT id FROM awcms_tenants WHERE status = 'active'`. `awcms_tenants` itself has no RLS (it is the root table, not tenant-scoped data), so this plain query is safe on any client. */
export async function fetchActiveTenants(sql: Bun.SQL): Promise<TenantRow[]> {
  return (await sql`
    SELECT id FROM awcms_tenants WHERE status = 'active'
  `) as TenantRow[];
}

/** The default safety bound every existing script's own `MAX_PASSES_PER_TENANT` constant already uses (audit-log-purge.ts, form-draft-purge.ts use 50; object-sync-dispatch.ts/email-dispatch.ts use 20). Callers needing a different bound pass their own `maxPasses`. */
export const DEFAULT_MAX_PASSES = 50;

/** The minimal shape a single bounded pass must report: how many items it affected — the loop stops once this is `0`. */
export type BatchPassResult = {
  count: number;
};

export type BoundedBatchOutcome<TResult extends BatchPassResult> = {
  passes: TResult[];
  totalCount: number;
  /** `true` if the safety bound (`maxPasses`) was hit before a pass returned `count: 0` — a signal the backlog was NOT fully drained this run, worth surfacing in job telemetry rather than silently swallowing. */
  hitPassLimit: boolean;
  /** `true` if this stopped early because `signal` was aborted before the next pass started, rather than the backlog draining (`count: 0`) or hitting `maxPasses`. Distinct from `hitPassLimit` — an aborted run's backlog state is unknown/irrelevant, not "still has more work". */
  aborted: boolean;
};

export type BoundedBatchOptions = {
  maxPasses?: number;
  /** Checked at the START of each pass (before calling `runPass()`) — if already aborted, the loop stops WITHOUT starting that pass. An in-flight pass (already awaited) always runs to completion; only the NEXT one is skipped. See file header for why this bounded window is an intentional, documented tradeoff, not a bug. */
  signal?: AbortSignal;
};

/**
 * Repeatedly calls `runPass()` until it reports `count: 0` (backlog
 * drained), `maxPasses` is reached (safety bound), or `signal` aborts —
 * whichever comes first. Each call to `runPass()` is expected to be its own
 * bounded transaction/statement (the caller's responsibility, e.g. via
 * `withTenant`); this function only sequences the calls, it never opens a
 * transaction of its own and never accumulates unbounded memory (only the
 * small per-pass result objects are kept, capped at `maxPasses` entries).
 */
export async function runBoundedBatches<TResult extends BatchPassResult>(
  runPass: () => Promise<TResult>,
  options: BoundedBatchOptions = {}
): Promise<BoundedBatchOutcome<TResult>> {
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  const passes: TResult[] = [];
  let totalCount = 0;
  let hitPassLimit = false;
  let aborted = false;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }

    const result = await runPass();
    passes.push(result);
    totalCount += result.count;

    if (result.count === 0) {
      break;
    }

    if (pass === maxPasses - 1) {
      hitPassLimit = true;
    }
  }

  return { passes, totalCount, hitPassLimit, aborted };
}

export type TenantBatchOutcome<TResult extends BatchPassResult> =
  BoundedBatchOutcome<TResult>;

export type IterateTenantsOptions = BoundedBatchOptions & {
  tenants?: TenantRow[];
};

/**
 * `runBoundedBatches` applied across every `active` tenant. `runPassForTenant`
 * receives each tenant's id and must return one bounded pass's result (same
 * contract as `runBoundedBatches`); this function loops per tenant until
 * that tenant's backlog is drained, `maxPasses` is hit, or `signal` aborts
 * (checked both before starting a new tenant and surfaced from each
 * tenant's own `runBoundedBatches` outcome) — never holding more than one
 * tenant's in-flight pass at a time, and never accumulating results across
 * tenants beyond the small per-tenant `passes` arrays returned in
 * `perTenant`.
 */
export async function iterateTenantsInBatches<TResult extends BatchPassResult>(
  sql: Bun.SQL,
  runPassForTenant: (tenantId: string) => Promise<TResult>,
  options: IterateTenantsOptions = {}
): Promise<{
  tenants: TenantRow[];
  totalCount: number;
  perTenant: Map<string, TenantBatchOutcome<TResult>>;
  aborted: boolean;
}> {
  const tenants = options.tenants ?? (await fetchActiveTenants(sql));
  const perTenant = new Map<string, TenantBatchOutcome<TResult>>();
  let totalCount = 0;
  let aborted = false;

  for (const tenant of tenants) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }

    const outcome = await runBoundedBatches(
      () => runPassForTenant(tenant.id),
      options
    );

    perTenant.set(tenant.id, outcome);
    totalCount += outcome.totalCount;

    if (outcome.aborted) {
      aborted = true;
      break;
    }
  }

  return { tenants, totalCount, perTenant, aborted };
}
