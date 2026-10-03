import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { log } from "../../../../../lib/logging/logger";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  MissionControlReplayInvalidError,
  parseReplayQuery,
  type ReplayQuery
} from "../../../../../modules/omes-control/domain/mission-control-replay";
import { createMissionControlCan } from "../../../../../modules/omes-control/application/mission-control-directory";
import { fetchMissionControlReplayWindow } from "../../../../../modules/omes-control/application/mission-control-replay-directory";

/**
 * `GET /api/v1/omes/mission-control/replay?from=&to=&cursor=` (Issue
 * ahliweb/omes#266, epic ahliweb/omes#263, ADR-0031 rule 4) — ONE bounded,
 * keyset-paginated page of the evidence already retained for the 3D Mission
 * Control historical replay. It is a read projection over existing tables: no
 * new store, no new permission, no action, no raw payload.
 *
 * Strict query validation (no free-form fields): `from` and `to` are required
 * UTC instants (`2026-10-02T08:00:00Z`) with `from < to`, a span of at most 24
 * hours and `to` not in the future; `cursor` is the opaque `next_cursor` of the
 * previous page; any other parameter is a 400. A page holds at most 500 events.
 *
 * Guarded by `omes_control.servers.read` — the workspace's own gate. Each
 * source is then read only if the viewer holds its OWN read permission (the
 * live scene's guards, `createMissionControlCan`); a source they may not read
 * contributes no events and is reported as a `source_unavailable` gap. An
 * invalid page fails CLOSED (generic 500, JSON paths only logged).
 */
export const GET = defineTenantRoute<ReplayQuery>({
  workClass: "interactive",
  prepare: ({ url, now }): ReplayQuery | Response => {
    const parsed = parseReplayQuery(url.searchParams, now);
    if (!parsed.ok) return fail(400, "VALIDATION_ERROR", parsed.message);
    return parsed.value;
  },
  authorize: OMES_GUARDS.servers.read,
  handler: async ({
    tx,
    tenantId,
    tokenHash,
    now,
    request,
    clientAddress,
    locals,
    prepared
  }) => {
    const can = createMissionControlCan({
      tx,
      tenantId,
      tokenHash,
      now,
      clientIp: resolveClientIp(request, clientAddress)
    });

    try {
      const window = await fetchMissionControlReplayWindow({
        tx,
        tenantId,
        now,
        can,
        from: prepared.from,
        to: prepared.to,
        cursor: prepared.cursor
      });
      return ok({ window });
    } catch (error) {
      if (error instanceof MissionControlReplayInvalidError) {
        log("error", "omes.mission_control.replay_invalid", {
          correlationId: locals.correlationId,
          invalidPaths: [...error.invalidPaths]
        });
        return fail(
          500,
          "MISSION_CONTROL_REPLAY_INVALID",
          "The Mission Control replay window could not be composed."
        );
      }
      throw error;
    }
  }
});
