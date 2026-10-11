🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0139-cross-channel-notification-orchestration-not-admitted.id.md)

# ADR-0139 — Cross-channel notification orchestration is not admitted (rejected for now)

- **Status:** Accepted. The decision it records is a **rejection**: orchestration is **not admitted, for now**. (The ADR status vocabulary in the ADR README has no `Rejected`; the ADR is accepted, its subject is not.)
- **Date:** 2026-10-12
- **Decision maker:** ahliweb (product owner)
- **Resolves:** the "notification orchestration is NOT admitted, pending a written value case (O11)" clause of [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.md) §7. This ADR is that written value case, and its answer is no
- **Related:** Issue #966; downstream `ahliweb/awcms-one` epic #280 item 33 and DoR owner decision O11 (answered 10 Oct 2026: orchestration is wanted _subject to a written value case and an upstream ADR_); [ADR-0006](0006-offline-first-sync-outbox.md), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md), [ADR-0074](0074-push-delivery-is-a-second-outbox.md), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md), [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.md) §15 (delivery channels)

**Docs-only.** No module, migration, OpenAPI path or AsyncAPI channel is added, changed or reserved by this ADR.

## Context

ADR-0133 admitted a WhatsApp-specific delivery capability and deliberately left three things out: **per-user channel preferences**, **cross-channel fallback** ("WhatsApp failed, send e-mail") and a **unified cross-channel status**. It bound two rules in the meantime: the delivery port is channel-specific (`WhatsappDeliveryPort`, never a `MessageDeliveryPort(channel, ...)` facade), and no module may implement automatic fallback between channels. The awcms-one owner then answered O11 as "wanted, subject to a written value case". Issue #966 asks for that case and an explicit accept or reject.

What exists in this repository today, as facts:

- **Live channels: two.** `email` (outbox, lease dispatcher, provider port, suppression list) and `push_delivery` (a second outbox, ADR-0074).
- **Admitted but not built: two.** `whatsapp_delivery` (ADR-0133) and an optional, off-by-default Telegram adapter (owner answer O10, which still needs its own ADR). No implementation of either exists.
- Each channel already has **its own queue, dispatcher, provider port, retry policy, circuit breaker and retention descriptor**. ADR-0133 §3 made "one queue per channel per deployment, never one per domain" binding.
- `workflow_approval` has its own notification port, unaffected by any of this.
- There is **no named consumer** with a cross-channel fallback requirement. Booking needs reminders and confirmations; hr_payroll needs shift and payslip notices that, by ADR-0132 and ADR-0133 §7, must never fall back to another channel at all. Neither has asked for "if X fails, try Y".

## Decision

**Cross-channel notification orchestration is not admitted. The product owner has decided to reject it for now.** Concretely:

1. No module, port, table, job or setting named or shaped as a notification orchestrator, a preference centre, a fallback engine or a unified delivery-status service is added.
2. The ADR-0133 rules stand unchanged: the WhatsApp port stays channel-specific; there is no `MessageDeliveryPort(channel, ...)` facade; **no module implements automatic fallback between channels**; no consumer adds its own queue.
3. Channel choice, preference and any fallback stay **where they are today: per module, explicit, in the caller.** A module that needs "remind by WhatsApp, else e-mail" decides that itself, enqueues through the e-mail or WhatsApp port (each its own queue), and keeps its own record of what it sent. That is a conscious, visible cost; it is accepted.
4. The question is **closed, not open-ended**: it reopens only when a trigger in §3 is met, and then by the smallest design in §4, not by redoing the analysis.

### 1. Why now is the wrong time: the value case, honestly

The value orchestration would deliver is real in the abstract: a person who dislikes WhatsApp is not messaged on it, a bounced e-mail still reaches them, and an operator sees one status per message instead of one per channel. The case against admitting it **today** rests on four facts, none of them an opinion about the idea itself:

- **The constraints in ADR-0133 are the hard part, and orchestration pulls against every one.** A channel-neutral entry point is exactly the multi-channel facade ADR-0133 refused. Cross-channel fallback has to observe one channel's failure and trigger another's enqueue, which is a coordinator sitting across the outboxes. Doing it **inside** a dispatcher would put a second provider call or a cross-queue write into the first channel's claim-send-finalise loop. Doing it **as** a coordinator with its own durable state is a fourth outbox-shaped table. ADR-0133 §3 spent a long section establishing that the repository already has one more queue than the constraint "no second outbox" literally allows, and that the rule that matters is one queue per channel. Orchestration would be the first feature to need a queue that belongs to no channel.
- **There are two live channels, not many.** Fallback between two channels is "e-mail or push", and push is a device notification, not an alternative for a message that must reach a person's inbox or phone number. The combinations that make orchestration pay (three or more interchangeable channels, a stable preference ordering across them) do not exist, and two of the four channels are not even built.
- **Per-module preference and fallback is cheap today and cheap to unwind.** Booking and hr_payroll each have a small, closed set of message classes, each with an obvious channel (and, for payroll, an obvious "no fallback"). A per-module preference column or setting is a few lines, is visible in that module's own review, and is deleted trivially if a shared mechanism later replaces it. A shared mechanism built before the second and third consumer is known tends to encode the first consumer's assumptions.
- **There is no named consumer asking.** The epic asks for the value case, not for a requirement. A cross-cutting capability built without a consumer cannot be tested against real traffic, and ADR-0021's admission criteria require one.

