/**
 * Descriptor-declared consumer aggregation + validation (ADR-0134, Issue #918).
 * Pure: no I/O, no database, no wrapping — same shape as
 * `site-search/domain/search-source-registry.ts` and
 * `reporting/domain/projection-registry.ts`. The runtime's registry
 * (`infrastructure/consumer-registry.ts`) calls this at build time and THROWS on
 * any issue; `bun run domain-events:consumers:check` calls it in CI. One
 * validator, two callers, so the gate cannot pass something the runtime refuses.
 */
import type {
  ModuleDescriptor,
  ModuleLifecycleStatus
} from "../../_shared/module-contract";
import type { ModuleDomainEventConsumer } from "../../_shared/domain-event-consumer-contract";
import { isValidEventType, isValidEventVersion } from "./envelope";

export const DOMAIN_EVENT_RUNTIME_MODULE_KEY = "domain_event_runtime";

const CONSUMER_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type DeclaredDomainEventConsumer = {
  ownerModuleKey: string;
  ownerStatus: ModuleLifecycleStatus;
  declaration: ModuleDomainEventConsumer;
};

export type DomainEventConsumerDeclarationIssue = {
  consumerName: string;
  ownerModuleKey: string;
  message: string;
};

export function formatDomainEventConsumerIssue(
  issue: DomainEventConsumerDeclarationIssue
): string {
  return `[${issue.consumerName}] (module ${issue.ownerModuleKey}) ${issue.message}`;
}

/**
 * Every module's own `domainEventConsumers`, flattened and sorted by consumer
 * name. Sorting by NAME (not module order) makes the result independent of how a
 * downstream composition happens to order `listModules()`, so the dispatcher's
 * per-tick iteration order is the same on every deployment of the same set.
 */
export function collectDeclaredDomainEventConsumers(
  modules: readonly ModuleDescriptor[]
): DeclaredDomainEventConsumer[] {
  return modules
    .flatMap((module) =>
      (module.domainEventConsumers ?? []).map((declaration) => ({
        ownerModuleKey: module.key,
        ownerStatus: module.status,
        declaration
      }))
    )
    .sort((a, b) =>
      a.declaration.name < b.declaration.name
        ? -1
        : a.declaration.name > b.declaration.name
          ? 1
          : 0
    );
}

export function validateDomainEventConsumerDeclarations(
  modules: readonly ModuleDescriptor[]
): {
  valid: boolean;
  issues: DomainEventConsumerDeclarationIssue[];
  consumers: DeclaredDomainEventConsumer[];
} {
  const issues: DomainEventConsumerDeclarationIssue[] = [];
  const consumers = collectDeclaredDomainEventConsumers(modules);
  // Event types are checked against EVERY module's `events.publishes`, including
  // a module whose status is `disabled`: the event vocabulary is a property of
  // the composed registry, not of what happens to be switched on.
  const declaredEventTypes = new Set(
    modules.flatMap((module) => module.events?.publishes ?? [])
  );
  const dependenciesByModule = new Map(
    modules.map((module) => [module.key, module.dependencies])
  );
  const seenNames = new Map<string, string>();

  for (const { ownerModuleKey, declaration } of consumers) {
    const report = (message: string): void => {
      issues.push({
        consumerName: String(declaration.name),
        ownerModuleKey,
        message
      });
    };

    if (
      typeof declaration.name !== "string" ||
      !CONSUMER_NAME_PATTERN.test(declaration.name)
    ) {
      report(
        "name must be `<segment>.<segment>`, snake_case (^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$)."
      );
    }

    const firstOwner = seenNames.get(declaration.name);
    if (firstOwner !== undefined) {
      report(
        `duplicate consumer name — already declared by module ${firstOwner}. The name keys delivery rows and the effect ledger, so two consumers sharing one would silently swallow each other's events.`
      );
    } else {
      seenNames.set(declaration.name, ownerModuleKey);
    }

    if (
      ownerModuleKey !== DOMAIN_EVENT_RUNTIME_MODULE_KEY &&
      !(dependenciesByModule.get(ownerModuleKey) ?? []).includes(
        DOMAIN_EVENT_RUNTIME_MODULE_KEY
      )
    ) {
      report(
        `module ${ownerModuleKey} declares a consumer but does not list \`${DOMAIN_EVENT_RUNTIME_MODULE_KEY}\` in its dependencies.`
      );
    }

    if (
      typeof declaration.description !== "string" ||
      declaration.description.trim() === ""
    ) {
      report("description must be non-empty.");
    }

    if (declaration.eventTypes.length === 0) {
      report("eventTypes must list at least one event type.");
    }
    for (const eventType of declaration.eventTypes) {
      if (!isValidEventType(eventType)) {
        report(`event type ${JSON.stringify(eventType)} is malformed.`);
      } else if (!declaredEventTypes.has(eventType)) {
        report(
          `subscribes to ${JSON.stringify(eventType)}, which no module lists in events.publishes — it can never receive a delivery.`
        );
      }
    }

    if (declaration.eventVersions.length === 0) {
      report("eventVersions must list at least one event version.");
    }
    for (const eventVersion of declaration.eventVersions) {
      if (!isValidEventVersion(eventVersion)) {
        report(`event version ${JSON.stringify(eventVersion)} is malformed.`);
      }
    }

    if (
      declaration.maxAttempts !== undefined &&
      (!Number.isInteger(declaration.maxAttempts) ||
        declaration.maxAttempts < 1)
    ) {
      report("maxAttempts must be a positive integer.");
    }

    if (typeof declaration.handle !== "function") {
      report("handle must be a function.");
    }

    const idempotency = declaration.idempotency ?? "runtime_effect_once";
    if (
      idempotency !== "runtime_effect_once" &&
      idempotency !== "self_managed"
    ) {
      report(
        `idempotency ${JSON.stringify(idempotency)} is not "runtime_effect_once" or "self_managed".`
      );
    } else if (
      idempotency === "self_managed" &&
      (declaration.idempotencyRationale ?? "").trim() === ""
    ) {
      report(
        'idempotency "self_managed" requires a non-empty idempotencyRationale — emitted-once is not handled-once, so say why a redelivery cannot duplicate the effect.'
      );
    } else if (
      idempotency === "runtime_effect_once" &&
      declaration.idempotencyRationale !== undefined
    ) {
      report(
        'idempotencyRationale is only meaningful with idempotency "self_managed"; a rationale beside a runtime-guarded consumer is a stale claim.'
      );
    }
  }

  return { valid: issues.length === 0, issues, consumers };
}
