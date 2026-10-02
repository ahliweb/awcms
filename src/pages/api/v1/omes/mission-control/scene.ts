import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { log } from "../../../../../lib/logging/logger";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import { createAuthorizationReadCache } from "../../../../../modules/identity-access/application/authorization-read-cache";
import type { AccessRequest } from "../../../../../modules/identity-access/domain/access-control";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { MissionControlSceneInvalidError } from "../../../../../modules/omes-control/domain/mission-control";
import { composeMissionControlSceneForViewer } from "../../../../../modules/omes-control/application/mission-control-directory";

/**
 * `GET /api/v1/omes/mission-control/scene` (Issue ahliweb/omes#265, epic
 * ahliweb/omes#263, ADR-0031) — the ONE read-only, tenant-scoped, bounded
 * composition behind the 3D Mission Control workspace. It is a derived
 * projection of records existing screens already own: no new permission, no
 * new table, no action availability (read-only; actions are #267).
 *
 * Guarded by `omes_control.servers.read` — the same permission as the
 * Overview this workspace sits beside. That guard only admits the viewer; the
 * composer then evaluates each SOURCE's own read permission (source map
 * `read_permission`) through the same `authorizeInTransaction` chokepoint and
 * reports a source the viewer may not read as `unavailable`, with none of its
 * nodes. `can` shares one read cache across those evaluations (the memo
 * `loadAdminScreen` uses for the same reason) and carries `clientIp` so a
 * machine credential's IP restriction is enforced for them too.
 *
 * An invalid composition fails CLOSED: a generic 500, with only the failing
 * JSON paths logged — never label/summary contents.
 */
export const GET = defineTenantRoute<undefined>({
  workClass: "interactive",
  authorize: OMES_GUARDS.servers.read,
  handler: async ({
    tx,
    tenantId,
    tokenHash,
    now,
    request,
    clientAddress,
    locals
  }) => {
    const authorizeOptions = {
      clientIp: resolveClientIp(request, clientAddress),
      readCache: createAuthorizationReadCache()
    };

    const can = async (guard: AccessRequest): Promise<boolean> => {
      const result = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        guard,
        authorizeOptions
      );
      return result.allowed;
    };

    try {
      const scene = await composeMissionControlSceneForViewer({
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
