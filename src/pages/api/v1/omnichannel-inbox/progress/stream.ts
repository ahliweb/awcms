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
 * a confined caller), decided at open AND on every tick. A role, an assignment
 * or a business scope removed mid-stream ends it on the next tick with
 * `authorization-revoked` (audited). Guarded by `omnichannel_inbox.status.read`
 * — written out here as a literal for the gates that read source text:
 *
 *   moduleKey: "omnichannel_inbox", activityCode: "status", action: "read"
 *
 * Numbers, each chosen here as ADR-0075 requires:
 *
 * - `tickIntervalMs: 5000` — the revocation latency and the freshness: staff
 *   work in minutes (SLA budgets are in business minutes), and one guard chain
 *   plus three indexed reads per tick per connection.
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
