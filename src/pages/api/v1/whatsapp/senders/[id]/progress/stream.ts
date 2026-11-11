import { defineProgressSseRoute } from "../../../../../../../modules/_shared/progress-sse-route";
import { whatsappSenderProgressTopic } from "../../../../../../../modules/whatsapp-delivery/application/whatsapp-sender-progress";

/**
 * `GET /api/v1/whatsapp/senders/{id}/progress/stream` (Issue #1171, ADR-0154)
 * — one sender's delivery progress as Server-Sent Events, on the existing Bun
 * process (no second listener, no WebSocket).
 *
 * Authorization: `whatsapp_delivery.progress.read` through the chokepoint, and
 * the sender visible to the caller by the rules of `channel_accounts`, both
 * decided at open AND on every tick. A role, an assignment or a business scope
 * removed mid-stream ends it on the next tick with `authorization-revoked`
 * (audited). Guarded by `whatsapp_delivery.progress.read` — written out here as
 * a literal for the gates that read source text:
 *
 *   moduleKey: "whatsapp_delivery", activityCode: "progress", action: "read"
 *
 * Numbers, each chosen here as ADR-0075 requires:
 *
 * - `tickIntervalMs: 5000` — the revocation latency and the freshness. Faster
 *   than `whatsapp:dispatch` (every one or two minutes) by an order of
 *   magnitude, and one guard chain plus three indexed reads per tick per
 *   connection.
 * - `heartbeatMs: 15000` — below the 60 s idle timeout of common proxies.
 *   Measured on Bun 1.4.4: the `node:http` server the standalone entry uses did
 *   NOT close a stream that was silent for 25 s, so this is for the proxies.
 * - `maxConnectionMs: 600000` — ten minutes, then `stream-expired`; the client
 *   reconnects with `Last-Event-ID` and loses nothing.
 * - `maxChangesPerFrame: 50`, `maxFrameBytes: 16384` — a larger change set is a
 *   `snapshot-required` event, never a bigger frame.
 */
export const GET = defineProgressSseRoute({
  topic: whatsappSenderProgressTopic,
  workClass: "interactive",
  tickIntervalMs: 5_000,
  heartbeatMs: 15_000,
  maxConnectionMs: 600_000,
  maxChangesPerFrame: 50,
  maxFrameBytes: 16_384,
  retryMs: 5_000
});
