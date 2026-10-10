🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0133-generic-delivery-capability-whatsapp-promotion.id.md)

# ADR-0133 — WhatsApp delivery is promoted to a generic upstream capability (`whatsapp_delivery`); Telegram and orchestration are deferred

- **Status:** Accepted
- **Date:** 2026-10-08
- **Decision maker:** ahliweb
- **Extends:** [ADR-0006](0006-offline-first-sync-outbox.md) (no network call inside a DB transaction), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md) (consumers depend on a neutral port), [ADR-0074](0074-push-delivery-is-a-second-outbox.md) (the lease-outbox precedent and the "credentials per deployment" rule), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md) (every table answers the data-subject question)
- **Related:** Issue #917 (this ADR); downstream `ahliweb/awcms-one#280` (epic) item A4, [awcms-one ADR-0040](https://github.com/ahliweb/awcms-one/blob/main/docs/adr/0040-aw-business-platform-capability-ownership-and-boundaries.md) (placement: generic delivery goes upstream first), awcms-one ADR-0017 (the commerce-owned WhatsApp port) and ADR-0034 (document delivery rides that outbox); siblings admitted in parallel: booking (ADR-0131), hr_payroll (ADR-0132), consumer registration (ADR-0134)

**Docs-only.** No module code, migration, OpenAPI path or AsyncAPI channel is added by this ADR. Implementation is a separate issue, gated on the checklist in §9.

## Context

Three upstream modules are about to need to send a WhatsApp message: booking (reminders, confirmations), workforce/hr_payroll (shift and payroll _notices_) and, already today in the downstream template, `commerce` (customer OTP, order-paid, campaigns, receipt/invoice delivery). Upstream has two delivery capabilities:

- `email` — outbox + lease dispatcher + `EmailProvider` port + Mailketing adapter + categories/templates + suppression list.
- `push_delivery` — a **second** outbox (ADR-0074) with FCM v1 and Web Push/VAPID adapters.

WhatsApp exists only downstream: `awcms-one`'s `commerce` module owns a `WhatsappProvider` port (`send`, `healthCheck`), Fonnte / Meta Cloud / `log` adapters, the tables `awcms_commerce_whatsapp_messages` and `awcms_commerce_whatsapp_delivery_attempts` (migrations `sql/9xx`), the jobs `commerce:whatsapp:dispatch` and `commerce:whatsapp:purge`, and a template registry (`commerce.customer_otp`, `commerce.order_paid`, `commerce.campaign`, `commerce.document`). Its credentials are per deployment and read from the environment; it is wrapped in `withTimeout` and `getProviderCircuitBreaker`; the provider is called outside any transaction. That is a sound implementation, in the wrong place for a capability that more than one domain needs: upstream booking and hr_payroll cannot depend on a module that exists only in a derived template, and a derived template that grows its own copy per domain is the thing epic #280 is designed to avoid.

The constraint in the issue is **no second outbox**. Read literally that cannot be satisfied (ADR-0074 already made push a second one, with reasons that still hold), so §3 states precisely what the constraint means and what is reused.

## Decision

### 1. Option (a): a generic upstream module `whatsapp_delivery`, beside `email` and `push_delivery`

Compared on the axes the issue names:

| Axis                   | **(a) Promote to a generic upstream capability; commerce keeps a compatibility adapter until it migrates (chosen)**                                                                                                                             | (b) Stable upstream port only; the commerce implementation remains the adapter during migration                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security               | One implementation of the credential path, circuit breaker, masking, consent check and no-I/O-in-transaction rule to audit, in the repo that has the security gates (`bun run check`, RLS `FORCE`, ABAC default-deny, data-lifecycle registry). | The rules would be enforced by a **port contract** upstream and by **code upstream cannot see or test** downstream. A port with no upstream implementation is a promise the CI cannot check; the rules drift in the adapter first.                                            |
| Performance            | Booking and hr enqueue with an in-process call and a single INSERT in their own transaction; no cross-repo hop. Same claim/lease dispatcher shape already measured for email and push.                                                          | Identical at runtime, but upstream modules and their tests need a fake adapter, so the real hot path is never exercised upstream.                                                                                                                                             |
| Maintainability        | One owner for providers (Fonnte/Meta), templates, retry policy. Upstream is the system of record; downstream consumes by subtree sync, the path inventory, tax and procurement already took (ADR-0126/0127/0128).                               | The dependency points the wrong way: upstream calls an adapter that lives in a template that depends on upstream. Every fix is made downstream and back-ported, which ADR-0034 (family direct-use) and ADR-0055 (development confined to awcms/awcms-astro) exist to prevent. |
| Scalability            | Per-tenant tables, `(tenant_id, status, next_attempt_at)` claim index, same shape as `awcms_email_messages`. More domains add rows, not queues or workers.                                                                                      | Same shape, but a deployment without `commerce` (booking-only, hr-only) has **no WhatsApp at all**, so every such deployment must carry commerce to send a reminder.                                                                                                          |
| Compatibility          | Commerce keeps working throughout: its public functions (`enqueueWhatsappMessage`, the dispatch/purge jobs, the admin screens and API) stay until the end condition in §6; they become a thin adapter over the port.                            | Zero change for commerce — but also zero progress on the problem.                                                                                                                                                                                                             |
| Operational complexity | One new job pair (`whatsapp:dispatch`, `whatsapp:purge`) and, for a time, the old commerce pair draining. Bounded by the end condition. Ops already know the lease/retry shape.                                                                 | No new job, but permanently two places where WhatsApp can be stuck, retried twice or misconfigured.                                                                                                                                                                           |
| Long-term              | Telegram, if ever admitted, is a sibling adapter or module on the same pattern; commerce shrinks. The migration has a defined end.                                                                                                              | Commerce becomes a de-facto platform service that other modules must depend on, inverting the DAG epic #280 draws (ADR-0040: "no domain depends on a channel, commerce above generic infrastructure"). The "temporary" adapter has no natural end and becomes permanent.      |

**Decision: (a).** The port in (b) is not discarded: it is the contract in §8, and it is what makes (a) migratable, because commerce's compatibility adapter implements the same shape in the opposite direction (commerce calls the port). Choosing (a) means the port has a real upstream implementation, not that there is no port.

### 2. What is promoted, and what is not

Promoted into `src/modules/whatsapp-delivery/` (key `whatsapp_delivery`, `type: "system"`, feature-flagged **off** by default, `WHATSAPP_ENABLED=true` to enable, exactly as `PUSH_ENABLED`/email):

- the provider port (`send`, `healthCheck`) and result shape (`ok` / `retryable` / `skipped`), with Fonnte, Meta Cloud and `log` adapters;
- the per-tenant queue and the per-attempt ledger, the claim/send/finalise dispatcher, retry/backoff, the purge job;
- a template registry keyed by `templateKey`, with a versioned variable allow-list;
- a suppression/consent record and the purpose check (§4);
- an admin observability surface (queue diagnostics, cancel, suppression CRUD), following `email`'s precedent — required by ADR-0021 before the module may be `active`.

**Not promoted**: the commerce templates (`commerce.customer_otp`, `commerce.order_paid`, `commerce.campaign`, `commerce.document`) and the commerce domain logic that decides _when_ to send them. They are owned by their domain and registered into the upstream registry as module-prefixed keys. Upstream ships no business wording except a neutral `system.notice` template.

### 3. "No second outbox", stated precisely

`push_delivery` **is** a second outbox (ADR-0074), and ADR-0074's reason applies to WhatsApp unchanged: `awcms_domain_events` runs claim, handler and finalise in one transaction by design, and a WhatsApp provider is an HTTP call, which ADR-0006 forbids inside a transaction. WhatsApp therefore cannot be a domain-event consumer, and it does **not** join `awcms_domain_events`.