The honest summary: orchestration is a capability the platform may well want later, and it is the most expensive thing to retrofit **wrongly** (a facade or a fourth outbox is hard to remove once consumers call it), while remaining cheap to add **correctly** later because every channel keeps a clean, separate port today. Waiting costs a little duplicated per-module code; admitting it early risks the architecture ADR-0133 just fixed.

### 2. Options analysis

Four options were compared. Option A is chosen.

| Criterion              | A. Do not admit; per-module choice (chosen)                                                                                          | B. Orchestrator module with its own queue (a "notification hub")                                                                                                       | C. Multi-channel facade `MessageDeliveryPort(channel, ...)` over the existing queues                                                                      | D. Minimal policy resolver + event-driven fallback (the design in §4), built now                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advantages             | Nothing to build or maintain; keeps ADR-0133 intact; channel ports stay independently evolvable; each module's behaviour is explicit | One place for preference, fallback and status; consumers write one call                                                                                                | One entry point; callers need not know the channel; small to write                                                                                        | Smallest shared surface that still removes duplicated preference logic; no new queue; each channel keeps its port                                                      |
| Disadvantages          | Preference and fallback logic may be duplicated per module; no cross-channel status view; inconsistent behaviour is possible         | A fourth queue-shaped table with its own retry, retention and lease; a second path to every channel; the hub becomes a dependency of every domain                      | Refused by ADR-0133 §7 as the first step of orchestration; channel semantics (purpose, consent, template, address shape) differ so the parameter leaks    | Still needs a consumer to design against; policy and fallback rules are easy to get subtly wrong without one; one more registry to keep in sync                        |
| Security               | Best: each channel's consent, address masking and purpose rules are enforced in one place per channel                                | Worst: the hub sees every address and message class, must re-implement consent and the "never fall back for payroll / PII / security" rule, and is a high-value target | Weaker: one generic payload invites cross-channel PII leakage (a payslip notice or OTP reaching a lower-assurance channel because a failure triggered it) | Acceptable only with the hard rules in §4 (class-gated fallback, per-channel consent re-checked at the second enqueue); fallback is the riskiest feature and is opt-in |
| Performance            | Unchanged                                                                                                                            | Extra hop and extra write per message; a shared queue is a contention point across all domains                                                                         | Negligible overhead                                                                                                                                       | One policy read per enqueue (cacheable) and one event consumer; low                                                                                                    |
| Maintainability        | Simple; duplication is local and visible                                                                                             | Poor: three or four systems coupled by a coordinator with its own failure modes                                                                                        | Poor: the facade accretes channel-specific options until it is the union of all of them                                                                   | Good if kept to a resolver and a consumer; degrades if it grows a state machine                                                                                        |
| Scalability            | Scales with each channel independently, as ADR-0133 intends                                                                          | The hub's queue and dispatcher become the shared bottleneck                                                                                                            | Scales with the channels                                                                                                                                  | Scales with the channels plus one event stream                                                                                                                         |
| Operational complexity | Lowest: N independent dispatchers and breakers                                                                                       | Highest: another dispatcher, lease, retention descriptor, dead-letter handling and runbook                                                                             | Low to medium                                                                                                                                             | Medium: the failure-event path and its idempotency need monitoring                                                                                                     |
| Long-term implications | Leaves the door open to D without ever having built B or C; the cost of waiting is bounded                                           | Hard to remove once consumers call it; entrenches a non-channel queue ADR-0133 §3 refused                                                                              | A facade is the most likely way for the "no fallback / no cross-channel PII" guarantees to erode silently                                                 | Becomes the default shape the first time a trigger is met, which is why it is specified now and not built                                                              |

Option A wins on every criterion the repository weights most (security, operational simplicity, preserving ADR-0133), and loses only on convenience, which is cheap to pay while there are two live channels and no named consumer. B and C are rejected on ADR-0133's own grounds. D is the right answer **when its premise exists**, and is recorded in §4 so that day does not start from a blank page.

### 3. Re-opening triggers (all must hold)

This ADR is superseded by an admitting ADR only when **every** condition holds:

1. **At least three channels are live** (built, deployed and used in production by at least one tenant), not merely admitted. Today: two live, two admitted. Telegram counting as the third does not suffice if it carries only operator or non-user-facing traffic.
2. **A named consumer module or product states a concrete cross-channel requirement**, in writing, with the message class and the failure it must survive: a real "if channel X fails or is not preferred, deliver on channel Y" need, not a hypothetical. The consumer's issue is linked from the admitting ADR.
3. **That requirement cannot be met per-module** without duplicating non-trivial logic into at least two modules (the duplication is shown, not asserted).
4. **The consent and message-class rules are settled for every channel involved**, including the ADR-0133 §7 rule that payroll, personal-data and `security`-class messages never fall back.
5. A security review is scheduled, because fallback is a cross-channel data-flow decision (the sensitive-module rule in `AGENTS.md`).

