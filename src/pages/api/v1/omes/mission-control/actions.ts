import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  parseActionsQuery,
  type MissionControlActionsQuery
} from "../../../../../modules/omes-control/domain/mission-control-actions";
import { createMissionControlCan } from "../../../../../modules/omes-control/application/mission-control-directory";
import {
  fetchMissionControlActions,
  toMissionControlActionsWire
} from "../../../../../modules/omes-control/application/mission-control-actions-directory";

/**
 * `GET /api/v1/omes/mission-control/actions?kind=&id=` (Issue
 * ahliweb/omes#267, epic ahliweb/omes#263, ADR-0031 rule 3) — which EXISTING
 * actions the viewer may take on the ONE selected Mission Control object, and
 * why an unavailable one is unavailable.
 *
 * ADVISORY ONLY. This endpoint authorizes nothing: every action is a call to
 * an existing endpoint (`POST /api/v1/omes/operations`,
 * `POST /api/v1/omes/jobs/{id}/cancel|approve`,
 * `POST /api/v1/omes/backups/{id}/restore`) that re-authorizes, rate-limits,
 * applies the destructive-workflow gate, audits and enforces idempotency on its
 * own. Adding, removing or ignoring this answer cannot widen what a caller can
 * do; it only drives which buttons the UI offers and what it tells the user.
 *
 * Strict query validation (no free-form field): `kind` is one of the Mission
 * Control kinds and `id` matches `^[A-Za-z0-9_.:-]{1,128}$`; any other
 * parameter (`command`, `shell`, `target`, `url`, ...) is a 400. An unknown id,
 * another tenant's id and an object in a source the viewer may not read are
 * indistinguishable (every action `not_found`) — the endpoint is no existence
 * oracle.
 *
 * Guarded by `omes_control.servers.read` — the workspace's own gate; the target
 * is then read only if the viewer also holds the source's own read permission
 * (`createMissionControlCan`, the scene's guards).
 */
export const GET = defineTenantRoute<MissionControlActionsQuery>({
  workClass: "interactive",
  prepare: ({ url }): MissionControlActionsQuery | Response => {
    const parsed = parseActionsQuery(url.searchParams);
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
    prepared
  }) => {
    const can = createMissionControlCan({
      tx,
      tenantId,
      tokenHash,
      now,
      clientIp: resolveClientIp(request, clientAddress)
    });

    return ok({
      actions: toMissionControlActionsWire(
        await fetchMissionControlActions({
          tx,
          tenantId,
          now,
          can,
          kind: prepared.kind,
          sourceId: prepared.sourceId
        })
      )
    });
  }
});