It also does not join `awcms_email_messages`. That table's row is shaped for e-mail (recipients, attachments, category, suppression by address); stretching it to carry a channel discriminator would make both dispatchers claim from a mixed table and make e-mail retry policy a WhatsApp concern. ADR-0074 rejected the same generalisation for the same reason.

So the honest answer is: **WhatsApp gets a channel queue table, and that is a third outbox table in the repo.** What the constraint is _for_ is the rule below, which this ADR makes binding:

> **One queue per channel per deployment, never one per domain.** Booking, hr_payroll, commerce and every future consumer enqueue into `whatsapp_delivery`'s single queue through its port. No consumer module adds its own WhatsApp (or e-mail, or push) table, dispatcher, or provider call. The thing being refused is a **second WhatsApp queue** — in particular the one that would exist if commerce's table and the new upstream table both stayed live — and a fourth, fifth, sixth queue from each new domain.

A channel table is not a new outbox _mechanism_. What is reused, and by reference not by copy where code can be shared:

- **Lease semantics**: claim with `FOR UPDATE SKIP LOCKED`, lease by reusing `next_attempt_at` (no new column), send outside the transaction, finalise per row — the shape of `email-dispatch.ts`, `object-dispatch.ts`, `purge-queue.ts` and the push dispatcher. The pure helpers (backoff calculation, lease constants, attempt accounting) are imported from the existing shared locations where they are shared today; this ADR does not require extracting a new shared abstraction first, and does not forbid doing so in the implementation PR if a fourth copy would otherwise be written.
- **Retry/backoff and the circuit breaker**: `getProviderCircuitBreaker(providerKey)` inside the adapter only, so a per-message rejection (bad number, bad template) never trips it; `retryable` / `skipped` semantics as in `EmailDeliveryResult`.
- **Retention**: every table of the module carries a descriptor in the `data_lifecycle` registry from day one (ADR-0074 §3: `TABLES_PREDATING_THE_RULE` is closed and `BOUNDED_BY_DESIGN` is empty). The purge uses the **`delegated`** form with explicit terminal statuses and `updated_at` as the cursor, never age alone — a generic age-based delete aimed at a queue deletes messages still waiting out a provider outage.
- **Credentials per deployment** (ADR-0074 §5, awcms-one ADR-0017 D1), the **three-column discipline** for addresses (`recipient` / `recipient_hash` / `recipient_masked`, the raw column named in one file only), and the **same-origin/no-token-in-events** rule: a domain event carries _who_ and _what_, never a phone number.

What is **not** reused: the `awcms_domain_events` consumer path, the e-mail table, and any per-domain queue.

### 4. Purpose classes and consent

Every message carries a `purpose` set by the **caller's template registration**, not by free input per message: a template key is registered with exactly one purpose, and a caller cannot send a `marketing` template as `transactional`.

