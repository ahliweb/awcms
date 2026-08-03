/**
 * `tenant_admin`'s `BusinessScopeHierarchyPort` adapter — the base's REAL
 * business-scope resolver (ADR-0060), replacing the NO-OP that ADR-0034 left
 * permanently unfillable when it deleted the derived-application pathway the
 * NO-OP was waiting for.
 *
 * It resolves exactly ONE scope type, `office`, against `awcms_offices`
 * (migration `sql/002`, `FORCE ROW LEVEL SECURITY` since `sql/017`, composite
 * tenant-scoped parent FK since `sql/020`) — the only real hierarchy this base
 * owns. Every other scope type stays `resolved: false`, which is the port's
 * fail-closed contract, not an oversight: a scope type nobody owns must never
 * become authorization coverage.
 *
 * ## What counts as resolvable, and why each exclusion is deliberate
 *
 * - **Soft-deleted** (`deleted_at IS NOT NULL`) — the office no longer exists
 *   for its tenant, so an assignment naming it must stop covering. Coverage
 *   that outlives the resource it names is exactly the stale-hierarchy case
 *   the port contract tells callers to deny.
 * - **`status = 'inactive'`** — same reasoning one step softer. A tenant that
 *   deactivates a branch has said "this is not operating"; keeping its
 *   assignments live would make deactivation a purely cosmetic act.
 * - **Another tenant's office** — RLS `FORCE` already scopes every read, and
 *   the queries below still filter `tenant_id` explicitly. Two layers, because
 *   this one answers an authorization question.
 * - **A malformed `scopeId`** — returns unresolved rather than throwing. This
 *   runs behind an anonymous-reachable authorization path; a client-supplied
 *   string must never surface as a 500.
 *
 * A soft-deleted or inactive office is skipped ANYWHERE in a chain, not just
 * at the queried node: the walk joins only live rows, so a live office under a
 * deactivated parent simply has a shorter ancestor chain rather than borrowing
 * coverage through a resource its tenant switched off.
 *
 * ## Bounded and cycle-safe (port contract, and not theoretical)
 *
 * Both walks are single recursive CTEs carrying their own path array, capped
 * by depth and by result count. Every bound REFUSES rather than truncates —
 * a cycle, a chain deeper than the depth cap, and a result set over the count
 * cap all return `resolved: false`. Truncation would be worse than refusal
 * here, because a truncated list still claims `resolved: true`: the caller
 * would get a coverage answer computed from part of the graph with no signal
 * that the rest existed. `updateOffice` cannot currently re-parent an office,
 * so a cycle can only arrive by direct database write — precisely the case
 * where guessing is worst.
 */
import type {
  BusinessScopeHierarchyPort,
  BusinessScopeReference,
  BusinessScopeResolution
} from "../../_shared/ports/business-scope-hierarchy-port";

/** The one scope type this base can resolve. */
export const OFFICE_SCOPE_TYPE = "office";

/**
 * Depth cap for either direction. An office tree is an organizational
 * structure, not a linked list; 64 levels is far past any real one and still
 * bounds a hostile row set.
 */
export const DEFAULT_MAX_OFFICE_SCOPE_DEPTH = 64;

/**
 * Result-count cap. Deliberately at/below `business-scope-facts.ts`'s own
 * `AUTH_BUSINESS_SCOPE_HIERARCHY_MAX_RELATED_SCOPES` guard (default 5000) so
 * this adapter is the first, not the last, thing to say no.
 */
export const DEFAULT_MAX_OFFICE_SCOPE_RESULTS = 5000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNRESOLVED: BusinessScopeResolution = {
  resolved: false,
  ancestorScopes: [],
  descendantScopes: []
};

export type OfficeScopeHierarchyLimits = {
  maxDepth?: number;
  maxResults?: number;
};

type WalkRow = { id: string; depth: number; cycle: boolean };

function toReferences(rows: WalkRow[]): BusinessScopeReference[] {
  return rows.map((row) => ({
    scopeType: OFFICE_SCOPE_TYPE,
    scopeId: row.id
  }));
}

/**
 * Create the adapter. `limits` exists so a test can prove the bounds fire at a
 * size that is cheap to build — a test that had to insert 5000 offices to
 * exercise the cap would not be written, and an unexercised bound is a bound
 * nobody knows works.
 */
