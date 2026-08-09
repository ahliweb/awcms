import { defineSseTenantRoute } from "../../../../modules/_shared/tenant-route";
import { summarizePushQueue } from "../../../../modules/push-delivery/application/push-diagnostics";

/**
 * `GET /api/v1/push/stream` (Issue #467, ADR-0075) — the push queue summary,
 * live.
 *
 * The first and only SSE endpoint in this repo, and it exists because the
 * console it feeds is where an operator waits: `push:dispatch` runs every
 * minute or two, so "is the backlog draining?" is a question answered by
 * watching, and the alternative is a person pressing reload.
 *
 * ## Why the summary and nothing else
 *
 * Six counters and two timestamps — a few hundred bytes per tick. The message
 * and attempt lists on the same screen are deliberately NOT streamed: they are
 * bounded at 50 rows, they change shape rather than value, and re-sending them
 * every five seconds would spend two orders of magnitude more bandwidth to
 * animate a table nobody is watching row-by-row.
 *
 * ## Re-authorized every tick
 *
 * ADR-0075. Each tick opens its own transaction, runs the chokepoint again, and
 * reads only after it allows. A `push_delivery.diagnostics.read` grant revoked
 * mid-connection ends the stream on the next tick with an
 * `authorization-revoked` event — it does not wait for the client to
 * disconnect. That costs one guard chain per tick per connection, which is the
 * price of the stream holding no standing permission.
 *
 * `5000` ms and a `600000` ms ceiling: five seconds is faster than the
 * dispatcher's own schedule, so nothing is missed, and ten minutes is longer
 * than anyone watches a drain but short enough that an abandoned tab returns
 * its connection slot. `EventSource` reconnects by itself, so the ceiling costs
 * a reconnect and its absence would cost a slot forever.
 */
export const GET = defineSseTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "push_delivery",
    activityCode: "diagnostics",
    action: "read"
  },
  tickIntervalMs: 5_000,
  maxConnectionMs: 600_000,
  eventName: "push-queue-summary",
  read: async ({ tx, tenantId }) => summarizePushQueue(tx, tenantId)
});
