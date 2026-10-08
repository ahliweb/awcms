🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0134-descriptor-declared-domain-event-consumers.id.md)

# ADR-0134 — Domain-event consumers are declared in the owning module's descriptor

- **Status:** Accepted
- **Date:** 2026-10-08
- **Decision maker:** ahliweb
- **Extends:** [ADR-0006](0006-offline-first-sync-outbox.md) (outbox discipline: dispatch stays in-process and DB-only, no provider call inside the transaction), [ADR-0013](0013-extension-layers-and-boundary-model.md) (a module reaches another only through a declared edge), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (templates are used directly; domain modules are added in `src/modules/` with no upstream file to edit)
- **Related:** Issue #918 items 1 and 4 (the capability ports and AsyncAPI specs of items 2-3 follow after #915/#916/#917 and are NOT part of this decision); downstream `ahliweb/awcms-one` epic #280 (wave A item A5); [`src/modules/domain-event-runtime/README.md`](../../src/modules/domain-event-runtime/README.md); `src/modules/_shared/domain-event-consumer-contract.ts`; `scripts/domain-event-consumers-check.ts`

## Context

The runtime's consumers lived in one hand-written array, `src/modules/domain-event-runtime/infrastructure/consumer-registry.ts`. Three things were wrong with that, and the third is the one that blocks the booking and workforce modules:

1. **The dependency pointed the wrong way.** The array imported the consumer of every module that wanted one. Its only real entry (`reporting`) therefore made `domain_event_runtime` import `reporting`, while `reporting` declares `domain_event_runtime` as a dependency. At module level that is a cycle. `modules:dag:check` cannot see it (it validates declared edges only) and declaring it truthfully would make the gate fail, so `tests/module-boundary.test.ts` carried it as a documented exception and the file's header told the next author not to "fix" it.
2. **A consumer was not owned by the module that owns its behaviour.** Everything about the `reporting` projector (its event, its counter, its rebuild-deferral rule) lived in `reporting`; the one line that made it run lived in a file of another module.
3. **A downstream repository could not add a consumer without editing an upstream file.** `ahliweb/awcms-one` appends its `commerce` consumers to that array as a recorded local divergence (`domain_event_runtime -> commerce`). Every further adapter, and every generic upstream module that wants a consumer (booking, hr_payroll), would add another edit to the same file and another entry to the exception list.

Separately, idempotency was a convention. Delivery is at-least-once: a handler that ran and then crashed before its delivery row committed is legitimately attempted again. Every consumer had to remember to wrap its effect in `applyConsumerEffectOnce`; nothing checked that it did. Emitted-once is not handled-once.

## Decision

### 1. Consumers are declared in `ModuleDescriptor.domainEventConsumers`

A module that consumes events lists them in its **own** `module.ts`, next to its `events`, `permissions` and `jobs`, using `ModuleDomainEventConsumer` (`_shared/domain-event-consumer-contract.ts`): `name`, `description`, `eventTypes`, `eventVersions`, optional `maxAttempts`, `idempotency`, and `handle`. `domain_event_runtime` **builds** its registry from `listModules()` (`buildDomainEventConsumerRegistry`) and imports no consumer. The arrow now runs owner -> runtime, which is the direction `dependencies` can state truthfully: a declaring module must list `domain_event_runtime` (the runtime itself excepted) or the validator rejects it.

Consequences of the direction:

- The `domain_event_runtime -> reporting` import is gone, and its `DOCUMENTED_EXCEPTIONS` entry with it. The three shipped consumers moved: the two reference consumers into the runtime's own descriptor, the projector into `reporting`'s.
- A downstream module registers a consumer by declaring it in its own descriptor. `awcms-one` can retire its divergence in `consumer-registry.ts` when it syncs this change; no upstream file is edited.
- The descriptor stays import-light. `handle` is expected to `await import(...)` its implementation, because every caller of `listModules()` loads every descriptor and a static import would drag a module's database code into all of them.

### 2. The registry is still code, not data

Declarations are reviewed source. There is no `registerConsumer()` call, no table, no plugin hook; the full set of consumers for an event type is still knowable by reading source. `listDomainEventConsumers()` builds the registry on every call (a sort and a validation over a few dozen entries), so a module appended or a descriptor edited after startup is seen. No cache: one keyed on the identity and length of the `listModules()` array would miss an in-place edit, and none was measured to be needed; if one is ever added it must fingerprint module keys, statuses, events and consumer object identities.

