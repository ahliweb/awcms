import type { DomainEventForHandler } from "../domain/consumer-types";

/**
 * Optional broker adapter port ("keep an in-process/PostgreSQL default
 * implementation; define an optional broker adapter port for future use
 * without making it required" — and out of scope: "Kafka/RabbitMQ/NATS as a
 * mandatory dependency"). No adapter is registered by default
 * (`getDomainEventBrokerAdapter()` returns `null`) — every deployment,
 * including offline/LAN, dispatches purely via PostgreSQL + this module's
 * own in-process consumer registry.
 *
 * NOT IMPLEMENTED in this foundation module: routing dispatch for a
 * registered adapter's event types through an out-of-transaction
 * CLAIM/CALL/FINALIZE path (ADR-0006 — a real broker publish is external
 * I/O and must never run inside a DB transaction, unlike this module's
 * same-process reference consumers, see `application/dispatch-domain-
 * events.ts`'s doc comment). A future issue wiring a real adapter needs to
 * add that lease-based dispatch path back — deliberately not built
 * speculatively here (no tests would exercise it, and an untested code path
 * is worse than a documented gap).
 */
export type DomainEventBrokerPublishResult =
  | { outcome: "published" }
  | { outcome: "failed"; errorCode: string; errorMessage: string };

export type DomainEventBrokerAdapter = {
  /** Stable identifier, used in telemetry/logs only — never a metrics label directly. */
  readonly name: string;
  publish(
    event: DomainEventForHandler,
    tenantId: string
  ): Promise<DomainEventBrokerPublishResult>;
};

let registeredAdapter: DomainEventBrokerAdapter | null = null;

/** Registers a real broker adapter. Pass `null` to restore the default (no broker, PostgreSQL/in-process only). Mirrors `setMetricsPort`/`setLogSink`'s extension-point shape. */
export function setDomainEventBrokerAdapter(
  adapter: DomainEventBrokerAdapter | null
): void {
  registeredAdapter = adapter;
}

export function getDomainEventBrokerAdapter(): DomainEventBrokerAdapter | null {
  return registeredAdapter;
}

/** Test-only reset so adapter registration from one test case never leaks into the next (mirrors `resetMetricsPortForTests`). */
export function resetDomainEventBrokerAdapterForTests(): void {
  registeredAdapter = null;
}
