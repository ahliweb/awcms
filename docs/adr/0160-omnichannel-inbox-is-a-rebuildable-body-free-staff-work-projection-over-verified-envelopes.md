🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.id.md)

# ADR-0160 — The omnichannel inbox is a rebuildable, body-free staff work projection over verified envelopes

- **Status:** Proposed
- **Date:** 2026-11-11
- **Decision maker:** ahliweb (owner). **Not decided.** This ADR records what Issue #1164 needs that [ADR-0150](0150-inbound-omnichannel-events-enter-as-verified-redacted-envelopes-with-no-generic-interactions-store.md) §1 does not allow as written ("a unified inbox is a presentation-only projection … it never writes"), so that the owner can accept, narrow or reject it. An agent cannot change an Accepted owner decision inside a pull request; ADR-0150 is therefore **unchanged** until this one is accepted.
- **Refines (when accepted):** ADR-0150 §1 and N6, only as far as §2 below; every other ADR-0150 invariant (N1 to N5, N7 to N10) and every ADR-0148 invariant (I1 to I13) stays binding.
- **Related:** Issue #1164; [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (accounts, business scope as brand), [ADR-0152](0152-customer-telegram-engagement-is-a-separate-admitted-context-telegram-delivery-stays-staff-only.md) (the Telegram envelope), [ADR-0155](0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.md) (the website envelope), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md) (consumers), [ADR-0154](0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.md) (realtime topics), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md).

## Safe to merge before this is accepted

The module this ADR describes ships **`experimental` and switched off** (`OMNICHANNEL_INBOX_ENABLED` unset): every route answers `404`, the projector consumer does nothing, and the SLA job exits without touching a tenant. Merging the code changes no deployment's behaviour. Accepting this ADR is what makes switching it on legitimate.

## Context

Verified on `main` at 11 November 2026:

- Two verified inbound envelopes exist: `awcms.telegram_engagement.interaction.received` / `consent.changed` (ADR-0152; ids, kinds and classes, never a Telegram id or text) and `awcms.website_engagement.submission.received` / `withdrawn` (ADR-0155; an opaque submission id and facts about it, never the visitor's details). No WhatsApp inbound route exists; `whatsapp_delivery` is outbound only.
- ADR-0150 §1 admits no upstream conversation, thread or message store and calls the unified inbox "presentation-only … it never writes". Its re-open triggers are: two consumers in this repository needing the same persisted conversation state; a platform needing a server-held thread to reply; or the commerce inbox ceasing to be the authority.
- Issue #1164 asks for **assignment to staff, assignment history, tags, a conversation status, first-response and next-response SLA with a working calendar and holidays, and SLA notification to staff**. None of that is in an envelope: it is **staff work state**, authored by people in this tenant, and it has to persist between two page loads. A projection that never writes cannot hold "this conversation is Ani's".
- AWCMS is used directly as a template (ADR-0034). A deployment without `awcms-one` has no commerce inbox at all; for it the "downstream authority" ADR-0150 §8 relies on does not exist.

So the honest reading is that the re-open trigger is **not** strictly met as worded (there is one consumer, not two), but the premise behind §1 ("the inbox needs no write path") is false for the requirement the owner has since written down in #1164. That is a decision for the owner, which is why this ADR is `Proposed`.

## Decision (proposed)

### 1. A narrow module, `omnichannel_inbox`

A `system` module, `experimental`, off by default at the deployment (`OMNICHANNEL_INBOX_ENABLED`), module and tenant level. It depends on `channel_accounts` (scope and visibility rules) and `domain_event_runtime` (the consumer), and **imports nothing** from `telegram_engagement` or `website_engagement`: it reads their published envelopes only.

### 2. What it persists, and what it never persists

| Persisted                                                                                                                                                                                                                                               | Never persisted                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **conversation row** keyed by `(source kind, opaque source reference)`: the envelope's account-scoped contact id or submission id, the channel account and its business scope, first/last inbound time, customer state (active, opted out, withdrawn) | A message body, a `content_ref`, a sender address, a phone number, an e-mail address, a Telegram id, a name, a username, media                                                |
| **Staff work state**: status (`open`, `pending`, `resolved`, `closed`), assignee, tags, first/last response time, SLA due time and breach stamp                                                                                                         | A free-text internal note (deferred: it is free text about a customer and needs its own retention decision)                                                                   |
| An **append-only activity ledger** of staff and system actions (assigned, unassigned, assignee revoked, status changed, response recorded, tag added/removed, SLA breached), with ids and closed codes only                                             | Any reply. The inbox **sends nothing** and has no `send(channel, payload)`: a reply goes through the arrival channel's own queue, consent and capability checks (ADR-0150 §7) |
| Per-tenant tag catalogue and SLA policies (timezone, working hours per weekday, holidays, first/next response minutes), optionally per business scope                                                                                                   | A customer master, a contact merge, a cross-channel identity (ADR-0148 I7)                                                                                                    |

The envelope-derived columns are a **projection**: they are written only by the consumer, are idempotent by value (the earliest first-inbound time, the latest last-inbound time, a customer-state change applied only if its event sequence is newer), and can be **rebuilt** from `awcms_domain_events` by replaying the four event types. The staff work state is authored and is not rebuilt; a rebuild never touches it.

### 3. Access (default-deny, the channel-accounts confinement rule)

- Permissions: `conversations.read`, `conversations.update` (status, tags, record a response), `conversations.assign` (high-risk: idempotent, audited), `tags.configure`, `sla_policies.read`, `sla_policies.configure`, `projection.configure` (rebuild; high-risk).
- A conversation carries its channel account's business scope (a brand). A caller who is **scope-confined** (any active, non-tenant scope assignment that has not ended, **including one that has not started yet**, the #1171 / #1270 fail-closed rule) sees only conversations whose scope the chokepoint says they cover; a **tenant-wide** conversation (a tenant-wide account, every website submission) is hidden from them. Unknown, foreign and invisible are one `404`.
- An **assignee** must be an active tenant user holding `conversations.update` on a tenant-wide grant, and if they are scope-confined, an active, started assignment on the conversation's scope or an ancestor of it. A tenant-wide conversation can be assigned only to an unconfined person. The same predicate is re-checked by the SLA job: an assignee who lost it is **unassigned** with an `assignee_revoked` activity row, so a revoked person stops receiving SLA mail.
- RLS `FORCE` on every table; the activity ledger is append-only for the runtime role.

### 4. SLA

- A policy has a first-response and a next-response budget in **business minutes**, an IANA timezone, working hours per weekday and a holiday list. A due time is computed by walking working windows in the policy's zone (DST-safe), skipping holidays and closed days, bounded to 400 days; a policy with no working window is refused at write time.
- The clock starts at the **server receipt time** of the first unanswered inbound envelope (`receivedAt`), never a provider-supplied time. Because the inbox sends nothing, "a response" is a staff action, `POST …/responses`, recorded after replying through the channel's own route. Consuming an outbound "reply queued" event instead is a follow-up for the channel modules (none publishes one today).
- The SLA job (`omnichannel-inbox:sla`, pinned Bun, `awcms_app`, one transaction per tenant, a failure in one tenant never stops the others) marks breaches once and notifies **the assignee only**, through the existing `workflow_notification` port (the e-mail outbox); a missing template is a silent no-op. Nothing is sent to a customer.

### 5. Retention, subject data

The conversation row holds only opaque references and is purged by `data_lifecycle` on `last_inbound_at` (default 365 days, 30 to 1095); its activity and tag links go with it. A withdrawn website submission marks the conversation `withdrawn` at once. A rebuild replays only events inside the retention window, so it does not resurrect a purged conversation. A customer is unreachable by subject (they have no tenant user); the staff stamps are severed with the subject row (ADR-0094).

### 6. Realtime

No realtime topic is added. ADR-0154's registry names "inbox hint" as the entry the inbox adds; doing so needs a snapshot route, an SSE route and a topic permission and is a follow-up.

## Options considered

| Criterion         | **A. Narrow staff work projection (proposed)**   | B. ADR-0150 as written (no writes) | C. Generic `interactions` store                                  |
| ----------------- | ------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| Meets #1164       | Assignment, tags, status, SLA, history           | No: nothing to hold an assignment  | Yes, and far more                                                |
| Data minimisation | Opaque ids and closed codes only; no body        | Best                               | Holds bodies and identities of every channel (ADR-0150 rejected) |
| Authority         | Not a customer or message authority; rebuildable | n/a                                | Becomes the system of record by accident                         |
| Reversibility     | Drop the module; nothing else depends on it      | n/a                                | Hard                                                             |

## Consequences

- **Positive:** a deployment without a downstream inbox gets a working staff queue without holding a single message body; the projection is disposable and rebuildable.
- **Negative:** the "response" is a staff assertion until the channel modules publish an outbound event; website submissions are tenant-wide, so a brand-confined agent sees none of them.
- **Human sign-off still needed:** the owner, for this ADR; the controller, for the default retention; the e-mail template text for the SLA notice.

## Open questions for the owner

- **Q1.** Accept the refinement of ADR-0150 §1 for staff work state only (recommended), or keep ADR-0150 as written and drop #1164's assignment and SLA scope?
- **Q2.** Should visibility also require the caller's channel-account assignment (owner/operator/viewer), on top of the inbox permission and the business scope? Proposed: no; the inbox permission plus scope is the boundary, and the account assignment governs operating the account.
- **Q3.** Should an unassigned breach notify someone (for example holders of `conversations.assign`)? Proposed: no in this phase; the list filters unassigned breaches.
- **Q4.** Internal notes: admit them later with their own retention and redaction, or never?