### 3. One validator, two callers; invalid declarations fail at build time and in CI

`validateDomainEventConsumerDeclarations` (pure, `domain/consumer-declarations.ts`) rejects: a consumer name that is not `<segment>.<segment>` snake_case; a **duplicate name**, within a module or across modules; a **subscription to an event type no module lists in `events.publishes`** (such a consumer can never receive a delivery); malformed event types or versions; empty `eventTypes`/`eventVersions`; a non-positive `maxAttempts`; a declaring module that does not depend on `domain_event_runtime`; and the idempotency violations of §5. The runtime calls it when it builds the registry and **throws** `DomainEventConsumerRegistryError` listing every issue. `bun run domain-events:consumers:check`, in the `check` chain, calls the same function, so the gate cannot pass what the runtime would refuse. CI is the primary guard. The application has no boot-time composition validation path: `src/modules/index.ts` is deliberately pure data that never validates, and `modules:compose:check` is a CI script only, so this ADR does not invent one. The runtime throw is the backstop for a composition CI never saw; it surfaces on the first publish or dispatcher pass, not as a consumer that silently receives nothing.

The same gate also refuses to lose a **shipped name**. A consumer name is the delivery row's `consumer_name`, the effect-ledger key, the pause key and a metrics label; renaming one orphans its pending deliveries and re-runs its effects. The three names that exist today are pinned (`SHIPPED_CONSUMER_NAMES`) and are byte-identical to what the static registry used. The audit projector keeps its `logging.` prefix although it is now declared by `domain_event_runtime`, because renaming it would cost more than the convention it breaks.

### 4. Which consumers run: all of them