| Purpose         | Examples                                                                                | Consent                                                                                                                                                         | Suppression / opt-out                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transactional` | booking confirmation/reminder, receipt, order status, shift notice (no PII, no amounts) | No marketing consent. The recipient defaults to the source record's own subject; any other recipient is a separate permission (awcms-one ADR-0034 D5).          | Honours the channel **suppression list** (hard failures, "stop" replies, number reassigned). Marketing opt-out does not hide a transactional message; a hard bounce does stop it. |
| `security`      | OTP, login/step-up code, account-change alert                                           | None, and a marketing opt-out never blocks it. Reaching it is the point.                                                                                        | Honours hard-failure suppression only. Never batched, never in a campaign.                                                                                                        |
| `marketing`     | campaign, promotion, re-engagement                                                      | **Explicit, per recipient, per channel, recorded opt-in** with source and time. Checked at enqueue **and again at dispatch**, so a withdrawal lands in minutes. | Opt-out is immediate and wins over everything queued. Sending to a number with no recorded consent is refused (`CONSENT_REQUIRED`), not silently skipped.                         |

**Consent is independent of segment membership.** Being in a customer segment, a loyalty tier, a CRM list or a campaign audience never implies consent; segments narrow _who is eligible to be asked_, the consent record decides _who may be sent to_. The marketing check joins the consent table, not the segment. A segment definition changing can therefore never turn a non-consenting person into a recipient.

Security-class specifics (they carry secrets and are time-bound):

- `expiresAt` is mandatory. A message past it is **expired, not retried late** — an OTP that arrives after its validity is worse than none.
- Any variable that is a secret (the OTP code) is **cleared from the queue row on reaching a terminal state** and is never written to attempts, audit, logs or events. Providers that need the value at send time (Meta's OTP template parameter) receive it in memory from the claimed row.
- Per-recipient and per-tenant rate limits apply at enqueue; they are a security control as well as a cost control.
- No cross-channel fallback is performed by this module (§7).

**Payroll and personal data.** An hr_payroll message is `transactional` and is a **notice only**: it says that something is available, with at most a same-origin link to an authenticated page. It never carries salary, deductions, bank details, tax identifiers, national IDs, or health data in the body or variables. This is enforced by the template's variable allow-list (a variable not on the list is dropped by the renderer, as in `email`), not by caller discipline.

### 5. Provider rules (binding on the implementation)

1. **Credentials from the environment only**, one set per deployment, never per tenant (a tenant-supplied token lets one tenant's admin make the deployment speak as someone else — ADR-0074 §5). Never stored plaintext in the database, never in logs, audit rows, events or error messages. Multi-line or JSON-shaped values arrive base64, because `scripts/validate-env.ts` parses `.env` line by line. The provider is selected by env (`WHATSAPP_PROVIDER=fonnte|meta|log`), with `log` the default so a missing provider degrades to "recorded, not sent", never to a crash.
2. **No network I/O inside a DB transaction** (ADR-0006). Enqueue is one INSERT in the _caller's_ transaction (so a rolled-back booking never sends a reminder); the dispatcher claims in a short transaction, commits, calls the provider, then finalises per row in a new one.
3. **Bounded provider calls**: every call wrapped in `withTimeout`; `getProviderCircuitBreaker` in the adapter; an open breaker returns `skipped`, so no attempt is recorded and no retry is spent.
4. **Retry/backoff**: `retryable` for timeout/429/5xx, terminal for a 4xx rejection of the message; capped attempts with exponential backoff and jitter; a terminal `failed` is a state the caller can read, not an exception.
5. **Idempotency**: enqueue takes a caller-supplied idempotency key (unique per `(tenant_id, idempotency_key)`); a replay returns the existing message without inserting. The dispatcher claim is lease-based so a crashed worker's rows are re-claimable and a row is never sent by two workers at once. At-least-once to the provider is acknowledged; the provider message id is recorded to detect a duplicate on reconciliation.
6. **Masking**: the phone number is normalised to E.164, stored in the raw column, hashed (`recipient_hash`) for suppression lookups and duplicate detection, and masked (`recipient_masked`) everywhere else — admin lists, audit rows, logs, events and error text. No response other than the single-message reveal path (if one is ever added, as a separate audited permission with `no-store`) carries the raw number.
7. **Redaction at rest**: the rendered `body` is the sensitive part of the row; the purge job and the data-subject erasure path (ADR-0094) both address it, and the terminal-state clearing in §4 applies to secrets.
8. **Inbound callbacks** (delivery receipts, "stop" replies) are an open question (§10), not decided here; if built, they follow awcms-one ADR-0017 D2 (opaque per-tenant endpoint token, signature verified timing-safe, replay protection by unique key) and never resolve a tenant from the payload.

### 6. Migration path and the END CONDITION of the commerce compatibility adapter

Phases (each its own PR; none starts until the previous merged):

0. **This ADR** (docs only).
1. **Upstream implementation** (a later issue): `whatsapp_delivery` lands inert (flag off), with its own tables, jobs, adapters, admin surface, OpenAPI/AsyncAPI. Upstream consumers (booking, hr_payroll) may call the port.
2. **Downstream sync + adapter**: awcms-one syncs the subtree; commerce's `enqueueWhatsappMessage` becomes a thin adapter that calls the port and registers the `commerce.*` templates. A per-tenant mode (`legacy` | `upstream`) selects where **new** messages go.
3. **Cutover per tenant**: flip to `upstream`. **No dual write and no row copying**: in-flight rows in the old table are drained by the old dispatcher to a terminal state; only new messages enter the new queue. Two live queues for one tenant at once is exactly the "second WhatsApp queue" this ADR refuses, so a tenant is in exactly one mode at a time, and the flip happens only when that tenant has no non-terminal rows in the old queue (the flip waits for the drain).
4. **Removal.**

**End condition (all must hold; then the adapter and the legacy path are deleted, not left dormant):**

1. Every commerce caller — customer OTP, order-paid, campaigns, and document delivery (awcms-one ADR-0034) — enqueues through the upstream port, verified by a downstream test that fails if a commerce file imports its own WhatsApp table or provider.
2. Every tenant on every deployment is in `upstream` mode, and `awcms_commerce_whatsapp_messages` has **zero non-terminal rows**.
3. The old retention window has elapsed for terminal rows, or they have been purged by `commerce:whatsapp:purge`; the delivery-attempts ledger likewise.
4. `commerce:whatsapp:dispatch`, `commerce:whatsapp:purge`, the commerce-owned WhatsApp admin screens/API paths and the `legacy` mode flag are removed, with the API paths first redirected or aliased to the upstream ones for **one minor release** and announced in the changelog.
5. A final downstream migration drops the two legacy tables (a restore-class decision recorded in the downstream ADR, not a `down` migration).

**Backstop:** the adapter is removed no later than the **second minor release of the downstream template after the release that first ships the `upstream` mode (step 2)**; if the conditions above are not met by then, the decision to extend it needs a new ADR with a new date. A compatibility adapter without a dated end is the failure mode option (b) has by construction, and this ADR does not accept it for (a).

### 7. Deferred: Telegram (owner decision O10) and notification orchestration (O11)

**Telegram is deferred, not decided.** It depends on downstream owner decision O10 (whether to build it at all, and for which message classes). This ADR neither admits nor rejects it. Recorded constraints _if_ it is ever built, so a future ADR starts from them: off by default (flag, no provider = no module); explicit chat authorization (a chat is bound to a profile or tenant by a deliberate, audited, revocable act — a bot cannot message a chat that merely contains it); and **never a fallback for payroll or personal data** — hr_payroll notices, anything carrying PII, and `security`-class messages must not reach Telegram because WhatsApp failed. Such an ADR would also have to answer the credential and group-chat leakage questions it creates; none is answered here.

**Notification orchestration is NOT admitted**, pending a written value case (O11): per-user channel preferences, cross-channel fallback ("WhatsApp failed, send e-mail"), and a unified cross-channel status are not part of this capability. Consequences that this ADR makes explicit so they are not smuggled in: the port in §8 is **WhatsApp-specific** (`WhatsappDeliveryPort`), not a `MessageDeliveryPort(channel, …)` multi-channel facade — a facade with a channel parameter is the first step of orchestration; callers that want e-mail call the e-mail port; and no module in this repo may implement automatic fallback between channels. `workflow_approval`'s existing notification port is unaffected.

**Update (2026-10-10): owner answers recorded, this ADR unchanged.** The awcms-one owner answered O10 and O11. **O10:** Telegram is admitted as an optional, off-by-default adapter. **O11:** notification orchestration is wanted, subject to a written value case and an upstream ADR. Taken faithfully, this changes who decides, not what this repository has accepted: Telegram is still **not admitted here** until its own ADR/issue exists, and that ADR starts from the constraints recorded above (off by default, explicit chat authorization, never a fallback for payroll or personal data). Orchestration is still **not admitted** until the value case and its ADR exist; the WhatsApp-specific port (§8) and the rule that no module implements automatic fallback between channels stand until such an ADR amends them.

### 8. The delivery port contract (what booking and hr call)

Shape only; names are **provisional** and are fixed by the implementation ADR/PR (no code now). A capability port per ADR-0011, in `src/modules/_shared/ports/`, with the module's application layer as the adapter:

```ts
type WhatsappPurpose = "transactional" | "security" | "marketing";

