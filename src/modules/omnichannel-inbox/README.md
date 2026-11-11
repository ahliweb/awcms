🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `omnichannel_inbox`

A tenant-scoped staff work queue over the verified inbound envelopes (Issue
#1164, [ADR-0160](../../../docs/adr/0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.md),
**Accepted** 2026-11-11; it refines ADR-0150 §1 for staff work state only).

Ships **`experimental` and off** (`OMNICHANNEL_INBOX_ENABLED`): every route
answers `404`, the projector consumer does nothing and `bun run
omnichannel-inbox:sla` is inert.

## What it is

- **Projection.** The consumer `omnichannel_inbox.conversation_projector`
  subscribes to `awcms.telegram_engagement.interaction.received` and
  `awcms.website_engagement.submission.received` / `withdrawn`. It keeps one
  conversation row per (source kind, opaque reference): the account-scoped
  contact id or the submission id, the channel account and its business scope
  (brand), first/last inbound time and a customer state. **No message body, no
  content reference, no sender address, no external id, no name, no media.**
  `awcms.telegram_engagement.consent.changed` is projected too, but it is
  **not subscribed** (see below).
- **Runs as `awcms_worker`.** The dispatcher (`bun run domain-events:dispatch`)
  runs the consumer on `WORKER_DATABASE_URL`. `sql/382` gives that role
  column-level INSERT/UPDATE on exactly the columns the projector writes, an
  append-only INSERT on the activity history, and a read of the SLA policy
  terms. It cannot read or write the assignee or the response stamps.
- **Idempotent by value.** First/last inbound are LEAST/GREATEST; an inbound
  counts as unanswered only if received after `answered_through`; a
  customer-state change applies only with a newer `event_sequence`; `withdrawn`
  is terminal (`sql/384`). A duplicate delivery, a replay and a rebuild converge
  on the same row. A customer-state event that arrives before the conversation
  exists is applied when the conversation is created (read back from the log,
  newest first).
- **Customer-state sweep.** The customer bot dispatcher publishes
  `consent.changed` under its own role, which `sql/374` keeps from writing
  delivery rows, so no consumer may subscribe to it
  (`tests/domain-event-delivery-forbidden-subscriptions.test.ts` pins that for
  every module). The SLA job applies the consent changes and website
  withdrawals of the last 48 hours that the projection has not applied yet.
  For withdrawals this is a safety net behind the consumer: a withdrawal whose
  delivery dead-lettered is still applied.
- **Rebuild.** `POST /projection/rebuild` replays the four event types inside
  the window (at most 365 days) in batches of 2000. Staff work state is never
  reset. Only a caller acting tenant-wide may run it.
- **Staff work state.** Status (`open`, `pending`, `resolved`, `closed`; a NEW
  unanswered inbound reopens a settled conversation), assignment with an
  append-only history, tags (≤ 20, per-tenant catalogue), responses, SLA.
  Deleting a catalogue tag unlinks it everywhere, records `tag_removed` and
  moves each affected conversation's version.
- **SLA.** Per tenant or per business scope: an IANA zone, weekday windows,
  holidays, first/next response budgets in business minutes. The clock starts
  at the server receipt time of the first unanswered inbound. The inbox sends
  nothing, so a response is recorded by staff (`POST …/responses`) after
  replying through the channel's own route.
- **SLA job** (`omnichannel-inbox:sla`, every 5 minutes, `awcms_app`, one
  transaction per tenant, a failing tenant never stops the others): the
  customer-state sweep; then a re-check of at most 500 (assignee, scope) pairs,
  least recently checked first, so every pair is reached within a few runs;
  assignees who lost eligibility are unassigned (`assignee_revoked` with a
  reason); then breaches are stamped once and **only the assignee** is told,
  through the existing `workflow_notification` port (template
  `omnichannel_inbox.sla_breached`, variables `breachedCount` only; a missing
  template is a silent no-op).

## Access

Default-deny permissions (seeded by `sql/383`): `conversations.read`,
`conversations.update`, `conversations.assign` (high-risk, `Idempotency-Key`),
`tags.configure`, `sla_policies.read`, `sla_policies.configure`,
`projection.configure` (high-risk).

- **Tenant-wide** means: not scope-confined **and** holding the route's
  permission through a tenant-wide grant (ADR-0080 keeps a scoped grant's keys
  tenant-level at the chokepoint, so the key alone is not enough). Such a
  caller sees every conversation and may configure tags, the tenant default SLA
  policy and the rebuild.
- **Everyone else** sees only the business scopes they cover, through
  `channel_accounts`' rules, and **never a tenant-wide conversation** (every
  website submission is tenant-wide). A scope-confined caller is one with any
  active non-tenant assignment that has not ended, **including one that has
  not started yet** (#1270). A caller with neither sees nothing. The SLA policy
  list shows them the tenant default plus their scopes' policies.
- **Assignee.** An active user holding `conversations.update` on a tenant-wide
  grant and, if confined, an active, started assignment on the conversation's
  scope or an ancestor. A refusal is one `422 ASSIGNEE_NOT_ELIGIBLE` with no
  reason, so the route is no oracle on a colleague's account.
- Every write is guarded by `expectedVersion`; concurrent writers get one
  success and one `409`.

## Retention

Conversations are purged by `data_lifecycle` on `last_inbound_at` after the
descriptor's `defaultRetentionDays` (365). The purge has **no per-tenant
override** today, and the rebuild window is capped at the same number
(`MAX_REBUILD_WINDOW_DAYS`, bound to the descriptor by
`tests/omnichannel-inbox-domain.test.ts`), so a rebuild cannot bring back a
conversation the purge removed.

## Open decisions (recorded, fail-closed in the meantime)

- Q2: should visibility also need the channel-account assignment? Today it
  does not.
- Q3: unassigned breaches notify nobody.
- Q4: internal notes are not built.
- The assignee's own ABAC deny policies cannot be evaluated for them; the
  chokepoint applies them on each of their requests.

## Follow-ups

- The operator screen (`/admin/*`); its 7 permissions are in `NOT_YET_SCREENED`.
- A realtime "inbox hint" topic (ADR-0154 registry), an outbound "reply queued"
  event from the channel modules to replace the manual response record, and
  WhatsApp inbound once it exists.
- If `data_lifecycle` ever gains a per-tenant retention override, the rebuild
  window must follow it.
