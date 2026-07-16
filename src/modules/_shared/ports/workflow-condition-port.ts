/**
 * Capability port (ADR-0011) for MODULE-CONTRIBUTED condition resolvers
 * and actions (Issue #747). Zero imports from any module (the ADR-0011
 * rule for every file in this directory) — pure TypeScript interfaces
 * only.
 *
 * This is a DIFFERENT, narrower extension point than the built-in
 * bounded-operator `condition` node (`domain/workflow-graph.ts` +
 * `domain/workflow-condition.ts`), which is always available and needs no
 * registry. A `WorkflowConditionResolver`/`WorkflowActionHandler` instead
 * lets another module contribute a NAMED, reviewed-source-code predicate
 * or side-effect that a graph node can reference by name — still never
 * arbitrary tenant-supplied code (doc 21 §3 decision tree, node Q5): the
 * resolver/handler function itself is compiled TypeScript checked in to
 * the repo, referenced only by its fixed `name` string, exactly the same
 * shape as `domain-event-runtime`'s `DOMAIN_EVENT_CONSUMERS` static
 * registry (`src/modules/domain-event-runtime/infrastructure/
 * consumer-registry.ts`).
 *
 * The REGISTRY itself (`workflow-approval/infrastructure/
 * condition-action-registry.ts`) is a plain array a module adds an entry
 * to by editing that reviewed source file — never a runtime
 * `registerResolver(...)` call reachable from a request handler, and
 * never anything that interpolates tenant data into executable code.
 */

export type WorkflowConditionEvaluationContext = {
  tenantId: string;
  facts: Record<string, string | number | boolean>;
};

export type WorkflowConditionResolver = {
  /** Referenced by a condition node's `resolverName` (an alternative to the built-in factKey/operator/value comparison — deliberately out of this issue's node schema until a real consumer needs it; see module README §Deferred). */
  name: string;
  description: string;
  evaluate: (ctx: WorkflowConditionEvaluationContext) => boolean;
};

export type WorkflowActionContext = {
  tenantId: string;
  instanceId: string;
  resourceType: string;
  resourceId: string;
  facts: Record<string, string | number | boolean>;
};

export type WorkflowActionHandler = {
  name: string;
  description: string;
  /** Must be a plain DB write reachable inside the caller's transaction (AGENTS.md rule #11 — no provider/network call here). */
  execute: (tx: Bun.SQL, ctx: WorkflowActionContext) => Promise<void>;
};
