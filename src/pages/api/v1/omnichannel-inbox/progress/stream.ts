import { defineProgressSseRoute } from "../../../../../modules/_shared/progress-sse-route";
import { inboxStatusProgressTopic } from "../../../../../modules/omnichannel-inbox/application/inbox-status-progress";

/**
 * `GET /api/v1/omnichannel-inbox/progress/stream` (Issue #1171, ADR-0154) — the
 * inbox's live work counts and which conversations changed, as Server-Sent
 * Events on the existing Bun process (no second listener, no WebSocket).
 *
 * It is a HINT: counts, and per changed conversation only its id, status and
 * time. The page re-fetches the list through the authorized REST read; no
 * preview, source reference, assignee or customer identifier is streamed.
 *
 * Authorization: `omnichannel_inbox.status.read` through the chokepoint, and
 * the rows visible by the same rule as the conversation list (business scope of
 * a confined caller), decided at open AND on every tick. The ids named in a
 * frame are further limited to conversations the caller could list
 * (`omnichannel_inbox.conversations.read` coverage); the counts follow
 * `status.read` alone. Losing the permission or the session ends the stream on
 * the next tick with `authorization-revoked` (audited). Losing or changing a
 * business scope does NOT end it: swapping scope narrows the frames, while
 * removing the LAST scope ends confinement (a tenant-wide role then sees the
 * whole tenant; revoke the permission or role to cut access). An
 * assignee change has no effect. Guarded by `omnichannel_inbox.status.read`
 * — written out here as a literal for the gates that read source text:
 *
 *   moduleKey: "omnichannel_inbox", activityCode: "status", action: "read"
 *
 * Numbers, each chosen here as ADR-0075 requires:
 *
 * - `tickIntervalMs: 5000` — the revocation latency and the freshness: staff
 *   work in minutes (SLA budgets are in business minutes), and per tick per
 *   connection: one logged guard decision (`status.read`), a handful of indexed
 *   reads, and, for a scope-confined caller, one UNLOGGED chokepoint evaluation
 *   per candidate scope (at most 200, twice: `status.read` and
 *   `conversations.read`). Those scope probes write no decision-log row, so the
 *   ledger grows by one row per tick however many scopes the caller holds.
 * - `heartbeatMs: 15000` — below the 60 s idle timeout of common proxies.
 * - `maxConnectionMs: 600000` — ten minutes, then `stream-expired`; the client
 *   reconnects with `Last-Event-ID` and loses nothing.
 * - `maxChangesPerFrame: 50`, `maxFrameBytes: 16384` — a larger change set is a
 *   `snapshot-required` event, never a bigger frame.
 */
export const GET = defineProgressSseRoute({
  topic: inboxStatusProgressTopic,
  workClass: "interactive",
  tickIntervalMs: 5_000,
  heartbeatMs: 15_000,
  maxConnectionMs: 600_000,
  maxChangesPerFrame: 50,
  maxFrameBytes: 16_384,
  retryMs: 5_000
});
