/**
 * Default NO-OP `BusinessScopeHierarchyPort` adapter (Issue #180, epic #177
 * Wave 2 authorization). See `_shared/ports/business-scope-hierarchy-port.ts`
 * for the full rationale.
 *
 * The BASE owns no organization hierarchy — `scope_type`/`scope_id` are
 * generic references and there is no base scope-definition table to resolve
 * them against. So this default adapter resolves EVERY scope type to
 * `resolved: false` with empty ancestor/descendant lists: the safe default
 * this port's contract requires (no crash, no silent hierarchy propagation).
 *
 * CONSEQUENCE (intended, documented, fail-closed): in a pure-base deployment
 * with no derived hierarchy provider composed in, `createBusinessScopeAssignment`
 * always fails `scope_unresolved` (there are no valid scopes to assign), and a
 * high-risk action gated on a required scope is always denied. That is the
 * correct default for a generic scope LAYER whose real hierarchy is owned by a
 * DERIVED application — a derived app injects its own adapter (walking its real
 * effective-dated legal-entity/organization-unit/etc. tables) at the
 * composition roots (route handler / expiry job / its own `src/pages/api`),
 * exactly the ports-and-adapters seam (ADR-0011).
 * `tests/fixtures/example-domain-modules/` ships a working
 * dummy resolver that exercises exact/descendant/ancestor resolution without a
 * real domain module.
 *
 * A composition root (a route handler, the expiry job script, or an
 * integration test) is the only thing that imports this file —
 * `application/business-scope-assignment-service.ts` receives the port as an
 * injected parameter instead, exactly the pattern
 * `email/application/workflow-notification-port-adapter.ts` documents.
 */
import type {
  BusinessScopeHierarchyPort,
  BusinessScopeResolution
} from "../../_shared/ports/business-scope-hierarchy-port";

const UNRESOLVED: BusinessScopeResolution = {
  resolved: false,
  ancestorScopes: [],
  descendantScopes: []
};

export const defaultBusinessScopeHierarchyPortAdapter: BusinessScopeHierarchyPort =
  {
    async resolveScope() {
      // Base owns no hierarchy — every scope type is unresolved here. A
      // derived application replaces this with a real resolver.
      return UNRESOLVED;
    }
  };