Meeting a trigger **reopens the question**; it does not itself admit anything. The admitting ADR must reuse §4 as its starting point and justify any departure.

### 4. The smallest design that would be acceptable if reopened

Recorded so the next reader does not redo the analysis. It is a **specification of constraints**, not a plan to build; every name is provisional.

- **No facade and no new outbox.** Each channel keeps its own port and its own single queue (ADR-0133 §3). Nothing in the design adds a queue or a dispatcher.
- **A policy resolver, read-only, as a capability port (ADR-0011).** `resolveChannels(tenantId, recipient, messageClass) -> ordered list of {channel}`: it **returns a decision and sends nothing**. Inputs: the recipient's per-class channel preference and opt-outs (a small per-principal/profile table with RLS, default-deny, masked in logs), the tenant's enabled channels and the message class. The caller then enqueues through the chosen channel's own port. A consumer that does not call the resolver behaves exactly as today.
- **Fallback only as a domain-event consumer, never inside a dispatcher or a transaction.** A channel already emits a terminal `*.delivery.failed` event. A fallback consumer, declared in its owning module's descriptor (ADR-0134), reacts to the terminal failure of channel N and enqueues **one** message to channel N+1 through that channel's port, with an idempotency key derived as `{originalKey}:{channelN+1}` so a replayed event cannot send twice. **At most one fallback hop, no loops**, no retry of the original channel.
- **Fallback is opt-in per template/message class and denied by class.** A message class declares an allowed fallback channel list or none; the default is none. **Payroll, personal-data, OTP and `security`-class messages can never declare one** (ADR-0133 §7), enforced by a registry check in CI, not by convention. Consent and purpose are re-checked against the fallback channel at the second enqueue, never inherited from the first.
- **Unified status as a read-model, not a source of truth.** A projection keyed by the caller's `correlationId` joins the per-channel terminal states for display (a reporting-style projection). Each channel's own queue row remains authoritative; the projection can be rebuilt and holds no recipient address in clear.
- **Off by default**, behind a flag, with the existing PII rules: events carry who and what, never a phone number or address; every preference change and every fallback decision is audit-logged with redaction.
- **Tests required up front:** fallback never fires for a denied class; a replayed failure event enqueues once; fallback consent is checked independently; no second queue table exists (a registry check); the resolver is a pure read and sends nothing.

### 5. Security, performance and operational notes for the decision itself

- **Security:** the rejection removes the largest new risk (an automatic cross-channel data flow). Until reopened, a payroll or personal-data message cannot reach a different channel because of a failure, because nothing is able to route it.
- **Performance and scalability:** no change.
- **Operations:** nothing to deploy, monitor or run books to write.
- **Maintainability:** the cost is bounded and visible duplication in consumers; the mitigation is that each consumer's channel choice is reviewed in its own module, where the message class and consent facts live.

## Consequences

- Issue #966 is closed by this ADR; epic awcms-one #280 item 33 is closed as **rejected for now**, with the §3 triggers as the reopening condition.
- The owner's O11 is answered: orchestration remains wanted in principle, the written value case concludes it is premature, and the product owner accepted that conclusion. Nothing in awcms-one should schedule work that assumes a notification orchestrator.
- ADR-0133 §7 and `docs/awcms/hr-payroll.md` §15 are updated to point here. The WhatsApp port stays channel-specific and the no-automatic-fallback rule stands.
- **Cost of this decision:** modules that want a preferred channel or a fallback implement it themselves and must not call it "orchestration"; behaviour across modules may differ. Accepted until a trigger fires.
- Nothing is built and nothing is reserved: no migration, permission, OpenAPI path or AsyncAPI channel.

## Alternatives rejected

- **A notification hub module with its own queue (Option B).** A fourth outbox-shaped table, a second path to every channel and a dependency of every domain. Refused on ADR-0133 §3 grounds.
- **A `MessageDeliveryPort(channel, ...)` facade (Option C).** Refused by ADR-0133 §7; it erodes the per-channel consent, purpose and masking rules.
- **Building the minimal design now (Option D).** Correct in shape but premature: there are two live channels and no named consumer, so its fallback and preference rules would be designed against imagined traffic. Specified in §4 instead.
- **Admitting preferences only (a preference table without fallback).** Tempting as "the safe half", but a preference store with no consumer calling it is dead data with a retention and subject-rights cost (ADR-0094); it belongs to the same reopening, not before.
- **Deferring the decision again without a written outcome.** It leaves #966 open and the next reader to repeat this analysis, which is the failure this ADR exists to prevent.
