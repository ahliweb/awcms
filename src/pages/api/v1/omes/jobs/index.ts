import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchJobs } from "../../../../../modules/omes-control/application/job-directory";

/**
 * `GET /api/v1/omes/jobs` (Issue ahliweb/omes#198) — worker job queue view:
 * state, correlation via `operationRequestId`, and sanitized evidence
 * (`target`/`payload`/`result` are redacted defense-in-depth). This never
 * exposes an idempotency key belonging to the pull worker's own wire
 * protocol (out of scope, ahliweb/omes#199) — only this API's own
 * `Idempotency-Key` handling (operation submission) is client-facing.
 */
const VALID_STATE_FILTERS = new Set([
  "queued",
  "leased",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

type Prepared = {
  state: string | null;
  serverId: string | null;
  cursor: KeysetCursor | undefined;
};

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }): Prepared | Response => {
    const state = url.searchParams.get("state");
    if (state !== null && !VALID_STATE_FILTERS.has(state)) {
      return fail(400, "VALIDATION_ERROR", "state is not a known value.");
    }

    const serverId = url.searchParams.get("serverId");
    const rawCursor = url.searchParams.get("cursor");

    if (rawCursor === null) {
      return { state, serverId, cursor: undefined };
    }

    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { state, serverId, cursor };
  },
  authorize: OMES_GUARDS.jobs.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await fetchJobs(tx, tenantId, {
        state: prepared.state ?? undefined,
        serverId: prepared.serverId ?? undefined,
        cursor: prepared.cursor
      })
    )
});
