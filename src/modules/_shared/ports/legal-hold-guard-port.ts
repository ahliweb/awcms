/**
 * `LegalHoldGuardPort` (ported from awcms-micro Issue #745, ADR-0037) — the
 * capability `logging`/`visitor_analytics` (and future high-volume adopters)
 * consume from `data_lifecycle`: "is this registered high-volume-table
 * descriptor currently under an active legal hold for this tenant?" Lives in
 * neutral ground (`_shared`, imports NOTHING from either module), the same
 * reasoning `media-library-port.ts`/`public-content-port.ts` document in their
 * own headers.
 *
 * Exists because each consuming module's OWN existing purge function
 * (`purgeExpiredAuditEvents`/`purgeVisitorAnalyticsData`) is the real, only
 * enforcement point for "an active legal hold overrides ordinary
 * retention/purge and cannot be silently bypassed" for its own registered
 * `dataLifecycle` descriptor — `data_lifecycle`'s own archive/purge engine
 * NEVER mutates a "delegated" descriptor's table (see
 * `data-lifecycle/application/archive-purge-job.ts`'s header), it only records
 * a read-only dry-run snapshot. But importing `data_lifecycle`'s
 * `application`/`domain` code DIRECTLY from these modules' own trees would
 * create exactly the circular cross-module import the boundary gate (ADR-0011)
 * forbids: `data_lifecycle` already imports `logging`'s `recordAuditEvent` (to
 * audit its own operations), so `logging` importing `data_lifecycle`'s code
 * back would complete a real cycle.
 *
 * The concrete implementation
 * (`data-lifecycle/application/legal-hold-guard-port-adapter.ts`) is a thin
 * wrapper around `fetchActiveLegalHoldsForPlanning`/
 * `evaluateLegalHoldForDescriptor`. Only the TRUE composition roots — each
 * purge job's own script (`scripts/audit-log-purge.ts`,
 * `scripts/visitor-analytics-purge.ts`), the one on-demand API route that also
 * calls `purgeVisitorAnalyticsData` directly
 * (`src/pages/api/v1/analytics/retention/purge.ts`), and integration tests
 * exercising these functions directly — import both the concrete adapter and
 * the purge function, wiring them together. None of those live inside any
 * module's `application`/`domain` tree, so none are scanned by the
 * forbidden-cross-import gate.
 *
 * NOTE: this is a plain source-level port seam, NOT a capability-registry
 * entry (`capability-contract-versions.ts`) — the consumers wire the concrete
 * adapter at their composition roots directly, there is no `capabilities`
 * `provides`/`consumes` declaration for it (mirroring awcms-micro).
 */
export type LegalHoldGuardPort = {
  /**
   * True if `descriptorKey` currently has an active legal hold for this tenant
   * — either a hold scoped exactly to `descriptorKey`, or a broader
   * tenant-wide hold (`descriptorKey: null` at creation time). See
   * `data_lifecycle/domain/legal-hold.ts`'s `evaluateLegalHoldForDescriptor`
   * for the exact precedence rule this wraps. `tx` must already be
   * tenant-scoped (via `withTenant`) — this reads
   * `awcms_data_lifecycle_legal_holds`, itself `FORCE ROW LEVEL SECURITY`'d.
   */
  isDescriptorHeld(
    tx: Bun.SQL,
    tenantId: string,
    descriptorKey: string
  ): Promise<boolean>;
};
