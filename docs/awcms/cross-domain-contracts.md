🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](cross-domain-contracts.id.md)

# Cross-domain contracts — capability ports, provisional events and consumer idempotency

> **Status:** design only (Issue #918 items 2-3). **No runtime code exists for
> anything in this document.** The three ports below are signature sketches, the
> events are in a separate, machine-validated, **provisional** AsyncAPI document
> that is not part of the live contract, and the `_shared/ports/*.ts` files are
> created by each module's phase-1 implementation PR, not now (a port with no
> implementation is dead code that a reviewer would have to delete).
>
> It is the join between four decisions: the booking pack
> ([ADR-0131](../adr/0131-generic-booking-module-admission.md),
> [`booking.md`](booking.md)), the `hr_payroll` family ([ADR-0132](../adr/0132-hr-payroll-module-family-admission.md), [`hr-payroll.md`](hr-payroll.md), Issue #916),
> the WhatsApp delivery capability
> ([ADR-0133](../adr/0133-generic-delivery-capability-whatsapp-promotion.md)),
> and descriptor-declared consumer registration ([ADR-0134](../adr/0134-descriptor-declared-domain-event-consumers.md), Issue #918 item 1).
> Where a port is _defined_ elsewhere this document restates the contract so a
> reader can review the three side by side; the owning ADR wins on any
> disagreement, and a disagreement is a defect to report.

## 1. What is contracted here, and what is not

| Artifact                                                                            | Status          | Where                                                                                                                               |
| ----------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Booking port (`quote`, `hold`, `confirm`, `cancel`, `reschedule`)                   | design          | §3                                                                                                                                  |
| Staff availability port (`getAvailability`)                                         | design          | §4                                                                                                                                  |
| WhatsApp delivery port (`enqueue`, `getStatusByCorrelation`, `cancelByCorrelation`) | design          | §5                                                                                                                                  |
| 22 event schemas (9 booking, 6 hr, 7 whatsapp)                                      | **provisional** | [`asyncapi/provisional/…provisional.asyncapi.yaml`](../../asyncapi/provisional/awcms-cross-domain-events.provisional.asyncapi.yaml) |
| Consumer registration (`ModuleDescriptor.domainEventConsumers`)                     | ADR-0134        | not restated; this document only _uses_ it                                                                                          |
| Idempotency per side-effecting consumer                                             | design          | §6                                                                                                                                  |
| How an event moves from provisional to live                                         | process         | §7                                                                                                                                  |

Not contracted here: schemas, endpoints, permissions and state machines of the
modules themselves. They are in the packs and ADRs above and are not duplicated.

## 2. Rules that apply to all three ports

These are ADR-0011 (consumers depend on a neutral port, never on module code),
ADR-0006 (no network I/O inside a database transaction) and ADR-0063
(authorization at the chokepoint), applied once instead of three times.

- **Where a port lives.** A pure TypeScript interface in
  `src/modules/_shared/ports/<name>-port.ts` that imports nothing from any
  module. Its adapter lives in the **owning** module's `application/` layer and
  is injected by the **consumer's composition root** (its route or job). The file
  is created by the owning module's phase-1 PR together with the adapter and its
  first caller; **this PR creates none of them**.
- **Tenant context and RLS.** Every call runs in the caller's tenant-scoped
  transaction (`tx`) or takes `tenantId` and opens its own tenant context; either
  way FORCE RLS applies and a port can never reach another tenant's rows. A port
  never accepts a tenant id it then trusts over the session's.
- **Authorization.** A port **authorizes nothing and audits nothing**; the
  consumer's route authorizes _its own_ permission before calling (as
  `InventoryLedgerPort` documents). The owning module audits its own state
  changes inside the adapter.
- **No network I/O in a transaction.** No port method calls a provider, a
  webhook or another service. Anything that must leave the process rides an
  outbox and is sent by a dispatcher outside any transaction. The one write the
  delivery port performs is a single `INSERT` in the caller's transaction.
- **Refusals are values.** A domain refusal (`SLOT_UNAVAILABLE`, `refused`,
  `unknown`) is **returned**, not thrown; a port throws only for defects. A
  caller must not turn a returned refusal into a thrown error inside its own
  transaction without a savepoint, and must not `return` a 4xx from inside
  `withTenant` after writing (that COMMITS the write; see booking §5.2).
- **Identifiers are opaque.** A `staffRef`, `externalRef` or `correlationId`
  belongs to the party that minted it; the other side stores it and never parses
  it.
- **Time.** Every instant is an RFC 3339 UTC string ending in `Z`; every interval
  is half-open `[start, end)`. No local date or time zone crosses a port.

## 3. Booking port

- **Owning module:** `booking` (ADR-0131; `src/modules/_shared/ports/booking-port.ts`).
- **Consumers:** a downstream commerce adapter (offering ↔ product, hold → order,
  payment → confirm), a portal or kiosk route in the same repository. Booking
  itself has no consumer registry and no `commerce` dependency.
- **Transaction rule:** the adapter runs inside the caller's tenant transaction
  or opens one; it performs database work only. A refusal is a returned value.
- **Failure semantics:** `ok: false` with a pack error code; thrown only for
  defects. A replay of the same `idempotencyKey` returns the original outcome
  with `replayed: true` and writes nothing.

```ts
type Instant = string; // RFC 3339 UTC, ends in "Z"

type BookingRefusal =
  | "SLOT_UNAVAILABLE" // 409: exclusion conflict or no free unit
  | "OUTSIDE_SCHEDULE" // 409: lifted only by the HIGH-RISK override
  | "LEAD_TIME_VIOLATION"
  | "HORIZON_EXCEEDED"
  | "PARTY_SIZE_OUT_OF_RANGE"
  | "STAFF_UNAVAILABLE" // 409
  | "RECURRENCE_UNSUPPORTED"
  | "TIMEZONE_INVALID"
  | "HOLD_EXPIRED" // 409
  | "HOLD_LIMIT_EXCEEDED" // 429
  | "INVALID_STATE" // 409
  | "IDEMPOTENCY_CONFLICT" // 409: same key, different request
  | "PAYMENT_FIELD_NOT_ACCEPTED"; // 400: the module stores no payment state

type QuoteInput = {
  tenantId: string;
  offeringId: string;
  startsAt: Instant;
  partySize: number;
  resourceId?: string;
  staffRef?: string; // opaque; resolved only by StaffAvailabilityPort
  correlationId: string;
};

interface BookingPort {
  /** Non-binding. Writes nothing. A quote is not a promise. */
  quote(input: QuoteInput): Promise<
    | {
        ok: true;
        endsAt: Instant;
        occupiedFrom: Instant;
        occupiedTo: Instant;
        unitsNeeded: number;
      }
    | { ok: false; reason: BookingRefusal }
  >;

  /** Claims the slot as a hold (or confirmed when the offering is `immediate`). */
  hold(
    input: QuoteInput & {
      customerRef?: string; // opaque profile reference; never a name or contact
      holdSeconds?: number; // clamped by the module to [60, max_hold_seconds]
      externalRef?: { type: string; id: string }; // the adapter's own order reference
      idempotencyKey: string; // required
    }
  ): Promise<
    | {
        ok: true;
        reservationId: string;
        status: "held" | "confirmed";
        holdExpiresAt: Instant | null;
        replayed: boolean;
      }
    | { ok: false; reason: BookingRefusal }
  >;

  /** held -> confirmed. Re-checks the hold has not expired under the row lock. */
  confirm(input: {
    tenantId: string;
    reservationId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<BookingOutcome>;

  /** held | confirmed -> cancelled. The module records `lateCancellation`; any fee is the adapter's decision. */
  cancel(input: {
    tenantId: string;
    reservationId: string;
    reasonCode: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<BookingOutcome>;

  /** One transaction: release old allocations, insert the replacement, supersede the old. Refusal rolls back to the untouched original. */
  reschedule(input: {
    tenantId: string;
    reservationId: string;
    startsAt: Instant;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<BookingOutcome>;
}

type BookingOutcome =
  | { ok: true; reservationId: string; status: string; replayed: boolean }
  | { ok: false; reason: BookingRefusal };
```

Idempotency, as booking §5.2: the key is required on `hold`, `confirm`, `cancel`
and `reschedule`; the acting user is part of the request hash; the same key
against a different target is `IDEMPOTENCY_CONFLICT`; confirming a `confirmed`
reservation returns it with `replayed: true`; and the exclusion constraint
backstops both layers. The natural key `(tenant, externalRef.type, externalRef.id)`
lets an adapter retry with a fresh key without duplicating a live reservation.

**What the port deliberately does not carry:** price, deposit, payment status,
customer name or contact, free-text notes. Any of them in an input is
`PAYMENT_FIELD_NOT_ACCEPTED` or a validation error. Payment is the adapter's;
the adapter decides _when_ to ask for a `confirm`.

Provisional signature note: `BookingRefusal` is the pack's list as of this
writing; the implementation PR fixes the final union and OpenAPI `ErrorCode`
enumeration together.

## 4. Staff availability port

- **Owning module:** `hr_workforce` (ADR-0132; `src/modules/_shared/ports/staff-availability-port.ts`).
- **Consumers:** `booking` (optional `consumes`; without it, assignments are
  constrained only by booking's own exclusion rule and the response says
  `staffAvailability: "unchecked"`).
- **Transaction rule:** a read in the caller's tenant `tx`. No write, no event, no
  lock, no I/O.
- **Failure semantics:** fail-closed. Anything the adapter cannot vouch for is
  `status: "unknown"` with empty intervals; "not found", "other tenant",
  "soft-deleted" and "not active in the window" are indistinguishable on purpose
  (no existence oracle). More than 200 staff or a window over 35 days is a
  caller error (`RangeError` class), to be split by the caller.

```ts
type StaffAvailabilityQuery = {
  staffRefs: readonly string[]; // opaque (= employment ids), 1..200, duplicates collapsed
  fromUtc: string; // inclusive, ends in "Z"
  toUtc: string; // exclusive, after fromUtc, span <= 35 days
  officeId?: string;
};

type AvailabilityInterval = { startUtc: string; endUtc: string }; // [start, end)

type StaffAvailability = {
  staffRef: string;
  status: "resolved" | "unknown";
  intervals: readonly AvailabilityInterval[]; // sorted, disjoint, merged, clipped; empty when unknown
};

type StaffAvailabilityResult = {
  asOf: string;
  staff: readonly StaffAvailability[];
};

interface StaffAvailabilityPort {
  getAvailability(
    tx: TenantTx,
    query: StaffAvailabilityQuery
  ): Promise<StaffAvailabilityResult>;
}
```

Semantics a consumer must honour: `unknown` is **unbookable**; an empty array with
`resolved` means "scheduled for nothing"; the answer is a **read, not a hold**, so
booking re-checks at commit and uses `asOf` to judge staleness; a later shift
change is surfaced by booking's schedule-conflict report (booking §7.3), never by
silently cancelling; display names come from the consumer's own resource or
`profile_identity`, never from this port; do not infer an absence reason from a
gap; do not log the full result at `info`. The result is an allow-list of three
fields per person and structurally contains no payroll data; the adapter's SQL
names only the two schedule tables, and a test fails if it ever names a
compensation, payroll or commission table.

There is one contract: this one. The booking pack ([`booking.md`](booking.md) §10.3)
consumes it as defined and adds no requirement of its own.

## 5. WhatsApp delivery port

- **Owning module:** `whatsapp_delivery` (ADR-0133; `src/modules/_shared/ports/whatsapp-delivery-port.ts`).
- **Consumers:** `booking` (reminders, confirmations), `hr_payroll` (shift and
  payroll _notices_), a downstream commerce adapter (OTP, order-paid, campaigns,
  document delivery).
- **Transaction rule:** `enqueue` and `cancelByCorrelation` are database writes in
  the **caller's** transaction (one `INSERT` / one `UPDATE`). The port has **no
  `send`**: the provider is called only by the dispatcher job, outside any
  transaction, under a timeout and a circuit breaker.
- **Failure semantics:** a refusal or suppression is **returned**, so a booking is
  never rolled back because a reminder could not be queued. The caller never
  learns the provider's answer synchronously; it reads status back by correlation
  id, and the status is never copied into the caller's table (it cannot drift).

```ts
type WhatsappPurpose = "transactional" | "security" | "marketing";

type WhatsappRecipient =
  | { kind: "profile"; profileId: string } // resolved inside the module
  | { kind: "address"; phone: string }; // guest; normalised to E.164 on entry

type EnqueueWhatsappInput = {
  tenantId: string;
  templateKey: string; // module-prefixed ("booking.reminder"); registered with ONE purpose
  variables: Record<string, string>; // filtered by the template's allow-list
  recipient: WhatsappRecipient;
  idempotencyKey: string; // required
  correlationId?: string;
  notBefore?: Date;
  expiresAt?: Date; // mandatory when the template's purpose is "security"
};

type EnqueueWhatsappResult =
  | { status: "queued"; messageId: string }
  | { status: "duplicate"; messageId: string } // idempotent replay
  | { status: "suppressed"; reason: "hard_failure" | "opt_out" }
  | {
      status: "refused";
      reason:
        "CONSENT_REQUIRED" | "TEMPLATE_UNKNOWN" | "DISABLED" | "RATE_LIMITED";
    };

interface WhatsappDeliveryPort {
  enqueue(
    tx: TenantTx,
    input: EnqueueWhatsappInput
  ): Promise<EnqueueWhatsappResult>;
  getStatusByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<WhatsappStatus[]>;
  /** Cancels a still-queued message; a no-op (returns 0) once sent. */
  cancelByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<number>;
}
```

The idempotency key is unique per `(tenant_id, idempotency_key)`; a replay returns
`duplicate` with the existing message id. The signatures are **provisional** as
ADR-0133 §8 says; the implementation ADR fixes them. A phone number, message
body or template variable never appears in an event, an audit row or a log; the
caller learns only ids and the masked recipient.

## 6. Idempotency per side-effecting consumer — emitted once is not handled once

Delivery is **at-least-once**. A handler that ran and then crashed before its
delivery row committed is legitimately attempted again, so every consumer below
must be safe to run twice for the same event. ADR-0134 makes the default
structural: a consumer declared in its module descriptor with
`idempotency: "runtime_effect_once"` has its `handle` (the _effect_) wrapped by
the registry in `applyConsumerEffectOnce`, keyed `(tenant, consumer name,
event id)`; a failing effect rolls back the whole delivery transaction, marker
included. A consumer that cannot use that marker declares `self_managed` with a
reviewed `idempotencyRationale`. **No consumer calls `applyConsumerEffectOnce`
itself.** How a downstream adapter subscribes: it declares the consumer in its
**own** module descriptor (`domainEventConsumers`), naming the event types and
versions; no upstream file is edited and no upstream module imports it.

The rows below are the consumers the design packs imply. They are _illustrative
of the strategy_: each is declared by its owning module (or a downstream
adapter) when that module is built, and none exists today.

| Consumer (declared by)                                               | Event(s)                                                  | Side effect                                                             | Strategy                                                                                                                                                                                                            | Second line of defence                                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Booking reminders (`booking`)                                        | `…reservation.confirmed`                                  | `WhatsappDeliveryPort.enqueue` with `notBefore`                         | `runtime_effect_once`                                                                                                                                                                                               | `idempotencyKey = "<consumer>:<envelope eventId>"`; the port answers `duplicate` on a replay                                                                                                           |
| Booking reminder withdrawal (`booking`)                              | `…reservation.cancelled`, `…reservation.rescheduled`      | `cancelByCorrelation(reservationId)`                                    | `runtime_effect_once`                                                                                                                                                                                               | Naturally idempotent: a second call finds nothing queued and returns 0                                                                                                                                 |
| Order cancellation on expiry (commerce adapter)                      | `…reservation.expired`, `…reservation.cancelled`          | cancel the pending order named by `externalRef`                         | `runtime_effect_once`                                                                                                                                                                                               | The handler checks the order's state first; cancelling a cancelled order is a no-op                                                                                                                    |
| Confirm on payment (commerce adapter)                                | none (consumes a payment signal, not a booking event)     | `BookingPort.confirm`                                                   | `self_managed`                                                                                                                                                                                                      | `confirm` is idempotent on its own `idempotencyKey` (derived from the payment id) and on the state check                                                                                               |
| Refund coordination (commerce adapter)                               | `…reservation.cancelled`                                  | create a refund request                                                 | `self_managed`; rationale: natural key `(tenant, externalRef, "refund")` unique in the adapter's table                                                                                                              | Unique constraint on the natural key                                                                                                                                                                   |
| Availability invalidation (`booking`)                                | `awcms.hr.shift.assigned`                                 | recompute the schedule-conflict read model                              | `runtime_effect_once`                                                                                                                                                                                               | The recompute is an upsert keyed by `assignmentId`, so a double run converges                                                                                                                          |
| Payroll posting (finance adapter)                                    | `awcms.hr.payroll.finalized`, `awcms.hr.payroll.reversed` | post (or reverse) a journal from an authorized read of the run's totals | `self_managed`; rationale: the journal posting has its own `Idempotency-Key` derived from `runId`, and a posted entry is immutable                                                                                  | The ledger's idempotency layer; the event carries **no amount**, so the totals come from a fresh read                                                                                                  |
| Commission payout hand-off (finance adapter)                         | `awcms.hr.commission.approved`                            | request payout from an authorized read                                  | `self_managed`; rationale: natural key `accrualId`                                                                                                                                                                  | Unique constraint on `accrualId` in the adapter                                                                                                                                                        |
| Shift notice (`hr_workforce`)                                        | `awcms.hr.shift.assigned`                                 | `WhatsappDeliveryPort.enqueue`                                          | `runtime_effect_once`                                                                                                                                                                                               | `idempotencyKey = "<consumer>:<envelope eventId>"`; consent and suppression checks are the port's                                                                                                      |
| WhatsApp dispatcher (`whatsapp_delivery`, **not** an event consumer) | n/a (reads its own outbox rows)                           | the provider call                                                       | **Delivery records, not the effect marker.** The outbox row is unique per `(tenant_id, idempotency_key)`; the claim is a `FOR UPDATE SKIP LOCKED` lease; each attempt is a row; the provider message id is recorded | At-least-once to the provider is acknowledged (ADR-0133 §5); a crash between the provider accepting and the row being finalised can re-send, which the recorded provider id lets reconciliation detect |

Three points that the table cannot hold:

1. **The two idempotency layers are different things.** The registry's marker
   makes the _handler_ run once per `(consumer, event)`. The port-level key
   (`enqueue`'s `idempotencyKey`, `confirm`'s `idempotencyKey`) makes the _effect_
   safe even if the marker were somehow absent (a `self_managed` consumer, a
   replay after a purge of the effect ledger). Both are cheap; neither replaces
   the other.
2. **WhatsApp is not an event consumer and must not become one.** Its handlers
   would run inside the dispatch transaction and call a provider, which ADR-0006
   forbids (ADR-0133 §3). Booking and hr reach it only through the port, in their
   own transaction or in a consumer's `handle`, where `enqueue` is one `INSERT`.
3. **A returned refusal inside a consumer is a successful handling.** A
   `refused` or `suppressed` result is recorded by the port; the consumer must
   not throw (that would retry a decision that will not change and eventually
   dead-letter it).

## 7. From provisional to live

The provisional document is `asyncapi/provisional/…provisional.asyncapi.yaml`.
Nothing reads it except `bun run asyncapi:provisional:check` (in the `check`
chain): the API reference generator, the registry parity test and the family
conformance manifest read only `asyncapi/awcms-domain-events.asyncapi.yaml`, so a
provisional event is **invisible to the live contract** and a mistake in it
cannot publish, register or break anything.

**The rule: an event lives in exactly one of two places.** Either the provisional
file, or the live pair (`asyncapi/awcms-domain-events.asyncapi.yaml` plus
`DOMAIN_EVENT_TYPE_REGISTRY` plus the producing module's `events.publishes`). The
check fails when a name is in both, so the move cannot be half done.

The implementation PR of each module, in one change:

1. Adds the event to `DOMAIN_EVENT_TYPE_REGISTRY` and to the producer's
   `module.ts` `events.publishes`.
2. Adds the channel to the live AsyncAPI file (a channel per event, the shared
   `DomainEvent` message, the producer named in the description) and bumps its
   `info.version` per the contract-versioning policy.
3. **Deletes the event from the provisional file** (channel and message). The
   check turns red until it does.
4. Refreshes the generated API reference (`bun run api:docs:generate`) and adds a
   changeset.
5. Adds the producer test the live parity test demands (registry ↔ channel ↔
   `events.publishes`), and, if the payload changed during implementation, the
   payload schema is written in the live file's own style at that point.

When the last event of a family has moved, the provisional file is deleted; when
the last of all has moved, the check, its test and the `package.json` entry go
with it.

Naming: events are `awcms.<area>.<entity>.<verb>`. The packs and ADR-0133 wrote
the shorthand without the prefix (`booking.reservation.*`, `hr.*`,
`whatsapp.message.*`); on the wire they carry `awcms.`. The check enforces
exactly four lowercase segments.

Payload rules the check enforces: every payload schema is closed
(`additionalProperties: false`); no property name contains a word for an amount,
payment state, personal data or free text (`amount`, `salary`, `payment`, `phone`,
`email`, `name`, `note`, `reason`, `body`, …). The `hr` events carry **no amount**
(a single-employee tenant would leak a salary through an "aggregate"); the
`booking` events carry **no payment state**; the `whatsapp` events carry ids and a
masked recipient only. Consumers de-duplicate on the envelope's `eventId`.

Versioning: each message pins `eventVersion` to `"1.0"`. A breaking payload change
after going live is a new `eventVersion` registered beside the old one, not an
edit.

## 8. Open items

- The final `BookingRefusal` union, WhatsApp port names and the exact hr payload
  field types (for example `kind`, `source`, `operation` enumerations) are fixed
  by each implementation PR; the provisional schemas leave them as strings where
  the packs list no closed set.
- `awcms.hr.*` producer-module mapping (`hr_workforce` / `hr_compensation` /
  `hr_payroll`) is confirmed when the first channel moves (ADR-0132).
- Whether any consumer in the table above ships in this repository or only in a
  downstream template is each module's admission decision, not this document's.
