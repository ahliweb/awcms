/**
 * `BusinessScopeHierarchyPort` (Issue #180, epic #177 "Kesiapan fondasi ERP
 * turunan", Wave 2 authorization, ADR-0011 capability port). Ported from
 * awcms-mini's `_shared/ports/business-scope-hierarchy-port.ts` (Issue #746).
 * Zero imports from any module (the ADR-0011 rule for every file in this
 * directory) — pure TypeScript interfaces only.
 *
 * The capability `identity_access`'s business-scope machinery CONSUMES to
 * answer two questions about a GENERIC `(scopeType, scopeId)` reference
 * WITHOUT identity-access ever importing an optional organization module's
 * tables directly (issue #180: "Tambahkan capability port agar derived app
 * dapat menyediakan hierarchy resolver tanpa membuat base bergantung pada
 * modul domain"):
 *
 * 1. Is this scope reference currently valid/resolvable for this tenant
 *    (existence + tenant ownership)? "Scope derived dari request harus
 *    diverifikasi terhadap resource server-side; jangan percaya scopeId dari
 *    klien sebagai fakta otorisasi" (issue #180 security model) — this port
 *    IS that validation boundary.
 * 2. What are this scope's ancestor/descendant scope references, for
 *    hierarchy-aware access (e.g. "branch B is under region R")?
 *
 * This port only RESOLVES the hierarchy graph — it never decides
 * authorization policy itself (that stays in `domain/access-control.ts`,
 * which consults bounded, already-resolved `businessScopeFacts`, not this
 * port, keeping `evaluateAccess` I/O-free and pure).
 *
 * WHO PROVIDES AN ADAPTER. Since ADR-0060 the base ships a REAL one:
 * `tenant-admin/application/office-scope-hierarchy-port-adapter.ts`, resolving
 * the `office` scope type against `awcms_offices` (bounded, cycle-safe, live
 * and same-tenant rows only) and returning `resolved: false` for every other
 * scope type. It replaced a NO-OP that resolved NOTHING — correct while
 * ADR-0011/0014 expected a derived application to inject its own resolver,
 * and permanently unfillable once ADR-0034 deleted that pathway: with no
 * derived app and no base provider, `createBusinessScopeAssignment` denied
 * `scope_unresolved` for every input, in every deployment.
 *
 * A module that later owns a richer hierarchy (legal entity, cost center)
 * either extends that adapter or replaces the binding at the composition
 * roots — a route handler or a job script, never `application`/`domain` code
 * (ADR-0011). `tests/fixtures/example-domain-modules/` still ships a dummy
 * resolver that exercises heterogeneous, multi-type ancestry, which the
 * office tree (homogeneous by construction) cannot.
 *
 * `resolved: false` is a DISTINCT outcome from "resolved but has no
 * ancestors/descendants" (an empty array with `resolved: true`) — callers
 * MUST default-DENY high-risk actions when `resolved: false` (issue #180:
 * "Unknown scope type, unresolved scope, stale hierarchy ... default to deny
 * for high-risk actions"), never treat an unresolved scope as "no hierarchy
 * constraint applies".
 *
 * HETEROGENEOUS ANCESTRY. Ancestor/descendant entries are
 * `{ scopeType, scopeId }` REFERENCES, not bare ids of the SAME scopeType as
 * the query — an organization unit's ancestor chain can legitimately
 * terminate at a different-typed legal entity (e.g. `unit(branch) ->
 * unit(region) -> legal_entity`). A flat `string[]` of ids would implicitly,
 * and wrongly, assume every ancestor/descendant shared the queried scope's
 * own `scopeType`.
 */
export type BusinessScopeReference = {
  scopeType: string;
  scopeId: string;
};

export type BusinessScopeResolution = {
  /** `false` for an unknown scope type, a scope id that doesn't exist, or one that belongs to a different tenant — never inferred from an empty ancestor/descendant list. */
  resolved: boolean;
  /** Ancestor scope references, immediate parent first, broadest/last-known ancestor last (may legitimately end in a different scopeType) — empty when `resolved` is `false` or the scope genuinely has no ancestors. */
  ancestorScopes: readonly BusinessScopeReference[];
  /** Descendant scope references (any depth, any scopeType), same emptiness convention as `ancestorScopes`. */
  descendantScopes: readonly BusinessScopeReference[];
};

export type BusinessScopeHierarchyPort = {
  /**
   * Resolves one `(scopeType, scopeId)` reference for `tenantId`. `tx` must
   * already be tenant-scoped (via `withTenant`) — an implementation reads
   * only its own owned, `FORCE ROW LEVEL SECURITY`'d table(s). An
   * implementation MUST enforce its own node/depth bound and cycle detection
   * (issue #180: "Resolver harus memiliki batas node/depth dan deteksi
   * cycle") and return a bounded result — never loop forever on a cyclic
   * graph.
   */
  resolveScope(
    tx: Bun.SQL,
    tenantId: string,
    scopeType: string,
    scopeId: string
  ): Promise<BusinessScopeResolution>;
};
