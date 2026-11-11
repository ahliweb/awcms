/**
 * The admitted realtime progress topics (Issue #1171, ADR-0154).
 *
 * This list IS the extension point. A topic is admitted by adding an entry here
 * in the same change that adds:
 *
 * 1. a `ProgressTopic` implementation in its owning module (a projection of
 *    rows that module already owns; never a new queue);
 * 2. its permission in that module's descriptor AND in a seeding migration
 *    (`tests/realtime-topics-registry.test.ts` checks both);
 * 3. a REST snapshot route and an SSE route built with
 *    `defineProgressSseRoute` (`_shared/progress-sse-route.ts`), both in OpenAPI.
 *
 * The client never names a topic string: each topic has its own path, and the
 * client names only the resource id in it (ADR-0154 R4). `topic` here is a
 * code-defined constant used in the envelope and as a metric label.
 *
 * ## Not admitted yet, on purpose
 *
 * - **Inbox hint** (`inbox.status.read`): the unified inbox (Issue #1164) does
 *   not exist, so there is no durable row to project. It becomes an entry here
 *   in the change that builds the inbox, not before.
 * - **Campaign progress** (`crm_campaigns.progress.read`): there is no campaign
 *   entity in this repository. A campaign module would add its own topic over
 *   its own rows; until then the per-sender lane below is the real, durable
 *   progress there is to show.
 * - **Per-message status** across channels: ADR-0154 task 3, its own change.
 */
export type RealtimeTopicEntry = {
  /** Code-defined name carried in the envelope and as the `topic` metric label. */
  topic: string;
  /** Module that owns the projected rows and the permission. */
  moduleKey: string;
  permission: { activityCode: string; action: "read" };
  /** Route paths (Astro file-system form) of the SSE stream and its REST snapshot. */
  streamPath: string;
  snapshotPath: string;
};

export const WHATSAPP_SENDER_PROGRESS_TOPIC = "whatsapp.sender.progress";

export const REALTIME_TOPICS: readonly RealtimeTopicEntry[] = [
  {
    topic: WHATSAPP_SENDER_PROGRESS_TOPIC,
    moduleKey: "whatsapp_delivery",
    permission: { activityCode: "progress", action: "read" },
    streamPath: "/api/v1/whatsapp/senders/[id]/progress/stream",
    snapshotPath: "/api/v1/whatsapp/senders/[id]/progress"
  }
];