**Every declared consumer runs, regardless of its module's descriptor `status`** (`disabled` included) and regardless of any per-tenant enable/disable (`awcms_tenant_modules`). This is identical to the static array this replaces, which never excluded anyone. An earlier draft excluded consumers of `status: disabled` modules; that was removed because it stranded pending deliveries, hid them from `listConsumerStates`, made replay fail with `UnknownReplayConsumerError`, and silently dropped events published while the module was disabled: a new lossy semantic nobody asked for. A "disabled module means no events" rule would need its own decision. **Per-tenant enable/disable is deliberately not consulted either.** That toggle is documented as writing only `awcms_tenant_modules` and never unloading code, the module's jobs do not consult it, and the fan-out is decided once at publish time. A dispatcher that skipped a tenant's rows because the owning module was toggled off would strand them head-of-line behind their order key and then process them in a burst on re-enable. Whether a tenant has a feature switched off is a decision the consumer's own effect makes (it can read the tenant's module state), not something the transport decides by leaving rows unprocessed.

Registry order is by consumer name, not module order, so the dispatcher iterates the same sequence on every deployment of the same set regardless of how a downstream composition orders `listModules()`.

### 5. Idempotency is applied by the registry, not remembered by the consumer

`idempotency` is `"runtime_effect_once"` (default) or `"self_managed"`.

- **`runtime_effect_once`:** the registry wraps `handle` in `applyConsumerEffectOnce`, keyed `(tenant, consumer name, event id)` in `awcms_domain_event_consumer_effects`: the same ledger the consumers used to call by hand, so existing effect rows keep matching. `handle` is the _side effect_, not the handler. A consumer that declares this cannot forget the guard because it never sees it. A failing effect rolls back the whole delivery transaction, marker included, and is retried by the normal backoff/dead-letter path.
- **`self_managed`:** `handle` is passed through unwrapped and owns its idempotency (a natural-key upsert, its own inbox table). It requires a non-empty `idempotencyRationale` saying why a redelivery cannot duplicate the effect; the gate refuses an empty one, and refuses a rationale on a runtime-guarded consumer as a stale claim. This is where an integration consumer with its own delivery or inbox records declares it, so its idempotency strategy is a reviewed sentence beside its name rather than an assumption.

The gate also enforces the converse statically: no file under `src/` other than `consumer-effect.ts` and the registry may reference `applyConsumerEffectOnce` in code. A `handle` that also claimed the marker would find it already taken, see `applied: false`, and silently never run its effect: green, wrong and invisible. `tests/integration/domain-event-consumer-registry.integration.test.ts` proves, against PostgreSQL, that the three consumers fan out under their unchanged names and that a redelivered event (delivery reset to `pending`, markers committed) runs no effect twice.

## Consequences

- Positive: a consumer is owned by the module that owns its behaviour; the upstream-to-downstream import and its documented exception are gone; a downstream template adds consumers without editing upstream files; duplicate and dangling subscriptions fail CI; idempotency is structural for the default path and justified in prose for the exception.
- Positive: `MODULE_CONTRACT_VERSION` is `4.2.0` (additive: `domainEventConsumers` optional), `awcms-family-compatibility.yaml` is updated, and no existing descriptor changes meaning.
- Negative: `buildDomainEventConsumerRegistry` runs on the first publish or dispatcher pass of a process and imports the module list into the runtime's infrastructure layer. It is cheap and pure, a descriptor is already loaded by anything that calls `listModules()`, and the import is of `index.ts` (data), not of any module's application code.
- Negative: `DOMAIN_EVENT_CONSUMERS` (a live binding) is removed in favour of `listDomainEventConsumers()`. In this repository the only importers were the runtime and two tests. A downstream that imported the constant must move to the function when it syncs.
- Negative: a consumer's `handle` is now reached through a dynamic `import()`; a mistyped path is a runtime error rather than a compile error. `bun run typecheck` still checks the path (the import is statically analysable) and the integration test exercises all three.

### Follow-ups, not decided here

- **`DOMAIN_EVENT_TYPE_REGISTRY`** (the catalogue `appendDomainEvent` checks before it persists an event) is still a hand-written list in the runtime, and a downstream module that publishes a new event type must add to it. It is the producer-side twin of this problem and wants the same treatment (descriptor-declared event types, the AsyncAPI parity gate reading the composed list). Separate ADR.
- **E-mail categories.** `email/domain/email-template-categories.ts` is the same shape for the `email` module (awcms-one adds derived categories to it as a divergence). Descriptor-declared e-mail categories are the second half of Issue #918 item 1. Not implemented here: it is a different registry with its own validation (template and locale coupling) and deserves its own change.
- Items 2-3 of #918 (booking, workforce and delivery capability ports; their AsyncAPI events) follow after #915/#916/#917 land. They will use this mechanism and add no new registration path.

## Alternatives rejected

Evaluated on security, performance, maintainability, scalability, compatibility and operational complexity.

### A. Startup registration API (`registerDomainEventConsumer(...)` called from a module's bootstrap)

- _Security:_ a runtime call can be made from anywhere, including code that has no business registering a consumer, and the set depends on execution order. The reviewed-source property ("grep tells you the whole set") is lost.
- _Performance / scalability:_ equivalent to the chosen design at run time.
- _Maintainability:_ needs a bootstrap hook every entry point (the HTTP server, `domain-events:dispatch`, tests, each script) must remember to run; forgetting it in one entry point produces a process with a different consumer set, which is the worst failure mode here (a publisher that fans out to nobody, or a dispatcher that ignores rows). There is no static place to validate the set, so a gate cannot see duplicates before runtime.
- _Compatibility:_ no descriptor change, but a new global mutable singleton with test-isolation hazards.
- _Operational complexity:_ highest; it adds an ordering contract between module load and first publish.
- Rejected: the descriptor is already the place every other registry in this repository lives, and it is loaded by the same `listModules()` everywhere with no bootstrap to forget.

### B. Build-time generated registry (a script scans modules and writes `consumer-registry.generated.ts`)

- _Security:_ equivalent; the output is reviewed source.
- _Performance:_ marginally better than the chosen design (no runtime build), which is immaterial: the build is a sort and a validation over a few dozen entries, once per process.
- _Maintainability:_ a second artifact to regenerate and a drift gate to keep (the repository already carries several, and has been bitten by generated files drifting after two squash-merges). A downstream template would have to regenerate a file that lives in an upstream path, which is the same upstream edit this ADR removes, one level removed.
- _Compatibility / operational complexity:_ needs a generator, a checked-in artifact and a CI step; the chosen design needs none of them.
- Rejected: it reintroduces the upstream-file edit through a generated file, to save work that costs nothing.

### C. Keep the static array, add a documented exception per downstream module

- Rejected: it is the status quo. It scales as one divergence and one exception entry per adapter, keeps the import cycle, and gives a generic upstream module (booking, hr_payroll) no way to consume an event without importing from a downstream repository.

### D. Put `handler` (not `handle`) in the declaration and leave idempotency to each consumer

- Rejected: it keeps idempotency a convention. The sample consumers all called `applyConsumerEffectOnce` correctly; the point is that a fourth author who does not is invisible until a redelivery duplicates a ledger posting. Making the default structural and the exception a reviewed sentence moves the failure from production to review.
