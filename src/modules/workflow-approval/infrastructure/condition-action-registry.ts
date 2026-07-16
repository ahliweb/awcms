/**
 * Static, reviewed-source-code registry of module-contributed condition
 * resolvers and action handlers (Issue #747). Mirrors
 * `domain-event-runtime`'s `DOMAIN_EVENT_CONSUMERS`
 * (`src/modules/domain-event-runtime/infrastructure/consumer-registry.ts`)
 * exactly: a plain array, never a runtime `register(...)` call reachable
 * from a request handler — adding a real entry means editing THIS file
 * (reviewed source), never uploading/configuring one at runtime (doc 21
 * §3 decision tree, node Q5).
 *
 * Ships exactly one self-contained reference resolver and one
 * self-contained reference action — deliberately NOT tied to another
 * module's real business logic in this issue, matching the accepted
 * "foundation issue ships zero real business integrations" precedent
 * (#643 shipped zero real provider adapters; #742 shipped one
 * self-contained `sample.recorded` event + two reference consumers). A
 * derived application or a future base module adds its OWN entries here
 * when it has a real bounded predicate/side-effect to contribute.
 */
import type {
  WorkflowActionHandler,
  WorkflowConditionResolver
} from "../../_shared/ports/workflow-condition-port";

const ALWAYS_TRUE_RESOLVER_NAME = "workflow_approval.reference.always_true";

/**
 * Reference resolver — always returns `true`. Exists purely to prove the
 * `resolverName` condition-node variant (`domain/workflow-graph.ts`) and
 * the registry lookup mechanism (`domain/workflow-condition.ts`'s
 * `evaluateCondition`) work end-to-end; not meant to be used in a real
 * definition beyond tests/fixtures.
 */
export const alwaysTrueConditionResolver: WorkflowConditionResolver = {
  name: ALWAYS_TRUE_RESOLVER_NAME,
  description:
    "Reference resolver (Issue #747) — always evaluates true. Proves the module-contributed condition-resolver registry mechanism end-to-end.",
  evaluate: () => true
};

const NOOP_ACTION_NAME = "workflow_approval.reference.noop";

/**
 * Reference action handler — performs no side effect. Exists purely to
 * prove the static action-handler registry mechanism; real
 * module-contributed actions are a follow-up (this issue's graph node
 * schema does not yet include an `action` node type that would invoke
 * one — see module README §Deferred).
 */
export const noopActionHandler: WorkflowActionHandler = {
  name: NOOP_ACTION_NAME,
  description:
    "Reference action handler (Issue #747) — performs no side effect. Proves the static action-handler registry mechanism.",
  execute: async () => {}
};

const BASE_CONDITION_RESOLVERS: readonly WorkflowConditionResolver[] = [
  alwaysTrueConditionResolver
];

const BASE_ACTION_HANDLERS: readonly WorkflowActionHandler[] = [
  noopActionHandler
];

/**
 * `export let` (not `const`) so tests can append a fixture resolver/
 * handler for a single test file's duration — same test-injection shape
 * `domain-event-runtime`'s `DOMAIN_EVENT_CONSUMERS` and
 * `social-provider-registry.ts` already established. Never reassigned
 * from production code.
 */
export let WORKFLOW_CONDITION_RESOLVERS: readonly WorkflowConditionResolver[] =
  BASE_CONDITION_RESOLVERS;

export let WORKFLOW_ACTION_HANDLERS: readonly WorkflowActionHandler[] =
  BASE_ACTION_HANDLERS;

export function getWorkflowConditionResolverNames(): string[] {
  return WORKFLOW_CONDITION_RESOLVERS.map((r) => r.name);
}

/** Test-only. Appends a fixture resolver for the remainder of the current test file/process. */
export function registerWorkflowConditionResolverForTests(
  resolver: WorkflowConditionResolver
): void {
  WORKFLOW_CONDITION_RESOLVERS = [...WORKFLOW_CONDITION_RESOLVERS, resolver];
}

/** Test-only. Restores the registry to exactly the reference resolver. */
export function resetWorkflowConditionResolversForTests(): void {
  WORKFLOW_CONDITION_RESOLVERS = BASE_CONDITION_RESOLVERS;
}

/** Test-only. Appends a fixture action handler for the remainder of the current test file/process. */
export function registerWorkflowActionHandlerForTests(
  handler: WorkflowActionHandler
): void {
  WORKFLOW_ACTION_HANDLERS = [...WORKFLOW_ACTION_HANDLERS, handler];
}

/** Test-only. Restores the registry to exactly the reference action handler. */
export function resetWorkflowActionHandlersForTests(): void {
  WORKFLOW_ACTION_HANDLERS = BASE_ACTION_HANDLERS;
}