type WhatsappRecipient =
  | { kind: "profile"; profileId: string } // resolved inside the module from profile_identity
  | { kind: "address"; phone: string }; // direct, e.g. a guest; E.164-normalised on entry

type EnqueueWhatsappInput = {
  tenantId: string;
  templateKey: string; // module-prefixed, e.g. "booking.reminder"; registered with ONE purpose
  variables: Record<string, string>; // filtered by the template's allow-list
  recipient: WhatsappRecipient;
  idempotencyKey: string; // required
  correlationId?: string; // the caller's record id, for reading status back
  notBefore?: Date; // scheduled send (reminders)
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
  /** One INSERT inside the CALLER's transaction. No network I/O. */
  enqueue(
    tx: TenantTx,
    input: EnqueueWhatsappInput
  ): Promise<EnqueueWhatsappResult>;
  /** Reads the outbox row back by correlation id; never copied into the caller's tables. */
  getStatusByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<WhatsappStatus[]>;
  /** Cancels a still-queued message (booking cancelled before the reminder). No-op once sent. */
  cancelByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<number>;
}
```

Notes: the port has **no `send`**; sending is the dispatcher's job, outside any transaction. A caller never learns the provider's answer synchronously. The caller reads status back from the outbox row (the pattern awcms-one ADR-0034 D1 uses: the request record references the outbox row by `correlation_id`; status is never duplicated into the caller's table, so it cannot drift). The `refused` and `suppressed` outcomes are returned, not thrown, so a booking is never rolled back because a reminder could not be queued.

Provisional events (AsyncAPI, by the implementation PR; payloads carry ids and masked recipient only, never a phone number, body or variable): `whatsapp.message.queued`, `whatsapp.message.sent`, `whatsapp.message.failed`, `whatsapp.message.expired`, `whatsapp.consent.granted`, `whatsapp.consent.withdrawn`, `whatsapp.dispatch.failed` (job-level), following the `email.message.*` / `push.dispatch.*` naming.

Provisional permissions: `whatsapp_delivery.messages.read|cancel`, `whatsapp_delivery.suppressions.read|create|delete`, `whatsapp_delivery.consents.read|create|withdraw`, `whatsapp_delivery.templates.read`; each registered by a migration seed in the same change as the endpoint (the seed-gap trap in `AGENTS.md`).

### 9. What must exist before implementation starts

- The downstream owner has accepted awcms-one ADR-0040 (Wave A item A1) — the gate stated in #917.
- An implementation issue that names the module key, `sql/NNN` range, the permission seeds and the `AccessAction` additions (if any), and the OpenAPI/AsyncAPI files.
- Confirmation of where consent is stored (§10, Q1) — the one design question that changes the schema.
- A security review (the module sends messages containing OTPs and handles phone numbers), per the sensitive-module rule in `AGENTS.md`.
- The consumer registration mechanism being settled in ADR-0134, so booking/hr/commerce register templates the same way.
- A plan for the admin screen and its `navigation` entry in the same change (ADR-0021 criterion 1; `AGENTS.md` navigation rule).
- Tests planned up front: template allow-list drops unlisted variables; marketing without consent is refused; consent checked again at dispatch; secrets cleared at terminal; no network I/O within a transaction (a harness that fails if a provider is called while a transaction is open); a purge never deletes non-terminal rows.

### 10. Open questions

1. **Where does consent live?** A `whatsapp_delivery`-owned `consents` table keyed by `(tenant_id, recipient_hash)`, or a channel-neutral contact-preference record owned by `profile_identity` (which every future channel could reuse, but which is one step toward the orchestration refused in §7)? Leaning: module-owned now, extracted only if a second channel is admitted.
2. **Inbound webhooks** (delivery receipts, "stop"/"berhenti" replies): in the first implementation or a follow-up? Without them, opt-out by reply and delivery confirmation do not exist; with them, the module gains a public unauthenticated surface (per awcms-one ADR-0017 D2 shape).
3. **Sender identity**: one WhatsApp number per deployment (what BjekMart-style deployments do today) or per tenant? Credentials stay per deployment (§5); the open point is whether a tenant may select _which_ of several deployment-level senders it uses.
4. **Meta template approval**: Meta requires pre-approved templates for business-initiated messages outside the 24-hour window; the registry needs a field for the approved template name/language, and a rule for what happens on mismatch (fail terminally, never fall back to free text for `transactional`/`marketing`).
5. **Shared dispatcher code**: extract a common lease/claim helper now, or let the fourth copy stand and extract in a follow-up? This ADR permits either; a reviewer should insist if the implementation PR would otherwise copy more than the claim query.
6. **Booking reminders at scale**: a reminder scheduled days ahead is a queue row waiting; confirm the dispatcher claim index and the purge's "waiting" exclusion hold for long `notBefore` horizons, or decide that reminders are enqueued shortly before the send time by a booking job instead.
7. **Reveal of the raw number** to an admin (to call a customer): required or not? Default is no.
8. **O10 and O11** were answered by the owner on 2026-10-10 (Telegram admitted as an optional, off-by-default adapter; orchestration wanted, subject to a value case); see the update note in §7. Neither is admitted in this repository until it has its own ADR/issue.

## Consequences

- Booking, hr_payroll and commerce share one WhatsApp queue, one set of provider rules and one consent check. A fix to the provider path lands once, upstream.
- The repo gains a **third channel table** (email, push, WhatsApp). The cost is real and is accepted: one more dispatcher job pair, one more admin surface and one more retention registration, bounded by the rule in §3 that no domain adds a fourth.
- Commerce carries a **dated** compatibility adapter. If the end condition is not met on time, the plan is wrong and needs a new ADR, not a quiet extension.
- No schema, API or event changes land with this ADR; `bun run check` is unaffected beyond documentation gates.
- Telegram and orchestration stay unbuilt and un-admitted; their owner decisions (O10, O11) are tracked downstream. Neither a stub module nor a multi-channel facade is introduced "for later".

## Alternatives rejected

- **(b) Port upstream, implementation stays in commerce.** Rejected in §1: wrong dependency direction, untestable upstream, no natural end for the adapter, and a booking-only or hr-only deployment would have no WhatsApp.
- **WhatsApp as a `domain_events` consumer.** Rejected: handlers run inside the dispatch transaction; a provider call there violates ADR-0006 (ADR-0074).
- **Add a channel discriminator to `awcms_email_messages`.** Rejected: mixed-shape table, two dispatchers contending, e-mail retry policy leaking into WhatsApp (ADR-0074's reasoning).
- **A generic `MessageDeliveryPort(channel, …)` facade now.** Rejected: that is notification orchestration admitted by the back door (§7, O11).
- **Per-domain WhatsApp queues** (booking's own, hr's own). Rejected: this is the exact outcome the issue exists to prevent; §3 makes it a binding rule.
- **Tenant-supplied provider credentials.** Rejected for the reason in ADR-0074 §5.
- **Consent inferred from segment membership or campaign audience.** Rejected: §4.
