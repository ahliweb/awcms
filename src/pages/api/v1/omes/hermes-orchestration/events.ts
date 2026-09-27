import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchOrchestrationEvents } from "../../../../../modules/omes-control/application/hermes-orchestration-directory";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * `GET /api/v1/omes/hermes-orchestration/events` (Issue ahliweb/omes#246,
 * OMES issue #183) — the tenant-scoped orchestration activity stream
 * (`?session_id=` optionally narrows to one session), for
 * `/admin/omes/orkestrasi-langsung` and its live-refresh polling. Guarded
 * by `omes_control.hermes_orchestration.read`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: OMES_GUARDS.hermesOrchestration.read,
  handler: async ({ tx, tenantId, url }) => {
    const rawSessionId = url.searchParams.get("session_id");
    const sessionId =
      rawSessionId && SESSION_ID_PATTERN.test(rawSessionId)
        ? rawSessionId
        : undefined;

    const events = await fetchOrchestrationEvents(tx, tenantId, sessionId);
    return ok({ events });
  }
});
