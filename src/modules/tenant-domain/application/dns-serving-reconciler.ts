/**
 * Reconcile platform subdomains in the database to serving DNS records.
 *
 * This is the mechanism behind "unlimited subdomains": a row in
 * `awcms_tenant_domains` is the desired state, and this brings the managed
 * Cloudflare zone into line with it. Adding a tenant subdomain becomes an
 * INSERT; the next reconcile pass makes it resolve.
 *
 * ## Why reconciliation and not a create-time API call
 *
 * The obvious design is "on POST /api/v1/tenant/domains, also create the DNS
 * record". That is wrong here for the same reasons the edge-cache purge queue is
 * not a direct HTTP call (ADR-0042 §9, ADR-0006):
 *
 * - it puts a slow, externally-owned network call inside a tenant's request;
 * - a failure leaves the row created and the domain permanently non-resolving,
 *   with nothing to retry it;
 * - it cannot heal drift — a record edited by hand in the Cloudflare dashboard
 *   stays wrong forever.
 *
 * A pass is idempotent, so running it more often is always safe.
 *
 * ## Scope, deliberately narrow
 *
 * Only `domain_type = 'subdomain'` rows are reconciled. Custom domains are
 * hostnames the platform does **not** own; their records live in the tenant's
 * own zone and writing them is neither possible nor appropriate. Those keep the
 * existing manual/TXT verification flow.
 *
 * Nothing is ever deleted. A soft-deleted or suspended domain is skipped, which
 * leaves a stale record resolving to the platform — visible and harmless —
 * rather than having an automated job issue destructive DNS writes. Removal is
 * an explicit operator action.
 */
import type {
  EnsureServingRecordResult,
  ServingRecordType,
  TenantDomainDnsProvider
} from "../infrastructure/cloudflare-dns-adapter";

/** One row of desired state. */
export type ServingDomainRow = {
  id: string;
  tenant_id: string;
  normalized_hostname: string;
};

export type ServingTarget = {
  recordType: ServingRecordType;
  /** IPv4 for `A`, target hostname for `CNAME` — where tenant traffic should land. */
  value: string;
  proxied: boolean;
};

export type ReconcileOutcome = {
  hostname: string;
  tenantId: string;
  status: "created" | "updated" | "unchanged" | "failed";
  detail?: string;
  retryable?: boolean;
};

export type ReconcileSummary = {
  outcomes: ReconcileOutcome[];
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
};

/**
 * Reconcile every supplied row. One row's failure never aborts the pass — a
 * single hostname Cloudflare rejects must not stop every other tenant's
 * subdomain from being fixed.
 *
 * Rows are processed sequentially on purpose. Cloudflare rate-limits per token,
 * and a burst of parallel writes across a large tenant base is the fastest way
 * to get every request in the pass throttled at once.
 */
export async function reconcileServingRecords(
  rows: readonly ServingDomainRow[],
  provider: TenantDomainDnsProvider,
  target: ServingTarget
): Promise<ReconcileSummary> {
  const outcomes: ReconcileOutcome[] = [];

  for (const row of rows) {
    const result: EnsureServingRecordResult =
      await provider.ensureServingRecord({
        recordType: target.recordType,
        recordName: row.normalized_hostname,
        recordValue: target.value,
        proxied: target.proxied
      });

    outcomes.push(
      result.ok
        ? {
            hostname: row.normalized_hostname,
            tenantId: row.tenant_id,
            status: result.action
          }
        : {
            hostname: row.normalized_hostname,
            tenantId: row.tenant_id,
            status: "failed",
            detail: result.error,
            retryable: result.retryable
          }
    );
  }

  return {
    outcomes,
    created: outcomes.filter((o) => o.status === "created").length,
    updated: outcomes.filter((o) => o.status === "updated").length,
    unchanged: outcomes.filter((o) => o.status === "unchanged").length,
    failed: outcomes.filter((o) => o.status === "failed").length
  };
}

/**
 * Read the serving target from the environment.
 *
 * Returns `null` when unset — the job then no-ops rather than guessing. Guessing
 * here would mean pointing every tenant subdomain at a wrong address, which is
 * a platform-wide outage, so "not configured" must never fall back to a default.
 */
export function resolveServingTarget(
  env: NodeJS.ProcessEnv = process.env
): ServingTarget | null {
  const value = env.TENANT_DOMAIN_SERVING_TARGET?.trim();

  if (!value) {
    return null;
  }

  const rawType = env.TENANT_DOMAIN_SERVING_RECORD_TYPE?.trim().toUpperCase();
  const recordType: ServingRecordType = rawType === "A" ? "A" : "CNAME";

  return {
    recordType,
    value,
    // Proxied unless explicitly disabled: the orange cloud is what supplies TLS
    // for an unbounded number of subdomains without per-name certificates.
    proxied: env.TENANT_DOMAIN_SERVING_PROXIED?.trim().toLowerCase() !== "false"
  };
}
