---
"awcms": minor
---

feat(realtime): the omnichannel inbox's live work counts as the second admitted SSE topic, `inbox.status.progress` (Issue #1171, ADR-0154 task 3). Still SSE only: **no WebSocket, no second listener, no Node or Socket.IO process, no second queue.**

`GET /api/v1/omnichannel-inbox/progress` is the REST snapshot and polling fallback; `GET /api/v1/omnichannel-inbox/progress/stream` is the `text/event-stream`, built with the same `defineProgressSseRoute` factory as `whatsapp.sender.progress` (Origin and Fetch Metadata refused before any work, re-authorization every 5 s with `authorization-revoked` and an audit row, `Last-Event-ID` resume on any instance, `snapshot-required`, per-actor/per-tenant/per-instance caps, slow-consumer eviction, `stream-expired`). Both need the new, separately grantable permission `omnichannel_inbox.status.read` (`sql/413`, which also adds the keyset and active-work indexes on `awcms_inbox_conversations`); both answer `404` while `OMNICHANNEL_INBOX_ENABLED` is off.

It is a hint, not a preview: counts of ACTIVE work (`open`, `pending`, `awaitingReply`, `unassigned`, `slaBreached`) and, per changed conversation, only its id, status and time. Never a source reference, channel account, assignee, tag, message body or customer identifier. Rows are filtered exactly as the conversation list is (a scope-confined caller sees only the business scopes they cover and never a tenant-wide conversation); a scope swapped mid-stream changes the next frame, a role or session removed ends the stream. Counting only open and pending conversations keeps a tick's cost proportional to the work in progress.

No admin screen consumes it yet. Not admitted by this change, and still outside ADR-0154: WebSocket, cross-instance fan-out beyond cursor resume, a campaign topic (no campaign entity exists) and cross-channel per-message status.

**Deploy:** `sql/413` builds two indexes on `awcms_inbox_conversations` without `CONCURRENTLY` (a short SHARE lock on a table of thousands of rows). Operator action: `bun run db:migrate` (forward-only) and `bun run identity-access:permissions:backfill` for tenants that already exist. See `docs/awcms/realtime-progress-streams.md`.
