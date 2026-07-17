---
"awcms": patch
---

Fix silent row loss in keyset pagination: the shared cursor now carries
`created_at` at full microsecond precision instead of flooring it to
milliseconds (Issue #158).

`encodeKeysetCursor` used to serialise a row's `created_at` as a JS `Date`
(`.toISOString()`), which holds only milliseconds — but `timestamptz` holds
microseconds, and the driver had already floored them on the way out
(`...:00.029058+00` arrives as `...:00.029Z`). A cursor built from that `Date`
denoted an instant strictly EARLIER than the row it came from, so
`(created_at, id) < (cursor)` skipped every row that shared that millisecond
across a page boundary — rows that no later cursor could reach either. Measured
against a batch of rows sharing one millisecond, page 2 came back empty.

The fix carries the value through the cursor as full-precision UTC ISO-8601
text (`_shared/keyset-pagination.ts`, `KEYSET_CURSOR_CREATED_AT_SQL`), keeping
`ORDER BY (created_at, id)` on the bare column so the existing
`(tenant_id, created_at DESC)` indexes still serve the query. `KeysetCursor.createdAt`
is now a string, not a `Date`; the cursor stays opaque to clients and remains
backward-compatible with any millisecond cursor already in flight.

Endpoints corrected: `GET /api/v1/workflows/tasks`, `GET /api/v1/email/messages`,
`GET /api/v1/sync/object-queue`, and `GET /api/v1/offices` (whose earlier local
`date_trunc('milliseconds', …)` guard is removed now that the fix is central).
The `GET /api/v1/email/messages` and `GET /api/v1/sync/object-queue` response
bodies are unchanged (`{ …, nextCursor }`); only the value of `nextCursor` is
now correct.