export function createOfficeScopeHierarchyPortAdapter(
  limits: OfficeScopeHierarchyLimits = {}
): BusinessScopeHierarchyPort {
  const maxDepth = Math.max(
    1,
    limits.maxDepth ?? DEFAULT_MAX_OFFICE_SCOPE_DEPTH
  );
  const maxResults = Math.max(
    0,
    limits.maxResults ?? DEFAULT_MAX_OFFICE_SCOPE_RESULTS
  );

  return {
    async resolveScope(
      tx: Bun.SQL,
      tenantId: string,
      scopeType: string,
      scopeId: string
    ): Promise<BusinessScopeResolution> {
      if (scopeType !== OFFICE_SCOPE_TYPE) {
        return UNRESOLVED;
      }

      if (typeof scopeId !== "string" || !UUID_PATTERN.test(scopeId)) {
        return UNRESOLVED;
      }

      // Existence + liveness + tenant ownership, in one query. `status` and
      // `deleted_at` are part of the predicate rather than read back and
      // branched on, so "not live" and "not mine" are indistinguishable from
      // here — the port contract's single `resolved: false` outcome.
      const selfRows = (await tx`
        SELECT id
        FROM awcms_offices
        WHERE tenant_id = ${tenantId}
          AND id = ${scopeId}
          AND deleted_at IS NULL
          AND status = 'active'
      `) as { id: string }[];

      if (!selfRows[0]) {
        return UNRESOLVED;
      }

      // Ancestors: immediate parent first (ORDER BY depth), each step joining
      // only live, same-tenant rows. `path` carries the visited ids so a cycle
      // is detected rather than walked until the depth cap hides it.
      const ancestorRows = (await tx`
        WITH RECURSIVE chain AS (
          SELECT
            o.id,
            o.parent_office_id,
            0 AS depth,
            ARRAY[o.id] AS path,
            false AS cycle
          FROM awcms_offices o
          WHERE o.tenant_id = ${tenantId}
            AND o.id = ${scopeId}
            AND o.deleted_at IS NULL
            AND o.status = 'active'
          UNION ALL
          SELECT
            parent.id,
            parent.parent_office_id,
            chain.depth + 1,
            chain.path || parent.id,
            parent.id = ANY (chain.path)
          FROM chain
          JOIN awcms_offices parent
            ON parent.id = chain.parent_office_id
           AND parent.tenant_id = ${tenantId}
           AND parent.deleted_at IS NULL
           AND parent.status = 'active'
          WHERE chain.cycle = false
            AND chain.depth <= ${maxDepth}
        )
        SELECT id, depth, cycle
        FROM chain
        WHERE depth > 0
        ORDER BY depth
      `) as WalkRow[];

      if (ancestorRows.some((row) => row.cycle || row.depth > maxDepth)) {
        return UNRESOLVED;
      }

      // Descendants: any depth, unordered by contract; same live/tenant join
      // and the same path-based cycle detection.
      const descendantRows = (await tx`
        WITH RECURSIVE subtree AS (
          SELECT
            o.id,
            0 AS depth,
            ARRAY[o.id] AS path,
            false AS cycle
          FROM awcms_offices o
          WHERE o.tenant_id = ${tenantId}
            AND o.id = ${scopeId}
            AND o.deleted_at IS NULL
            AND o.status = 'active'
          UNION ALL
          SELECT
            child.id,
            subtree.depth + 1,
            subtree.path || child.id,
            child.id = ANY (subtree.path)
          FROM subtree
          JOIN awcms_offices child
            ON child.parent_office_id = subtree.id
           AND child.tenant_id = ${tenantId}
           AND child.deleted_at IS NULL
           AND child.status = 'active'
          WHERE subtree.cycle = false
            AND subtree.depth <= ${maxDepth}
        )
        SELECT id, depth, cycle
        FROM subtree
        WHERE depth > 0
        ORDER BY depth, id
      `) as WalkRow[];

      if (descendantRows.some((row) => row.cycle || row.depth > maxDepth)) {
        return UNRESOLVED;
      }

      // Over the count cap is refused, never truncated — same reasoning as the
      // depth cap above. A truncated list still claims `resolved: true`, so it
      // would answer a coverage question from part of the graph with no signal
      // that the rest existed.
      if (ancestorRows.length + descendantRows.length > maxResults) {
        return UNRESOLVED;
      }

      return {
        resolved: true,
        ancestorScopes: toReferences(ancestorRows),
        descendantScopes: toReferences(descendantRows)
      };
    }
  };
}

/** The instance every composition root injects. */
export const officeScopeHierarchyPortAdapter: BusinessScopeHierarchyPort =
  createOfficeScopeHierarchyPortAdapter();
