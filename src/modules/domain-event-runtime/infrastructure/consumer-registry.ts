import { listModules } from "../../index";
import { applyConsumerEffectOnce } from "../application/consumer-effect";
import type { DomainEventConsumerDefinition } from "../domain/consumer-types";
import { DEFAULT_CONSUMER_MAX_ATTEMPTS } from "../domain/consumer-types";
import {
  formatDomainEventConsumerIssue,
  validateDomainEventConsumerDeclarations,
  type DeclaredDomainEventConsumer
} from "../domain/consumer-declarations";
import type { ModuleDescriptor } from "../../_shared/module-contract";

/**
 * The consumer registry, BUILT from the composed module list (ADR-0134,
 * Issue #918). Every entry is declared by its OWNING module in
 * `ModuleDescriptor.domainEventConsumers`; this file imports no module's
 * consumer, so adding one (in this repo or in a downstream template) edits only
 * the module that owns it, and the former `domain_event_runtime -> reporting`
 * import cycle no longer exists.
 *
 * It stays a registry "owned by reviewed source code": the declarations are
 * code in `module.ts`, never database state or a runtime `registerConsumer()`
 * call, so the full set of consumers for an event type is still knowable by
 * reading source.
 *
 * ## Build-time failure
 *
 * `buildDomainEventConsumerRegistry` THROWS on any validation issue (duplicate
 * name, an event type no module publishes, a missing idempotency rationale, ...).
 * The same validator backs `bun run domain-events:consumers:check`, so the
 * normal path is that CI catches it first; the throw is the backstop for a
 * composition CI never saw. The first `appendDomainEvent` / dispatcher pass
 * after boot is where it surfaces — loudly, instead of a consumer that silently
 * receives nothing.
 *
 * ## Which modules' consumers run
 *
 * Consumers of a module whose `status` is `"disabled"` (disabled by code or
 * deployment) are excluded; every other status runs. Per-TENANT enable/disable
 * (`awcms_tenant_modules`) is deliberately NOT consulted, matching how the
 * module's jobs behave and what that toggle is documented to do ("writes only
 * `awcms_tenant_modules`, never unloads code"): the fan-out is decided once, at
 * publish time, and a delivery row must stay deliverable. A dispatcher that
 * skipped a tenant's rows because the owning module was toggled off would
 * strand them head-of-line behind an order key and then process them in a burst
 * on re-enable.
 *
 * ## Idempotency (emitted-once is not handled-once)
 *
 * A `runtime_effect_once` consumer (the default) has its `handle` wrapped in
 * `applyConsumerEffectOnce` HERE, keyed `(tenant, name, event.id)` — the same
 * ledger the consumers used to call by hand, so existing effect records keep
 * matching. A `self_managed` consumer is passed through unwrapped and must
 * justify why in its descriptor.
 */
export class DomainEventConsumerRegistryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid domain-event consumer declarations (${issues.length}):\n` +
        issues.map((issue) => `  - ${issue}`).join("\n")
    );
    this.name = "DomainEventConsumerRegistryError";
    this.issues = issues;
  }
}

function resolveConsumer(
  entry: DeclaredDomainEventConsumer
): DomainEventConsumerDefinition {
  const { declaration, ownerModuleKey } = entry;
  const guarded =
    (declaration.idempotency ?? "runtime_effect_once") ===
    "runtime_effect_once";

  return {
    ownerModuleKey,
    name: declaration.name,
    description: declaration.description,
    eventTypes: declaration.eventTypes,
    eventVersions: declaration.eventVersions,
    maxAttempts: declaration.maxAttempts ?? DEFAULT_CONSUMER_MAX_ATTEMPTS,
    handler: guarded
      ? async (tx, event, ctx) => {
          await applyConsumerEffectOnce(
            tx,
            ctx.tenantId,
            declaration.name,
            event.id,
            () => declaration.handle(tx, event, ctx)
          );
        }
      : declaration.handle
  };
}

/** Pure given its input: validate, drop `disabled` modules' consumers, wrap. Sorted by consumer name. */
export function buildDomainEventConsumerRegistry(
  modules: readonly ModuleDescriptor[]
): readonly DomainEventConsumerDefinition[] {
  const result = validateDomainEventConsumerDeclarations(modules);

  if (!result.valid) {
    throw new DomainEventConsumerRegistryError(
      result.issues.map(formatDomainEventConsumerIssue)
    );
  }

  return result.consumers
    .filter((entry) => entry.ownerStatus !== "disabled")
    .map(resolveConsumer);
}

let cache:
  | {
      modules: readonly ModuleDescriptor[];
      length: number;
      consumers: readonly DomainEventConsumerDefinition[];
    }
  | undefined;
let testExtras: readonly DomainEventConsumerDefinition[] = [];

/**
 * The live registry for the current composition. Memoised against the identity
 * AND length of `listModules()` (the stable array a downstream composition
 * appends to at startup), so a module added after the first call is picked up
 * rather than silently ignored.
 */
export function listDomainEventConsumers(): readonly DomainEventConsumerDefinition[] {
  const modules = listModules();

  if (
    cache === undefined ||
    cache.modules !== modules ||
    cache.length !== modules.length
  ) {
    cache = {
      modules,
      length: modules.length,
      consumers: buildDomainEventConsumerRegistry(modules)
    };
  }

  return testExtras.length === 0
    ? cache.consumers
    : [...cache.consumers, ...testExtras];
}

/** Test-only. Appends a (typically deliberately-failing) consumer for the rest of the process — call `resetDomainEventConsumersForTests()` to drop it. Never called from production code. */
export function registerDomainEventConsumerForTests(
  consumer: DomainEventConsumerDefinition
): void {
  testExtras = [...testExtras, consumer];
}

/** Test-only. Drops every consumer added by `registerDomainEventConsumerForTests` and forgets the memoised build. */
export function resetDomainEventConsumersForTests(): void {
  testExtras = [];
  cache = undefined;
}

export function getConsumersForEventType(
  eventType: string
): readonly DomainEventConsumerDefinition[] {
  return listDomainEventConsumers().filter((consumer) =>
    consumer.eventTypes.includes(eventType)
  );
}

export function getConsumerByName(
  name: string
): DomainEventConsumerDefinition | undefined {
  return listDomainEventConsumers().find((consumer) => consumer.name === name);
}
