import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { log } from "../../../../../lib/logging/logger";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { MissionControlSceneInvalidError } from "../../../../../modules/omes-control/domain/mission-control";
import { parseSceneQuery } from "../../../../../modules/omes-control/domain/mission-control-replay";
import {
  composeMissionControlSceneForViewer,
  createMissionControlCan
} from "../../../../../modules/omes-control/application/mission-control-directory";
import {
  composeHistoricalMissionControlSceneForViewer,
  missionControlReplayHorizonMs
} from "../../../../../modules/omes-control/application/mission-control-replay-directory";

/**
 * `GET /api/v1/omes/mission-control/scene` (Issue ahliweb/omes#265, epic
 * ahliweb/omes#263, ADR-0031) — the ONE read-only, tenant-scoped, bounded
 * composition behind the 3D Mission Control workspace. It is a derived
 * projection of records existing screens already own: no new permission, no
 * new table, no action availability (read-only; actions are #267).
 *
 * `?as_of=<UTC instant>` (Issue ahliweb/omes#266) asks for the scene a past
 * instant's RETAINED EVIDENCE proves (`mode: "historical"`): absent = live. It
 * must not be in the future nor older than the retention horizon, and `as_of`
 * is the ONLY query parameter accepted — an unknown one is a 400, not ignored.
 *
 * Guarded by `omes_control.servers.read` — the same permission as the
 * Overview this workspace sits beside. That guard only admits the viewer; the
 * composer then evaluates each SOURCE's own read permission (source map
 * `read_permission`) through the same `authorizeInTransaction` chokepoint
 * (`createMissionControlCan`) and reports a source the viewer may not read as
 * `unavailable`, with none of its nodes — in historical mode exactly as in
 * live mode.
 *
 * An invalid composition fails CLOSED: a generic 500, with only the failing
 * JSON paths logged — never label/summary contents.
 */
type Prepared = { asOf: Date | null };

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url, now }): Prepared | Response => {
    const parsed = parseSceneQuery(
      url.searchParams,
      now,
      missionControlReplayHorizonMs()
    );
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
      const scene = prepared.asOf
        ? await composeHistoricalMissionControlSceneForViewer({
            tx,
            tenantId,
            now,
            asOf: prepared.asOf,
            can
          })
        : await composeMissionControlSceneForViewer({
            tx,
            tenantId,
            now,
            can
          });
      return ok({ scene });
    } catch (error) {
      if (error instanceof MissionControlSceneInvalidError) {
        log("error", "omes.mission_control.scene_invalid", {
          correlationId: locals.correlationId,
          invalidPaths: [...error.invalidPaths]
        });
        return fail(
          500,
          "MISSION_CONTROL_SCENE_INVALID",
          "The Mission Control scene could not be composed."
        );
      }
      throw error;
    }
  }
});
