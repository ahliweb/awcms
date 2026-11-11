🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `omnichannel_inbox`

A tenant-scoped staff work queue over the verified inbound envelopes (Issue
#1164, [ADR-0160](../../../docs/adr/0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.md),
**Proposed** — it needs the owner's acceptance because it refines ADR-0150 §1).

Ships **`experimental` and off** (`OMNICHANNEL_INBOX_ENABLED`): every route
answers `404`, the projector consumer does nothing and `bun run
omnichannel-inbox:sla` is inert.

## What it is

- **Projection.** The consumer `omnichannel_inbox.conversation_projector` reads
  `awcms.telegram_engagement.interaction.received` / `consent.changed` and
  `awcms.website_engagement.submission.received` / `withdrawn` and keeps one
  conversation row per (source kind, opaque reference): the account-scoped
  contact id or the submission id, the channel account and its business scope
  (brand), first/last inbound time and a customer state. **No message body, no
  content reference, no sender address, no external id, no name, no media.**
- **Idempotent by value.** First/last inbound are LEAST/GREATEST; an inbound
  counts as unanswered only if received after `answered_through`; a
  customer-state change applies only with a newer `event_sequence`; `withdrawn`
  is terminal (`sql/384`). A duplicate delivery, a replay and a rebuild converge
  on the same row. A consent event that arrives before the conversation exists
  is applied when the conversation is created (read back from the log).
- **Rebuild.** `POST /projection/rebuild` replays the four event types inside
  the window (at most 365 days) in batches of 2000. Staff work state is never
  reset.
- **Staff work state.** Status (`open`, `pending`, `resolved`, `closed`; a NEW
  unanswered inbound reopens a settled conversation), assignment with an
  append-only history, tags (≤ 20, per-tenant catalogue), responses, SLA.
- **SLA.** Per tenant or per business scope: an IANA zone, weekday windows,
  holidays, first/next response budgets in business minutes. The clock starts
  at the server receipt time of the first unanswered inbound. The inbox sends
  nothing, so a response is recorded by staff (`POST …/responses`) after
  replying through the channel's own route.
- **SLA job** (`omnichannel-inbox:sla`, every 5 minutes, `awcms_app`, one
  transaction per tenant, a failing tenant never stops the others): unassigns
  assignees who lost eligibility (`assignee_revoked` with a reason), stamps
  breaches once and notifies **only the assignee** through the existing
  `workflow_notification` port (template `omnichannel_inbox.sla_breached`,
  variables `breachedCount` only; a missing template is a silent no-op).

## Access

Default-deny permissions (seeded by `sql/383`): `conversations.read`,
`conversations.update`, `conversations.assign` (high-risk, `Idempotency-Key`),
`tags.configure`, `sla_policies.read`, `sla_policies.configure`,
`projection.configure` (high-risk). Visibility uses `channel_accounts`' rules:
a **scope-confined** caller (any active non-tenant assignment that has not
ended, **including one that has not started yet**, #1270) sees only the
business scopes they cover and **never a tenant-wide conversation** (every
website submission is tenant-wide). An assignee must be an active user holding
`conversations.update` on a tenant-wide grant and, if confined, an active
assignment on the conversation's scope or an ancestor. Every write is guarded
by `expectedVersion`; concurrent writers get one success and one `409`.

## Open decisions (recorded, fail-closed in the meantime)

- ADR-0160 itself (Q1) and whether visibility should also need the channel
  account assignment (Q2; today it does not).
- Unassigned breaches notify nobody (Q3); internal notes are not built (Q4).
- The assignee's own ABAC deny policies cannot be evaluated for them; the
  chokepoint applies them on each of their requests.
- A tenant that shortened its conversation retention below 365 days must pass a
  smaller `windowDays` to the rebuild, or a rebuild may restore a conversation
  that its own purge removed (known limitation).

## Follow-ups

- The operator screen (`/admin/*`); its 7 permissions are in `NOT_YET_SCREENED`.
- A realtime "inbox hint" topic (ADR-0154 registry), an outbound "reply queued"
  event from the channel modules to replace the manual response record, and
  WhatsApp inbound once it exists.
